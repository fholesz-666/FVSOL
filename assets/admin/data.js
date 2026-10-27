// Datová vrstva administrace – Supabase (přihlášení stejným účtem jako CRM, přístup hlídá RLS + tabulka staff).
import { CONFIG } from "../zakazky/config.js";

const BUCKET = "fvsol-orders";
const TBUCKET = "fvsol-templates";

export function createData() {
  if (globalThis.FVSOL_ADMIN_DATA) return globalThis.FVSOL_ADMIN_DATA; // testovací náhrada
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "fvsol-admin" },
  });
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message || "Chyba databáze");
    return data;
  };
  const safe = (n) => String(n || "soubor").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

  return {
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ? { email: data.session.user.email } : null;
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((_e, s) => cb(s?.user ? { email: s.user.email } : null));
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(/invalid/i.test(error.message) ? "Špatný e-mail nebo heslo." : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async isStaff() {
      const { data } = await sb.from("staff").select("email").limit(1);
      return !!data?.length;
    },

    async listOrders({ drafts = false } = {}) {
      let q = sb.from("orders").select("id,code,service,phase,status,contact,answers,completeness,workflow,needs_review,crm_job_id,created_at,submitted_at,updated_at").order("created_at", { ascending: false }).limit(500);
      if (!drafts) q = q.neq("phase", "draft");
      return must(await q);
    },
    async getOrder(id) {
      const [o, f, e, r, a] = await Promise.all([
        sb.from("orders").select("*").eq("id", id).single(),
        sb.from("order_files").select("*").eq("order_id", id).order("created_at"),
        sb.from("order_events").select("*").eq("order_id", id).order("at", { ascending: false }).limit(300),
        sb.from("info_requests").select("*").eq("order_id", id).order("created_at"),
        sb.from("automation_runs").select("*").eq("order_id", id).order("created_at", { ascending: false }).limit(50),
      ]);
      return { order: must(o), files: must(f), events: must(e), requests: must(r), runs: must(a) };
    },
    async updateOrder(id, patch) { return must(await sb.from("orders").update(patch).eq("id", id).select("*").single()); },
    async addNote(id, text, visible = false) {
      const { data: u } = await sb.auth.getUser();
      return must(await sb.from("order_events").insert({ order_id: id, type: "note", message: text, actor: u.user?.email ?? "admin", visible_to_customer: visible }));
    },
    async fileUrl(path, name, bucket = BUCKET) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300, { download: name || true });
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async uploadOutput(order, file, kind, note) {
      const { data: u } = await sb.auth.getUser();
      const { data: prev } = await sb.from("order_files").select("output_version").eq("order_id", order.id).eq("direction", "out").eq("output_kind", kind);
      const version = Math.max(0, ...(prev ?? []).map((x) => x.output_version || 0)) + 1;
      const id = crypto.randomUUID();
      const path = `${order.id}/out/${id}-${safe(file.name)}`;
      must(await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }));
      return must(await sb.from("order_files").insert({
        id, order_id: order.id, direction: "out", category: "vystup", storage_path: path, file_name: file.name, mime: file.type || null,
        size: file.size, status: "uploaded", uploaded_by: u.user?.email, output_kind: kind, output_version: version, source: "rucne",
        note: note || null, uploaded_at: new Date().toISOString(),
      }).select("*").single());
    },
    async setReview(fileId, review_status) { return must(await sb.from("order_files").update({ review_status }).eq("id", fileId).select("*").single()); },
    async deleteOutput(file) {
      await sb.storage.from(BUCKET).remove([file.storage_path]);
      must(await sb.from("order_files").delete().eq("id", file.id));
    },
    async staff(action, body = {}) {
      const { data, error } = await sb.functions.invoke("fvsol-staff", { body: { action, ...body } });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      return data;
    },

    async companies() { return must(await sb.from("company_profiles").select("*").order("name")); },
    async saveCompany(c) {
      const { data: u } = await sb.auth.getUser();
      const row = { name: c.name, ico: c.ico || null, address: c.address || null, contact: c.contact || null, notes: c.notes || null, active: c.active !== false, updated_by: u.user?.email };
      return c.id ? must(await sb.from("company_profiles").update(row).eq("id", c.id).select("*").single()) : must(await sb.from("company_profiles").insert(row).select("*").single());
    },
    async templates() {
      return must(await sb.from("doc_templates").select("*, doc_template_versions(*), company_profiles(name)").order("created_at"));
    },
    async createTemplate(t) {
      return must(await sb.from("doc_templates").insert({ company_id: t.company_id || null, kind: t.kind, service: t.service || "any", name: t.name, description: t.description || null }).select("*").single());
    },
    async uploadTemplateVersion(tpl, file, note) {
      const path = `${tpl.company_id || "univerzalni"}/${tpl.id}/${crypto.randomUUID()}-${safe(file.name)}`;
      must(await sb.storage.from(TBUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }));
      return must(await sb.from("doc_template_versions").insert({
        template_id: tpl.id, version: 0, storage_path: path, file_name: file.name, mime: file.type || null, size: file.size, note: note || null, is_current: true,
      }).select("*").single());
    },
    async setCurrentVersion(id) { return must(await sb.from("doc_template_versions").update({ is_current: true }).eq("id", id)); },
    async setTemplateActive(id, active) { return must(await sb.from("doc_templates").update({ active }).eq("id", id)); },
    templateUrl(path, name) { return this.fileUrl(path, name, TBUCKET); },
  };
}
