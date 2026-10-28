// Náhradní datová vrstva administrace pro testy v prohlížeči (window.FVSOL_ADMIN_DATA). Zaznamenává volání.
(() => {
  const now = new Date().toISOString();
  const calls = [];
  const site = { source: "ruian", lat: 50.7215, lon: 15.1702, address: "Polní 3677/10, 46601 Jablonec nad Nisou", parcel: "st. 4940/1", ku: "Jablonec nad Nisou [655970]",
    building: { id: "111", use: "objekt občanské vybavenosti", floors: 2, length: 32.1, width: 16, height_est: 8.4 }, building_confirmed: true };
  const orders = [
    { id: "11111111-1111-4111-8111-111111111111", code: "Z26-0001", service: "fve", phase: "inquiry", status: "ceka_na_podklady", needs_review: false, crm_job_id: "fv-z26-0001",
      answers: { fve_rozsah: "nova", site, objekt_typ: "verejna", montaz: "plocha", komponenty_stav: "mam", zadost: "sop", fve_vykon: "50-100", hromosvod: "?",
        kontakt_jmeno: "Jan Novák", kontakt_email: "jan@example.cz", kontakt_telefon: "+420777123456", role: "montaz", firma: "Solar Test s.r.o.", ico: "27082440", vzor: "vlastni", souhlas: true },
      site: { ...site, buildings: [{ id: "111", ring: [[15.17, 50.7213], [15.1705, 50.7213], [15.1705, 50.7217], [15.17, 50.7217], [15.17, 50.7213]] }] },
      completeness: { missing: [{ key: "vzor", label: "Firemní vzor", level: "process" }] }, workflow: {}, template_selection: {}, company_profile_id: null,
      created_at: now, submitted_at: now, updated_at: now },
    { id: "22222222-2222-4222-8222-222222222222", code: "Z26-0002", service: "lps", phase: "order", status: "zpracovava_se", needs_review: true,
      answers: { lps_rozsah: ["novy"], site: { source: "manual", query: "p. č. 1234/5", obec: "Rychnov" }, kontakt_jmeno: "Eva Malá", kontakt_email: "eva@example.cz", souhlas: true },
      completeness: { missing: [] }, workflow: { kontrola_zadani: { done: true, at: now, by: "fholesz@gmail.com" }, nabidka: { done: true, at: now }, potvrzeni: { done: true, at: now } },
      template_selection: {}, created_at: now, submitted_at: now, updated_at: now },
    { id: "33333333-3333-4333-8333-333333333333", code: null, service: "dwg", phase: "draft", status: "rozpracovana", answers: {}, completeness: {}, workflow: {}, created_at: now, updated_at: now },
  ];
  const files = [
    { id: "f1", order_id: orders[0].id, direction: "in", category: "vykresy", file_name: "pudorys.pdf", size: 120000, status: "uploaded", storage_path: "x/in/f1", meta: { label: "Vektorové PDF – geometrii lze převzít", pages: 2, sheet: "A3 na šířku" }, created_at: now },
    { id: "f2", order_id: orders[0].id, direction: "in", category: "foto", file_name: "strecha.jpg", size: 2400000, status: "uploaded", storage_path: "x/in/f2", meta: {}, created_at: now },
    { id: "o1", order_id: orders[1].id, direction: "out", category: "vystup", file_name: "Z26-0002_situace_KN_v1.dxf", output_kind: "situace_dxf", output_version: 1, source: "auto:situace_dxf", size: 34000, status: "uploaded", storage_path: "x/out/o1", review_status: "neovereno", released: false, created_at: now },
  ];
  const events = [{ id: 1, order_id: orders[0].id, at: now, actor: "zakaznik", type: "submitted", message: "Zadání Z26-0001 odesláno zákazníkem.", data: {}, visible_to_customer: true }];
  const companies = [{ id: "c1", name: "SIMPLY s.r.o.", ico: "27082440", active: true }];
  const templates = [{ id: "t1", company_id: null, kind: "titulni_list", service: "any", name: "Titulní list", active: true, doc_template_versions: [{ id: "v1", template_id: "t1", version: 1, file_name: "titulni.docx", is_current: true, created_at: now, placeholders: ["zakazka.cislo"] }] },
    { id: "t2", company_id: "c1", kind: "razitko", service: "fve", name: "Razítko SIMPLY", active: true, doc_template_versions: [{ id: "v2", template_id: "t2", version: 1, file_name: "razitko.docx", is_current: true, created_at: now }] }];
  let user = null;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const find = (id) => orders.find((o) => o.id === id);

  window.__calls = calls;
  window.FVSOL_ADMIN_DATA = {
    async session() { return user; },
    onAuth() {},
    async signIn(email, pw) { calls.push(["signIn", email]); if (pw !== "heslo123") throw new Error("Špatný e-mail nebo heslo."); user = { email }; },
    async signOut() { user = null; },
    async isStaff() { return user?.email === "fholesz@gmail.com"; },
    async listOrders({ drafts }) { return clone(orders.filter((o) => drafts || o.phase !== "draft")); },
    async getOrder(id) {
      return clone({ order: find(id), files: files.filter((f) => f.order_id === id), events: events.filter((e) => e.order_id === id).reverse(), requests: [], runs: [] });
    },
    async updateOrder(id, patch) {
      calls.push(["updateOrder", id, patch]);
      if (patch.status === "dokoncena" && !files.some((f) => f.order_id === id && f.direction === "out" && f.released && f.review_status === "overeno"))
        throw new Error("Zakázku nelze označit jako dokončenou: chybí ověřený a předaný výstup.");
      if (patch.template_selection) for (const vid of Object.values(patch.template_selection)) {
        const t = templates.find((x) => x.doc_template_versions.some((v) => v.id === vid));
        if (t.company_id && t.company_id !== (patch.company_profile_id ?? find(id).company_profile_id)) throw new Error("Vybraný vzor nepatří k firmě přiřazené k zakázce ani není univerzální.");
      }
      Object.assign(find(id), patch);
      return clone(find(id));
    },
    async addNote(id, text) { calls.push(["addNote", id, text]); events.push({ id: events.length + 1, order_id: id, at: new Date().toISOString(), actor: user.email, type: "note", message: text, data: {} }); },
    async fileUrl(path) { calls.push(["fileUrl", path]); return "about:blank"; },
    async uploadOutput(order, file, kind) { calls.push(["uploadOutput", order.id, file.name, kind]); files.push({ id: "o" + files.length, order_id: order.id, direction: "out", file_name: file.name, output_kind: kind, output_version: 1, source: "rucne", size: file.size, status: "uploaded", review_status: "neovereno", released: false, created_at: new Date().toISOString() }); },
    async setReview(id, st) { calls.push(["setReview", id, st]); const f = files.find((x) => x.id === id); f.review_status = st; f.reviewed_by = user.email; return f; },
    async deleteOutput(f) { calls.push(["deleteOutput", f.id]); files.splice(files.findIndex((x) => x.id === f.id), 1); },
    async staff(action, body) {
      calls.push(["staff", action, body]);
      if (action === "workflow") {
        const o = find(body.order_id);
        o.workflow = { ...o.workflow, [body.step]: { done: body.done !== false, at: new Date().toISOString(), by: user.email, note: body.note } };
        if (body.step === "potvrzeni" && body.done !== false) { o.phase = "order"; o.status = "pripravena"; }
        return { workflow: o.workflow };
      }
      if (action === "run") {
        const o = find(body.order_id);
        if (["situace_dxf", "project_data", "docx_sablona", "externi"].includes(body.task) && !o.workflow?.potvrzeni?.done) throw new Error("Zpracování lze spustit až po potvrzení zakázky.");
        return { run: "r1", result: {} };
      }
      if (action === "release") { const f = files.find((x) => x.id === body.file_id); if (f.review_status !== "overeno") throw new Error("Výstup lze předat až po ověření projektantem."); f.released = body.released; return { released: body.released, mail: { sent: false, reason: "Chybí BREVO_API_KEY" } }; }
      if (action === "info_request") return { request: {}, mail: { sent: false, reason: "Chybí BREVO_API_KEY – e-mail se neodeslal." } };
      if (action === "customer_link") return { url: "https://fvsol.cz/zadani/#t=TESTTOKENTESTTOKENTESTTOKENTESTTOKEN" };
      if (action === "template_keys") return { keys: { "zakazka.cislo": "číslo zakázky", "misto.adresa": "adresa stavby" } };
      if (action === "email_test") return { sent: false, reason: "Chybí BREVO_API_KEY – e-mail se neodeslal." };
      if (action === "storage_usage") return { orders_bytes: 5242880, templates_bytes: 1048576, limit_bytes: 1073741824 };
      return {};
    },
    async companies() { return clone(companies); },
    async saveCompany(c) { calls.push(["saveCompany", c]); if (c.id) Object.assign(companies.find((x) => x.id === c.id), c); else companies.push({ ...c, id: "c" + (companies.length + 1) }); return c; },
    async templates() { return clone(templates); },
    async createTemplate(t) { calls.push(["createTemplate", t]); const n = { ...t, id: "t" + (templates.length + 1), active: true, doc_template_versions: [] }; templates.push(n); return clone(n); },
    async uploadTemplateVersion(tpl, file) { calls.push(["uploadTemplateVersion", tpl.id, file.name]); const t = templates.find((x) => x.id === tpl.id); t.doc_template_versions.forEach((v) => (v.is_current = false)); const v = { id: "v" + Math.random().toString(36).slice(2, 6), template_id: t.id, version: t.doc_template_versions.length + 1, file_name: file.name, is_current: true, created_at: new Date().toISOString() }; t.doc_template_versions.push(v); return v; },
    async setCurrentVersion(id) { calls.push(["setCurrentVersion", id]); },
    async setTemplateActive(id, a) { templates.find((t) => t.id === id).active = a; },
    templateUrl() { return "about:blank"; },
  };
})();
