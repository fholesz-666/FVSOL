/**
 * fvsol-intake – veřejné rozhraní formuláře zakázek na fvsol.cz.
 * Zákazník nemá účet: k zakázce se dostane jen přes tajný odkaz (token), v databázi je uložen jen jeho otisk.
 * Anon role nemá k tabulkám přístup, vše jde přes tuto funkci se service role.
 */
import * as core from "./shared/core.js";
import { findLocation, GeoError, lookupSite, suggest } from "./shared/cuzk.ts";
import { mailConfirmation, mailCustomerReply, mailNewOrder, mailResume, sendMail } from "./shared/mail.ts";
import {
  adminUrl, BUCKET, cleanupDrafts, crmCreate, crmNote, crmSyncMissing, evaluateOrder, filesOf, objectSize,
  issueToken, orderByToken, sanitizeAnswers,
} from "./shared/orders.ts";
import { admin, corsHeaders, env, HttpError, ipHash, json, logEvent, rateLimit, safeFileName, str } from "./shared/util.ts";

type Body = Record<string, any>;

async function publicView(order: any) {
  const files = await filesOf(order.id);
  const { data: reqs } = await admin().from("info_requests").select("id,message,items,status,created_at,answered_at").eq("order_id", order.id).order("created_at");
  const inputs = files.filter((f: any) => f.direction === "in" && f.status !== "rejected");
  const outputs = files.filter((f: any) => f.direction === "out" && f.released && f.review_status === "overeno");
  const evaluation = evaluateOrder(order, inputs);
  const hasOpenRequest = (reqs ?? []).some((r: any) => r.status === "open");
  return {
    order: {
      code: order.code,
      service: order.service,
      phase: order.phase,
      answers: order.answers,
      site: order.site ? { buildings: order.site.buildings ?? [], lat: order.site.lat, lon: order.site.lon } : null,
      created_at: order.created_at,
      submitted_at: order.submitted_at,
      customer_status: core.customerStatus({ ...order, hasOpenRequest, hasReleasedOutput: outputs.length > 0 }),
    },
    files: inputs.map((f: any) => ({ id: f.id, category: f.category, file_name: f.file_name, size: f.size, status: f.status, created_at: f.created_at })),
    outputs: outputs.map((f: any) => ({ id: f.id, file_name: f.file_name, output_kind: f.output_kind, released_at: f.released_at })),
    requests: reqs ?? [],
    evaluation,
  };
}

const actions: Record<string, (req: Request, b: Body) => Promise<unknown>> = {
  async create(req, b) {
    const service = String(b.service ?? "");
    if (!core.SERVICES[service as keyof typeof core.SERVICES]) throw new HttpError(400, "Neznámá služba.");
    const ip = await ipHash(req);
    await rateLimit(`create:${ip}`, 3600, 20);
    const { data, error } = await admin().from("orders").insert({
      service, phase: "draft", status: "rozpracovana", answers: {}, created_ip_hash: ip,
    }).select("*").single();
    if (error) throw new HttpError(500, "Zadání se nepodařilo založit. Zkuste to prosím znovu.");
    const token = await issueToken(data.id, "web", "zakaznik");
    await logEvent(data.id, "created", "Rozpracované zadání založeno na webu.", { service });
    if (Math.random() < 0.05) cleanupDrafts().catch(() => {});
    return { token, ...(await publicView(data)) };
  },

  async get(req, b) {
    await rateLimit(`get:${await ipHash(req)}`, 3600, 900);
    return publicView(await orderByToken(b.token));
  },

  async save(req, b) {
    await rateLimit(`save:${await ipHash(req)}`, 3600, 900);
    const order = await orderByToken(b.token);
    if (order.phase !== "draft") throw new HttpError(409, "Odeslané zadání už nelze měnit. Doplnění pošlete přes stránku zakázky.");
    const service = core.SERVICES[b.service as keyof typeof core.SERVICES] ? String(b.service) : order.service;
    const answers = sanitizeAnswers(service, b.answers ?? {}, order.site);
    const files = await filesOf(order.id, "in");
    const evaluation = core.evaluate({ service, answers, site: order.site, files });
    const contact = { name: answers.kontakt_jmeno ?? null, email: answers.kontakt_email ? String(answers.kontakt_email).toLowerCase() : null, phone: answers.kontakt_telefon ?? null, company: answers.firma ?? null };
    const { error } = await admin().from("orders").update({ service, answers, contact, completeness: evaluation }).eq("id", order.id);
    if (error) throw new HttpError(500, "Uložení se nepovedlo.");
    return { saved_at: new Date().toISOString(), evaluation };
  },

  async upload_url(req, b) {
    await rateLimit(`upload:${await ipHash(req)}`, 3600, 200);
    const order = await orderByToken(b.token);
    if (order.phase === "cancelled") throw new HttpError(409, "Zakázka je zrušená.");
    const name = str(b.name, 200), size = Number(b.size);
    const allowed = core.fileCategoriesFor(order.service, order.answers);
    const category = allowed.includes(b.category) ? b.category : "jine";
    const existing = await filesOf(order.id, "in");
    const err = core.checkFile(name, size, existing);
    if (err) throw new HttpError(400, err);
    const id = crypto.randomUUID();
    const path = `${order.id}/in/${id}-${safeFileName(name)}`;
    const { data: signed, error: e1 } = await admin().storage.from(BUCKET).createSignedUploadUrl(path);
    if (e1 || !signed) throw new HttpError(500, "Nahrávání teď nejde připravit. Zkuste to prosím znovu.");
    const { error: e2 } = await admin().from("order_files").insert({
      id, order_id: order.id, direction: "in", category, storage_path: path, file_name: name,
      mime: str(b.type, 100) || null, size, status: "pending", uploaded_by: "zakaznik",
    });
    if (e2) throw new HttpError(500, "Soubor se nepodařilo zaevidovat.");
    return { file_id: id, url: signed.signedUrl, token: signed.token, path };
  },

  async file_done(req, b) {
    await rateLimit(`upload:${await ipHash(req)}`, 3600, 400);
    const order = await orderByToken(b.token);
    const { data: f } = await admin().from("order_files").select("*").eq("id", b.file_id).eq("order_id", order.id).maybeSingle();
    if (!f) throw new HttpError(404, "Soubor nenalezen.");
    if (f.status === "uploaded") return { ok: true };
    const size = await objectSize(f.storage_path);
    if (size == null) throw new HttpError(409, "Soubor se nenahrál celý. Zkuste ho nahrát znovu.");
    if (size > core.FILE_RULES.maxFileBytes) {
      await admin().storage.from(BUCKET).remove([f.storage_path]);
      await admin().from("order_files").update({ status: "rejected", note: "Překročena velikost" }).eq("id", f.id);
      throw new HttpError(400, "Soubor je větší než 50 MB.");
    }
    await admin().from("order_files").update({ status: "uploaded", size: size || f.size, uploaded_at: new Date().toISOString() }).eq("id", f.id);
    if (order.phase !== "draft") await logEvent(order.id, "file", `Zákazník nahrál soubor ${f.file_name}.`, { file_id: f.id, category: f.category }, { actor: "zakaznik" });
    return { ok: true };
  },

  async file_delete(_req, b) {
    const order = await orderByToken(b.token);
    const { data: f } = await admin().from("order_files").select("*").eq("id", b.file_id).eq("order_id", order.id).eq("direction", "in").maybeSingle();
    if (!f) throw new HttpError(404, "Soubor nenalezen.");
    if (order.phase !== "draft" && f.status === "uploaded") throw new HttpError(409, "Po odeslání zadání už soubory mazat nelze. Napište mi, který soubor neplatí.");
    await admin().storage.from(BUCKET).remove([f.storage_path]);
    await admin().from("order_files").delete().eq("id", f.id);
    return { ok: true };
  },

  async submit(req, b) {
    const ip = await ipHash(req);
    await rateLimit(`submit:${ip}`, 3600, 20);
    if (b.website) throw new HttpError(400, "Odeslání se nepodařilo."); // past na roboty
    if (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 4000) throw new HttpError(400, "Formulář byl vyplněn podezřele rychle. Zkuste to prosím znovu.");
    const order = await orderByToken(b.token);
    if (order.phase !== "draft") return { code: order.code, already: true };
    const files = await filesOf(order.id, "in");
    const ev = evaluateOrder(order, files);
    if (!ev.canSubmit) throw new HttpError(422, "Zadání ještě není kompletní.", { missing: ev.missing.filter((m: any) => m.level === "submit"), pending: ev.files.pending });
    const a = order.answers ?? {};
    const email = String(a.kontakt_email).toLowerCase();
    const { data: cust } = await admin().from("customers").upsert({
      email, name: str(a.kontakt_jmeno, 160), phone: str(a.kontakt_telefon, 40) || null, company: str(a.firma, 160) || null,
      ico: str(a.ico, 20) || null, kind: a.role ?? null,
    }, { onConflict: "email" }).select("id").single();
    const { data: code } = await admin().rpc("next_order_code");
    const { data: upd, error } = await admin().from("orders").update({
      code, phase: "inquiry", status: ev.suggestedStatus, submitted_at: new Date().toISOString(), completeness: ev,
      needs_review: ev.needsReview, customer_id: cust?.id ?? null,
    }).eq("id", order.id).eq("phase", "draft").select("*").single();
    if (error || !upd) throw new HttpError(500, "Odeslání se nepovedlo. Zkuste to prosím znovu.");
    await logEvent(upd.id, "submitted", `Zadání ${code} odesláno zákazníkem.`, { status: ev.suggestedStatus, missing: ev.missing.length }, { actor: "zakaznik", visible: true });

    const svc = core.SERVICES[upd.service as keyof typeof core.SERVICES];
    const later = ev.missing.filter((m: any) => m.level !== "submit").map((m: any) => m.ask || m.label);
    const conf = mailConfirmation(code, b.token, svc.title, later);
    const notify = mailNewOrder(code, adminUrl(upd), [
      `${svc.title}`, core.siteLabel(a.site) || "místo nezadáno", `${a.kontakt_jmeno} <${email}>${a.firma ? ", " + a.firma : ""}`,
      `Stav: ${core.STATUSES[ev.suggestedStatus as keyof typeof core.STATUSES]}; chybí ${ev.missing.length}, soubory ${ev.files.count}`,
    ]);
    await Promise.allSettled([
      crmCreate(upd, ev),
      sendMail(upd.id, "potvrzeni", { email, name: a.kontakt_jmeno }, conf.subject, conf.html),
      sendMail(upd.id, "nova-zakazka", { email: env("NOTIFY_EMAIL", "fholesz@gmail.com") }, notify.subject, notify.html),
    ]);
    return { code, ...(await publicView(upd)) };
  },

  async respond(req, b) {
    await rateLimit(`respond:${await ipHash(req)}`, 3600, 60);
    const order = await orderByToken(b.token);
    if (order.phase === "draft" || order.phase === "cancelled") throw new HttpError(409, "U této zakázky nelze nic doplnit.");
    const text = str(b.message, 5000).trim();
    const { data: open } = await admin().from("info_requests").select("id").eq("order_id", order.id).eq("status", "open");
    const now = new Date().toISOString();
    for (const r of open ?? []) await admin().from("info_requests").update({ status: "answered", answer: { message: text }, answered_at: now }).eq("id", r.id);
    const files = await filesOf(order.id, "in");
    const ev = evaluateOrder(order, files);
    const patch: Record<string, unknown> = { completeness: ev };
    if (order.status === "ceka_na_podklady" && !ev.missing.some((m: any) => m.level === "process")) patch.status = ev.needsReview ? "rucni_posouzeni" : "podklady_k_overeni";
    await admin().from("orders").update(patch).eq("id", order.id);
    await logEvent(order.id, "info_response", text || "Zákazník doplnil podklady.", { files: files.length }, { actor: "zakaznik", visible: true });
    const reply = mailCustomerReply(order.code, adminUrl(order), text);
    await Promise.allSettled([
      crmNote(order, `Klient doplnil podklady${text ? ": " + text : "."}`, "klient"),
      crmSyncMissing(order, ev),
      sendMail(order.id, "doplneno", { email: env("NOTIFY_EMAIL", "fholesz@gmail.com") }, reply.subject, reply.html),
    ]);
    return publicView(await orderByToken(b.token));
  },

  async download(req, b) {
    await rateLimit(`dl:${await ipHash(req)}`, 3600, 200);
    const order = await orderByToken(b.token);
    const { data: f } = await admin().from("order_files").select("*").eq("id", b.file_id).eq("order_id", order.id).maybeSingle();
    const allowed = f && ((f.direction === "out" && f.released && f.review_status === "overeno") || (f.direction === "in" && f.status === "uploaded"));
    if (!allowed) throw new HttpError(404, "Soubor není k dispozici.");
    const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(f.storage_path, 600, { download: f.file_name });
    if (error || !data) throw new HttpError(500, "Odkaz ke stažení se nepodařilo vytvořit.");
    if (f.direction === "out") await logEvent(order.id, "file", `Zákazník stáhl ${f.file_name}.`, { file_id: f.id }, { actor: "zakaznik" });
    return { url: data.signedUrl };
  },

  async send_link(req, b) {
    const order = await orderByToken(b.token);
    await rateLimit(`link:${order.id}`, 3600, 3);
    const email = String(order.answers?.kontakt_email ?? b.email ?? "").toLowerCase();
    if (!core.validEmail(email)) throw new HttpError(400, "Zadejte nejdřív platný e-mail.");
    const m = mailResume(b.token);
    const r = await sendMail(order.id, "odkaz", { email }, m.subject, m.html);
    if (!r.sent) throw new HttpError(503, "E-mail teď nejde odeslat. Uložte si prosím odkaz z adresního řádku.");
    return { ok: true };
  },

  async geo_suggest(req, b) {
    await rateLimit(`geo:${await ipHash(req)}`, 600, 300);
    const text = str(b.text, 120).trim();
    if (text.length < 3) return { suggestions: [] };
    return { suggestions: await suggest(text) };
  },

  async geo_find(req, b) {
    await rateLimit(`geo:${await ipHash(req)}`, 600, 300);
    const loc = await findLocation(str(b.text, 200), str(b.magicKey, 400));
    if (!loc) throw new HttpError(404, "Místo se nepodařilo najít.");
    return loc;
  },

  async geo_site(req, b) {
    await rateLimit(`geo:${await ipHash(req)}`, 600, 120);
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!(lat > 48.4 && lat < 51.2 && lon > 12 && lon < 19)) throw new HttpError(400, "Místo leží mimo Českou republiku.");
    const site = await lookupSite(lon, lat, { pick: b.pick ? String(b.pick) : null });
    if (b.token) {
      const order = await orderByToken(b.token);
      if (order.phase === "draft") await admin().from("orders").update({ site }).eq("id", order.id);
    }
    return { site };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Použijte POST." }, 405);
  let b: Body;
  try {
    const raw = await req.text();
    if (raw.length > 200_000) throw new HttpError(413, "Požadavek je příliš velký.");
    b = JSON.parse(raw || "{}");
  } catch (e) {
    return json(req, { error: e instanceof HttpError ? e.message : "Neplatný požadavek." }, e instanceof HttpError ? e.status : 400);
  }
  const fn = actions[String(b.action)];
  if (!fn) return json(req, { error: "Neznámá akce." }, 400);
  try {
    return json(req, await fn(req, b));
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message, ...(e.data ? { data: e.data } : {}) }, e.status);
    if (e instanceof GeoError) return json(req, { error: e.message, geo_unavailable: true }, 503);
    console.error("intake_error", b.action, e);
    return json(req, { error: "Něco se pokazilo na serveru. Zkuste to prosím znovu za chvíli." }, 500);
  }
});

