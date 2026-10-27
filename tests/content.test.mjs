// Chráněný obsah webu: portfolio, text o mně, služby, ARONLINE, FAQ a kontakty musí zůstat beze změny.
// Snapshot tests/fixtures/protected-content.json byl vytažen z původního index.html (tag zaloha-pred-redesignem-2026-10-27).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const P = JSON.parse(readFileSync(new URL("tests/fixtures/protected-content.json", root), "utf8"));
const html = readFileSync(new URL("index.html", root), "utf8");
const dec = (s) => s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (s) => dec(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const norm = (s) => dec(s).replace(/\s+/g, " ").trim();

test("portfolio: všech 18 ukázek se stejnými obrázky, popisky a kategoriemi", () => {
  const works = [...html.matchAll(/<figure class="work" data-cats="([^"]+)">\s*<button type="button" data-full="([^"]+)" data-caption="([^"]*)"[^>]*>\s*<img src="([^"]+)" width="(\d+)" height="(\d+)" alt="([^"]*)"[\s\S]*?<h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p>/g)];
  assert.equal(works.length, P.portfolio.length);
  P.portfolio.forEach((it, i) => {
    const w = works[i];
    assert.deepEqual(w[1].split(" "), it.cats.filter((c) => c !== "item"), `kategorie #${i}`);
    assert.equal(w[2], it.full);
    assert.equal(dec(w[3]), it.caption, `popisek #${i}`);
    assert.equal(w[4], it.thumb);
    assert.equal(Number(w[5]), it.w);
    assert.equal(Number(w[6]), it.h);
    assert.equal(dec(w[7]), it.alt);
    assert.equal(dec(w[8]), it.title);
    assert.equal(dec(w[9]), it.sub);
  });
});

test("portfolio: filtry a úvodní věta", () => {
  for (const [f, label] of P.filters) {
    const key = f === "*" ? "*" : f.replace(/^\./, "");
    assert.ok(html.includes(`data-filter="${key}"`), key);
    assert.ok(html.includes(`>${label}</button>`), label);
  }
  assert.ok(html.includes(P.intro));
});

test("text o mně beze změny", () => {
  const body = text(html);
  assert.ok(body.includes(norm(P.about_heading)));
  for (const p of P.about) assert.ok(body.includes(norm(p)), p.slice(0, 40));
  assert.ok(html.includes('href="images/CV.pdf"'));
  assert.ok(html.includes('src="images/about_me_pic_2.jpg"'));
});

test("úvod: nadpis a podtitul beze změny", () => {
  assert.ok(text(html).includes(text(P.hero.h1)));
  assert.ok(text(html).includes(text(P.hero.lead)));
});

test("služby: původní texty FVE, LPS a Analýzy zachované", () => {
  const body = text(html);
  for (const [name, p] of Object.entries(P.services)) {
    assert.ok(body.includes(text(name)), name);
    assert.ok(body.includes(text(p)), name);
  }
});

test("ARONLINE a odkazy na aronline.cz", () => {
  const body = text(html);
  assert.ok(body.includes(P.aronline_heading));
  for (const p of P.aronline) assert.ok(body.includes(text(p)));
  for (const c of ["hero", "sekce-analyza", "paticka"]) assert.ok(html.includes(`utm_campaign=${c}`), c);
});

test("FAQ: otázky beze změny, odpovědi beze změny kromě odkazu na nový formulář", () => {
  const body = text(html);
  P.faq.forEach(([q, a], i) => {
    assert.ok(body.includes(norm(q)), q);
    if (i === 1) {
      const tail = text(a).split(". ").slice(1).join(". ");
      assert.ok(body.includes(tail), "zbytek odpovědi 2 zachován");
      assert.ok(!/Google|forms\.gle/i.test(html.split('id="faq-section"')[1].split("</section>")[0]));
    } else assert.ok(body.includes(text(a)), q);
  });
});

test("kontakty a funkční části: EmailJS, Calconic", () => {
  assert.ok(html.includes("mailto:projekce@fvsol.cz"));
  assert.ok(html.includes("tel:+420605783000"));
  assert.ok(text(html).includes(text(P.contact.address)));
  assert.ok(html.includes('data-calculatorid="6961003a04cb0a002c209956"'));
  const js = readFileSync(new URL("assets/home.js", root), "utf8");
  for (const k of ["jcI-Mfxs2Tj1RcLNA", "service_amm7txp", "template_g18lk2i"]) assert.ok(js.includes(k), k);
  for (const id of ['id="contactForm"', 'name="name"', 'name="email"', 'name="message"', 'id="form-message-success"', 'id="form-message-warning"']) assert.ok(html.includes(id), id);
});

test("kotvy původních sekcí zůstaly (staré odkazy fungují)", () => {
  for (const id of ["home-section", "portfolio-section", "about-section", "services-section", "analyza-section", "calculation-section", "contact-section", "faq-section"])
    assert.ok(html.includes(`id="${id}"`), id);
});

test("strukturovaná data jsou platný JSON a obsahují nové služby", () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const svc = ld.find((n) => n["@type"] === "ProfessionalService");
  assert.ok(svc.hasOfferCatalog.itemListElement.some((o) => /DWG/.test(o.itemOffered.name)));
  const faq = ld.find((n) => n["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 6);
});
