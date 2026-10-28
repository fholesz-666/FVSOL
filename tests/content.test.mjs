// Původní web zůstává beze změny. Jediné dovolené zásahy jsou odkazy na zadání zakázky vypsané níže
// a blok stylů „Zadání zakázky“ připojený na konec css/fvsol.css.
// tests/fixtures/index.original.html a fvsol.original.css jsou kopie z větve main před úpravami.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const original = read("tests/fixtures/index.original.html");
const current = read("index.html");

// [původní úsek, nový úsek] – nic jiného se v index.html měnit nesmí
const ADDITIONS = [
  [
    `<li><a href="#contact-section" class="nav-link">Kontakt</a></li>\n              </ul>`,
    `<li><a href="#contact-section" class="nav-link">Kontakt</a></li>\n                <li><a href="zadani/" class="nav-order">Zadat zakázku</a></li>\n              </ul>`,
  ],
  [
    `                <a href="#contact-section" class="btn btn-outline-pill btn-custom-light smoothscroll">Poptat dokumentaci</a>`,
    `                <a href="zadani/" class="btn btn-outline-pill btn-custom-light btn-accent">Zadat zakázku</a>\n                <a href="#contact-section" class="btn btn-outline-pill btn-custom-light smoothscroll">Poptat dokumentaci</a>`,
  ],
  [
    `technická zpráva a&nbsp;výkaz výměr.</p>`,
    `technická zpráva a&nbsp;výkaz výměr.</p>\n                <p class="order-link"><a href="zadani/?sluzba=lps" class="text-link">Zadat zakázku LPS &rarr;</a></p>`,
  ],
  [
    `Rozsah doplním podle vašich potřeb.</p>`,
    `Rozsah doplním podle vašich potřeb.</p>\n                <p class="order-link"><a href="zadani/?sluzba=fve" class="text-link">Zadat zakázku FVE &rarr;</a></p>`,
  ],
  [
    `<a href="#analyza-section" class="text-link smoothscroll">online</a>.</p>`,
    `<a href="#analyza-section" class="text-link smoothscroll">online</a>.</p>\n                <p class="order-link"><a href="zadani/?sluzba=dwg" class="text-link">Překreslení do DWG/DXF &rarr;</a><br><a href="zadani/?sluzba=individual" class="text-link">Jiná technická práce &rarr;</a></p>`,
  ],
  [
    `<a href="https://forms.gle/ZxewcbH8ftuPXBb49" class="btn btn-outline-pill btn-custom-light" target="_blank" rel="noopener noreferrer">Zadaní podkladu FVE</a>`,
    `<a href="zadani/?sluzba=fve" class="btn btn-outline-pill btn-custom-light">Zadaní podkladu FVE</a>`,
  ],
  [
    `<a href="https://forms.gle/mDim9adUyjTMdjfS7" class="btn btn-outline-pill btn-custom-light" target="_blank" rel="noopener noreferrer">Zadaní podkladu LPS</a>`,
    `<a href="zadani/?sluzba=lps" class="btn btn-outline-pill btn-custom-light">Zadaní podkladu LPS</a>`,
  ],
];

test("úvodní stránka = původní web + jen odkazy na zadání zakázky", () => {
  let expected = original;
  for (const [from, to] of ADDITIONS) {
    assert.equal(expected.split(from).length - 1, 1, `úsek se v originálu nenašel právě jednou: ${from.slice(0, 60)}`);
    expected = expected.replace(from, to);
  }
  if (current !== expected) {
    const a = expected.split("\n"), b = current.split("\n");
    const i = a.findIndex((l, k) => l !== b[k]);
    assert.fail(`index.html se liší od původního webu na řádku ${i + 1}:\n  čekáno: ${a[i]}\n  je:     ${b[i]}`);
  }
});

test("styly: původní css/fvsol.css beze změny, jen připojený blok pro zadání", () => {
  const css = read("css/fvsol.css");
  const orig = read("tests/fixtures/fvsol.original.css");
  assert.ok(css.startsWith(orig), "původní styly byly změněny");
  const added = css.slice(orig.length);
  assert.match(added, /^\s*\/\* Zadání zakázky \*\//);
  assert.ok(!/(^|\n)\s*(body|html|\.unslate_co--section|\.feature-v1)\s*\{/.test(added), "přidaný blok nesmí přestylovat původní prvky");
});

test("původní soubory webu zůstaly beze změny", async () => {
  const { execSync } = await import("node:child_process");
  let changed = "";
  try {
    changed = execSync("git diff --name-only main -- css js images *.html", { cwd: new URL(".", root).pathname, encoding: "utf8" });
  } catch {
    return; // mimo git (např. v nasazení) se nekontroluje
  }
  const files = changed.split("\n").filter(Boolean).filter((f) => !["index.html", "css/fvsol.css"].includes(f) && !f.startsWith("zadani/") && !f.startsWith("admin/"));
  assert.deepEqual(files, [], "změněné původní soubory");
});
