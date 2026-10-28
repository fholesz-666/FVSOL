// Testy čistých modulů Edge funkcí (Deno). Spuštění: deno test --no-config -A supabase/functions/_shared/modules.test.ts <složka s fixtures>
import nodeAssert from "node:assert/strict";
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepEqual(a, b, msg);
const assertMatch = (s: string, re: RegExp, msg?: string) => nodeAssert.match(s, re, msg);
import { analyzeFile, sheetName } from "./analyze.ts";
import { fillDocx, fillXml, listPlaceholders } from "./docx.ts";
import { DxfWriter, dxfText, situaceDxf } from "./dxf.ts";
import { minAreaRect, polygonArea, polygonPerimeter } from "./geometry.ts";

const FIX = Deno.env.get("FIXTURES") ?? "";
const OUT = Deno.env.get("OUT") ?? FIX;

Deno.test("geometrie: obdélník 20 × 10 m pootočený o 30°", () => {
  const a = (30 * Math.PI) / 180;
  const pts = [[0, 0], [20, 0], [20, 10], [0, 10]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as [number, number]);
  const r = minAreaRect(pts);
  assert(Math.abs(r.length - 20) < 1e-6 && Math.abs(r.width - 10) < 1e-6);
  assert(Math.abs(r.orientationDeg - 30) < 1e-6);
  assert(Math.abs(polygonArea(pts) - 200) < 1e-6);
});

Deno.test("DXF: text s diakritikou a S-JTSK kontrola", () => {
  assertEquals(dxfText("Půdorys č. 1"), "P\\U+016Fdorys \\U+010D. 1");
  const parcel = { attributes: { cisloparcely: "4940/1", druhcislovanikod: 1 }, geometry: { rings: [[[-700000, -1000000], [-699980, -1000000], [-699980, -999980], [-700000, -999980], [-700000, -1000000]]] } };
  const bld = { attributes: { objectid: 7 }, geometry: { rings: [[[-699995, -999995], [-699985, -999995], [-699985, -999985], [-699995, -999985]]] } };
  const { dxf, stats } = situaceDxf({ parcels: [parcel], buildings: [bld], selectedBuildingId: "7", title: "Situace – test", lines: ["Zdroj: ČÚZK"] });
  assertEquals(stats, { parcels: 1, buildings: 1 });
  assertMatch(dxf, /AC1009/);
  assertMatch(dxf, /\r\nOBJEKT\r\n/);
  assert(dxf.endsWith("EOF\r\n"));
  if (OUT) Deno.writeTextFileSync(`${OUT}/test_situace.dxf`, dxf);
  let threw = false;
  try {
    situaceDxf({ parcels: [{ attributes: {}, geometry: { rings: [[[15.1, 50.7], [15.2, 50.7], [15.2, 50.8]]] } }], buildings: [], title: "x", lines: [] });
  } catch { threw = true; }
  assert(threw, "WGS84 souřadnice musí být odmítnuty");
});

Deno.test("DXF writer: prázdný výkres je platný", () => {
  const s = new DxfWriter().layer("A", 1).toString();
  assertMatch(s, /SECTION\r\n2\r\nENTITIES\r\n0\r\nENDSEC/);
});

Deno.test("DOCX: značka rozdělená do běhů, neznámé hodnoty zvýrazněné, escapování", () => {
  const xml = '<w:p><w:r><w:t xml:space="preserve">Akce: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>{{misto.</w:t></w:r><w:r><w:t>adresa}}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:sz w:val="20"/><w:u w:val="single"/></w:rPr><w:t>Investor: {{investor.nazev}}</w:t></w:r></w:p>';
  const r = fillXml(xml, { "misto.adresa": "Polní 3677/10 & <dvůr>", "investor.nazev": null }, { "investor.nazev": "investor" });
  assertMatch(r.xml, /<w:t>Polní 3677\/10 &amp; &lt;dvůr&gt;<\/w:t>/);
  assertMatch(r.xml, /<w:t><\/w:t>/);
  assertMatch(r.xml, /<w:sz w:val="20"\/><w:highlight w:val="yellow"\/><w:u w:val="single"\/>/, "highlight před w:u (pořadí schématu)");
  assertMatch(r.xml, /DOPLNIT – investor/);
  assertEquals(r.unfilled, ["investor.nazev"]);
});

Deno.test({
  name: "DOCX: vyplnění skutečného souboru (záhlaví, tabulka, rozdělené běhy)",
  ignore: !FIX,
  async fn() {
    const src = await Deno.readFile(`${FIX}/sablona.docx`);
    const keys = await listPlaceholders(src);
    for (const k of ["zakazka.cislo", "misto.adresa", "investor.nazev", "misto.parcela", "misto.ku", "fve.vykon_kwp", "neco.jineho", "projektant.jmeno"]) assert(keys.includes(k), k);
    const r = await fillDocx(src, {
      "zakazka.cislo": "Z26-0001", "misto.adresa": "Polní 3677/10, Jablonec nad Nisou", "investor.nazev": "Jablonecká energetická a.s.",
      "misto.parcela": "st. 4940/1", "misto.ku": null, "fve.vykon_kwp": "81 kWp", "projektant.jmeno": "Filip Holesz",
    });
    assertEquals(r.unfilled.sort(), ["misto.ku", "neco.jineho"]);
    await Deno.writeFile(`${OUT}/test_vyplneno.docx`, r.bytes);
  },
});

Deno.test({
  name: "analýza: vektorové PDF, rastrové PDF, JPEG s DPI",
  ignore: !FIX,
  async fn() {
    const v = await analyzeFile("vykres.pdf", await Deno.readFile(`${FIX}/vektor.pdf`));
    assertEquals(v.kind, "vector");
    assertEquals(v.sheet, "A3 na šířku");
    const r = await analyzeFile("sken.pdf", await Deno.readFile(`${FIX}/sken.pdf`));
    assertEquals(r.kind, "raster");
    assertEquals(r.sheet, "A4 na výšku");
    const j = await analyzeFile("foto.jpg", await Deno.readFile(`${FIX}/sken.jpg`));
    assertEquals(j.width_px, 2480);
    assertEquals(j.height_px, 3508);
    assertEquals(j.dpi, 300);
    const cv = await analyzeFile("CV.pdf", await Deno.readFile(new URL("../../../images/CV.pdf", import.meta.url)));
    assertEquals(cv.pages, 1, "přírůstkově uložené PDF má 1 stranu");
    assertEquals(cv.kind, "mixed");
    const d = await analyzeFile("x.dwg", new TextEncoder().encode("AC1032\0\0\0"));
    assertMatch(d.cad_version!, /2018/);
    assertEquals(sheetName(841, 594), "A1 na šířku");
  },
});

Deno.test("geometrie: obvod obdélníku", () => {
  assertEquals(Math.round(polygonPerimeter([[0, 0], [20, 0], [20, 10], [0, 10]])), 60);
});

Deno.test("e-mail přes EmailJS: šablona, tajný klíč jen na serveru, odstup 1 s", async () => {
  const { sendMail, mailProvider, mailConfirmation } = await import("./mail.ts");
  const calls: { body: any; at: number }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    calls.push({ body: JSON.parse(init.body), at: Date.now() });
    return new Response("OK", { status: 200 });
  }) as typeof fetch;
  try {
    assertEquals(mailProvider(), null);
    const none = await sendMail(null, "test", { email: "a@b.cz" }, "x", "<p>x</p>");
    assertEquals(none.sent, false);
    Deno.env.set("EMAILJS_PRIVATE_KEY", "priv-test");
    Deno.env.set("EMAILJS_TEMPLATE_ID", "template_fvsol");
    assertEquals(mailProvider(), "emailjs");
    const m = mailConfirmation("Z26-0001", "tok", "Fotovoltaika (FVE)", ["Fotka elektroměrového rozvaděče"]);
    const [r1, r2] = await Promise.all([
      sendMail(null, "potvrzeni", { email: "jan@example.cz", name: "Jan" }, m.subject, m.html),
      sendMail(null, "nova", { email: "projekce@fvsol.cz" }, "Nové zadání", "<p>x</p>"),
    ]);
    assert(r1.sent && r2.sent);
    assertEquals(calls.length, 2);
    const b = calls[0].body;
    assertEquals(b.template_id, "template_fvsol");
    assertEquals(b.accessToken, "priv-test");
    assertEquals(b.template_params.to_email, "jan@example.cz");
    assertEquals(b.template_params.subject, "Zadání Z26-0001 jsem přijal");
    assert(b.template_params.html.includes("Fotka elektroměrového rozvaděče"));
    assert(JSON.stringify(b).length < 50_000, "EmailJS bere požadavky do 50 kB");
    assert(calls[1].at - calls[0].at >= 1000, "EmailJS dovolí 1 požadavek za sekundu");
  } finally {
    globalThis.fetch = realFetch;
    Deno.env.delete("EMAILJS_PRIVATE_KEY");
    Deno.env.delete("EMAILJS_TEMPLATE_ID");
  }
});

Deno.test("ČÚZK: hlavičky dotazu jsou platné (jen ASCII)", async () => {
  const { CUZK_HEADERS } = await import("./cuzk.ts");
  new Request("https://ags.cuzk.gov.cz/", { headers: CUZK_HEADERS });
  for (const v of Object.values(CUZK_HEADERS)) assert(/^[\x20-\x7e]*$/.test(v), v);
});
