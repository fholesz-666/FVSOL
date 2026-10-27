/**
 * Zadání zakázky – průvodce po krocích.
 * Rozpracované zadání se ukládá na server (tajný odkaz v adrese #t=…), takže jde kdykoli pokračovat.
 * Po odeslání slouží stejná stránka jako stránka zakázky: stav, doplnění podkladů, stažení dokumentace.
 */
import * as core from "./core.js";
import { api, ApiError, putSigned } from "./api.js";
import { SiteMap } from "./map.js";
import { CONFIG } from "./config.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* soukromé okno */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nic */ } },
};
const LS_KEY = "fvsol.zadani";
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const fmtTime = (d) => new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(d);
const fmtDate = (s) => (s ? new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(s)) : "");

const S = {
  view: "loading",
  token: null,
  service: null,
  answers: {},
  files: [],
  outputs: [],
  requests: [],
  order: null,
  stepIdx: 0,
  errors: {},
  showErrors: false,
  siteFull: null,
  site: { suggestions: [], active: -1, manual: false, busy: false, error: "" },
  prefilled: {},
  saveState: "",
  loadedAt: Date.now(),
  createdHere: false,
  fatal: "",
  submitError: null,
  respondText: "",
};

const app = $("#app");
const saveEl = $("#z-save");
const mapEl = document.createElement("div");
mapEl.className = "site-map";
mapEl.setAttribute("aria-label", "Mapa stavby – kliknutím vyberete budovu");
const mapCtl = new SiteMap(mapEl, { onPick: (id) => pickBuilding(id) });

/* ------------------------------------------------------------------ start */

function tokenFromHash() {
  const m = /[#&]t=([A-Za-z0-9_-]{30,100})/.exec(location.hash);
  return m ? m[1] : null;
}

async function init() {
  const t = tokenFromHash();
  if (t) return load(t);
  S.view = "start";
  render();
}

async function load(token) {
  S.view = "loading";
  render();
  try {
    const r = await api("get", { token });
    applyServer(token, r);
    if (S.order.phase === "draft") {
      const saved = LS.get(LS_KEY);
      S.stepIdx = saved?.token === token && Number.isInteger(saved.step) ? Math.min(saved.step, steps().length - 1) : 0;
      S.view = "step";
      LS.set(LS_KEY, { token, service: S.service, step: S.stepIdx });
    } else {
      S.view = "status";
      if (LS.get(LS_KEY)?.token === token) LS.del(LS_KEY);
    }
  } catch (e) {
    S.view = "error";
    S.fatal = e instanceof ApiError && e.status === 404 ? "Odkaz na zakázku není platný. Zkontrolujte, že jste ho zkopírovali celý." : e.message;
    if (LS.get(LS_KEY)?.token === token) LS.del(LS_KEY);
  }
  render();
}

function applyServer(token, r) {
  S.token = token;
  S.order = r.order;
  S.service = r.order.service;
  S.answers = r.order.answers || {};
  S.files = r.files || [];
  S.outputs = r.outputs || [];
  S.requests = r.requests || [];
  if (r.order.site?.buildings) S.siteFull = { ...(S.answers.site || {}), buildings: r.order.site.buildings };
  S.evaluation = r.evaluation || null;
  if (S.answers.site?.source === "manual") S.site.manual = true;
  if (location.hash !== `#t=${token}` || location.search) history.replaceState(null, "", `${location.pathname}#t=${token}`);
}

async function startService(service) {
  if (S.busy) return;
  S.busy = true;
  render();
  try {
    const r = await api("create", { service });
    S.createdHere = true;
    S.loadedAt = Date.now();
    applyServer(r.token, r);
    S.stepIdx = 0;
    S.view = "step";
    LS.set(LS_KEY, { token: r.token, service, step: 0 });
  } catch (e) {
    S.fatal = e.message;
    S.view = "error";
  }
  S.busy = false;
  render();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ kroky */

const steps = () => core.stepsFor(S.service);
const curStep = () => steps()[S.stepIdx];

function localEval() {
  return core.evaluate({ service: S.service, answers: S.answers, files: S.files.map((f) => ({ ...f, direction: "in" })) });
}

let saveTimer = null;
function scheduleSave(ms = 700) {
  clearTimeout(saveTimer);
  setSave("Ukládám…");
  saveTimer = setTimeout(save, ms);
}
async function save() {
  clearTimeout(saveTimer);
  if (!S.token || S.order?.phase !== "draft") return;
  S.saving = true;
  try {
    await api("save", { token: S.token, service: S.service, answers: S.answers });
    setSave(`Uloženo ${fmtTime(new Date())}`);
  } catch (e) {
    setSave("Neuloženo – zkouším znovu");
    saveTimer = setTimeout(save, 5000);
    console.warn(e);
  }
  S.saving = false;
}
function setSave(t) {
  S.saveState = t;
  if (saveEl) saveEl.textContent = t;
}

function go(idx) {
  S.stepIdx = Math.max(0, Math.min(idx, steps().length - 1));
  S.showErrors = false;
  S.errors = {};
  LS.set(LS_KEY, { token: S.token, service: S.service, step: S.stepIdx });
  render();
  window.scrollTo(0, 0);
  $("h1", app)?.focus();
}

function next() {
  const step = curStep();
  const uploading = S.files.some((f) => f.status === "uploading");
  const errs = core.validateStep(step, S.answers, { uploading });
  S.errors = errs;
  if (Object.keys(errs).length) {
    S.showErrors = true;
    render();
    const first = $(".q .error", app);
    first?.closest(".q")?.scrollIntoView({ block: "center" });
    first?.closest(".q")?.querySelector("input,textarea,select,button")?.focus();
    return;
  }
  save();
  go(S.stepIdx + 1);
}

/* ------------------------------------------------------------------ vykreslení */

function render() {
  const active = document.activeElement?.id;
  if (S.view === "loading") app.innerHTML = `<p class="muted">Načítám…</p>`;
  else if (S.view === "error") app.innerHTML = viewError();
  else if (S.view === "start") app.innerHTML = viewStart();
  else if (S.view === "status") app.innerHTML = viewStatus();
  else app.innerHTML = viewStep();
  const slot = $("[data-map-slot]", app);
  if (slot) {
    slot.replaceWith(mapEl);
    mapEl.hidden = !S.siteFull?.buildings?.length && !Number.isFinite(S.answers.site?.lat);
    if (!mapEl.hidden) mapCtl.show(S.siteFull || S.answers.site);
  }
  if (active && document.getElementById(active)) document.getElementById(active).focus({ preventScroll: true });
  setSave(S.saveState);
}

function viewError() {
  return `<h1 class="z-title" tabindex="-1">Něco se nepovedlo</h1>
    <div class="notice"><p>${esc(S.fatal)}</p></div>
    <p>Zakázku můžete poslat i e-mailem na <a class="link" href="mailto:${CONFIG.contactEmail}">${CONFIG.contactEmail}</a>.</p>
    <p><a class="btn" href="./">Začít znovu</a></p>`;
}

function viewStart() {
  const pre = new URLSearchParams(location.search).get("sluzba");
  const saved = LS.get(LS_KEY);
  const resume = saved?.token
    ? `<div class="notice"><p>Máte rozpracované zadání (${esc(core.SERVICES[saved.service]?.title || "")}).</p>
        <p><a class="btn btn-dark btn-sm" href="#t=${esc(saved.token)}" data-act="resume">Pokračovat v zadání</a>
        <button class="icon-btn" type="button" data-act="discard">Zahodit</button></p></div>`
    : "";
  const tiles = Object.values(core.SERVICES).map((s) => `<button type="button" data-service="${s.id}" aria-pressed="${pre === s.id}" ${S.busy ? "disabled" : ""}>
      <strong>${esc(s.title)}</strong><span>${esc(s.lead)}</span></button>`).join("");
  return `<h1 class="z-title" tabindex="-1">Zadání zakázky</h1>
    <p class="z-lead">Vyberte službu. Podle ní se zeptám jen na to, co pro zpracování opravdu potřebuji. Zadání se průběžně ukládá a můžete se k němu vrátit.</p>
    ${resume}
    <div class="svc-grid" role="group" aria-label="Služba">${tiles}</div>
    <p class="muted" style="margin-top:20px;font-size:15px">Jen krátký dotaz? Napište na <a class="link" href="mailto:${CONFIG.contactEmail}">${CONFIG.contactEmail}</a>.</p>`;
}

function stepNav() {
  const st = steps();
  const items = st.map((s, i) => `<li class="${i < S.stepIdx ? "done" : i === S.stepIdx ? "current" : ""}" ${i === S.stepIdx ? 'aria-current="step"' : ""}>${esc(s.title)}</li>`).join("");
  return `<ol class="z-steps" aria-label="Postup zadání"><li class="svc">${esc(core.SERVICES[S.service].title)}<small><a href="./" data-act="new">Jiná služba</a></small></li>${items}</ol>`;
}

function viewStep() {
  const step = curStep();
  const st = steps();
  let body;
  if (step.id === "podklady") body = viewFiles();
  else if (step.id === "prehled") body = viewReview();
  else body = core.visibleQuestions(step, S.answers).map(renderQuestion).join("");
  const isLast = step.id === "prehled";
  const leads = {
    podklady: "Nahrajte, co máte. Čím víc podkladů, tím méně se budu doptávat. Další můžete poslat i později.",
    kontakt: "Kam vám mám poslat nabídku a případné dotazy.",
    prehled: "Zkontrolujte zadání. Odesláním ještě nic neobjednáváte – podklady projdu a pošlu vám nabídku.",
  };
  return `<div class="z-layout">
    ${stepNav()}
    <div class="z-body">
      <p class="z-progress">Krok ${S.stepIdx + 1} z ${st.length} · ${esc(core.SERVICES[S.service].short)}</p>
      <h1 class="z-title" tabindex="-1">${esc(step.title)}</h1>
      ${leads[step.id] ? `<p class="z-lead">${leads[step.id]}</p>` : ""}
      <form id="z-form" novalidate>
        ${body}
        ${step.id === "kontakt" ? `<p><button type="button" class="icon-btn" data-act="send-link">${S.linkSent ? "Odkaz odeslán – zkontrolujte e-mail" : "Poslat si odkaz na rozpracované zadání e-mailem"}</button></p>` : ""}
        ${isLast ? "" : `<div class="z-nav">
          ${S.stepIdx > 0 ? `<button type="button" class="btn" data-act="back">Zpět</button>` : `<span></span>`}
          <button type="submit" class="btn btn-dark">Pokračovat</button>
        </div>`}
      </form>
    </div>
  </div>`;
}

function errHtml(id) {
  return S.showErrors && S.errors[id] ? `<p class="error" id="err-${id}">${esc(S.errors[id])}</p>` : "";
}

function renderQuestion(q) {
  const v = S.answers[q.id];
  const help = q.help ? `<p class="help">${esc(q.help)}</p>` : "";
  const desc = S.showErrors && S.errors[q.id] ? `aria-describedby="err-${q.id}" aria-invalid="true"` : "";
  if (q.type === "site") return renderSite(q);
  if (q.type === "single" || q.type === "multi") {
    const type = q.type === "single" ? "radio" : "checkbox";
    const opts = [...q.options, ...(q.unknown && !q.options.some((o) => o.v === core.UNKNOWN) ? [{ v: core.UNKNOWN, l: "Nevím" }] : [])];
    const checked = (o) => (q.type === "single" ? v === o.v : Array.isArray(v) && v.includes(o.v));
    const pre = S.prefilled[q.id] ? `<p class="help">Předvyplněno podle katastru – zkontrolujte.</p>` : "";
    return `<fieldset class="q" data-q="${q.id}"><legend>${esc(q.label)}</legend>${help}${pre}
      <div class="choices">${opts.map((o, i) => `<label class="choice${o.v === core.UNKNOWN ? " unknown" : ""}">
        <input type="${type}" id="q-${q.id}-${i}" name="${q.id}" value="${esc(o.v)}" ${checked(o) ? "checked" : ""} data-q="${q.id}" data-kind="${q.type}">
        <span>${esc(o.l)}${o.help ? `<small>${esc(o.help)}</small>` : ""}</span></label>`).join("")}</div>${errHtml(q.id)}</fieldset>`;
  }
  if (q.type === "check") {
    return `<div class="q" data-q="${q.id}"><label class="check"><input type="checkbox" id="q-${q.id}" data-q="${q.id}" data-kind="check" ${v ? "checked" : ""} ${desc}><span>${esc(q.label)}</span></label>${errHtml(q.id)}</div>`;
  }
  const unk = v === core.UNKNOWN;
  const inputType = { email: "email", tel: "tel", number: "text", date: "date" }[q.type] || "text";
  const extra = q.type === "number" ? 'inputmode="decimal"' : "";
  const ac = q.autocomplete ? `autocomplete="${q.autocomplete}"` : "";
  const ph = q.placeholder ? `placeholder="${esc(q.placeholder)}"` : "";
  const field = q.type === "textarea"
    ? `<textarea class="textarea" id="q-${q.id}" data-q="${q.id}" data-kind="text" ${ph} ${desc}>${esc(unk ? "" : v)}</textarea>`
    : `<input class="input" type="${inputType}" id="q-${q.id}" data-q="${q.id}" data-kind="${q.type === "number" ? "number" : "text"}" value="${esc(unk || v == null ? "" : v)}" ${extra} ${ac} ${ph} ${unk ? "disabled" : ""} ${desc}>`;
  const unit = q.unit ? `<div class="unit-row">${field}<span>${esc(q.unit)}</span></div>` : field;
  const unknownToggle = q.unknown ? `<label class="check unknown-toggle"><input type="checkbox" id="q-${q.id}-unk" data-unknown="${q.id}" ${unk ? "checked" : ""}><span>Nevím</span></label>` : "";
  const mapHint = mapHintFor(q.id);
  return `<div class="q field" data-q="${q.id}"><label for="q-${q.id}" class="q-label">${esc(q.label)}</label>${help}${unit}${unknownToggle}${mapHint}${errHtml(q.id)}</div>`;
}

function mapHintFor(id) {
  const b = S.answers.site?.building;
  if (!b) return "";
  if (id === "delka_m" && b.length) return `<p class="hint-map">Z katastrální mapy vychází ${String(b.length).replace(".", ",")} × ${String(b.width).replace(".", ",")} m (jen odhad z obrysu – přesné rozměry ověřím podle výkresů).</p>`;
  if (id === "vyska_m" && b.height_est) return `<p class="hint-map">Z výškopisu vychází přibližně ${String(b.height_est).replace(".", ",")} m (orientační odhad).</p>`;
  return "";
}

function renderSite(q) {
  const s = S.answers.site || {};
  const b = s.building;
  const help = `<p class="help">${esc(q.help)}</p>`;
  if (S.site.manual) {
    return `<fieldset class="q" data-q="site"><legend>${esc(q.label)}</legend>
      ${S.site.error ? `<div class="notice"><p>${esc(S.site.error)}</p></div>` : ""}
      <div class="field"><label for="site-obec">Obec</label><input class="input" id="site-obec" data-site="obec" value="${esc(s.obec || "")}" autocomplete="address-level2"></div>
      <div class="field"><label for="site-query">Adresa nebo číslo parcely</label><input class="input" id="site-query" data-site="query" value="${esc(s.query || "")}" placeholder="např. Polní 10 nebo p. č. 4940/1"></div>
      <div class="field"><label for="site-note">Poznámka k místu (nepovinné)</label><input class="input" id="site-note" data-site="note" value="${esc(s.note || "")}" placeholder="např. novostavba bez čísla popisného"></div>
      ${errHtml("site")}
      <button type="button" class="icon-btn" data-act="site-search">Vyhledat v mapě</button></fieldset>`;
  }
  const facts = b || s.parcel ? `<dl class="stamp site-facts">
      <div><dt>Adresa</dt><dd>${esc(s.address || "–")}</dd></div>
      <div><dt>Parcela</dt><dd>${esc(s.parcel || "–")}</dd></div>
      <div><dt>Katastrální území</dt><dd>${esc(s.ku || "–")}</dd></div>
      ${b ? `<div><dt>Využití</dt><dd>${esc(b.use || "–")}</dd></div>
      <div><dt>Podlaží</dt><dd>${esc(b.floors ?? "–")}</dd></div>
      <div><dt>Půdorys <span class="tag-est">odhad z mapy</span></dt><dd>${b.length ? `${String(b.length).replace(".", ",")} × ${String(b.width).replace(".", ",")} m` : "–"}</dd></div>` : ""}
    </dl>
    <p class="site-note">Údaje z katastru (© ČÚZK). Rozměry z mapy jsou jen orientační – před zpracováním je ověřím.</p>` : "";
  const confirm = b ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="site-confirm" data-act="site-confirm" ${s.building_confirmed ? "checked" : ""}><span>Ano, červeně označená budova je ta správná</span></label>` : "";
  const noBuilding = Number.isFinite(s.lat) && !b ? `<p class="site-note">Budovu se nepodařilo najít v katastrální mapě. Klikněte na ni v mapě, nebo pokračujte – dohledám ji sám.</p>` : "";
  const multi = Number.isFinite(s.lat) && (S.siteFull?.buildings?.length || 0) > 1 ? `<p class="site-note">Jiná budova? Klikněte na ni v mapě.</p>` : "";
  return `<fieldset class="q" data-q="site"><legend>${esc(q.label)}</legend>${help}
    ${S.site.error ? `<div class="notice"><p>${esc(S.site.error)}</p></div>` : ""}
    <div class="site-search">
      <label for="site-q" class="visually-hidden">Adresa nebo parcela</label>
      <input class="input" id="site-q" role="combobox" aria-autocomplete="list" aria-expanded="${S.site.suggestions.length > 0}" aria-controls="site-sug" autocomplete="off"
        placeholder="Ulice a číslo, obec – nebo obec a číslo parcely" value="${esc(s.query || s.address || "")}">
      <ul class="site-sug" id="site-sug" role="listbox" ${S.site.suggestions.length ? "" : "hidden"}>${suggestionsHtml()}</ul>
    </div>
    ${S.site.busy ? `<p class="site-note" role="status">Hledám v katastru…</p>` : ""}
    <div data-map-slot></div>
    ${multi}${noBuilding}${facts}${confirm}${errHtml("site")}
    <p><button type="button" class="icon-btn" data-act="site-manual">Místo v mapě nenacházím – zadám ho ručně</button></p>
  </fieldset>`;
}

function suggestionsHtml() {
  return S.site.suggestions.map((x, i) => `<li role="option" id="sug-${i}" data-sug="${i}" aria-selected="${i === S.site.active}">${esc(x.text)}<small>${x.type === "parcel" ? "parcela" : x.type === "address" ? "adresa" : ""}</small></li>`).join("");
}

/* ------------------------------------------------------------------ místo stavby */

let sugTimer = null;
let sugSeq = 0;
function onSiteInput(value) {
  S.answers.site = { ...(S.answers.site?.lat ? {} : S.answers.site || {}), query: value, source: "manual" };
  S.siteFull = null;
  scheduleSave(1500);
  clearTimeout(sugTimer);
  if (value.trim().length < 3) {
    S.site.suggestions = [];
    updateSuggestions();
    return;
  }
  sugTimer = setTimeout(async () => {
    const my = ++sugSeq;
    try {
      const r = await api("geo_suggest", { text: value.trim() });
      if (my !== sugSeq) return;
      S.site.suggestions = r.suggestions || [];
      S.site.active = -1;
      S.site.error = "";
    } catch (e) {
      S.site.suggestions = [];
      S.site.error = e.data?.geo_unavailable ? "Vyhledávání v katastru teď nefunguje. Zadejte místo ručně, dohledám ho sám." : e.message;
      if (e.data?.geo_unavailable) { S.site.manual = true; render(); return; }
    }
    updateSuggestions();
  }, 300);
}

function updateSuggestions() {
  const ul = $("#site-sug");
  const input = $("#site-q");
  if (!ul || !input) return;
  ul.innerHTML = suggestionsHtml();
  ul.hidden = !S.site.suggestions.length;
  input.setAttribute("aria-expanded", String(S.site.suggestions.length > 0));
  input.setAttribute("aria-activedescendant", S.site.active >= 0 ? `sug-${S.site.active}` : "");
}

async function chooseSuggestion(i) {
  const sug = S.site.suggestions[i];
  if (!sug) return;
  S.site.suggestions = [];
  S.site.busy = true;
  S.site.error = "";
  render();
  try {
    const loc = await api("geo_find", { text: sug.text, magicKey: sug.magicKey });
    await lookup(loc.lat, loc.lon, null, sug.text);
  } catch (e) {
    S.site.error = e.data?.geo_unavailable ? "Katastr teď neodpovídá. Zadejte místo ručně, dohledám ho sám." : e.message;
    if (e.data?.geo_unavailable) S.site.manual = true;
  }
  S.site.busy = false;
  render();
}

async function lookup(lat, lon, pick, label) {
  const r = await api("geo_site", { lat, lon, pick, token: S.token });
  const site = r.site;
  const { buildings, ...rest } = site;
  S.siteFull = site;
  const prevId = S.answers.site?.building?.id;
  S.answers.site = { ...rest, query: label || S.answers.site?.query || site.address || "", building_confirmed: !!(pick && prevId === site.building?.id && S.answers.site?.building_confirmed) };
  const sugType = site.building?.suggested_type;
  if (sugType && !S.answers.objekt_typ) {
    S.answers.objekt_typ = sugType;
    S.prefilled.objekt_typ = true;
  }
  save();
}

async function pickBuilding(id) {
  const s = S.answers.site;
  if (!s || !Number.isFinite(s.lat) || S.site.busy) return;
  S.site.busy = true;
  render();
  try {
    await lookup(s.lat, s.lon, id, s.query);
    S.answers.site.building_confirmed = true;
    save();
  } catch (e) {
    S.site.error = e.message;
  }
  S.site.busy = false;
  render();
}

/* ------------------------------------------------------------------ podklady */

const RECOMMEND = {
  podklady_objekt: ["vykresy", "foto"], komponenty: ["nabidka"], stavajici: ["stavajici", "revize"], zdroj: ["zdroj"],
  vzor: ["vzor"], fve_projekt: ["fve_projekt"], datasheet: ["datasheet"], sop: ["pripojeni"], pbr: ["pbr"], rozmery: ["vykresy"],
};

function viewFiles() {
  const ev = localEval();
  const rec = new Set(ev.missing.flatMap((m) => RECOMMEND[m.key] || []));
  const cats = core.fileCategoriesFor(S.service, S.answers);
  const html = cats.map((c) => {
    const def = core.FILE_CATEGORIES[c];
    const list = S.files.filter((f) => f.category === c);
    return `<section class="files-cat${rec.has(c) ? " recommended" : ""}" data-cat="${c}">
      <h3>${esc(def.label)}${rec.has(c) ? `<span class="rec">doporučuji</span>` : ""}</h3>
      ${def.help ? `<p class="help">${esc(def.help)}</p>` : ""}
      <div class="drop" data-drop="${c}">
        <label class="btn btn-sm" for="file-${c}">Vybrat soubory</label>
        <input type="file" id="file-${c}" data-file-cat="${c}" multiple accept="${core.FILE_RULES.extensions.map((e) => "." + e).join(",")}">
        <span class="muted" style="font-size:14px">nebo je sem přetáhněte</span>
      </div>
      ${list.length ? `<ul class="file-list">${list.map(fileRow).join("")}</ul>` : ""}
    </section>`;
  }).join("");
  return `${html}${errHtml("_files")}
    <p class="muted" style="font-size:14px">Soubor nejvýše 50 MB, celkem 150 MB. Povolené typy: PDF, DWG, DXF, obrázky, Word, Excel, ZIP. Větší sady pošlete odkazem v poznámce.</p>
    ${S.fileError ? `<div class="notice" role="alert"><p>${esc(S.fileError)}</p></div>` : ""}`;
}

function fileRow(f) {
  const state = f.status === "uploading" ? `<span class="muted">${Math.round((f.progress || 0) * 100)} %</span>`
    : f.status === "error" ? `<span class="error">${esc(f.error || "Chyba")}</span>`
    : `<span class="muted">${fmtSize(f.size)}</span>`;
  const del = S.order?.phase === "draft" || f.status !== "uploaded" ? `<button type="button" class="icon-btn" data-del-file="${esc(f.id)}" aria-label="Odebrat ${esc(f.file_name)}">Odebrat</button>` : "<span></span>";
  const bar = f.status === "uploading" ? `<div class="bar"><span style="width:${Math.round((f.progress || 0) * 100)}%"></span></div>` : "";
  return `<li data-file="${esc(f.id)}"><span class="name">${esc(f.file_name)}</span>${state}${del}${bar}</li>`;
}

async function addFiles(cat, fileList) {
  S.fileError = "";
  for (const file of [...fileList]) {
    const err = core.checkFile(file.name, file.size, S.files);
    if (err) { S.fileError = err; continue; }
    const temp = { id: "tmp-" + Math.random().toString(36).slice(2), file_name: file.name, size: file.size, category: cat, status: "uploading", progress: 0 };
    S.files.push(temp);
    render();
    try {
      const u = await api("upload_url", { token: S.token, category: cat, name: file.name, size: file.size, type: file.type });
      temp.id = u.file_id;
      await putSigned(u.url, file, (p) => {
        temp.progress = p;
        const li = document.querySelector(`[data-file="${CSS.escape(temp.id)}"]`);
        if (li) { li.querySelector(".bar span").style.width = `${Math.round(p * 100)}%`; li.children[1].textContent = `${Math.round(p * 100)} %`; }
      });
      await api("file_done", { token: S.token, file_id: u.file_id });
      temp.status = "uploaded";
    } catch (e) {
      temp.status = "error";
      temp.error = e.message;
    }
    render();
  }
  render();
}

async function deleteFile(id) {
  const f = S.files.find((x) => x.id === id);
  if (!f) return;
  if (!id.startsWith("tmp-")) {
    try { await api("file_delete", { token: S.token, file_id: id }); } catch (e) { S.fileError = e.message; render(); return; }
  }
  S.files = S.files.filter((x) => x !== f);
  render();
}

/* ------------------------------------------------------------------ přehled a odeslání */

function viewReview() {
  const ev = localEval();
  const rowsByStep = {};
  for (const r of core.summaryRows({ service: S.service, answers: S.answers })) (rowsByStep[r.step] ||= []).push(r);
  const st = steps();
  const groups = Object.entries(rowsByStep).map(([title, rows]) => {
    const idx = st.findIndex((s) => s.title === title);
    return `<section class="review"><h3>${esc(title)}<a href="#" class="edit link" data-go="${idx}">Upravit</a></h3>
      <dl>${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl></section>`;
  }).join("");
  const filesIdx = st.findIndex((s) => s.id === "podklady");
  const files = S.files.filter((f) => f.status === "uploaded");
  const filesBox = `<section class="review"><h3>Podklady<a href="#" class="edit link" data-go="${filesIdx}">Upravit</a></h3>
    <dl>${files.length ? files.map((f) => `<dt>${esc(core.FILE_CATEGORIES[f.category]?.label || f.category)}</dt><dd>${esc(f.file_name)}</dd>`).join("") : `<dt>Soubory</dt><dd>Zatím žádné</dd>`}</dl></section>`;
  const blocking = ev.missing.filter((m) => m.level === "submit");
  const later = ev.missing.filter((m) => m.level !== "submit");
  const mine = [...ev.designer.map((d) => d.label), ...ev.confirm.filter((c) => c.who === "projektant").map((c) => c.label)];
  const confirmCustomer = ev.confirm.filter((c) => c.who === "zakaznik");
  const submitErr = S.submitError ? `<div class="notice" role="alert"><p>${esc(S.submitError)}</p></div>` : "";
  return `${groups}${filesBox}
    ${blocking.length ? `<div class="notice" role="alert"><p><strong>Před odesláním doplňte:</strong></p><ul class="checklist todo">${blocking.map((m) => `<li>${esc(m.label)}</li>`).join("")}</ul></div>` : ""}
    ${later.length ? `<h2 style="font-size:20px;margin:28px 0 8px">Co budu ještě potřebovat</h2>
      <p class="muted">Nemusíte to mít hned. Klidně zadání odešlete, o chybějící podklady si řeknu.</p>
      <ul class="checklist">${later.map((m) => `<li>${esc(m.ask || m.label)}</li>`).join("")}</ul>` : ""}
    ${confirmCustomer.length ? `<ul class="checklist todo">${confirmCustomer.map((c) => `<li>${esc(c.label)}</li>`).join("")}</ul>` : ""}
    ${mine.length ? `<h2 style="font-size:20px;margin:28px 0 8px">Co ověřím sám</h2><ul class="checklist">${mine.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="hp" aria-hidden="true"><label for="website">Nevyplňujte</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
    ${submitErr}
    <div class="z-nav">
      <button type="button" class="btn" data-act="back">Zpět</button>
      <button type="button" class="btn btn-primary" data-act="submit" ${blocking.length || S.busy ? "disabled" : ""}>${S.busy ? "Odesílám…" : "Odeslat zadání"}</button>
    </div>
    <p class="muted" style="font-size:14px;margin-top:12px">Po odeslání dostanete potvrzení a odkaz na stránku zakázky, kde můžete podklady kdykoli doplnit.</p>`;
}

async function sendLink() {
  if (!core.validEmail(S.answers.kontakt_email)) {
    S.errors = { ...S.errors, kontakt_email: "Nejdřív zadejte platný e-mail." };
    S.showErrors = true;
    return render();
  }
  await save();
  try {
    await api("send_link", { token: S.token });
    S.linkSent = true;
  } catch (e) {
    S.errors = { ...S.errors, kontakt_email: e.message };
    S.showErrors = true;
  }
  render();
}

async function submit() {
  if (S.busy) return;
  S.busy = true;
  S.submitError = null;
  render();
  try {
    await save();
    const r = await api("submit", { token: S.token, website: $("#website")?.value || "", elapsed_ms: S.createdHere ? Date.now() - S.loadedAt : 0 });
    if (r.order) applyServer(S.token, r);
    else await load(S.token);
    LS.del(LS_KEY);
    S.justSubmitted = true;
    S.view = "status";
  } catch (e) {
    S.submitError = e.status === 422 && e.data?.missing?.length ? `Ještě chybí: ${e.data.missing.map((m) => m.label).join(", ")}.` : e.message;
  }
  S.busy = false;
  render();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ stránka zakázky */

function viewStatus() {
  const o = S.order;
  const cs = o.customer_status || core.customerStatus(o);
  const open = S.requests.filter((r) => r.status === "open");
  const link = location.href;
  const tone = { action: "red", done: "ok", progress: "muted", neutral: "muted" }[cs.tone] || "muted";
  const cats = core.fileCategoriesFor(o.service, o.answers);
  const reqHtml = open.map((r) => `<div class="notice"><p><strong>Prosím o doplnění</strong> <span class="muted">(${fmtDate(r.created_at)})</span></p>
      ${r.items?.length ? `<ul class="checklist todo">${r.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      ${r.message ? `<p>${esc(r.message).replace(/\n/g, "<br>")}</p>` : ""}</div>`).join("");
  const canRespond = o.phase !== "cancelled";
  const respond = canRespond ? `<section class="st-box"><h2>${open.length ? "Doplnit podklady" : "Poslat další podklady"}</h2>
      <div class="field"><label for="resp-cat">Druh podkladu</label><select class="select" id="resp-cat">${cats.map((c) => `<option value="${c}">${esc(core.FILE_CATEGORIES[c].label)}</option>`).join("")}</select></div>
      <div class="drop" data-drop="__resp"><label class="btn btn-sm" for="file-resp">Vybrat soubory</label><input type="file" id="file-resp" data-file-cat="__resp" multiple><span class="muted" style="font-size:14px">nebo přetáhněte</span></div>
      ${S.fileError ? `<p class="error" role="alert">${esc(S.fileError)}</p>` : ""}
      <ul class="file-list">${S.files.filter((f) => f.fresh).map(fileRow).join("")}</ul>
      <div class="field" style="margin-top:14px"><label for="resp-text">Zpráva (nepovinné)</label><textarea class="textarea" id="resp-text">${esc(S.respondText)}</textarea></div>
      <button type="button" class="btn btn-dark" data-act="respond" ${S.busy ? "disabled" : ""}>${S.busy ? "Odesílám…" : "Odeslat doplnění"}</button>
      ${S.respondOk ? `<p class="badge ok" role="status" style="margin-left:10px">Doplnění odesláno</p>` : ""}
    </section>` : "";
  const outputs = S.outputs.length ? `<section class="st-box"><h2>Dokumentace ke stažení</h2><ul class="file-list">${S.outputs.map((f) => `<li><span class="name">${esc(f.file_name)}</span><span class="muted">${fmtDate(f.released_at)}</span><button type="button" class="btn btn-sm" data-download="${esc(f.id)}">Stáhnout</button></li>`).join("")}</ul></section>` : "";
  const inputs = S.files.filter((f) => f.status === "uploaded");
  const need = !open.length && !S.outputs.length && o.phase !== "cancelled" ? (S.evaluation?.missing || []).filter((m) => m.level !== "submit") : [];
  const needBox = need.length ? `<section class="st-box"><h2>Co budu ještě potřebovat</h2>
      <p class="muted">Až to budete mít, nahrajte to níže. Nemusí to být hned.</p>
      <ul class="checklist todo">${need.map((m) => `<li>${esc(m.ask || m.label)}</li>`).join("")}</ul></section>` : "";
  return `<div class="z-body" style="max-width:820px">
    ${S.justSubmitted ? `<div class="notice ok"><p><strong>Zadání ${esc(o.code)} jsem přijal.</strong> Podklady projdu a ozvu se s nabídkou. Potvrzení přijde e-mailem.</p></div>` : ""}
    <div class="st-head"><h1 class="z-title" tabindex="-1">Zakázka</h1><span class="st-code">${esc(o.code || "")}</span><span class="badge ${tone}">${esc(cs.label)}</span></div>
    <p class="muted">${esc(core.SERVICES[o.service]?.title)} · odesláno ${fmtDate(o.submitted_at)}${o.answers?.site ? " · " + esc(core.siteLabel(o.answers.site)) : ""}</p>
    ${reqHtml}
    ${outputs}
    ${needBox}
    ${respond}
    <section class="st-box"><h2>Vaše podklady</h2>${inputs.length ? `<ul class="file-list">${inputs.map((f) => `<li><span class="name">${esc(f.file_name)}</span><span class="muted">${esc(core.FILE_CATEGORIES[f.category]?.label || "")}</span><button type="button" class="icon-btn" data-download="${esc(f.id)}">Stáhnout</button></li>`).join("")}</ul>` : `<p class="muted">Zatím žádné soubory.</p>`}</section>
    <section class="st-box"><h2>Odkaz na tuto stránku</h2>
      <p class="muted">Uložte si ho – přes něj kdykoli uvidíte stav zakázky a doplníte podklady. Neposílejte ho dál.</p>
      <div class="link-box"><input class="input" id="own-link" readonly value="${esc(link)}"><button type="button" class="btn btn-sm" data-act="copy-link">Zkopírovat</button></div>
    </section>
    <p><a class="link" href="./">Zadat další zakázku</a> · <a class="link" href="../">Zpět na fvsol.cz</a></p>
  </div>`;
}

async function respond() {
  if (S.busy) return;
  if (S.files.some((f) => f.status === "uploading")) { S.fileError = "Počkejte na dokončení nahrávání."; render(); return; }
  S.respondText = $("#resp-text")?.value || "";
  if (!S.respondText.trim() && !S.files.some((f) => f.fresh && f.status === "uploaded")) {
    S.fileError = "Napište zprávu nebo přiložte soubor.";
    return render();
  }
  S.busy = true;
  S.fileError = "";
  render();
  try {
    const r = await api("respond", { token: S.token, message: S.respondText });
    applyServer(S.token, r);
    S.respondText = "";
    S.respondOk = true;
  } catch (e) {
    S.fileError = e.message;
  }
  S.busy = false;
  render();
}

async function download(id) {
  try {
    const r = await api("download", { token: S.token, file_id: id });
    location.href = r.url;
  } catch (e) {
    alertBox(e.message);
  }
}

function alertBox(msg) {
  S.fileError = msg;
  render();
}

/* ------------------------------------------------------------------ události */

app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-service],[data-act],[data-go],[data-sug],[data-del-file],[data-download]");
  if (!t) return;
  if (t.dataset.service) return startService(t.dataset.service);
  if (t.dataset.go != null) { e.preventDefault(); return go(Number(t.dataset.go)); }
  if (t.dataset.sug != null) return chooseSuggestion(Number(t.dataset.sug));
  if (t.dataset.delFile) return deleteFile(t.dataset.delFile);
  if (t.dataset.download) return download(t.dataset.download);
  const act = t.dataset.act;
  if (act === "back") { save(); return go(S.stepIdx - 1); }
  if (act === "submit") return submit();
  if (act === "send-link") return sendLink();
  if (act === "respond") return respond();
  if (act === "resume") { e.preventDefault(); return load(LS.get(LS_KEY).token); }
  if (act === "discard") { LS.del(LS_KEY); return render(); }
  if (act === "new") { e.preventDefault(); LS.del(LS_KEY); history.replaceState(null, "", "./"); S.view = "start"; S.token = null; return render(); }
  if (act === "site-manual") { S.site.manual = true; S.answers.site = { source: "manual", query: S.answers.site?.address || S.answers.site?.query || "" }; S.siteFull = null; save(); return render(); }
  if (act === "site-search") { S.site.manual = false; S.site.error = ""; return render(); }
  if (act === "copy-link") {
    const i = $("#own-link");
    i.select();
    navigator.clipboard?.writeText(i.value).then(() => { t.textContent = "Zkopírováno"; }, () => document.execCommand("copy"));
  }
});

app.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.act === "site-confirm") {
    S.answers.site = { ...S.answers.site, building_confirmed: el.checked };
    save();
    return;
  }
  if (el.dataset.fileCat) {
    const cat = el.dataset.fileCat === "__resp" ? $("#resp-cat").value : el.dataset.fileCat;
    return el.dataset.fileCat === "__resp" ? addRespFiles(cat, el.files) : addFiles(cat, el.files);
  }
  if (el.dataset.unknown) {
    const id = el.dataset.unknown;
    S.answers[id] = el.checked ? core.UNKNOWN : "";
    scheduleSave();
    return render();
  }
  const id = el.dataset.q;
  if (!id) return;
  const kind = el.dataset.kind;
  if (kind === "text" || kind === "number") {
    // textová pole se nepřekreslují – jinak by se ztratilo kliknutí na tlačítko hned po psaní
    S.answers[id] = el.value;
    scheduleSave();
    return;
  }
  if (kind === "single") S.answers[id] = el.value;
  else if (kind === "multi") {
    let arr = $$(`input[data-q="${id}"]:checked`, app).map((x) => x.value);
    if (el.value === core.UNKNOWN && el.checked) arr = [core.UNKNOWN];
    else arr = arr.filter((x) => x !== core.UNKNOWN);
    S.answers[id] = arr;
  } else if (kind === "check") S.answers[id] = el.checked;
  if (S.prefilled[id]) delete S.prefilled[id];
  if (S.showErrors) S.errors = core.validateStep(curStep(), S.answers);
  scheduleSave();
  render();
});

app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "site-q") return onSiteInput(el.value);
  if (el.dataset.site) {
    S.answers.site = { ...(S.answers.site || {}), source: "manual", [el.dataset.site]: el.value };
    return scheduleSave();
  }
  if (el.id === "resp-text") { S.respondText = el.value; return; }
  const id = el.dataset.q;
  if (id && (el.dataset.kind === "text" || el.dataset.kind === "number")) {
    S.answers[id] = el.value;
    scheduleSave();
  }
});

app.addEventListener("keydown", (e) => {
  if (e.target.id !== "site-q") return;
  const n = S.site.suggestions.length;
  if (e.key === "ArrowDown" && n) { e.preventDefault(); S.site.active = (S.site.active + 1) % n; updateSuggestions(); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); S.site.active = (S.site.active - 1 + n) % n; updateSuggestions(); }
  else if (e.key === "Enter") { e.preventDefault(); if (n) chooseSuggestion(Math.max(0, S.site.active)); }
  else if (e.key === "Escape") { S.site.suggestions = []; updateSuggestions(); }
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  next();
});

app.addEventListener("dragover", (e) => {
  const d = e.target.closest("[data-drop]");
  if (!d) return;
  e.preventDefault();
  d.classList.add("over");
});
app.addEventListener("dragleave", (e) => e.target.closest("[data-drop]")?.classList.remove("over"));
app.addEventListener("drop", (e) => {
  const d = e.target.closest("[data-drop]");
  if (!d) return;
  e.preventDefault();
  d.classList.remove("over");
  if (d.dataset.drop === "__resp") addRespFiles($("#resp-cat").value, e.dataTransfer.files);
  else addFiles(d.dataset.drop, e.dataTransfer.files);
});

async function addRespFiles(cat, list) {
  const before = new Set(S.files.map((f) => f));
  await addFiles(cat, list);
  for (const f of S.files) if (!before.has(f)) f.fresh = true;
  render();
}

window.addEventListener("hashchange", () => {
  const t = tokenFromHash();
  if (t && t !== S.token) load(t);
});
window.addEventListener("beforeunload", (e) => {
  if (S.files.some((f) => f.status === "uploading") || S.saveState === "Ukládám…") {
    e.preventDefault();
    e.returnValue = "";
  }
});

init();
