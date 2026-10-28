// Práce se zakázkami – sdílí veřejná funkce (zákazník) i funkce administrace.
import * as core from "./core.js";
import { admin, env, HttpError, logEvent, randomToken, sha256hex, SITE_URL, str } from "./util.ts";

export const BUCKET = "fvsol-orders";

export type Order = Record<string, any>;

export async function orderByToken(token: string): Promise<Order> {
  if (!token || typeof token !== "string" || token.length < 30 || token.length > 100) throw new HttpError(404, "Odkaz na zakázku není platný.");
  const hash = await sha256hex(token);
  const { data: t, error } = await admin().from("order_tokens").select("order_id,revoked").eq("token_hash", hash).maybeSingle();
  if (error) throw new HttpError(500, "Zakázku se nepodařilo načíst.");
  if (!t || t.revoked) throw new HttpError(404, "Odkaz na zakázku není platný nebo zakázka byla smazána.");
  const { data } = await admin().from("orders").select("*").eq("id", t.order_id).maybeSingle();
  if (!data) throw new HttpError(404, "Odkaz na zakázku není platný nebo zakázka byla smazána.");
  return data;
}

/** Nový přístupový odkaz k zakázce (např. do e-mailu). Vrací token – v databázi zůstane jen jeho otisk. */
export async function issueToken(orderId: string, purpose: "web" | "email" | "manual", by = "system"): Promise<string> {
  const token = randomToken();
  const { error } = await admin().from("order_tokens").insert({ token_hash: await sha256hex(token), order_id: orderId, purpose, created_by: by });
  if (error) throw new HttpError(500, "Přístupový odkaz se nepodařilo vytvořit.");
  return token;
}

export async function orderById(id: string): Promise<Order> {
  const { data } = await admin().from("orders").select("*").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Zakázka neexistuje.");
  return data;
}

export async function filesOf(orderId: string, direction?: "in" | "out") {
  let q = admin().from("order_files").select("*").eq("order_id", orderId).order("created_at");
  if (direction) q = q.eq("direction", direction);
  const { data } = await q;
  return data ?? [];
}

const SITE_KEYS_NUM = ["lat", "lon"];

/** Odpovědi od zákazníka: jen známé otázky, rozumné délky. Převzatá data o stavbě bere server ze své kopie. */
export function sanitizeAnswers(service: string, input: Record<string, unknown>, trustedSite: any) {
  const qs = core.allQuestions(service);
  const out: Record<string, unknown> = {};
  for (const q of qs) {
    if (q.type === "site") continue;
    const v = input?.[q.id];
    if (v == null || v === "") continue;
    if (q.type === "multi") {
      if (Array.isArray(v)) {
        const allowed = new Set([...(q.options ?? []).map((o: any) => o.v), ...(q.unknown ? [core.UNKNOWN] : [])]);
        const arr = v.map(String).filter((x) => allowed.has(x)).slice(0, 20);
        if (arr.length) out[q.id] = arr;
      }
    } else if (q.type === "single") {
      const allowed = new Set([...(q.options ?? []).map((o: any) => o.v), ...(q.unknown ? [core.UNKNOWN] : [])]);
      if (allowed.has(String(v))) out[q.id] = String(v);
    } else if (q.type === "check") {
      out[q.id] = v === true;
    } else if (q.type === "number") {
      out[q.id] = v === core.UNKNOWN ? core.UNKNOWN : str(v, 20);
    } else {
      out[q.id] = v === core.UNKNOWN ? core.UNKNOWN : str(v, q.type === "textarea" ? 5000 : 300);
    }
  }
  out.site = mergeSite(input?.site, trustedSite);
  return out;
}

export function mergeSite(client: any, trusted: any) {
  if (!client || typeof client !== "object") return trusted?.source === "ruian" ? { ...stripSite(trusted) } : null;
  const lat = Number(client.lat), lon = Number(client.lon);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
  const base = {
    query: str(client.query, 200) || undefined,
    obec: str(client.obec, 120) || undefined,
    parcel_manual: str(client.parcel_manual, 60) || undefined,
    note: str(client.note, 500) || undefined,
  };
  if (hasPoint && trusted?.source === "ruian" && Math.abs(trusted.lat - lat) < 1e-6 && Math.abs(trusted.lon - lon) < 1e-6) {
    return {
      ...stripSite(trusted),
      ...base,
      building_confirmed: client.building_confirmed === true && !!trusted.building,
    };
  }
  return { source: "manual", ...base, ...(hasPoint ? { lat, lon } : {}) };
}

export function stripSite(s: any) {
  if (!s) return s;
  const { buildings: _b, ...rest } = s;
  return rest;
}

export function evaluateOrder(order: Order, files: any[]) {
  return core.evaluate({ service: order.service, answers: order.answers, site: order.site, files });
}

export function adminUrl(order: Order) {
  return `${SITE_URL()}/admin/#z=${order.id}`;
}

/* ------------------------------------------------------------------ CRM */

async function crmWorkspaceId(): Promise<string | null> {
  const fixed = env("CRM_WORKSPACE_ID");
  if (fixed) return fixed;
  const owner = env("CRM_OWNER_EMAIL", "fholesz@gmail.com").toLowerCase();
  const { data } = await admin().from("workspaces").select("id").eq("kind", "fve").eq("owner_email", owner).order("created_at").limit(1);
  return data?.[0]?.id ?? null;
}

export async function crmCreate(order: Order, ev: any): Promise<string | null> {
  if (order.crm_job_id) return order.crm_job_id;
  const ws = await crmWorkspaceId();
  if (!ws) {
    await logEvent(order.id, "error", "CRM: nenalezen prostor „FVE a LPS“ – zakázka do CRM nezapsána.");
    return null;
  }
  const id = `fv-${String(order.code).toLowerCase()}`;
  const data = core.toCrmJob(order, ev, { adminUrl: adminUrl(order) });
  const { error } = await admin().from("jobs").upsert({ id, workspace_id: ws, data, updated_by: "fvsol-web" });
  if (error) {
    await logEvent(order.id, "error", `CRM: zápis selhal (${error.message}).`);
    return null;
  }
  await admin().from("orders").update({ crm_job_id: id }).eq("id", order.id);
  await logEvent(order.id, "crm", `Zapsáno do CRM jako ${id} (${data.tasks.length} úkolů, termín kontroly ${data.events[0]?.date}).`, { job_id: id });
  return id;
}

async function crmUpdate(order: Order, fn: (data: any) => any, what: string) {
  if (!order.crm_job_id) return;
  const { data: row } = await admin().from("jobs").select("data").eq("id", order.crm_job_id).maybeSingle();
  if (!row) {
    await logEvent(order.id, "error", `CRM: zakázka ${order.crm_job_id} už v CRM není (${what}).`);
    return;
  }
  const next = fn(row.data);
  delete next._dev;
  const { error } = await admin().from("jobs").update({ data: next, updated_by: "fvsol-web" }).eq("id", order.crm_job_id);
  if (error) await logEvent(order.id, "error", `CRM: ${what} selhalo (${error.message}).`);
}

export const crmApplyWorkflow = (order: Order) =>
  crmUpdate(order, (d) => core.applyWorkflowToCrm(d, order.code, order.workflow), "aktualizace postupu");

export const crmNote = (order: Order, text: string, by = "web") =>
  crmUpdate(order, (d) => {
    d.notes = Array.isArray(d.notes) ? d.notes : [];
    d.notes.push({ id: `fvsol-${Date.now().toString(36)}`, text: text.slice(0, 2000), ts: Date.now(), by });
    return d;
  }, "poznámka");

/** Úkoly „Doplnit od klienta“ podle aktuálního vyhodnocení – vyřešené odškrtne, nové přidá. */
export const crmSyncMissing = (order: Order, ev: any) =>
  crmUpdate(order, (d) => {
    d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const open = new Set(ev.missing.filter((m: any) => m.level !== "submit").map((m: any) => m.key));
    for (const t of d.tasks) if (typeof t.key === "string" && t.key.startsWith("chybi:") && !open.has(t.key.slice(6))) t.done = true;
    for (const m of ev.missing.filter((x: any) => x.level !== "submit")) {
      const id = core.crmTaskId(order.code, "chybi-" + m.key);
      const t = d.tasks.find((x: any) => x.id === id);
      if (!t) d.tasks.push({ id, key: "chybi:" + m.key, text: `Doplnit od klienta: ${m.label}`, due: "", done: false });
      else t.done = false;
    }
    return d;
  }, "úkoly podkladů");

/* ------------------------------------------------------------------ úložiště */

export async function objectSize(path: string): Promise<number | null> {
  const dir = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const { data, error } = await admin().storage.from(BUCKET).list(dir, { search: name, limit: 5 });
  if (error) return null;
  const obj = (data ?? []).find((o: any) => o.name === name);
  return obj ? Number(obj.metadata?.size ?? 0) : null;
}

export async function purgeOrder(orderId: string) {
  const files = await filesOf(orderId);
  const paths = files.map((f: any) => f.storage_path);
  for (let i = 0; i < paths.length; i += 100) await admin().storage.from(BUCKET).remove(paths.slice(i, i + 100));
  await admin().from("orders").delete().eq("id", orderId);
}

/** Úklid: rozpracovaná zadání starší 30 dnů se smažou i se soubory. */
export async function cleanupDrafts(limit = 20) {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await admin().from("orders").select("id").eq("phase", "draft").lt("updated_at", cutoff).limit(limit);
  for (const o of data ?? []) await purgeOrder(o.id);
  return (data ?? []).length;
}
