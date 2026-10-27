/**
 * fvsol-staff – akce administrace, které potřebují server: postup zakázky a CRM, e-maily zákazníkovi,
 * automatické zpracování. Volá ji jen přihlášený uživatel uvedený v tabulce staff.
 * Čtení, poznámky, nahrávání výstupů, ověření výstupu a správa vzorů jdou z administrace přímo přes RLS.
 */
import * as core from "./shared/core.js";
import { analyzeFile } from "./shared/analyze.ts";
import { buildingsAround, GeoError, lookupSite, parcelsAround } from "./shared/cuzk.ts";
import { fillDocx, listPlaceholders } from "./shared/docx.ts";
import { situaceDxf } from "./shared/dxf.ts";
import { mailConfirmed, mailInfoRequest, mailReleased, mailTest, orderLink, sendMail } from "./shared/mail.ts";
import {
  BUCKET, cleanupDrafts, crmApplyWorkflow, crmCreate, crmNote, crmSyncMissing, evaluateOrder, filesOf, issueToken,
  mergeSite, orderById, type Order,
} from "./shared/orders.ts";
import { TEMPLATE_KEYS, templateValues } from "./shared/templating.ts";
import { admin, corsHeaders, fmtDateCz, HttpError, json, logEvent, safeFileName, str } from "./shared/util.ts";

type Ctx = { email: string };
type Body = Record<string, any>;

async function staffFromRequest(req: Request): Promise<Ctx> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Přihlaste se.");
  const { data, error } = await admin().auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "Přihlášení vypršelo. Přihlaste se znovu.");
  const { data: s } = await admin().from("staff").select("email").eq("email", email).maybeSingle();
  if (!s) throw new HttpError(403, "Tento účet nemá přístup do administrace zakázek.");
  return { email };
}

const PRODUCTION = new Set(["situace_dxf", "project_data", "docx_sablona", "externi"]);

function requireConfirmed(order: Order) {
  if (!order.workflow?.potvrzeni?.done)
    throw new HttpError(409, "Zpracování lze spustit až po potvrzení zakázky (krok „Nabídka přijata – potvrdit zpracování“).");
}

async function nextOutputVersion(orderId: string, kind: string) {
  const { data } = await admin().from("order_files").select("output_version").eq("order_id", orderId).eq("direction", "out").eq("output_kind", kind);
  return Math.max(0, ...(data ?? []).map((r: any) => Number(r.output_version) || 0)) + 1;
}

async function storeOutput(order: Order, kind: string, name: string, mime: string, bytes: Uint8Array, source: string, by: string, extra: Record<string, unknown> = {}) {
  const version = await nextOutputVersion(order.id, kind);
  const id = crypto.randomUUID();
  const fileName = name.replace(/(\.[a-z0-9]+)$/i, `_v${version}$1`);
  const path = `${order.id}/out/${id}-${safeFileName(fileName)}`;
  const { error: e1 } = await admin().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (e1) throw new HttpError(500, `Výstup se nepodařilo uložit (${e1.message}).`);
  const { data, error } = await admin().from("order_files").insert({
    id, order_id: order.id, direction: "out", category: "vystup", storage_path: path, file_name: fileName, mime,
    size: bytes.length, status: "uploaded", uploaded_by: by, output_kind: kind, output_version: version, source,
    uploaded_at: new Date().toISOString(), ...extra,
  }).select("*").single();
  if (error) throw new HttpError(500, "Výstup se nepodařilo zaevidovat.");
  await logEvent(order.id, "output", `Vytvořen výstup ${fileName} (${source}) – čeká na kontrolu.`, { file_id: id, kind, version }, { actor: by });
  return data;
}

async function setStatusIf(order: Order, from: string[], to: string) {
  if (from.includes(order.status)) {
    await admin().from("orders").update({ status: to }).eq("id", order.id);
    order.status = to;
  }
}

async function download(path: string, bucket = BUCKET): Promise<Uint8Array> {
  const { data, error } = await admin().storage.from(bucket).download(path);
  if (error || !data) throw new HttpError(404, "Soubor se nepodařilo stáhnout z úložiště.");
  return new Uint8Array(await data.arrayBuffer());
}

/* ------------------------------------------------------------------ automatizace */

const tasks: Record<string, (order: Order, b: Body, ctx: Ctx) => Promise<Record<string, unknown>>> = {
  async geo_refresh(order) {
    const s = order.answers?.site ?? order.site;
    if (!Number.isFinite(s?.lat) || !Number.isFinite(s?.lon)) throw new HttpError(409, "Zakázka nemá souřadnice – místo zadal zákazník ručně.");
    const pick = s?.building?.id ?? null;
    const site = await lookupSite(s.lon, s.lat, { pick });
    const answers = { ...order.answers, site: mergeSite({ ...order.answers?.site, lat: site.lat, lon: site.lon }, site) };
    if (order.answers?.site?.building_confirmed && site.building?.id === pick) answers.site.building_confirmed = true;
    const files = await filesOf(order.id, "in");
    const ev = core.evaluate({ service: order.service, answers, site, files });
    await admin().from("orders").update({ site, answers, completeness: ev }).eq("id", order.id);
    await logEvent(order.id, "geo", "Údaje o stavbě znovu načteny z RÚIAN.", { building: site.building?.id ?? null, notes: site.notes });
    return { address: site.address, parcel: site.parcel, ku: site.ku, building: site.building, notes: site.notes };
  },

  async analyza_podkladu(order, b) {
    const ids: string[] = b.file_id ? [b.file_id] : [];
    if (!ids.length) throw new HttpError(400, "Vyberte soubor k analýze.");
    const { data: f } = await admin().from("order_files").select("*").eq("id", ids[0]).eq("order_id", order.id).maybeSingle();
    if (!f || f.status !== "uploaded") throw new HttpError(404, "Soubor není nahraný.");
    const meta = await analyzeFile(f.file_name, await download(f.storage_path));
    await admin().from("order_files").update({ meta: { ...(f.meta ?? {}), ...meta } }).eq("id", f.id);
    const files = await filesOf(order.id, "in");
    await admin().from("orders").update({ completeness: evaluateOrder(order, files) }).eq("id", order.id);
    return { file: f.file_name, ...meta };
  },

  async situace_dxf(order, _b, ctx) {
    const s = order.site ?? order.answers?.site;
    if (!Number.isFinite(s?.lat)) throw new HttpError(409, "Zakázka nemá souřadnice stavby.");
    const [parcels, buildings] = await Promise.all([parcelsAround(s.lon, s.lat, 120, "5514"), buildingsAround(s.lon, s.lat, 120, "5514")]);
    const { dxf, stats } = situaceDxf({
      parcels, buildings, selectedBuildingId: order.answers?.site?.building?.id ?? s.building?.id ?? null,
      title: `Situace – podklad z katastru, zakázka ${order.code}`,
      lines: [
        `${core.siteLabel(order.answers?.site ?? s)}${s.parcel ? ", p. č. " + s.parcel : ""}${s.ku ? ", k. ú. " + s.ku : ""}`,
        `Zdroj: RÚIAN / katastrální mapa © ČÚZK (CC BY 4.0), staženo ${fmtDateCz()}.`,
        "Souřadnice S-JTSK (EPSG:5514), jednotky metry. Nejde o geodetické zaměření – rozměry ověřit na místě.",
        "Hladiny: KN_PARCELY, KN_CISLA_PARCEL, KN_BUDOVY, OBJEKT (vybraná budova), INFO.",
      ],
    });
    const file = await storeOutput(order, "situace_dxf", `${order.code}_situace_KN.dxf`, "application/dxf", new TextEncoder().encode(dxf), "auto:situace_dxf", ctx.email);
    await setStatusIf(order, ["pripravena"], "zpracovava_se");
    return { file_id: file.id, file_name: file.file_name, ...stats };
  },

  async project_data(order, _b, ctx) {
    const profile = order.company_profile_id ? (await admin().from("company_profiles").select("*").eq("id", order.company_profile_id).maybeSingle()).data : null;
    const pd = core.toProjectData(order, profile ? { company: { name: profile.name, ico: profile.ico, address: profile.address } } : {});
    const bytes = new TextEncoder().encode(JSON.stringify(pd, null, 2));
    const file = await storeOutput(order, "project_data", `${order.code}_project-data.json`, "application/json", bytes, "auto:project_data", ctx.email);
    await setStatusIf(order, ["pripravena"], "zpracovava_se");
    return { file_id: file.id, file_name: file.file_name, unknown: pd._unknown.length };
  },

  async docx_sablona(order, b, ctx) {
    const vid = String(b.template_version_id ?? "");
    const { data: v } = await admin().from("doc_template_versions").select("*, doc_templates(*)").eq("id", vid).maybeSingle();
    if (!v) throw new HttpError(404, "Vzor nenalezen.");
    const t = v.doc_templates;
    if (t.company_id && t.company_id !== order.company_profile_id)
      throw new HttpError(409, "Tento vzor patří jiné firmě, než je přiřazená k zakázce. Dokumentace různých zákazníků se nesmí míchat.");
    if (!/\.docx$/i.test(v.file_name)) throw new HttpError(400, "Automaticky lze vyplnit jen vzory DOCX.");
    const profile = order.company_profile_id ? (await admin().from("company_profiles").select("*").eq("id", order.company_profile_id).maybeSingle()).data : null;
    const values = templateValues(order, profile);
    const r = await fillDocx(await download(v.storage_path, "fvsol-templates"), values, TEMPLATE_KEYS);
    if (!r.used.length) throw new HttpError(422, "Ve vzoru nejsou žádné značky {{…}} – není co vyplnit.");
    const base = `${order.code}_${safeFileName(t.name)}.docx`;
    const file = await storeOutput(order, `docx:${t.kind}`, base,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", r.bytes, "auto:docx_sablona", ctx.email,
      { template_version_id: v.id, meta: { unfilled: r.unfilled, used: r.used, template: `${t.name} v${v.version}` } });
    await setStatusIf(order, ["pripravena"], "zpracovava_se");
    return { file_id: file.id, file_name: file.file_name, used: r.used.length, unfilled: r.unfilled };
  },

  async externi(order, b, ctx) {
    const name = str(b.task_name, 80) || "zpracovani";
    const { data } = await admin().from("automation_runs").insert({
      order_id: order.id, task: name, runner: "external", status: "queued", input: { requested_by: ctx.email, note: str(b.note, 500) }, created_by: ctx.email,
    }).select("id").single();
    await setStatusIf(order, ["pripravena"], "zpracovava_se");
    return { queued: data?.id, note: "Úloha čeká ve frontě na externí zpracování (lokální nástroj TZ / pracovní agent)." };
  },
};

/* ------------------------------------------------------------------ akce */

const actions: Record<string, (b: Body, ctx: Ctx) => Promise<unknown>> = {
  async run(b, ctx) {
    const order = await orderById(b.order_id);
    const task = String(b.task);
    const fn = tasks[task];
    if (!fn) throw new HttpError(400, "Neznámá úloha.");
    if (order.phase === "draft") throw new HttpError(409, "Rozpracované zadání se nezpracovává.");
    if (PRODUCTION.has(task)) requireConfirmed(order);
    if (task === "externi") return { run: await fn(order, b, ctx) };
    const { data: run } = await admin().from("automation_runs").insert({
      order_id: order.id, task, status: "running", input: { ...b, action: undefined }, created_by: ctx.email, started_at: new Date().toISOString(),
    }).select("id").single();
    try {
      const result = await fn(order, b, ctx);
      await admin().from("automation_runs").update({ status: "done", result, finished_at: new Date().toISOString(), output_file_id: (result.file_id as string) ?? null }).eq("id", run!.id);
      await logEvent(order.id, "automation", `Úloha ${task} dokončena.`, { run: run!.id }, { actor: ctx.email });
      return { run: run!.id, result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin().from("automation_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", run!.id);
      await logEvent(order.id, "error", `Úloha ${task} selhala: ${msg}`, { run: run!.id }, { actor: ctx.email });
      throw e;
    }
  },

  async workflow(b, ctx) {
    const order = await orderById(b.order_id);
    const step = core.WORKFLOW.find((s: any) => s.key === b.step);
    if (!step) throw new HttpError(400, "Neznámý krok.");
    if (order.phase === "draft") throw new HttpError(409, "Zadání ještě nebylo odesláno.");
    const done = b.done !== false;
    const idx = core.WORKFLOW.indexOf(step);
    if (done && idx > 0 && !core.WORKFLOW.slice(0, idx).every((s: any) => order.workflow?.[s.key]?.done))
      throw new HttpError(409, "Nejdřív dokončete předchozí kroky.");
    const workflow = { ...(order.workflow ?? {}), [step.key]: { done, at: new Date().toISOString(), by: ctx.email, note: str(b.note, 1000) || undefined } };
    const patch: Record<string, unknown> = { workflow };
    if (step.key === "potvrzeni" && done) {
      patch.phase = "order";
      if (!["ceka_na_podklady", "rucni_posouzeni"].includes(order.status)) patch.status = "pripravena";
    }
    if (step.key === "zpracovani" && done && ["pripravena", "zpracovava_se"].includes(order.status)) patch.status = "ceka_na_kontrolu";
    const { error } = await admin().from("orders").update(patch).eq("id", order.id);
    if (error) throw new HttpError(409, error.message);
    const updated = { ...order, ...patch };
    await logEvent(order.id, "workflow", `${done ? "Hotovo" : "Vráceno"}: ${step.label}${b.note ? " – " + str(b.note, 200) : ""}`, { step: step.key, done }, { actor: ctx.email });
    await crmApplyWorkflow(updated);
    if (step.key === "potvrzeni" && done && b.notify && updated.answers?.kontakt_email) {
      const token = await issueToken(order.id, "email", ctx.email);
      const m = mailConfirmed(order.code, token);
      await sendMail(order.id, "potvrzeno", { email: updated.answers.kontakt_email, name: updated.answers.kontakt_jmeno }, m.subject, m.html);
    }
    return { workflow, phase: updated.phase, status: updated.status };
  },

  async info_request(b, ctx) {
    const order = await orderById(b.order_id);
    const items: string[] = (Array.isArray(b.items) ? b.items : []).map((x: unknown) => str(x, 300)).filter(Boolean).slice(0, 30);
    const message = str(b.message, 4000);
    if (!items.length && !message.trim()) throw new HttpError(400, "Napište, co má zákazník doplnit.");
    const { data: r } = await admin().from("info_requests").insert({ order_id: order.id, message, items, created_by: ctx.email }).select("*").single();
    await admin().from("orders").update({ status: "ceka_na_podklady" }).eq("id", order.id);
    await logEvent(order.id, "info_request", message || items.join("; "), { request_id: r?.id, items }, { actor: ctx.email, visible: true });
    let mail = null;
    if (b.send_email !== false && order.answers?.kontakt_email) {
      const token = await issueToken(order.id, "email", ctx.email);
      const m = mailInfoRequest(order.code, token, message, items);
      mail = await sendMail(order.id, "vyzva", { email: order.answers.kontakt_email, name: order.answers.kontakt_jmeno }, m.subject, m.html);
    }
    await crmNote(order, `Vyžádáno od klienta: ${items.join("; ")}${message ? " – " + message : ""}`, ctx.email);
    return { request: r, mail };
  },

  async release(b, ctx) {
    const { data: f } = await admin().from("order_files").select("*").eq("id", b.file_id).eq("direction", "out").maybeSingle();
    if (!f) throw new HttpError(404, "Výstup nenalezen.");
    const released = b.released !== false;
    const { error } = await admin().from("order_files").update({ released }).eq("id", f.id);
    if (error) throw new HttpError(409, error.message.includes("ověření") ? "Výstup lze předat až po ověření projektantem." : error.message);
    const order = await orderById(f.order_id);
    await logEvent(order.id, "output", `${released ? "Předáno zákazníkovi" : "Staženo z předání"}: ${f.file_name}`, { file_id: f.id }, { actor: ctx.email, visible: released });
    let mail = null;
    if (released && b.notify && order.answers?.kontakt_email) {
      const { data: rel } = await admin().from("order_files").select("file_name").eq("order_id", order.id).eq("direction", "out").eq("released", true).eq("review_status", "overeno");
      const token = await issueToken(order.id, "email", ctx.email);
      const m = mailReleased(order.code, token, (rel ?? []).map((x: any) => x.file_name));
      mail = await sendMail(order.id, "predani", { email: order.answers.kontakt_email, name: order.answers.kontakt_jmeno }, m.subject, m.html);
    }
    return { released, mail };
  },

  async customer_link(b, ctx) {
    const order = await orderById(b.order_id);
    const token = await issueToken(order.id, "manual", ctx.email);
    await logEvent(order.id, "note", "Vytvořen nový odkaz pro zákazníka.", {}, { actor: ctx.email });
    return { url: orderLink(token) };
  },

  async crm_sync(b) {
    const order = await orderById(b.order_id);
    if (order.phase === "draft") throw new HttpError(409, "Do CRM se zapisuje až odeslané zadání.");
    const ev = evaluateOrder(order, await filesOf(order.id, "in"));
    const id = order.crm_job_id ?? (await crmCreate(order, ev));
    if (!id) throw new HttpError(500, "Do CRM se nepodařilo zapsat – podrobnosti jsou v historii zakázky.");
    const o2 = { ...order, crm_job_id: id };
    await crmApplyWorkflow(o2);
    await crmSyncMissing(o2, ev);
    return { crm_job_id: id };
  },

  async reevaluate(b) {
    const order = await orderById(b.order_id);
    const ev = evaluateOrder(order, await filesOf(order.id, "in"));
    await admin().from("orders").update({ completeness: ev, needs_review: ev.needsReview }).eq("id", order.id);
    if (order.crm_job_id) await crmSyncMissing(order, ev);
    return { evaluation: ev };
  },

  async template_scan(b) {
    const { data: v } = await admin().from("doc_template_versions").select("*").eq("id", b.template_version_id).maybeSingle();
    if (!v) throw new HttpError(404, "Verze vzoru nenalezena.");
    if (!/\.docx$/i.test(v.file_name)) return { placeholders: [] };
    const keys = await listPlaceholders(await download(v.storage_path, "fvsol-templates"));
    await admin().from("doc_template_versions").update({ placeholders: keys }).eq("id", v.id);
    return { placeholders: keys, unknown: keys.filter((k) => !(k in TEMPLATE_KEYS)) };
  },

  async email_test(b, ctx) {
    const m = mailTest();
    return sendMail(null, "test", { email: str(b.to, 200) || ctx.email }, m.subject, m.html);
  },

  async storage_usage() {
    const { data: f } = await admin().from("order_files").select("size");
    const { data: t } = await admin().from("doc_template_versions").select("size");
    const sum = (rows: any[] | null) => (rows ?? []).reduce((s, r) => s + (Number(r.size) || 0), 0);
    return { orders_bytes: sum(f), templates_bytes: sum(t), limit_bytes: 1024 ** 3 };
  },

  async cleanup_drafts() {
    return { deleted: await cleanupDrafts(100) };
  },

  async template_keys() {
    return { keys: TEMPLATE_KEYS };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Použijte POST." }, 405);
  try {
    const ctx = await staffFromRequest(req);
    const b = await req.json().catch(() => ({}));
    const fn = actions[String(b.action)];
    if (!fn) throw new HttpError(400, "Neznámá akce.");
    return json(req, await fn(b, ctx));
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    if (e instanceof GeoError) return json(req, { error: e.message }, 503);
    console.error("staff_error", e);
    return json(req, { error: e instanceof Error ? e.message : "Chyba serveru." }, 500);
  }
});
