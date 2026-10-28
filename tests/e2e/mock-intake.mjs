// Zkušební náhrada funkce fvsol-intake pro testy formuláře v prohlížeči (stav jen v paměti).
// Používá stejné jádro (core.js) jako skutečný server. Spuštění: node tests/e2e/mock-intake.mjs 8813
import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import * as core from "../../assets/zakazky/core.js";

const port = Number(process.argv[2] || 8813);
const orders = new Map(); // token -> order
const blobs = new Map();
let seq = 0;
const log = [];
const geoDown = process.env.GEO_DOWN === "1";

const SITE = {
  source: "ruian", lat: 50.7215, lon: 15.1702, address: "Polní 3677/10, 46601 Jablonec nad Nisou", parcel: "st. 4940/1",
  ku: "Jablonec nad Nisou [655970]", parcel_area: 2300,
  building: { id: "111", use: "objekt občanské vybavenosti", suggested_type: "verejna", floors: 2, area: 512.3, perimeter: 96.2, length: 32.1, width: 16, height_est: 8.4 },
  buildings: [
    { id: "111", ring: [[15.1700, 50.7213], [15.1705, 50.7213], [15.1705, 50.7217], [15.1700, 50.7217], [15.1700, 50.7213]], dist: 0 },
    { id: "222", ring: [[15.1708, 50.7213], [15.1711, 50.7213], [15.1711, 50.7216], [15.1708, 50.7216], [15.1708, 50.7213]], dist: 20 },
  ],
  notes: [], attribution: "© ČÚZK",
};

function view(o) {
  const inputs = o.files.filter((f) => f.direction === "in");
  return {
    order: { code: o.code, service: o.service, phase: o.phase, answers: o.answers, site: o.site ? { buildings: o.site.buildings, lat: o.site.lat, lon: o.site.lon } : null,
      submitted_at: o.submitted_at, created_at: o.created_at,
      customer_status: core.customerStatus({ ...o, hasOpenRequest: o.requests.some((r) => r.status === "open"), hasReleasedOutput: false }) },
    files: inputs, outputs: [], requests: o.requests,
    evaluation: core.evaluate({ service: o.service, answers: o.answers, files: inputs }),
  };
}

const A = {
  create(b) {
    if (!core.SERVICES[b.service]) throw [400, "Neznámá služba."];
    const token = randomBytes(32).toString("base64url");
    const o = { id: randomUUID(), service: b.service, phase: "draft", status: "rozpracovana", answers: {}, files: [], requests: [], created_at: new Date().toISOString() };
    orders.set(token, o);
    return { token, ...view(o) };
  },
  get(b) { return view(ord(b)); },
  save(b) {
    const o = ord(b);
    if (o.phase !== "draft") throw [409, "Odeslané zadání už nelze měnit."];
    const a = { ...b.answers };
    for (const k of Object.keys(a)) if (k !== "site" && !core.allQuestions(o.service).some((q) => q.id === k)) delete a[k];
    o.answers = a;
    return { saved_at: new Date().toISOString(), evaluation: core.evaluate({ service: o.service, answers: a, files: o.files }) };
  },
  upload_url(b) {
    const o = ord(b);
    const err = core.checkFile(b.name, b.size, o.files);
    if (err) throw [400, err];
    const id = randomUUID();
    o.files.push({ id, category: b.category, file_name: b.name, size: b.size, status: "pending", direction: "in" });
    return { file_id: id, url: `http://127.0.0.1:${port}/upload/${id}?token=x` };
  },
  file_done(b) {
    const o = ord(b);
    const f = o.files.find((x) => x.id === b.file_id);
    if (!blobs.has(b.file_id)) throw [409, "Soubor se nenahrál celý."];
    f.status = "uploaded";
    return { ok: true };
  },
  file_delete(b) { const o = ord(b); o.files = o.files.filter((x) => x.id !== b.file_id); return { ok: true }; },
  submit(b) {
    const o = ord(b);
    if (b.website) throw [400, "Odeslání se nepodařilo."];
    const ev = core.evaluate({ service: o.service, answers: o.answers, files: o.files });
    if (!ev.canSubmit) throw [422, "Zadání ještě není kompletní.", { missing: ev.missing.filter((m) => m.level === "submit") }];
    o.code = `Z26-${String(++seq).padStart(4, "0")}`;
    o.phase = "inquiry";
    o.status = ev.suggestedStatus;
    o.submitted_at = new Date().toISOString();
    o.crm = core.toCrmJob({ ...o }, ev, { adminUrl: "https://fvsol.cz/admin/#z=" + o.id });
    log.push({ submitted: o.code, status: o.status, crmTasks: o.crm.tasks.length });
    return { code: o.code, ...view(o) };
  },
  respond(b) {
    const o = ord(b);
    o.requests.forEach((r) => { r.status = "answered"; });
    log.push({ respond: o.code, message: b.message });
    return view(o);
  },
  send_link() { return { ok: true }; },
  download() { return { url: `http://127.0.0.1:${port}/blank` }; },
  geo_suggest(b) {
    if (geoDown) throw [503, "Služba ČÚZK teď není dostupná.", { geo_unavailable: true }];
    return { suggestions: [{ text: "Polní 3677/10, 46601 Jablonec nad Nisou", magicKey: "k1", type: "address" }, { text: `Jablonec nad Nisou ${b.text}`, magicKey: "k2", type: "parcel" }] };
  },
  geo_find() { return { lat: SITE.lat, lon: SITE.lon, label: SITE.address }; },
  geo_site(b) {
    const site = JSON.parse(JSON.stringify(SITE));
    if (b.pick === "222") { site.building = { id: "222", use: "garáž", floors: 1, area: 60, length: 10, width: 6, height_est: 3.1 }; }
    if (b.token) ord(b).site = site;
    return { site };
  },
  // jen pro testy
  _debug() { return { log, orders: [...orders.values()].map((o) => ({ code: o.code, phase: o.phase, status: o.status, answers: o.answers, files: o.files, crm: o.crm })) }; },
  _request(b) { const o = [...orders.values()].find((x) => x.code === b.code); o.requests.push({ id: randomUUID(), status: "open", message: b.message, items: b.items, created_at: new Date().toISOString() }); o.status = "ceka_na_podklady"; return { ok: true }; },
};

function ord(b) {
  const o = orders.get(b.token);
  if (!o) throw [404, "Odkaz na zakázku není platný."];
  return o;
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, PUT, OPTIONS" };
http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (req.url.startsWith("/upload/")) {
      blobs.set(req.url.split("/")[2].split("?")[0], Buffer.concat(chunks).length);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      return res.end('{"Key":"ok"}');
    }
    if (req.url.startsWith("/blank")) { res.writeHead(200, { ...cors, "Content-Type": "text/plain" }); return res.end("soubor"); }
    let b = {};
    try { b = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* */ }
    try {
      const out = A[b.action](b);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      const [status, msg, data] = Array.isArray(e) ? e : [500, String(e)];
      res.writeHead(status, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg, ...(data ? { data } : {}), ...(data?.geo_unavailable ? { geo_unavailable: true } : {}) }));
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`mock intake na ${port}`));
