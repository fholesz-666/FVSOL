/**
 * Administrace zakázek FVSOL.
 * Přehled → detail zakázky (postup, úplnost, podklady, vzory, zpracování, výstupy, historie) → vzory a firmy → nastavení.
 * Interní postup se promítá do CRM (úkoly a stav) přes serverovou funkci fvsol-staff.
 */
import * as core from "../zakazky/core.js";
import { createData } from "./data.js";
import { SiteMap } from "../zakazky/map.js";

const D = createData();
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dt = (s) => (s ? new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(s)) : "");
const d1 = (s) => (s ? new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(s)) : "");
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} kB`);
const LSK = "fvsol.admin.filters";
const ls = { get() { try { return JSON.parse(localStorage.getItem(LSK) || "{}"); } catch { return {}; } }, set(v) { try { localStorage.setItem(LSK, JSON.stringify(v)); } catch { /* */ } } };

const S = {
  user: null, view: "login", orders: [], filters: { service: "", status: "", phase: "open", q: "", drafts: false, ...ls.get() },
  detail: null, companies: [], templates: [], busy: false, loginError: "", tab: "orders", link: "", keys: null, usage: null,
};

const app = $("#app");
const mapEl = document.createElement("div");
mapEl.className = "a-map";
const map = new SiteMap(mapEl, {});

function flash(msg, err = false) {
  let box = document.getElementById("flashes");
  if (!box) {
    box = document.createElement("div");
    box.id = "flashes";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "flash" + (err ? " err" : "");
  el.setAttribute("role", err ? "alert" : "status");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 3000);
}

async function guard(fn, okMsg) {
  if (S.busy) return;
  S.busy = true;
  document.body.style.cursor = "progress";
  try {
    const r = await fn();
    if (okMsg) flash(okMsg);
    return r;
  } catch (e) {
    flash(e.message || String(e), true);
  } finally {
    S.busy = false;
    document.body.style.cursor = "";
  }
}

/* ------------------------------------------------------------------ navigace */

function route() {
  const h = location.hash;
  const m = /#z=([0-9a-f-]{36})/.exec(h);
  if (!S.user) return render();
  if (m) return openOrder(m[1]);
  if (h === "#vzory") { S.tab = "templates"; return loadTemplates(); }
  if (h === "#nastaveni") { S.tab = "settings"; S.view = "settings"; return render(); }
  S.tab = "orders";
  return loadList();
}

async function start() {
  S.user = await D.session();
  if (S.user && !(await D.isStaff())) { S.view = "denied"; return render(); }
  if (!S.user) { S.view = "login"; return render(); }
  route();
}

D.onAuth?.((u) => {
  const was = S.user?.email;
  S.user = u;
  if (!u) { S.view = "login"; render(); }
  else if (u.email !== was) start();
});
window.addEventListener("hashchange", route);

async function loadList() {
  S.view = "list";
  render();
  await guard(async () => { S.orders = await D.listOrders({ drafts: S.filters.drafts }); });
  render();
}

async function openOrder(id) {
  S.view = "detail";
  S.tab = "orders";
  if (S.detail?.order?.id !== id) { S.detail = null; render(); }
  await guard(async () => {
    S.detail = await D.getOrder(id);
    if (!S.companies.length) S.companies = await D.companies();
    if (!S.templates.length) S.templates = await D.templates();
  });
  render();
}

async function reload() {
  if (S.detail) await openOrder(S.detail.order.id);
}

async function loadTemplates() {
  S.view = "templates";
  render();
  await guard(async () => {
    S.companies = await D.companies();
    S.templates = await D.templates();
    if (!S.keys) S.keys = (await D.staff("template_keys")).keys;
  });
  render();
}

/* ------------------------------------------------------------------ vykreslení */

function render() {
  $("#a-user").innerHTML = S.user ? `${esc(S.user.email)} <button type="button" data-act="logout">Odhlásit</button>` : "";
  document.querySelectorAll(".a-tabs a").forEach((a) => (a.dataset.tab === S.tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $(".a-tabs").hidden = !S.user;
  if (S.view === "login") app.innerHTML = viewLogin();
  else if (S.view === "denied") app.innerHTML = `<div class="panel login"><h1>Bez přístupu</h1><p>Účet ${esc(S.user?.email)} nemá přístup do administrace zakázek.</p><button class="btn" data-act="logout">Odhlásit</button></div>`;
  else if (S.view === "list") app.innerHTML = viewList();
  else if (S.view === "detail") app.innerHTML = S.detail ? viewDetail() : `<p>Načítám…</p>`;
  else if (S.view === "templates") app.innerHTML = viewTemplates();
  else if (S.view === "settings") app.innerHTML = viewSettings();
  const slot = $("[data-map-slot]", app);
  if (slot) {
    slot.replaceWith(mapEl);
    map.show(S.detail.order.site || S.detail.order.answers?.site);
  }
}

function viewLogin() {
  return `<form class="panel login" id="login-form" novalidate>
    <h1>Administrace zakázek</h1>
    <p class="muted">Přihlaste se stejným účtem jako do CRM.</p>
    <div class="field"><label for="l-email">E-mail</label><input class="input" id="l-email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="l-pass">Heslo</label><input class="input" id="l-pass" type="password" autocomplete="current-password" required></div>
    ${S.loginError ? `<p class="error" role="alert">${esc(S.loginError)}</p>` : ""}
    <button class="btn btn-dark" type="submit">Přihlásit</button>
  </form>`;
}

const stBadge = (status) => `<span class="st st-${status}">${esc(core.STATUSES[status] || status)}</span>`;
const phaseBadge = (p) => `<span class="st st-${p}">${esc(core.PHASES[p] || p)}</span>`;

function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  return S.orders.filter((o) => {
    if (f.service && o.service !== f.service) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.phase === "open" && (o.phase === "cancelled" || o.status === "dokoncena" || o.workflow?.faktura?.done)) return false;
    if (f.phase && f.phase !== "open" && o.phase !== f.phase) return false;
    if (q) {
      const a = o.answers || {};
      const hay = [o.code, a.kontakt_jmeno, a.kontakt_email, a.firma, core.siteLabel(a.site), a.ind_popis].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function viewList() {
  const f = S.filters;
  const opts = (obj, cur, all) => `<option value="">${all}</option>` + Object.entries(obj).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(v.title || v)}</option>`).join("");
  const rows = filtered().map((o) => {
    const a = o.answers || {};
    const wf = core.workflowState(o.workflow);
    const ev = o.completeness || {};
    const miss = (ev.missing || []).filter((m) => m.level !== "submit").length;
    return `<tr class="row" data-open="${o.id}" tabindex="0">
      <td><span class="code">${esc(o.code || "rozpracováno")}</span><div class="sub">${dt(o.submitted_at || o.created_at)}</div></td>
      <td>${esc(core.SERVICES[o.service]?.short)}</td>
      <td>${esc(a.firma || a.kontakt_jmeno || "–")}<div class="sub">${esc(a.kontakt_email || "")}</div></td>
      <td>${esc(core.siteLabel(a.site) || "–")}</td>
      <td>${o.phase === "draft" ? phaseBadge("draft") : stBadge(o.status)}${o.needs_review ? ` <span class="st st-rucni_posouzeni">posoudit</span>` : ""}</td>
      <td>${o.phase === "draft" ? "–" : esc(wf.next?.label || "Hotovo")}</td>
      <td>${miss ? `${miss}` : "–"}</td>
    </tr>`;
  }).join("");
  return `<h1>Zakázky</h1>
    <div class="filters-bar">
      <div class="field"><label for="f-q">Hledat</label><input class="input" id="f-q" data-f="q" value="${esc(f.q)}" placeholder="číslo, jméno, místo"></div>
      <div class="field"><label for="f-service">Služba</label><select class="select" id="f-service" data-f="service">${opts(core.SERVICES, f.service, "Všechny")}</select></div>
      <div class="field"><label for="f-status">Stav</label><select class="select" id="f-status" data-f="status">${opts(core.STATUSES, f.status, "Všechny")}</select></div>
      <div class="field"><label for="f-phase">Fáze</label><select class="select" id="f-phase" data-f="phase">
        <option value="open" ${f.phase === "open" ? "selected" : ""}>Rozpracované (bez hotových a zrušených)</option>
        <option value="" ${f.phase === "" ? "selected" : ""}>Všechny</option>
        ${Object.entries(core.PHASES).map(([k, v]) => `<option value="${k}" ${f.phase === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
      </select></div>
      <label class="check"><input type="checkbox" data-f="drafts" ${f.drafts ? "checked" : ""}><span>Načíst i neodeslaná zadání</span></label>
      <button class="btn btn-sm" data-act="refresh">Obnovit</button>
    </div>
    ${rows ? `<table class="tbl"><thead><tr><th>Zakázka</th><th>Služba</th><th>Zákazník</th><th>Místo</th><th>Stav</th><th>Další krok</th><th>Chybí</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="panel"><p>${S.orders.length ? "Filtru neodpovídá žádná zakázka." : "Zatím tu nejsou žádné zakázky. Nové přijdou z formuláře na fvsol.cz/zadani/."}</p></div>`}`;
}

/* ------------------------------------------------------------------ detail */

function viewDetail() {
  const { order: o, files, events, requests, runs } = S.detail;
  const a = o.answers || {};
  const inputs = files.filter((f) => f.direction === "in" && f.status !== "rejected");
  const outputs = files.filter((f) => f.direction === "out");
  const ev = core.evaluate({ service: o.service, answers: a, files: inputs });
  const wf = core.workflowState(o.workflow);
  return `<p><a class="link" href="#">← Zakázky</a></p>
    <div class="d-head"><h1>${esc(o.code || "Rozpracované zadání")}</h1>${phaseBadge(o.phase)} ${stBadge(o.status)}
      ${o.needs_review ? `<span class="st st-rucni_posouzeni">ruční posouzení</span>` : ""}</div>
    <p class="d-meta">${esc(core.SERVICES[o.service]?.title)} · založeno ${dt(o.created_at)}${o.submitted_at ? ` · odesláno ${dt(o.submitted_at)}` : ""}${o.crm_job_id ? ` · CRM ${esc(o.crm_job_id)}` : ""}</p>
    <div class="d-grid">
      <div>
        ${panelCompleteness(o, ev)}
        ${panelAnswers(o)}
        ${panelSite(o)}
        ${panelInputs(o, inputs)}
        ${panelProcessing(o, runs, wf)}
        ${panelOutputs(o, outputs)}
      </div>
      <div>
        ${panelWorkflow(o, wf)}
        ${panelContact(o)}
        ${panelStatus(o)}
        ${panelRequest(o, ev, requests)}
        ${panelTemplates(o)}
        ${panelNotes(o, events)}
      </div>
    </div>`;
}

function panelWorkflow(o, wf) {
  if (o.phase === "draft") return `<section class="panel"><h2>Postup</h2><p class="muted">Zadání zatím zákazník neodeslal.</p></section>`;
  const lastDone = [...wf.steps].reverse().find((s) => s.done);
  return `<section class="panel"><h2>Postup zakázky<span class="sp"></span><button class="btn btn-xs" data-act="crm-sync" title="Zapsat stav do CRM">CRM</button></h2>
    <ol class="wf">${wf.steps.map((s) => {
      const isNext = wf.next?.key === s.key;
      return `<li class="${s.done ? "done" : ""} ${isNext ? "next" : ""}"><span class="dot"></span><div>${esc(s.label)}
        ${s.done ? `<span class="when">${dt(s.at)} · ${esc(s.by || "")}${s.note ? " · " + esc(s.note) : ""}</span>` : ""}
        ${isNext ? `<div class="acts">
          <input class="input" style="min-height:32px;padding:4px 8px;font-size:14px" id="wf-note" placeholder="poznámka (nepovinné)">
          ${s.key === "potvrzeni" ? `<label class="check" style="font-size:14px"><input type="checkbox" id="wf-notify"><span>Informovat zákazníka</span></label>` : ""}
          <button class="btn btn-dark btn-xs" data-wf="${s.key}">${s.key === "potvrzeni" ? "Potvrdit – zpracovat" : "Hotovo"}</button></div>` : ""}
        ${lastDone && lastDone.key === s.key ? `<div class="acts"><button class="icon-btn" data-wf-undo="${s.key}">Vrátit krok</button></div>` : ""}
      </div></li>`;
    }).join("")}</ol></section>`;
}

function panelContact(o) {
  const a = o.answers || {};
  const rows = [
    ["Jméno", esc(a.kontakt_jmeno)],
    ["E-mail", a.kontakt_email ? `<a class="link" href="mailto:${esc(a.kontakt_email)}">${esc(a.kontakt_email)}</a>` : "–"],
    ["Telefon", a.kontakt_telefon ? `<a class="link" href="tel:${esc(String(a.kontakt_telefon).replace(/\s/g, ""))}">${esc(a.kontakt_telefon)}</a>` : "–"],
    ["Role", esc(core.formatValue(core.CONTACT_STEP.questions.find((q) => q.id === "role"), a.role) || "–")],
    ["Firma", esc([a.firma, a.ico ? "IČO " + a.ico : ""].filter(Boolean).join(", ") || "–")],
  ];
  return `<section class="panel"><h2>Zákazník</h2><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <div class="row-acts" style="margin-top:10px"><button class="btn btn-xs" data-act="customer-link">Nový odkaz pro zákazníka</button></div>
    ${S.link ? `<div class="field" style="margin-top:8px"><input class="input" readonly value="${esc(S.link)}" id="cust-link"><span class="help">Odkaz otevře zákazníkovi stránku zakázky. Pošlete ho jen jemu.</span></div>` : ""}</section>`;
}

function panelStatus(o) {
  return `<section class="panel"><h2>Stav</h2>
    <div class="inline-form">
      <div class="field"><label for="st-sel">Stav zpracování</label><select class="select" id="st-sel">${Object.entries(core.STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
      <div class="field"><label for="due">Termín</label><input class="input" type="date" id="due" value="${esc(o.due_date || "")}"></div>
      <div class="field"><label for="price">Cena / nabídka (interní)</label><input class="input" id="price" value="${esc(o.price_note || "")}"></div>
      <button class="btn btn-dark btn-sm" data-act="save-status">Uložit</button>
    </div>
    <p class="help" style="margin-top:8px">„Dokončena“ jde nastavit až s ověřeným a předaným výstupem.</p>
    ${o.phase !== "cancelled" && o.phase !== "draft" ? `<button class="icon-btn" data-act="cancel-order">Zrušit zakázku</button>` : ""}
  </section>`;
}

function panelCompleteness(o, ev) {
  const li = (arr, f) => (arr.length ? `<ul>${arr.map(f).join("")}</ul>` : `<p class="muted">–</p>`);
  const lvl = { submit: "povinné", process: "ke zpracování", later: "později" };
  return `<section class="panel"><h2>Úplnost zakázky<span class="sp"></span>
      ${ev.readyForProcessing ? `<span class="st st-dokoncena">lze zpracovat</span>` : `<span class="st st-ceka_na_podklady">chybí podklady</span>`}
      <button class="btn btn-xs" data-act="reevaluate">Přepočítat</button></h2>
    <div class="groups">
      <h3>Chybí</h3>${li(ev.missing, (m) => `<li>${esc(m.label)} <span class="muted">(${lvl[m.level]})</span></li>`)}
      <h3>Převzato automaticky – ověřit</h3>${li(ev.auto, (x) => `<li>${esc(x.label)}: <strong>${esc(x.value)}</strong><span class="q-auto st ${x.quality === "odhad" ? "st-ceka_na_podklady" : "st-pripravena"}">${x.quality === "odhad" ? "odhad" : "převzato"}</span> <span class="muted">${esc(x.source)}</span></li>`)}
      <h3>K potvrzení</h3>${li(ev.confirm, (c) => `<li>${esc(c.label)} <span class="muted">(${c.who === "zakaznik" ? "zákazník" : "projektant"})</span></li>`)}
      <h3>Posoudí projektant</h3>${li(ev.designer, (d) => `<li>${esc(d.label)}</li>`)}
      ${ev.manual.length ? `<h3>Ruční posouzení</h3>${li(ev.manual, (m) => `<li>${esc(m)}</li>`)}` : ""}
      <p class="muted" style="margin-top:10px">Odborná kontrola výstupu je vždy nutná – výstup nelze předat bez ověření.</p>
    </div></section>`;
}

function panelAnswers(o) {
  const rows = core.summaryRows(o).filter((r) => !["kontakt_jmeno", "kontakt_email", "kontakt_telefon", "firma", "ico", "role"].includes(r.key));
  return `<section class="panel"><h2>Zadání</h2><dl class="kv">${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("") || "<dt>–</dt><dd></dd>"}</dl></section>`;
}

function panelSite(o) {
  const s = o.answers?.site || {};
  const t = o.site || {};
  const b = s.building || t.building;
  if (!s.query && !Number.isFinite(s.lat)) return "";
  return `<section class="panel"><h2>Stavba<span class="sp"></span>${Number.isFinite(s.lat) ? `<button class="btn btn-xs" data-run="geo_refresh">Načíst znovu z RÚIAN</button>` : ""}</h2>
    <dl class="kv">
      <dt>Místo</dt><dd>${esc(core.siteLabel(s))} ${s.source === "manual" ? `<span class="st st-ceka_na_podklady">zadáno ručně</span>` : ""}</dd>
      ${s.parcel || s.parcel_manual ? `<dt>Parcela</dt><dd>${esc(s.parcel || s.parcel_manual)}${s.ku ? ", k. ú. " + esc(s.ku) : ""}</dd>` : ""}
      ${b ? `<dt>Budova</dt><dd>${esc(b.use || "")}${b.floors ? ", " + b.floors + " podl." : ""} · ${String(b.length).replace(".", ",")} × ${String(b.width).replace(".", ",")} m (odhad) ${b.height_est ? "· výška ~" + String(b.height_est).replace(".", ",") + " m (odhad)" : ""} ${s.building_confirmed ? `<span class="st st-dokoncena">zákazník potvrdil budovu</span>` : `<span class="st st-ceka_na_podklady">budova nepotvrzena</span>`}</dd>` : ""}
      ${Number.isFinite(s.lat) ? `<dt>GPS</dt><dd>${s.lat.toFixed(6)}, ${s.lon.toFixed(6)} · <a class="link" target="_blank" rel="noopener" href="https://mapy.com/zakladni?x=${s.lon}&y=${s.lat}&z=19&source=coor&id=${s.lon},${s.lat}">Mapy.com</a> · <a class="link" target="_blank" rel="noopener" href="https://nahlizenidokn.cuzk.gov.cz/MapaIdentifikace.aspx?l=KN&x=${s.lon}&y=${s.lat}">Nahlížení do KN</a></dd>` : ""}
      ${s.note ? `<dt>Poznámka</dt><dd>${esc(s.note)}</dd>` : ""}
    </dl>
    ${Number.isFinite(s.lat) ? `<div data-map-slot></div>` : ""}</section>`;
}

function panelInputs(o, inputs) {
  return `<section class="panel"><h2>Podklady od zákazníka (${inputs.length})</h2>
    ${inputs.length ? `<ul class="files">${inputs.map((f) => `<li><div><div class="nm">${esc(f.file_name)}</div>
        <div class="info">${esc(core.FILE_CATEGORIES[f.category]?.label || f.category)} · ${size(f.size)} · ${dt(f.uploaded_at || f.created_at)}${f.status !== "uploaded" ? " · <strong>nedokončeno</strong>" : ""}</div>
        ${f.meta?.label ? `<div class="info">${esc(f.meta.label)}${f.meta.pages ? ` · ${f.meta.pages} str.` : ""}${f.meta.sheet ? ` · ${esc(f.meta.sheet)}` : ""}${f.meta.width_px ? ` · ${f.meta.width_px}×${f.meta.height_px} px` : ""}${f.meta.dpi ? ` · ${f.meta.dpi} DPI` : ""}${f.meta.cad_version ? ` · ${esc(f.meta.cad_version)}` : ""}${f.meta.note ? ` · ${esc(f.meta.note)}` : ""}</div>` : ""}</div>
        <div class="acts">${f.status === "uploaded" ? `<button class="btn btn-xs" data-dl="${f.id}">Stáhnout</button><button class="btn btn-xs" data-run="analyza_podkladu" data-file="${f.id}">${f.meta?.label ? "Znovu analyzovat" : "Analyzovat"}</button>` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Bez souborů.</p>`}
  </section>`;
}

function panelProcessing(o, runs, wf) {
  const confirmed = wf.confirmed;
  const sel = Object.entries(o.template_selection || {});
  const tplOptions = sel.map(([kind, vid]) => {
    const v = S.templates.flatMap((t) => (t.doc_template_versions || []).map((x) => ({ ...x, t }))).find((x) => x.id === vid);
    return v && /\.docx$/i.test(v.file_name) ? `<option value="${v.id}">${esc(v.t.name)} v${v.version}</option>` : "";
  }).join("");
  const dis = confirmed ? "" : "disabled";
  return `<section class="panel"><h2>Zpracování</h2>
    ${confirmed ? "" : `<p class="notice">Zpracování spustíte po kroku „Nabídka přijata – potvrdit zpracování“.</p>`}
    <div class="row-acts">
      <button class="btn btn-sm" data-run="situace_dxf" ${dis}>Situace DXF z katastru</button>
      <button class="btn btn-sm" data-run="project_data" ${dis}>Data pro TZ (JSON)</button>
      ${tplOptions ? `<select class="select" id="tpl-run" style="width:auto;min-height:36px">${tplOptions}</select><button class="btn btn-sm" data-run="docx_sablona" ${dis}>Vyplnit vzor DOCX</button>` : `<span class="muted" style="font-size:14px">Vzor DOCX vyberte v panelu Vzory.</span>`}
      <button class="btn btn-sm" data-run="externi" ${dis}>Do fronty pro TZ / agenta</button>
    </div>
    ${runs.length ? `<ul class="events" style="margin-top:12px">${runs.map((r) => `<li><span class="t">${dt(r.created_at)} · ${esc(r.created_by || "")}</span><br>${esc(r.task)} – <strong>${esc({ queued: "ve frontě", running: "běží", done: "hotovo", failed: "chyba", cancelled: "zrušeno" }[r.status])}</strong>${r.error ? ` · <span class="error">${esc(r.error)}</span>` : ""}${r.result?.unfilled?.length ? ` · nevyplněno: ${esc(r.result.unfilled.join(", "))}` : ""}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function panelOutputs(o, outputs) {
  return `<section class="panel"><h2>Výstupy (${outputs.length})</h2>
    ${outputs.length ? `<ul class="files">${outputs.map((f) => `<li><div><div class="nm">${esc(f.file_name)}</div>
        <div class="info">${esc(f.output_kind || "")} v${f.output_version || 1} · ${esc(f.source || "")} · ${size(f.size)} · ${dt(f.created_at)}</div>
        <div class="info">${f.review_status === "overeno" ? `<span class="st st-dokoncena">ověřeno ${esc(f.reviewed_by || "")}</span>` : f.review_status === "zamitnuto" ? `<span class="st st-rucni_posouzeni">zamítnuto</span>` : `<span class="st st-ceka_na_podklady">neověřeno</span>`}
          ${f.released ? ` <span class="st st-pripravena">předáno ${d1(f.released_at)}</span>` : ""}${f.meta?.unfilled?.length ? ` · nevyplněno: ${esc(f.meta.unfilled.join(", "))}` : ""}</div></div>
        <div class="acts"><button class="btn btn-xs" data-dl="${f.id}">Stáhnout</button>
          ${f.review_status !== "overeno" ? `<button class="btn btn-xs" data-review="overeno" data-file="${f.id}">Ověřeno</button>` : ""}
          ${f.review_status === "neovereno" ? `<button class="btn btn-xs" data-review="zamitnuto" data-file="${f.id}">Zamítnout</button>` : ""}
          ${f.review_status === "overeno" && !f.released ? `<button class="btn btn-dark btn-xs" data-release="${f.id}">Předat zákazníkovi</button>` : ""}
          ${f.released ? `<button class="btn btn-xs" data-unrelease="${f.id}">Stáhnout z předání</button>` : ""}
          ${!f.released ? `<button class="icon-btn" data-del-out="${f.id}">Smazat</button>` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Zatím žádné výstupy.</p>`}
    <div class="inline-form" style="margin-top:12px">
      <div class="field"><label for="out-kind">Druh výstupu</label><select class="select" id="out-kind">
        ${["technicka_zprava", "vykresy", "jednopolove_schema", "situace", "vykaz_materialu", "analyza_rizika", "dwg", "jine"].map((k) => `<option value="${k}">${k.replace(/_/g, " ")}</option>`).join("")}</select></div>
      <div class="field"><label for="out-file">Soubor</label><input class="input" type="file" id="out-file" multiple></div>
      <button class="btn btn-sm" data-act="upload-out">Nahrát výstup</button>
    </div>
    <label class="check" style="margin-top:8px;font-size:14px"><input type="checkbox" id="rel-notify" checked><span>Při předání poslat zákazníkovi e-mail s odkazem</span></label>
  </section>`;
}

function panelRequest(o, ev, requests) {
  if (o.phase === "draft") return "";
  const open = requests.filter((r) => r.status === "open");
  const items = ev.missing.filter((m) => m.level !== "submit");
  return `<section class="panel"><h2>Vyžádat podklady</h2>
    ${open.map((r) => `<p class="notice">Otevřená výzva ${d1(r.created_at)}: ${esc((r.items || []).join(", "))} ${esc(r.message || "")}</p>`).join("")}
    ${items.map((m, i) => `<label class="check" style="font-size:14px;margin-bottom:4px"><input type="checkbox" data-req-item="${esc(m.ask || m.label)}" ${m.level === "process" ? "checked" : ""}><span>${esc(m.ask || m.label)}</span></label>`).join("")}
    <div class="field" style="margin-top:8px"><label for="req-msg">Zpráva zákazníkovi</label><textarea class="textarea" id="req-msg" style="min-height:80px"></textarea></div>
    <button class="btn btn-dark btn-sm" data-act="info-request">Odeslat výzvu</button>
    <p class="help" style="margin-top:6px">Zákazník dostane e-mail s odkazem a výzvu uvidí na stránce zakázky. Stav se změní na „Čeká na podklady“.</p>
  </section>`;
}

function panelTemplates(o) {
  const comp = S.companies.filter((c) => c.active || c.id === o.company_profile_id);
  const avail = S.templates.filter((t) => t.active && (!t.company_id || t.company_id === o.company_profile_id));
  const kinds = [...new Set(avail.map((t) => t.kind))];
  const sel = o.template_selection || {};
  return `<section class="panel"><h2>Vzory</h2>
    <div class="field"><label for="comp-sel">Firemní profil</label><select class="select" id="comp-sel"><option value="">Bez firmy – univerzální vzory</option>
      ${comp.map((c) => `<option value="${c.id}" ${o.company_profile_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    ${kinds.length ? kinds.map((k) => {
      const opts = avail.filter((t) => t.kind === k).flatMap((t) => (t.doc_template_versions || []).sort((a, b) => b.version - a.version).map((v) => ({ t, v })));
      return `<div class="field"><label for="tpl-${k}">${esc(KINDS[k] || k)}</label><select class="select" id="tpl-${k}" data-tpl-kind="${k}"><option value="">–</option>
        ${opts.map(({ t, v }) => `<option value="${v.id}" ${sel[k] === v.id ? "selected" : ""}>${t.company_id ? "" : "[univerzální] "}${esc(t.name)} v${v.version}${v.is_current ? " (aktuální)" : ""}</option>`).join("")}</select></div>`;
    }).join("") : `<p class="muted">Žádné vzory. Nahrajete je v části <a class="link" href="#vzory">Vzory a firmy</a>.</p>`}
    <button class="btn btn-sm" data-act="save-templates">Uložit výběr</button>
    <p class="help" style="margin-top:6px">Nabízejí se jen univerzální vzory a vzory vybrané firmy – vzory jiných firem k zakázce přiřadit nejde.</p>
  </section>`;
}

function panelNotes(o, events) {
  const label = { created: "založeno", submitted: "odesláno", status: "stav", phase: "fáze", note: "poznámka", info_request: "výzva", info_response: "doplnění", file: "soubor", output: "výstup", email: "e-mail", automation: "zpracování", geo: "katastr", template: "vzor", crm: "CRM", workflow: "postup", error: "chyba" };
  const msg = (e) => e.message || (e.type === "status" ? `${core.STATUSES[e.data?.from] || e.data?.from} → ${core.STATUSES[e.data?.to] || e.data?.to}` : e.type === "phase" ? `${core.PHASES[e.data?.from] || ""} → ${core.PHASES[e.data?.to] || ""}` : "");
  return `<section class="panel"><h2>Poznámky a historie</h2>
    <div class="field"><label for="note" class="visually-hidden">Poznámka</label><textarea class="textarea" id="note" style="min-height:70px" placeholder="Interní poznámka"></textarea></div>
    <button class="btn btn-sm" data-act="add-note">Přidat poznámku</button>
    <ul class="events" style="margin-top:12px">${events.map((e) => `<li><span class="t">${dt(e.at)} · ${esc(e.actor)} · ${esc(label[e.type] || e.type)}${e.visible_to_customer ? " · vidí zákazník" : ""}</span><br>${esc(msg(e))}</li>`).join("")}</ul>
  </section>`;
}

/* ------------------------------------------------------------------ vzory a nastavení */

const KINDS = { titulni_list: "Titulní list", pruvodni_zprava: "Průvodní zpráva", technicka_zprava: "Technická zpráva", razitko: "Razítko", vykresovy_ramecek: "Výkresový rámeček", cad_vzor: "CAD vzor / hladiny", vykaz_materialu: "Výkaz materiálu", jednopolove_schema: "Jednopólové schéma", jine: "Jiný" };

function viewTemplates() {
  const comp = S.companies;
  const group = (cid) => S.templates.filter((t) => (t.company_id || "") === (cid || ""));
  const tplHtml = (t) => {
    const vers = (t.doc_template_versions || []).sort((a, b) => b.version - a.version);
    return `<div class="tpl"><div class="row-acts"><strong>${esc(t.name)}</strong> <span class="st st-pripravena">${esc(KINDS[t.kind] || t.kind)}</span> <span class="muted">${esc(t.service)}</span>${t.active ? "" : ` <span class="st st-draft">neaktivní</span>`}
        <span style="flex:1"></span>
        <label class="btn btn-xs" for="tv-${t.id}">Nahrát novou verzi</label><input type="file" id="tv-${t.id}" data-tpl-upload="${t.id}" hidden>
        <button class="icon-btn" data-tpl-active="${t.id}" data-val="${t.active ? "0" : "1"}">${t.active ? "Deaktivovat" : "Aktivovat"}</button></div>
      <div class="vers">${vers.length ? vers.map((v) => `v${v.version} ${esc(v.file_name)} · ${d1(v.created_at)}${v.is_current ? " · <strong>aktuální</strong>" : ` · <button class="icon-btn" data-tpl-current="${v.id}">nastavit jako aktuální</button>`} · <button class="icon-btn" data-tpl-dl="${v.id}">stáhnout</button>${v.placeholders?.length ? ` · značky: ${esc(v.placeholders.join(", "))}` : ""}`).join("<br>") : "Zatím bez souboru."}</div></div>`;
  };
  return `<h1>Vzory a firmy</h1>
    <div class="d-grid"><div>
      <section class="panel"><h2>Univerzální vzory</h2>${group("").map(tplHtml).join("") || `<p class="muted">Zatím žádné. Nahrajte vlastní vzor – obsah vzorů se nevymýšlí.</p>`}</section>
      ${comp.map((c) => `<section class="panel"><h2>${esc(c.name)}${c.ico ? ` <span class="muted">IČO ${esc(c.ico)}</span>` : ""}${c.active ? "" : ` <span class="st st-draft">neaktivní</span>`}<span class="sp"></span><button class="icon-btn" data-edit-company="${c.id}">Upravit</button></h2>
        ${group(c.id).map(tplHtml).join("") || `<p class="muted">Bez vzorů.</p>`}</section>`).join("")}
    </div><div>
      <section class="panel"><h2>Nový vzor</h2>
        <div class="field"><label for="nt-name">Název</label><input class="input" id="nt-name" placeholder="např. Titulní list – Simply"></div>
        <div class="field"><label for="nt-kind">Druh</label><select class="select" id="nt-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="field"><label for="nt-service">Služba</label><select class="select" id="nt-service"><option value="any">Všechny</option><option value="fve">FVE</option><option value="lps">LPS</option><option value="dwg">DWG</option></select></div>
        <div class="field"><label for="nt-company">Firma</label><select class="select" id="nt-company"><option value="">Univerzální</option>${comp.filter((c) => c.active).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="nt-file">Soubor (DOCX, DWG, DXF, XLSX, PDF…)</label><input class="input" type="file" id="nt-file"></div>
        <button class="btn btn-dark btn-sm" data-act="new-template">Přidat vzor</button>
        <p class="help" style="margin-top:8px">Každé nahrání vytvoří novou verzi – starší verze zůstávají a zakázky, které je použily, se nemění.</p>
      </section>
      <section class="panel" id="company-form"><h2>${S.editCompany?.id ? "Upravit firmu" : "Nová firma"}</h2>
        ${["name:Název", "ico:IČO", "address:Adresa", "contact:Kontakt"].map((x) => { const [k, l] = x.split(":"); return `<div class="field"><label for="c-${k}">${l}</label><input class="input" id="c-${k}" value="${esc(S.editCompany?.[k] || "")}"></div>`; }).join("")}
        <div class="field"><label for="c-notes">Poznámky (standardy, požadavky)</label><textarea class="textarea" id="c-notes" style="min-height:70px">${esc(S.editCompany?.notes || "")}</textarea></div>
        <label class="check"><input type="checkbox" id="c-active" ${S.editCompany?.active === false ? "" : "checked"}><span>Aktivní</span></label>
        <div class="row-acts" style="margin-top:10px"><button class="btn btn-dark btn-sm" data-act="save-company">Uložit firmu</button>${S.editCompany?.id ? `<button class="icon-btn" data-act="new-company">Nová firma</button>` : ""}</div>
      </section>
      <section class="panel"><h2>Značky ve vzorech DOCX</h2>
        <p class="help">Do vzoru napište značku, např. <code>{{misto.adresa}}</code>. Co v zakázce není, zůstane ve výstupu žlutě jako „DOPLNIT“.</p>
        <dl class="kv">${Object.entries(S.keys || {}).map(([k, v]) => `<dt><code>{{${esc(k)}}}</code></dt><dd>${esc(v)}</dd>`).join("")}</dl>
      </section>
    </div></div>`;
}

function viewSettings() {
  const u = S.usage;
  return `<h1>Nastavení</h1>
    <section class="panel"><h2>E-maily (Brevo)</h2>
      <p>Zkušební e-mail ověří, že je nastavený klíč BREVO_API_KEY a odesílací adresa.</p>
      <div class="inline-form"><div class="field"><label for="test-to">Komu</label><input class="input" id="test-to" value="${esc(S.user?.email || "")}"></div><button class="btn btn-sm" data-act="email-test">Poslat zkušební e-mail</button></div>
    </section>
    <section class="panel"><h2>Úložiště</h2>
      ${u ? `<p>Podklady a výstupy: <strong>${size(u.orders_bytes)}</strong>, vzory: <strong>${size(u.templates_bytes)}</strong> z ${size(u.limit_bytes)} (bezplatný tarif Supabase).</p>` : ""}
      <div class="row-acts"><button class="btn btn-sm" data-act="usage">Zjistit obsazení</button><button class="btn btn-sm" data-act="cleanup">Smazat neodeslaná zadání starší 30 dnů</button></div>
    </section>`;
}

/* ------------------------------------------------------------------ akce */

async function staffRun(task, extra = {}) {
  const o = S.detail.order;
  const r = await guard(() => D.staff("run", { order_id: o.id, task, ...extra }), "Hotovo.");
  if (r) await reload();
}

app.addEventListener("submit", async (e) => {
  if (e.target.id !== "login-form") return;
  e.preventDefault();
  S.loginError = "";
  try {
    await D.signIn($("#l-email").value.trim(), $("#l-pass").value);
    await start();
  } catch (err) {
    S.loginError = err.message;
    render();
  }
});

app.addEventListener("input", (e) => {
  if (e.target.dataset.f === "q") {
    S.filters.q = e.target.value;
    ls.set({ ...S.filters, q: "" });
    const pos = e.target.selectionStart;
    render();
    const i = $("#f-q");
    i.focus();
    i.setSelectionRange(pos, pos);
  }
});

app.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.f && t.dataset.f !== "q") {
    S.filters[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value;
    ls.set({ ...S.filters, q: "" });
    if (t.dataset.f === "drafts") return loadList();
    return render();
  }
  if (t.dataset.tplUpload) {
    const tpl = S.templates.find((x) => x.id === t.dataset.tplUpload);
    const f = t.files[0];
    if (!f) return;
    const v = await guard(() => D.uploadTemplateVersion(tpl, f), "Nová verze nahrána.");
    if (v) { await D.staff("template_scan", { template_version_id: v.id }).catch(() => null); loadTemplates(); }
  }
});

app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tr.row")) location.hash = `#z=${e.target.dataset.open}`;
});

app.addEventListener("click", async (e) => {
  const t = e.target.closest("button, tr.row, a");
  if (!t) return;
  if (t.matches("tr.row")) { location.hash = `#z=${t.dataset.open}`; return; }
  const o = S.detail?.order;
  const act = t.dataset.act;

  if (t.dataset.wf) {
    const r = await guard(() => D.staff("workflow", { order_id: o.id, step: t.dataset.wf, note: $("#wf-note")?.value || "", notify: !!$("#wf-notify")?.checked }), "Krok uložen a promítnut do CRM.");
    if (r) reload();
    return;
  }
  if (t.dataset.wfUndo) {
    if (!confirm("Vrátit poslední krok postupu?")) return;
    const r = await guard(() => D.staff("workflow", { order_id: o.id, step: t.dataset.wfUndo, done: false }), "Krok vrácen.");
    if (r) reload();
    return;
  }
  if (t.dataset.run) {
    const extra = t.dataset.file ? { file_id: t.dataset.file } : t.dataset.run === "docx_sablona" ? { template_version_id: $("#tpl-run")?.value } : {};
    return staffRun(t.dataset.run, extra);
  }
  if (t.dataset.dl) {
    const f = S.detail.files.find((x) => x.id === t.dataset.dl);
    const url = await guard(() => D.fileUrl(f.storage_path, f.file_name));
    if (url) window.open(url, "_blank", "noopener");
    return;
  }
  if (t.dataset.review) {
    const r = await guard(() => D.setReview(t.dataset.file, t.dataset.review), t.dataset.review === "overeno" ? "Výstup označen jako ověřený." : "Výstup zamítnut.");
    if (r) reload();
    return;
  }
  if (t.dataset.release || t.dataset.unrelease) {
    const r = await guard(() => D.staff("release", { file_id: t.dataset.release || t.dataset.unrelease, released: !!t.dataset.release, notify: !!t.dataset.release && $("#rel-notify")?.checked }), t.dataset.release ? "Předáno zákazníkovi." : "Staženo z předání.");
    if (r) reload();
    return;
  }
  if (t.dataset.delOut) {
    if (!confirm("Smazat výstup?")) return;
    const f = S.detail.files.find((x) => x.id === t.dataset.delOut);
    await guard(() => D.deleteOutput(f), "Smazáno.");
    return reload();
  }
  if (t.dataset.tplCurrent) { await guard(() => D.setCurrentVersion(t.dataset.tplCurrent), "Nastaveno."); return loadTemplates(); }
  if (t.dataset.tplActive) { await guard(() => D.setTemplateActive(t.dataset.tplActive, t.dataset.val === "1")); return loadTemplates(); }
  if (t.dataset.tplDl) {
    const v = S.templates.flatMap((x) => x.doc_template_versions || []).find((x) => x.id === t.dataset.tplDl);
    const url = await guard(() => D.templateUrl(v.storage_path, v.file_name));
    if (url) window.open(url, "_blank", "noopener");
    return;
  }
  if (t.dataset.editCompany) { S.editCompany = S.companies.find((c) => c.id === t.dataset.editCompany); render(); $("#company-form").scrollIntoView(); return; }

  if (act === "logout") { await D.signOut(); S.user = null; S.view = "login"; return render(); }
  if (act === "refresh") return loadList();
  if (act === "reevaluate") { await guard(() => D.staff("reevaluate", { order_id: o.id }), "Přepočítáno."); return reload(); }
  if (act === "crm-sync") { await guard(() => D.staff("crm_sync", { order_id: o.id }), "CRM aktualizováno."); return reload(); }
  if (act === "customer-link") { const r = await guard(() => D.staff("customer_link", { order_id: o.id })); if (r) { S.link = r.url; render(); $("#cust-link")?.select(); } return; }
  if (act === "save-status") {
    const r = await guard(() => D.updateOrder(o.id, { status: $("#st-sel").value, due_date: $("#due").value || null, price_note: $("#price").value || null }), "Uloženo.");
    if (r) reload(); else render();
    return;
  }
  if (act === "cancel-order") {
    if (!confirm("Opravdu zrušit zakázku? Zákazník uvidí stav „zrušeno“.")) return;
    await guard(() => D.updateOrder(o.id, { phase: "cancelled" }), "Zakázka zrušena.");
    return reload();
  }
  if (act === "info-request") {
    const items = [...app.querySelectorAll("[data-req-item]:checked")].map((x) => x.dataset.reqItem);
    const r = await guard(() => D.staff("info_request", { order_id: o.id, items, message: $("#req-msg").value }));
    if (r) { flash(r.mail?.sent ? "Výzva odeslána e-mailem." : `Výzva uložena. E-mail neodešel: ${r.mail?.reason || "zákazník nemá e-mail"}`); reload(); }
    return;
  }
  if (act === "save-templates") {
    const sel = {};
    app.querySelectorAll("[data-tpl-kind]").forEach((s) => { if (s.value) sel[s.dataset.tplKind] = s.value; });
    const company = $("#comp-sel").value || null;
    const companyChanged = company !== (o.company_profile_id || null);
    const r = await guard(() => D.updateOrder(o.id, { company_profile_id: company, template_selection: companyChanged ? {} : sel }), companyChanged ? "Firma změněna – vyberte vzory znovu." : "Výběr vzorů uložen.");
    if (r) reload();
    return;
  }
  if (act === "add-note") {
    const text = $("#note").value.trim();
    if (!text) return;
    await guard(() => D.addNote(o.id, text), "Poznámka přidána.");
    return reload();
  }
  if (act === "upload-out") {
    const files = [...($("#out-file").files || [])];
    if (!files.length) return flash("Vyberte soubor.", true);
    for (const f of files) await guard(() => D.uploadOutput(o, f, $("#out-kind").value), `Nahráno: ${f.name}`);
    return reload();
  }
  if (act === "new-template") {
    const name = $("#nt-name").value.trim();
    const file = $("#nt-file").files[0];
    if (!name) return flash("Zadejte název vzoru.", true);
    const t2 = await guard(() => D.createTemplate({ name, kind: $("#nt-kind").value, service: $("#nt-service").value, company_id: $("#nt-company").value || null }));
    if (t2 && file) {
      const v = await guard(() => D.uploadTemplateVersion(t2, file), "Vzor přidán.");
      if (v) await D.staff("template_scan", { template_version_id: v.id }).catch(() => null);
    }
    return loadTemplates();
  }
  if (act === "save-company") {
    const c = { id: S.editCompany?.id, name: $("#c-name").value.trim(), ico: $("#c-ico").value.trim(), address: $("#c-address").value.trim(), contact: $("#c-contact").value.trim(), notes: $("#c-notes").value, active: $("#c-active").checked };
    if (!c.name) return flash("Zadejte název firmy.", true);
    if (c.ico && !core.validIco(c.ico)) return flash("IČO nemá platný tvar.", true);
    const r = await guard(() => D.saveCompany(c), "Firma uložena.");
    if (r) { S.editCompany = null; loadTemplates(); }
    return;
  }
  if (act === "new-company") { S.editCompany = null; return render(); }
  if (act === "email-test") {
    const r = await guard(() => D.staff("email_test", { to: $("#test-to").value }));
    if (r) flash(r.sent ? "Zkušební e-mail odeslán." : `Neodesláno: ${r.reason}`, !r.sent);
    return;
  }
  if (act === "usage") { S.usage = await guard(() => D.staff("storage_usage")); return render(); }
  if (act === "cleanup") {
    if (!confirm("Smazat neodeslaná zadání starší 30 dnů včetně jejich souborů?")) return;
    const r = await guard(() => D.staff("cleanup_drafts"));
    if (r) flash(`Smazáno zadání: ${r.deleted}`);
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act='logout']");
  if (t && !app.contains(t)) { await D.signOut(); S.user = null; S.view = "login"; render(); }
});

start();
