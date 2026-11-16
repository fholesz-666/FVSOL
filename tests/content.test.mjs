// Původní web zůstává beze změny. Jediné dovolené zásahy jsou odkazy na zadání zakázky a doplnění služby
// smart home vypsané níže a blok stylů „Zadání zakázky“ připojený na konec css/fvsol.css.
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

// Smart home (16. 11. 2026, na přání Filipa): služba, portfolio, FAQ, meta – další dovolené úseky
const SMART_HOME = [
  [
    `    <meta name="description" content="Externí projektant fotovoltaických elektráren (FVE) a hromosvodů (LPS). Projektová dokumentace pro rodinné domy, firmy i obce, analýza rizika podle ČSN EN 62305-2. Celá ČR.">`,
    `    <meta name="description" content="Externí projektant fotovoltaických elektráren (FVE), hromosvodů (LPS) a chytrých elektroinstalací smart home (Loxone). Projektová dokumentace pro rodinné domy, firmy i obce, analýza rizika podle ČSN EN 62305-2. Celá ČR.">`,
  ],
  [
    `    <meta property="og:description" content="Externí projektant fotovoltaických elektráren (FVE) a hromosvodů (LPS). Projektová dokumentace pro rodinné domy, firmy i obce, analýza rizika podle ČSN EN 62305-2. Celá ČR.">`,
    `    <meta property="og:description" content="Externí projektant fotovoltaických elektráren (FVE), hromosvodů (LPS) a chytrých elektroinstalací smart home (Loxone). Projektová dokumentace pro rodinné domy, firmy i obce, analýza rizika podle ČSN EN 62305-2. Celá ČR.">`,
  ],
  [
    `    "description": "Externí projektant fotovoltaických elektráren (FVE) a hromosvodů (LPS). Projektová dokumentace pro rodinné domy, firmy, obce a školy, analýza rizika podle ČSN EN 62305-2.",`,
    `    "description": "Externí projektant fotovoltaických elektráren (FVE), hromosvodů (LPS) a chytrých elektroinstalací smart home (Loxone). Projektová dokumentace pro rodinné domy, firmy, obce a školy, analýza rizika podle ČSN EN 62305-2.",`,
  ],
  [
    `      "přepěťové ochrany"`,
    `      "přepěťové ochrany",
      "smart home",
      "Loxone",
      "chytrá elektroinstalace"`,
  ],
  [
    `            "description": "Dokumentace fotovoltaické elektrárny pro distributora, stavební řízení (DSP), provedení stavby (DPS) i dokumentace skutečného provedení."
          }`,
    `            "description": "Dokumentace fotovoltaické elektrárny pro distributora, stavební řízení (DSP), provedení stavby (DPS) i dokumentace skutečného provedení."
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Projekt chytré elektroinstalace smart home (Loxone)",
            "description": "Rozmístění prvků v půdorysech (osvětlení, stínění, vytápění, zabezpečení, audio, data), rozvaděč a schémata zapojení, kabelové trasy a technická zpráva."
          }`,
  ],
  [
    `                  <a href="#" data-filter=".schemata">Schémata a rozvaděče</a>
                </div>`,
    `                  <a href="#" data-filter=".schemata">Schémata a rozvaděče</a>
                  <a href="#" data-filter=".smarthome">Smart home</a>
                </div>`,
  ],
  [
    `            <p class="portfolio-intro mb-4">Výběr z mé projektové dokumentace – fotovoltaika a hromosvody pro výrobní haly, firmy, školy, úřady i rodinné domy. Razítka a údaje investorů jsou na ukázkách skryté.</p>`,
    `            <p class="portfolio-intro mb-4">Výběr z mé projektové dokumentace – fotovoltaika, hromosvody a chytré elektroinstalace pro výrobní haly, firmy, školy, úřady i rodinné domy. Razítka a údaje investorů jsou na ukázkách skryté.</p>`,
  ],
  [
    `           <div id="posts" class="row gutter-isotope-item">
              <div class="item fve-firmy col-sm-6 col-md-6 col-lg-4 isotope-mb-2">`,
    `           <div id="posts" class="row gutter-isotope-item">
              <div class="item smarthome col-sm-6 col-md-6 col-lg-4 isotope-mb-2">
                <a href="images/portfolio/smarthome-rd-osvetleni.webp" class="portfolio-item isotope-item gsap-reveal-img" data-fancybox="gallery" data-caption="Smart home Loxone pro rodinný dům s garáží (Moravskoslezský kraj) – půdorys osvětlení: svítidla DALI-2 a 230 V, LED pásky RGBW, venkovní osvětlení a seznam prvků">
                  <div class="overlay">
                    <span class="wrap-icon icon-photo2"></span>
                    <div class="portfolio-item-content">
                      <h3>Smart home · Rodinný dům</h3>
                      <p>Loxone · půdorys osvětlení</p>
                    </div>
                  </div>
                  <img src="images/portfolio/thumbs/smarthome-rd-osvetleni.webp" class="img-fluid" width="960" height="720" alt="Půdorys rodinného domu s rozmístěním svítidel a LED pásků chytré elektroinstalace Loxone">
                </a>
              </div>

              <div class="item smarthome schemata col-sm-6 col-md-6 col-lg-4 isotope-mb-2">
                <a href="images/portfolio/smarthome-rozvadec-loxone.webp" class="portfolio-item isotope-item gsap-reveal-img" data-fancybox="gallery" data-caption="Smart home Loxone pro rodinný dům – rozmístění přístrojů v rozvaděči: Miniserver, Tree a Relay Extension, DALI, audio, jištění a svorkovnice se seznamem přístrojů">
                  <div class="overlay">
                    <span class="wrap-icon icon-photo2"></span>
                    <div class="portfolio-item-content">
                      <h3>Smart home · Rozvaděč Loxone</h3>
                      <p>Rozmístění přístrojů · 2 pole</p>
                    </div>
                  </div>
                  <img src="images/portfolio/thumbs/smarthome-rozvadec-loxone.webp" class="img-fluid" width="960" height="720" alt="Výkres rozvaděče chytré elektroinstalace Loxone s rozmístěním přístrojů">
                </a>
              </div>
              <div class="item fve-firmy col-sm-6 col-md-6 col-lg-4 isotope-mb-2">`,
  ],
  [
    `              <p class="lead gsap-reveal">Jsem externí projektant specializující se na fotovoltaické elektrárny a&nbsp;hromosvody. Vytvářím projektovou dokumentaci, dokumentaci skutečného provedení, analýzy rizika a&nbsp;návrhy optimálního rozložení panelů včetně materiálového výpočtu.</p>`,
    `              <p class="lead gsap-reveal">Jsem externí projektant specializující se na fotovoltaické elektrárny a&nbsp;hromosvody. Vytvářím projektovou dokumentaci, dokumentaci skutečného provedení, analýzy rizika a&nbsp;návrhy optimálního rozložení panelů včetně materiálového výpočtu. Navrhuji také chytré elektroinstalace smart home v&nbsp;systému Loxone.</p>`,
  ],
  [
    `          <div class="row gutter-v3">
            <div class="col-md-6 col-lg-4 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="0">`,
    `          <div class="row gutter-v3">
            <div class="col-md-6 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="0">`,
  ],
  [
    `            </div>
            <div class="col-md-6 col-lg-4 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="50">`,
    `            </div>
            <div class="col-md-6 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="50">`,
  ],
  [
    `            </div>
            <div class="col-md-6 col-lg-4 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="100">`,
    `            </div>
            <div class="col-md-6 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="100">`,
  ],
  [
    `              <div class="feature-v1" data-aos="fade-up" data-aos-delay="100">
                <div class="wrap-icon mb-3">`,
    `              <div class="feature-v1" data-aos="fade-up" data-aos-delay="100">
                <div class="wrap-icon mb-3">
                  <img src="images/svg/006-goal.svg" alt="" width="45">
                </div>
                <h3>Dokumentace <br> smart home (Loxone)</h3>
                <p>Projekt chytré elektroinstalace rodinného domu: rozmístění prvků v&nbsp;půdorysech (osvětlení, žaluzie, vytápění po místnostech, zabezpečení, audio, data), rozvaděč s&nbsp;rozmístěním přístrojů, schémata zapojení, kabelové trasy a&nbsp;technická zpráva.</p>
                <p class="order-link"><a href="zadani/?sluzba=smarthome" class="text-link">Zadat zakázku smart home &rarr;</a></p>
              </div>
            </div>
            <div class="col-md-6 mb-4">
              <div class="feature-v1" data-aos="fade-up" data-aos-delay="150">
                <div class="wrap-icon mb-3">`,
  ],
  [
    `            <a href="zadani/?sluzba=lps" class="btn btn-outline-pill btn-custom-light">Zadaní podkladu LPS</a>
          </div>
        </div>
`,
    `            <a href="zadani/?sluzba=lps" class="btn btn-outline-pill btn-custom-light">Zadaní podkladu LPS</a>
          </div>
          <div class="col-auto mb-3">
            <a href="zadani/?sluzba=smarthome" class="btn btn-outline-pill btn-custom-light">Zadaní podkladu smart home</a>
          </div>
        </div>
`,
  ],
  [
    `              <p>Záleží na konkrétní stavbě. Pokud objekt hromosvod má, je nutné ověřit, že panely leží v ochranném prostoru jímací soustavy a jsou dodrženy dostatečné vzdálenosti s – jinak se hromosvod upravuje. Pokud ho nemá, o potřebě ochrany rozhodne analýza rizika. Součástí návrhu jsou i přepěťové ochrany na straně DC i AC.</p>
            </details>`,
    `              <p>Záleží na konkrétní stavbě. Pokud objekt hromosvod má, je nutné ověřit, že panely leží v ochranném prostoru jímací soustavy a jsou dodrženy dostatečné vzdálenosti s – jinak se hromosvod upravuje. Pokud ho nemá, o potřebě ochrany rozhodne analýza rizika. Součástí návrhu jsou i přepěťové ochrany na straně DC i AC.</p>
            </details>
            <details class="faq-item">
              <summary>Děláte i projekt chytrého domu (smart home)?</summary>
              <p>Ano, navrhuji chytré elektroinstalace v systému Loxone – hlavně pro novostavby rodinných domů, ale i rekonstrukce. Dodám půdorysy s rozmístěním světel, tlačítek, čidel, žaluzií a dalších prvků, rozvaděč a schémata zapojení, kabelové trasy a technickou zprávu. Nejvíc pomohou půdorysy domu (ideálně DWG z projektu stavby) a výpis oken. Vše ostatní zjistím z formuláře <a href="zadani/?sluzba=smarthome" class="text-link">Zadat zakázku smart home</a>.</p>
            </details>`,
  ],
];

test("úvodní stránka = původní web + jen odkazy na zadání zakázky", () => {
  let expected = original;
  for (const [from, to] of [...ADDITIONS, ...SMART_HOME]) {
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
  const files = changed.split("\n").filter(Boolean).filter((f) => !["index.html", "css/fvsol.css"].includes(f) && !f.startsWith("zadani/") && !f.startsWith("admin/"))
    .filter((f) => !/^images\/portfolio\/(thumbs\/)?smarthome-[a-z-]+\.webp$/.test(f)) // ukázky smart home do portfolia
    .filter((f) => f !== "js/main.js"); // jediná úprava: vypnutý parallax úvodního obrázku na mobilu (disableParallax)
  assert.deepEqual(files, [], "změněné původní soubory");
});
