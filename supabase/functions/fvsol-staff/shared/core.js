/**
 * FVSOL – jádro zadávání zakázek.
 * Sdílí ho formulář na webu, administrace i serverová funkce (Supabase Edge, Deno).
 * Žádné DOM ani síťové volání – jen data a čisté funkce.
 *
 * Hodnota „Nevím“ se ukládá jako "?" (u výběru více možností jako prvek pole).
 */

export const UNKNOWN = "?";
export const CORE_VERSION = "2026-10-28";

/* ------------------------------------------------------------------ číselníky */

export const SERVICES = {
  fve: {
    id: "fve",
    title: "Fotovoltaika (FVE)",
    short: "FVE",
    lead: "Projektová dokumentace FVE – nová instalace, rozšíření i úpravy.",
    crmType: "FVE",
  },
  lps: {
    id: "lps",
    title: "Hromosvod (LPS)",
    short: "LPS",
    lead: "Návrh a úpravy hromosvodu, analýza rizika, dostatečné vzdálenosti.",
    crmType: "LPS",
  },
  dwg: {
    id: "dwg",
    title: "Překreslení do DWG/DXF",
    short: "DWG/DXF",
    lead: "Překreslení výkresů ze skenu, PDF nebo fotografie do editovatelného CAD.",
    crmType: "Ostatní",
  },
  individual: {
    id: "individual",
    title: "Jiná technická práce",
    short: "Individuální",
    lead: "Zakázka, která nespadá do ostatních kategorií.",
    crmType: "Ostatní",
  },
};

export const STATUSES = {
  rozpracovana: "Rozpracovaná",
  ceka_na_podklady: "Čeká na podklady",
  podklady_k_overeni: "Podklady k ověření",
  pripravena: "Připravena ke zpracování",
  zpracovava_se: "Probíhá zpracování",
  ceka_na_kontrolu: "Čeká na kontrolu",
  dokoncena: "Dokončena",
  rucni_posouzeni: "Vyžaduje ruční posouzení",
};

export const PHASES = {
  draft: "Rozpracované zadání",
  inquiry: "Přijatá poptávka",
  order: "Potvrzená objednávka",
  cancelled: "Zrušeno",
};

/** Co vidí zákazník na stránce své zakázky – bez interních kroků. */
export function customerStatus(order) {
  if (order.phase === "draft") return { label: "Zadání ještě není odeslané", tone: "neutral" };
  if (order.phase === "cancelled") return { label: "Zakázka byla zrušena", tone: "neutral" };
  if (order.hasOpenRequest || order.status === "ceka_na_podklady")
    return { label: "Prosím o doplnění podkladů", tone: "action" };
  if (order.hasReleasedOutput) return { label: "Dokumentace je připravena k převzetí", tone: "done" };
  if (order.phase === "order") return { label: "Zakázka je potvrzená a zpracovává se", tone: "progress" };
  return { label: "Zadání jsem přijal, ozvu se s nabídkou", tone: "progress" };
}

/** Interní postup zakázky (jen administrace a CRM – na webu se nezobrazuje). */
export const WORKFLOW = [
  { key: "kontrola_zadani", label: "Zkontrolovat zadání a podklady", crmStatus: null },
  { key: "nabidka", label: "Poslat cenovou nabídku", crmStatus: "Nabídka" },
  { key: "potvrzeni", label: "Nabídka přijata – potvrdit zpracování", crmStatus: "Objednáno" },
  { key: "zpracovani", label: "Zpracovat dokumentaci", crmStatus: null },
  { key: "kontrola", label: "Zkontrolovat a upravit dokumentaci", crmStatus: null },
  { key: "odeslani", label: "Odeslat dokumentaci klientovi", crmStatus: null },
  { key: "schvaleni", label: "Schválení klientem, případně doúpravy", crmStatus: null },
  { key: "faktura", label: "Vystavit a poslat fakturu", crmStatus: "Hotovo" },
];

export function workflowState(workflow = {}) {
  const steps = WORKFLOW.map((s) => ({ ...s, ...(workflow[s.key] || {}), done: !!workflow[s.key]?.done }));
  const next = steps.find((s) => !s.done) || null;
  return { steps, next, confirmed: !!workflow.potvrzeni?.done };
}

/* ------------------------------------------------------------------ podklady */

export const FILE_RULES = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFiles: 40,
  maxOrderBytes: 150 * 1024 * 1024,
  extensions: [
    "pdf", "dwg", "dxf", "jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff", "bmp",
    "doc", "docx", "xls", "xlsx", "csv", "txt", "zip",
  ],
};

export const FILE_CATEGORIES = {
  vykresy: { label: "Výkresy objektu", help: "Půdorysy, řezy, pohledy, výkres střechy – PDF, DWG nebo sken." },
  foto: { label: "Fotografie", help: "Střecha, objekt ze všech stran, rozvaděč a elektroměr." },
  nabidka: { label: "Nabídka nebo seznam komponent", help: "Panely, střídač, baterie, konstrukce." },
  datasheet: { label: "Technické listy", help: "Datasheety panelů, střídače, baterie." },
  pripojeni: { label: "Smlouva o připojení / vyjádření distributora", help: "" },
  stavajici: { label: "Stávající dokumentace", help: "Projekt, který se má rozšířit nebo upravit." },
  revize: { label: "Revizní zpráva hromosvodu", help: "" },
  fve_projekt: { label: "Projekt FVE", help: "Rozmístění panelů a tras na střeše." },
  pbr: { label: "Požárně bezpečnostní řešení", help: "Pokud je k dispozici." },
  zdroj: { label: "Podklady k překreslení", help: "PDF, sken, fotografie nebo DWG/DXF." },
  sablona: { label: "Šablona hladin nebo razítko", help: "Pokud chcete výkresy ve vlastním standardu." },
  vzor: { label: "Firemní vzor dokumentace", help: "Razítko, titulní list, vzorová technická zpráva." },
  jine: { label: "Jiné", help: "" },
};

const FILE_CATS_BY_SERVICE = {
  fve: ["vykresy", "foto", "nabidka", "datasheet", "pripojeni", "stavajici", "jine"],
  lps: ["vykresy", "foto", "stavajici", "revize", "fve_projekt", "pbr", "jine"],
  dwg: ["zdroj", "sablona", "jine"],
  individual: ["jine", "vykresy", "foto"],
};

export function fileCategoriesFor(service, answers = {}) {
  const cats = [...(FILE_CATS_BY_SERVICE[service] || ["jine"])];
  if (["montaz", "projekce"].includes(answers.role) && answers.vzor === "vlastni") cats.splice(cats.length - 1, 0, "vzor");
  return cats;
}

export function extOf(name = "") {
  const m = /\.([a-z0-9]{1,6})$/i.exec(String(name).trim());
  return m ? m[1].toLowerCase() : "";
}

export function checkFile(name, size, existing = []) {
  const ext = extOf(name);
  if (!FILE_RULES.extensions.includes(ext))
    return `Soubor ${name}: typ .${ext || "?"} nelze nahrát. Povolené: ${FILE_RULES.extensions.join(", ")}.`;
  if (!(size > 0)) return `Soubor ${name} je prázdný.`;
  if (size > FILE_RULES.maxFileBytes) return `Soubor ${name} je větší než 50 MB. Pošlete ho prosím zmenšený nebo po částech.`;
  const live = existing.filter((f) => f.status !== "rejected");
  if (live.length >= FILE_RULES.maxFiles) return `K jedné zakázce lze nahrát nejvýše ${FILE_RULES.maxFiles} souborů.`;
  const total = live.reduce((s, f) => s + (Number(f.size) || 0), 0);
  if (total + size > FILE_RULES.maxOrderBytes) return "Celková velikost podkladů by přesáhla 150 MB. Velké sady pošlete prosím odkazem (úschovna, OneDrive).";
  return null;
}

/* ------------------------------------------------------------------ otázky */

const o = (v, l, help) => (help ? { v, l, help } : { v, l });
const has = (a, k, v) => Array.isArray(a[k]) ? a[k].includes(v) : a[k] === v;
const isRole = (a, ...r) => r.includes(a.role);

export const OBJECT_TYPES = [
  o("rd", "Rodinný dům"),
  o("bd", "Bytový dům"),
  o("firma", "Firma, hala, sklad"),
  o("verejna", "Veřejná budova", "Škola, školka, úřad, zdravotnictví"),
  o("zemedelska", "Zemědělský objekt"),
  o("jine", "Jiný objekt"),
];

/**
 * Kroky formuláře podle služby. Každá otázka:
 *  id, label, type (single|multi|text|textarea|number|date|site|files|check),
 *  options, unknown (nabídnout „Nevím“), when(answers), need: "submit" | "process" | "later" | null,
 *  help, unit, placeholder, ask (jak o údaj požádat později), designer (co posoudí projektant při „Nevím“).
 */
export const STEPS = {
  fve: [
    {
      id: "rozsah",
      title: "Co potřebujete",
      questions: [
        {
          id: "fve_rozsah", type: "single", need: "submit", label: "O jakou dokumentaci jde?",
          options: [
            o("nova", "Nová FVE", "Kompletní dokumentace nové elektrárny"),
            o("rozsireni", "Rozšíření stávající FVE"),
            o("uprava", "Úprava existující dokumentace"),
            o("dsps", "Dokumentace skutečného provedení"),
            o("cast", "Jen vybrané části"),
          ],
        },
        {
          id: "fve_casti", type: "multi", need: "submit", label: "Které části?",
          when: (a) => a.fve_rozsah === "cast",
          options: [
            o("tz", "Technická zpráva"),
            o("vykresy", "Situace a půdorys s rozmístěním panelů"),
            o("jps", "Jednopólové schéma"),
            o("rozvadece", "AC/DC rozvaděče, jištění a ochrany"),
            o("stringy", "Kontrola stringů, kabeláže a kompatibility"),
            o("distributor", "Podklady pro připojení k distribuční soustavě"),
          ],
        },
        {
          id: "fve_ucel", type: "multi", unknown: true, need: null, label: "K čemu dokumentaci potřebujete?",
          help: "Podle účelu zvolím stupeň dokumentace. Můžete vybrat více možností.",
          options: [
            o("distributor", "Žádost o připojení k síti"),
            o("su", "Stavební úřad"),
            o("dps", "Provedení stavby (DPS)"),
            o("dotace", "Dotace"),
            o("investor", "Pro investora nebo výběrové řízení"),
          ],
          designer: "Určit stupeň dokumentace podle účelu",
        },
      ],
    },
    {
      id: "objekt",
      title: "Objekt",
      questions: [
        { id: "site", type: "site", need: "submit", label: "Kde je stavba?", help: "Adresa nebo číslo parcely. Objekt pak označíte v mapě." },
        { id: "objekt_typ", type: "single", need: "process", label: "Typ objektu", options: OBJECT_TYPES, ask: "Typ objektu" },
        {
          id: "montaz", type: "single", unknown: true, need: "process", label: "Kam se budou panely montovat?",
          options: [o("sikma", "Šikmá střecha"), o("plocha", "Plochá střecha"), o("fasada", "Fasáda"), o("zem", "Na zemi nebo na přístřešku")],
          designer: "Určit typ montáže z výkresů nebo fotografií",
        },
        {
          id: "krytina", type: "single", unknown: true, need: null, label: "Krytina",
          when: (a) => a.montaz === "sikma",
          options: [o("taska", "Taška"), o("plech", "Plech, falc"), o("sindel", "Šindel"), o("vlaknocement", "Vláknocement, eternit"), o("jina", "Jiná")],
          designer: "Určit krytinu z fotografií",
        },
        {
          id: "krytina_plocha", type: "single", unknown: true, need: null, label: "Povrch ploché střechy",
          when: (a) => a.montaz === "plocha",
          options: [o("folie", "Fólie"), o("asfalt", "Asfaltové pásy"), o("trapez", "Trapézový plech"), o("jina", "Jiný")],
          designer: "Určit skladbu střechy",
        },
        {
          id: "hromosvod", type: "single", unknown: true, need: null, label: "Je na objektu hromosvod?",
          options: [o("ano", "Ano"), o("ne", "Ne")],
          designer: "Ověřit hromosvod z fotografií",
        },
        {
          id: "hromosvod_resit", type: "single", need: null, label: "Mám řešit i hromosvod?",
          help: "Panely musí ležet v ochranném prostoru a dodržet dostatečné vzdálenosti.",
          when: (a) => a.hromosvod === "ano" || a.hromosvod === UNKNOWN,
          options: [o("ano", "Ano, navrhněte i úpravu hromosvodu"), o("ne", "Ne, jen FVE"), o("poradte", "Poraďte mi")],
        },
      ],
    },
    {
      id: "technologie",
      title: "Technologie",
      questions: [
        {
          id: "komponenty_stav", type: "single", need: "submit", label: "Máte už vybrané komponenty?",
          options: [
            o("mam", "Ano, mám nabídku nebo seznam"),
            o("castecne", "Jen některé"),
            o("navrh", "Ne, potřebuji návrh"),
          ],
        },
        { id: "vykon_kwp", type: "number", unknown: true, need: null, unit: "kWp", label: "Přibližný výkon", placeholder: "např. 9,9" },
        { id: "panely_typ", type: "text", unknown: true, need: null, label: "Panely – výrobce a typ", when: (a) => a.komponenty_stav !== "navrh", placeholder: "např. AIKO A500-MAH60Mb" },
        { id: "panely_pocet", type: "number", unknown: true, need: null, unit: "ks", label: "Počet panelů", when: (a) => a.komponenty_stav !== "navrh" },
        { id: "stridac", type: "text", unknown: true, need: null, label: "Střídač – výrobce a typ", when: (a) => a.komponenty_stav !== "navrh", placeholder: "např. SolaX X3-Hybrid-10.0" },
        {
          id: "baterie", type: "single", unknown: true, need: null, label: "Baterie",
          options: [o("ne", "Bez baterie"), o("ano", "S baterií")],
        },
        { id: "baterie_kwh", type: "number", unknown: true, need: null, unit: "kWh", label: "Kapacita baterie", when: (a) => a.baterie === "ano" },
        {
          id: "dalsi", type: "multi", need: null, label: "Další části (nepovinné)",
          options: [o("wallbox", "Nabíječka elektromobilu"), o("optimizery", "Optimizéry nebo odpojovače"), o("ohrev", "Ohřev vody přebytky"), o("zaloha", "Záložní provoz při výpadku sítě")],
        },
      ],
    },
    {
      id: "pripojeni",
      title: "Připojení",
      questions: [
        {
          id: "distributor", type: "single", unknown: true, need: null, label: "Distributor elektřiny",
          help: "Najdete ho na faktuře za elektřinu.",
          options: [o("cez", "ČEZ Distribuce"), o("egd", "EG.D"), o("pre", "PREdistribuce"), o("lds", "Lokální distribuční soustava")],
          ask: "Distributor elektřiny (z faktury za elektřinu)",
        },
        { id: "jistic_a", type: "number", unknown: true, need: null, unit: "A", label: "Hlavní jistič před elektroměrem", placeholder: "např. 25", ask: "Hodnota hlavního jističe (stačí fotografie elektroměrového rozvaděče)" },
        {
          id: "pretoky", type: "single", unknown: true, need: null, label: "Přetoky do sítě",
          options: [o("ano", "Ano, prodávat přebytky"), o("ne", "Ne, bez přetoků")],
          ask: "Zda má výrobna dodávat přebytky do sítě",
        },
        {
          id: "zadost", type: "single", unknown: true, need: null, label: "Žádost o připojení",
          options: [o("ne", "Zatím nepodaná"), o("podana", "Podaná, čekám na vyjádření"), o("sop", "Mám smlouvu o připojení")],
        },
        { id: "umisteni_technologie", type: "text", need: null, label: "Kde bude střídač a rozvaděče? (nepovinné)", placeholder: "např. garáž, technická místnost v 1. NP" },
      ],
    },
  ],

  lps: [
    {
      id: "rozsah",
      title: "Co potřebujete",
      questions: [
        {
          id: "lps_rozsah", type: "multi", need: "submit", label: "Co mám zpracovat?",
          help: "Můžete vybrat více možností.",
          options: [
            o("novy", "Nový hromosvod"),
            o("rekonstrukce", "Rekonstrukce nebo úprava stávajícího"),
            o("fve", "Úprava kvůli FVE", "Kolize, ochranný prostor, dostatečné vzdálenosti"),
            o("analyza", "Analýza rizika", "Podle ČSN EN 62305-2"),
            o("vzdalenosti", "Kontrola dostatečných vzdáleností"),
            o("dsps", "Dokumentace skutečného provedení"),
          ],
        },
      ],
    },
    {
      id: "objekt",
      title: "Objekt",
      questions: [
        { id: "site", type: "site", need: "submit", label: "Kde je stavba?", help: "Adresa nebo číslo parcely. Objekt pak označíte v mapě." },
        { id: "objekt_typ", type: "single", need: "process", label: "Typ objektu", options: OBJECT_TYPES, ask: "Typ objektu" },
        { id: "delka_m", type: "number", unknown: true, need: null, unit: "m", label: "Délka objektu" },
        { id: "sirka_m", type: "number", unknown: true, need: null, unit: "m", label: "Šířka objektu" },
        { id: "vyska_m", type: "number", unknown: true, need: null, unit: "m", label: "Výška objektu (nejvyšší bod střechy)" },
        {
          id: "strecha_tvar", type: "single", unknown: true, need: null, label: "Tvar střechy",
          options: [o("plocha", "Plochá"), o("sedlova", "Sedlová"), o("valbova", "Valbová"), o("pultova", "Pultová"), o("kombinovana", "Členitá, kombinovaná")],
          designer: "Určit tvar střechy z výkresů",
        },
        {
          id: "krytina_lps", type: "single", unknown: true, need: null, label: "Krytina",
          options: [o("plech", "Plech"), o("taska", "Taška"), o("folie", "Fólie"), o("asfalt", "Asfaltové pásy"), o("horlava", "Hořlavá", "Šindel, dřevo, došky"), o("jina", "Jiná")],
          designer: "Určit krytinu z fotografií",
        },
        {
          id: "zatepleni", type: "single", unknown: true, need: null, label: "Má objekt zateplenou fasádu?",
          options: [o("ano", "Ano"), o("ne", "Ne")],
        },
      ],
    },
    {
      id: "technologie",
      title: "Střecha a ochrana",
      questions: [
        {
          id: "fve_na_strese", type: "single", need: "process", label: "Je nebo bude na střeše fotovoltaika?",
          options: [o("ne", "Ne"), o("stavajici", "Ano, už tam je"), o("planovana", "Ano, plánuje se")],
          ask: "Zda je nebo bude na střeše FVE",
        },
        {
          id: "strecha_zarizeni", type: "multi", need: null, label: "Co dalšího je na střeše? (nepovinné)",
          options: [o("klimatizace", "Klimatizace, tepelná čerpadla"), o("vzt", "Vzduchotechnika"), o("anteny", "Antény, stožáry"), o("komin", "Komíny"), o("svetliky", "Světlíky")],
        },
        {
          id: "stavajici_lps", type: "single", unknown: true, need: null, label: "Je na objektu hromosvod?",
          options: [o("ano", "Ano"), o("ne", "Ne")],
          designer: "Ověřit stávající hromosvod z fotografií",
        },
        {
          id: "trida_lps", type: "single", need: null, label: "Požadovaná třída ochrany",
          help: "Pokud ji neznáte, určí ji analýza rizika.",
          options: [o(UNKNOWN, "Nevím – určí analýza rizika"), o("I", "LPS I"), o("II", "LPS II"), o("III", "LPS III"), o("IV", "LPS IV")],
        },
        {
          id: "provedeni", type: "single", need: null, label: "Provedení",
          options: [o("klasicke", "Klasické vodiče", "AlMgSi, FeZn"), o("hvi", "Izolovaný hromosvod (HVI)"), o("projektant", "Nechám na projektantovi")],
        },
        {
          id: "pripojka_el", type: "single", unknown: true, need: "later", label: "Přípojka elektřiny",
          when: (a) => has(a, "lps_rozsah", "analyza") || !a.trida_lps || a.trida_lps === UNKNOWN,
          options: [o("zemni", "Zemní kabel"), o("vzdusna", "Vzdušné vedení")],
          ask: "Typ přípojky elektřiny (zemní kabel / vzdušné vedení)",
        },
        {
          id: "dalsi_vedeni", type: "multi", unknown: true, need: null, label: "Další přípojky do objektu",
          when: (a) => has(a, "lps_rozsah", "analyza") || !a.trida_lps || a.trida_lps === UNKNOWN,
          options: [o("telekom", "Telekomunikace, data"), o("zadne", "Žádné další")],
        },
      ],
    },
  ],

  dwg: [
    {
      id: "rozsah",
      title: "Co potřebujete",
      questions: [
        {
          id: "dwg_ukol", type: "multi", need: "submit", label: "Co mám udělat?",
          options: [
            o("sken", "Překreslit papírový výkres nebo sken"),
            o("pdf", "Převést PDF do DWG/DXF"),
            o("uprava", "Upravit existující DWG/DXF"),
            o("doplneni", "Doplnit nebo změnit dokumentaci"),
            o("sada", "Překreslit větší sadu výkresů"),
          ],
        },
        {
          id: "dwg_druh", type: "multi", unknown: true, need: "submit", label: "Jaké výkresy?",
          options: [o("pudorysy", "Půdorysy"), o("rezy", "Řezy a pohledy"), o("situace", "Situační výkresy"), o("schemata", "Elektro schémata"), o("jine", "Jiné technické výkresy")],
        },
        { id: "dwg_pocet", type: "number", unknown: true, need: null, unit: "listů", label: "Kolik výkresů?", designer: "Spočítat listy v podkladech" },
      ],
    },
    {
      id: "vystup",
      title: "Výstup",
      questions: [
        { id: "dwg_format", type: "single", need: null, label: "Formát", options: [o("dwg", "DWG"), o("dxf", "DXF"), o("oba", "DWG i DXF")] },
        {
          id: "dwg_verze", type: "single", unknown: true, need: null, label: "Verze AutoCADu",
          options: [o("2018", "2018 a novější"), o("2013", "2013"), o("2010", "2010"), o("2007", "2007")],
        },
        {
          id: "zachovat", type: "multi", need: null, label: "Co má výkres zachovat?",
          options: [o("vrstvy", "Vrstvy podle předlohy nebo vaší šablony"), o("texty", "Texty a popisy"), o("koty", "Kóty"), o("meritko", "Měřítko 1:1"), o("razitko", "Razítko a rámeček")],
        },
        {
          id: "zname_meritko", type: "single", unknown: true, need: null, label: "Je na podkladu kóta nebo známý rozměr?",
          help: "U skenů a fotografií podle něj ověřím měřítko.",
          when: (a) => has(a, "dwg_ukol", "sken") || has(a, "dwg_ukol", "pdf") || has(a, "dwg_ukol", "sada"),
          options: [o("ano", "Ano"), o("ne", "Ne")],
        },
        { id: "termin", type: "single", need: null, label: "Termín", options: [o("bezny", "Běžný"), o("spech", "Spěchá")] },
        { id: "termin_datum", type: "date", need: null, label: "Potřebuji do", when: (a) => a.termin === "spech" },
      ],
    },
  ],

  individual: [
    {
      id: "popis",
      title: "Popis práce",
      questions: [
        {
          id: "ind_obor", type: "multi", need: null, label: "Obor",
          options: [o("fve", "Fotovoltaika"), o("lps", "Hromosvody"), o("elektro", "Elektro – jiné"), o("cad", "Výkresy, CAD"), o("jine", "Jiné")],
        },
        { id: "ind_popis", type: "textarea", need: "submit", label: "Co potřebujete zpracovat?", placeholder: "Popište stručně zadání, rozsah a k čemu výstup potřebujete." },
        { id: "ind_termin", type: "date", need: null, label: "Termín (nepovinné)" },
      ],
    },
  ],
};

export const FILES_STEP = { id: "podklady", title: "Podklady" };

export const CONTACT_STEP = {
  id: "kontakt",
  title: "Kontakt",
  questions: [
    { id: "kontakt_jmeno", type: "text", need: "submit", label: "Jméno a příjmení", autocomplete: "name" },
    { id: "kontakt_email", type: "email", need: "submit", label: "E-mail", autocomplete: "email" },
    { id: "kontakt_telefon", type: "tel", need: "later", label: "Telefon", autocomplete: "tel", ask: "Telefon pro rychlé dotazy" },
    {
      id: "role", type: "single", need: null, label: "Zadáváte jako",
      options: [o("investor", "Majitel nebo investor"), o("montaz", "Montážní firma"), o("projekce", "Projekční kancelář"), o("jine", "Jiné")],
    },
    { id: "firma", type: "text", need: null, label: "Firma", when: (a) => isRole(a, "montaz", "projekce", "jine"), autocomplete: "organization" },
    { id: "ico", type: "text", need: null, label: "IČO", when: (a) => isRole(a, "montaz", "projekce", "jine"), placeholder: "8 číslic" },
    { id: "investor_nazev", type: "text", need: "later", label: "Investor stavby (do razítka)", when: (a) => isRole(a, "montaz", "projekce"), ask: "Název a adresa investora do razítka" },
    {
      id: "vzor", type: "single", need: null, label: "Vzor dokumentace",
      when: (a) => isRole(a, "montaz", "projekce"),
      options: [o("vlastni", "Mám vlastní vzor, přiložím ho"), o("drive", "Vzor už máte z dřívější spolupráce"), o("univerzalni", "Použijte váš vzor")],
    },
    { id: "poznamka", type: "textarea", need: null, label: "Poznámka (nepovinné)" },
    { id: "souhlas", type: "check", need: "submit", label: "Souhlasím se zpracováním uvedených údajů pro vyřízení poptávky." },
  ],
};

export function stepsFor(service) {
  const s = STEPS[service];
  if (!s) return [];
  return [...s, FILES_STEP, CONTACT_STEP, { id: "prehled", title: "Přehled" }];
}

export function allQuestions(service) {
  return [...(STEPS[service] || []).flatMap((s) => s.questions), ...CONTACT_STEP.questions];
}

export function visibleQuestions(step, answers) {
  return (step.questions || []).filter((q) => !q.when || q.when(answers || {}));
}

/* ------------------------------------------------------------------ hodnoty */

export function isBlank(v) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}
export function isUnknown(v) {
  return v === UNKNOWN || (Array.isArray(v) && v.includes(UNKNOWN));
}
export function validEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v || "").trim());
}
export function validPhone(v) {
  const d = String(v || "").replace(/[\s()-]/g, "");
  return d === "" || /^\+?\d{9,15}$/.test(d);
}
export function validIco(v) {
  const s = String(v || "").replace(/\s/g, "");
  if (s === "") return true;
  if (!/^\d{8}$/.test(s)) return false;
  const w = [8, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((acc, k, i) => acc + k * Number(s[i]), 0);
  const c = (11 - (sum % 11)) % 10;
  return c === Number(s[7]);
}
export function parseNumber(v) {
  if (v === UNKNOWN || v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function formatValue(q, v) {
  if (v === UNKNOWN) return "Nevím";
  if (isBlank(v)) return "";
  if (q.type === "single") return (q.options || []).find((x) => x.v === v)?.l ?? String(v);
  if (q.type === "multi") return v.map((x) => (x === UNKNOWN ? "Nevím" : (q.options || []).find((y) => y.v === x)?.l ?? x)).join(", ");
  if (q.type === "check") return v ? "Ano" : "";
  if (q.type === "number") return `${String(v).replace(".", ",")}${q.unit ? " " + q.unit : ""}`;
  if (q.type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : String(v);
  }
  if (q.type === "site") return siteLabel(v);
  return String(v);
}

export function siteLabel(site) {
  if (!site) return "";
  return site.address || site.label || [site.obec, site.parcel ? `p. č. ${site.parcel}` : ""].filter(Boolean).join(", ") || site.query || "";
}

/** Kontrola jednoho kroku formuláře – vrací { [qid]: "chyba" }. */
export function validateStep(step, answers, ctx = {}) {
  const errors = {};
  for (const q of visibleQuestions(step, answers)) {
    const v = answers[q.id];
    if (q.type === "site") {
      if (q.need === "submit" && !siteHasLocation(answers.site)) errors.site = "Zadejte adresu nebo obec a číslo parcely.";
      continue;
    }
    if (q.need === "submit" && (isBlank(v) || v === false)) {
      errors[q.id] = q.type === "check" ? "Bez souhlasu nemohu poptávku přijmout." : "Vyplňte prosím, nebo zvolte „Nevím“.";
      if (!q.unknown && q.type !== "check") errors[q.id] = "Vyplňte prosím.";
      continue;
    }
    if (isBlank(v) || v === UNKNOWN) continue;
    if (q.type === "email" && !validEmail(v)) errors[q.id] = "Zadejte platný e-mail.";
    if (q.type === "tel" && !validPhone(v)) errors[q.id] = "Zadejte telefon ve tvaru +420 123 456 789.";
    if (q.id === "ico" && !validIco(v)) errors[q.id] = "IČO má 8 číslic a kontrolní součet nesedí.";
    if (q.type === "number") {
      const n = parseNumber(v);
      if (n == null || n < 0) errors[q.id] = "Zadejte kladné číslo.";
      else if (q.unit === "m" && n > 500) errors[q.id] = "Hodnota je nezvykle vysoká – zkontrolujte jednotky (metry).";
    }
    if (q.type === "textarea" && String(v).length > 5000) errors[q.id] = "Text je příliš dlouhý (max. 5000 znaků).";
    if (q.type === "text" && String(v).length > 300) errors[q.id] = "Text je příliš dlouhý.";
  }
  if (step.id === "podklady" && ctx.uploading) errors._files = "Počkejte na dokončení nahrávání.";
  return errors;
}

export function siteHasLocation(site) {
  if (!site) return false;
  if (Number.isFinite(site.lat) && Number.isFinite(site.lon)) return true;
  return String(site.query || "").trim().length >= 3;
}

/* ------------------------------------------------------------------ úplnost */

function filesIn(files, ...cats) {
  return (files || []).filter((f) => f.direction !== "out" && f.status === "uploaded" && cats.includes(f.category)).length;
}

/**
 * Vyhodnocení úplnosti zakázky.
 * order: { service, answers, site?, files: [{category,status,direction,meta}] }
 * Vyplnění formuláře ≠ technická úplnost: výsledek odděluje, co zákazník zadal,
 * co bylo převzato automaticky (a čeká na potvrzení), co chybí a co musí posoudit projektant.
 */
export function evaluate(order) {
  const service = order.service;
  const a = order.answers || {};
  const files = order.files || [];
  const site = a.site || order.site || null;

  const provided = [];
  const unknown = [];
  const auto = [];
  const confirm = [];
  const missing = [];
  const designer = [];
  const manual = [];

  const miss = (key, label, level, ask) => missing.push({ key, label, level, ask: ask || label });
  const des = (key, label) => designer.push({ key, label });

  // vyplněné odpovědi
  const qs = allQuestions(service);
  const vis = (q) => !q.when || q.when(a);
  for (const q of qs) {
    if (!vis(q) || q.type === "check") continue;
    const v = q.id === "site" ? site : a[q.id];
    if (q.type === "site") {
      if (siteHasLocation(site)) provided.push({ key: "site", label: "Místo stavby", value: siteLabel(site) });
      continue;
    }
    if (isBlank(v)) {
      if (q.need === "submit") miss(q.id, q.label, "submit");
      else if (q.need === "process") miss(q.id, q.ask || q.label, "process");
      else if (q.need === "later") miss(q.id, q.ask || q.label, "later");
      continue;
    }
    if (isUnknown(v)) {
      unknown.push({ key: q.id, label: q.label });
      if (q.designer) des(q.id, q.designer);
      else if (q.need === "process") miss(q.id, q.ask || q.label, "process");
      else if (q.need === "later" || q.ask) miss(q.id, q.ask || q.label, "later");
    }
    provided.push({ key: q.id, label: q.label, value: formatValue(q, v) });
  }

  // místo stavby – převzaté údaje
  if (service === "fve" || service === "lps") {
    if (!siteHasLocation(site)) miss("site", "Místo stavby (adresa nebo parcela)", "submit");
    else {
      if (site.source === "ruian") {
        if (site.address) auto.push({ key: "address", label: "Adresa", value: site.address, source: "RÚIAN (ČÚZK)", quality: "prevzato" });
        if (site.parcel) auto.push({ key: "parcel", label: "Parcela", value: `${site.parcel}${site.ku ? ", k. ú. " + site.ku : ""}`, source: "RÚIAN (ČÚZK)", quality: "prevzato" });
        const b = site.building;
        if (b) {
          if (b.use) auto.push({ key: "use", label: "Způsob využití stavby", value: b.use, source: "RÚIAN", quality: "prevzato" });
          if (b.floors) auto.push({ key: "floors", label: "Počet podlaží", value: String(b.floors), source: "RÚIAN", quality: "prevzato" });
          if (b.area) auto.push({ key: "area", label: "Zastavěná plocha (z obrysu)", value: `${fmt1(b.area)} m²`, source: "obrys budovy v katastrální mapě", quality: "odhad" });
          if (b.length && b.width) auto.push({ key: "dims", label: "Půdorysné rozměry (z obrysu)", value: `${fmt1(b.length)} × ${fmt1(b.width)} m`, source: "obrys budovy v katastrální mapě", quality: "odhad" });
          if (b.height_est) auto.push({ key: "height", label: "Výška (odhad z výškopisu)", value: `${fmt1(b.height_est)} m`, source: "DMP 1G − DMR 5G (ČÚZK)", quality: "odhad" });
        }
        if (!site.building_confirmed) confirm.push({ key: "building", label: "Výběr budovy v mapě", who: "zakaznik" });
        if (b?.length || b?.height_est) confirm.push({ key: "dims", label: "Rozměry převzaté z mapy ověřit podle výkresů", who: "projektant" });
      } else {
        confirm.push({ key: "site", label: "Místo stavby zadané ručně – dohledat parcelu a objekt", who: "projektant" });
      }
    }
  }

  // pravidla podle služby
  if (service === "fve") {
    if (!filesIn(files, "vykresy", "foto")) miss("podklady_objekt", "Výkresy objektu nebo alespoň fotografie střechy", "process");
    if (a.montaz === "plocha") des("statika", "Ověřit únosnost ploché střechy (zátěžová konstrukce) – případně vyžádat statický posudek");
    if (a.montaz && a.montaz !== "zem" && a.montaz !== "plocha") des("statika", "Ověřit, zda investor potřebuje statické posouzení střechy");
    if (a.komponenty_stav === "mam") {
      const listed = !isBlank(a.panely_typ) && !isUnknown(a.panely_typ) && !isBlank(a.panely_pocet) && !isUnknown(a.panely_pocet) && !isBlank(a.stridac) && !isUnknown(a.stridac);
      if (!filesIn(files, "nabidka") && !listed) miss("komponenty", "Nabídka nebo seznam komponent (panely, počet, střídač)", "process");
    }
    if (a.komponenty_stav === "navrh") des("komponenty", "Navrhnout komponenty a počet panelů (určuje projektant, nepočítá se automaticky)");
    if (a.komponenty_stav === "castecne") des("komponenty", "Doplnit chybějící komponenty");
    if (isUnknown(a.panely_pocet) && a.komponenty_stav !== "navrh") des("panely_pocet", "Určit počet panelů podle rozmístění");
    if (a.komponenty_stav !== "navrh" && !filesIn(files, "datasheet") && (filesIn(files, "nabidka") || !isBlank(a.panely_typ)))
      miss("datasheet", "Technické listy panelů a střídače", "later");
    if (["rozsireni", "uprava", "dsps"].includes(a.fve_rozsah) && !filesIn(files, "stavajici"))
      miss("stavajici", a.fve_rozsah === "dsps" ? "Projekt, podle kterého se stavělo, a změny při montáži" : "Stávající dokumentace FVE", "process");
    if (a.zadost === "sop" && !filesIn(files, "pripojeni")) miss("sop", "Smlouva o připojení", "later");
    if (has(a, "fve_ucel", "distributor") || a.fve_rozsah === "nova") miss("ean", "EAN odběrného místa (z faktury za elektřinu)", "later");
    if (a.hromosvod === "ano" && a.hromosvod_resit === "ne") des("lps_kolize", "Ověřit polohu panelů v ochranném prostoru a dostatečné vzdálenosti s");
    if (a.hromosvod_resit === "ano") manual.push("Zákazník chce řešit i hromosvod – připojit LPS do nabídky");
    if (has(a, "dalsi", "zaloha")) des("zaloha", "Záložní provoz – ověřit zapojení přepínání a soulad s pravidly distributora");
    if (a.objekt_typ === "jine") manual.push("Neobvyklý typ objektu");
  }

  if (service === "lps") {
    if (!filesIn(files, "vykresy", "foto")) miss("podklady_objekt", "Výkresy objektu nebo fotografie objektu ze všech stran a střechy", "process");
    const dimsKnown = ["delka_m", "sirka_m", "vyska_m"].every((k) => parseNumber(a[k]) != null);
    if (!dimsKnown && !filesIn(files, "vykresy")) miss("rozmery", "Rozměry objektu (výkresy nebo délka, šířka a výška)", "process");
    else if (!dimsKnown) des("rozmery", "Odečíst rozměry objektu z výkresů");
    if (has(a, "lps_rozsah", "rekonstrukce") && !filesIn(files, "stavajici", "revize")) miss("stavajici", "Stávající projekt nebo poslední revizní zpráva hromosvodu", "later");
    if ((has(a, "lps_rozsah", "fve") || a.fve_na_strese === "planovana" || a.fve_na_strese === "stavajici") && !filesIn(files, "fve_projekt"))
      miss("fve_projekt", "Projekt FVE (rozmístění panelů a tras)", has(a, "lps_rozsah", "fve") ? "process" : "later");
    if (!a.trida_lps || a.trida_lps === UNKNOWN) des("trida", has(a, "lps_rozsah", "analyza") ? "Třída LPS z analýzy rizika" : "Třída LPS neurčena – doporučit analýzu rizika");
    if (has(a, "lps_rozsah", "analyza") && ["verejna", "bd", "firma"].includes(a.objekt_typ) && !filesIn(files, "pbr"))
      miss("pbr", "Požárně bezpečnostní řešení (pro analýzu rizika)", "later");
    if (has(a, "lps_rozsah", "analyza")) miss("osoby", "Provoz objektu: počet osob a doba přítomnosti", "later");
    if (a.krytina_lps === "horlava") manual.push("Hořlavá krytina – zvláštní požadavky na vzdálenosti vodičů");
    if (a.objekt_typ === "jine") manual.push("Neobvyklý typ objektu");
  }

  if (service === "dwg") {
    if (!filesIn(files, "zdroj")) miss("zdroj", "Podklady k překreslení (PDF, sken, fotografie nebo DWG)", "process");
    const raster = files.filter((f) => f.category === "zdroj" && f.status === "uploaded" && (f.meta?.kind === "raster" || /^(jpe?g|png|heic|heif|tiff?|bmp|webp)$/.test(extOf(f.file_name))));
    if ((has(a, "dwg_ukol", "sken") || raster.length) && a.zname_meritko !== "ano")
      manual.push("Rastrový podklad bez známého rozměru – měřítko je nutné ověřit");
    if (raster.length) des("kvalita", "Posoudit čitelnost skenů – nečitelné části překreslit ručně po domluvě");
    if (has(a, "zachovat", "vrstvy") && !filesIn(files, "sablona")) confirm.push({ key: "vrstvy", label: "Šablona hladin – vlastní od zákazníka, nebo moje?", who: "zakaznik" });
    const vector = files.filter((f) => f.category === "zdroj" && f.meta?.kind === "vector").length;
    if (vector) auto.push({ key: "pdf_vector", label: "Vektorové PDF", value: `${vector} soubor(ů) – geometrii lze převzít`, source: "analýza podkladů", quality: "prevzato" });
    if (raster.length) auto.push({ key: "pdf_raster", label: "Rastrové podklady", value: `${raster.length} soubor(ů) – nutné překreslení`, source: "analýza podkladů", quality: "prevzato" });
  }

  if (service === "individual") manual.push("Individuální zakázka – posoudit rozsah a cenu");

  // kontakt a vzor
  if (["montaz", "projekce"].includes(a.role)) {
    if (a.vzor === "vlastni" && !filesIn(files, "vzor")) miss("vzor", "Firemní vzor dokumentace (razítko, titulní list, TZ)", "process");
    if (a.vzor === "drive") confirm.push({ key: "vzor", label: "Přiřadit firemní profil a vzor z dřívější spolupráce", who: "projektant" });
  }

  // soubory nahrané, ale nepotvrzené
  const pending = files.filter((f) => f.direction !== "out" && f.status === "pending").length;
  const uploaded = files.filter((f) => f.direction !== "out" && f.status === "uploaded");
  const byCategory = {};
  for (const f of uploaded) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  if (uploaded.length) confirm.push({ key: "files", label: "Zkontrolovat obsah nahraných podkladů", who: "projektant" });

  const dedupe = (arr) => arr.filter((x, i) => arr.findIndex((y) => y.key === x.key && y.label === x.label) === i);
  const missingD = dedupe(missing);
  const blockingSubmit = missingD.filter((m) => m.level === "submit");
  const blockingProcess = missingD.filter((m) => m.level === "process");

  const canSubmit = blockingSubmit.length === 0 && pending === 0;
  const readyForProcessing = canSubmit && blockingProcess.length === 0;
  const needsReview = manual.length > 0;

  let suggestedStatus = "rozpracovana";
  if (canSubmit) suggestedStatus = blockingProcess.length ? "ceka_na_podklady" : needsReview ? "rucni_posouzeni" : "podklady_k_overeni";

  return {
    version: CORE_VERSION,
    provided,
    unknown,
    files: { count: uploaded.length, pending, byCategory },
    auto,
    confirm: dedupe(confirm),
    missing: missingD,
    designer: dedupe(designer),
    manual: [...new Set(manual)],
    canSubmit,
    readyForProcessing,
    needsReview,
    expertCheckRequired: true,
    suggestedStatus,
  };
}

function fmt1(n) {
  return String(Math.round(Number(n) * 10) / 10).replace(".", ",");
}

/* ------------------------------------------------------------------ souhrny */

export function summaryRows(order) {
  const a = order.answers || {};
  const rows = [];
  for (const step of STEPS[order.service] || []) {
    for (const q of visibleQuestions(step, a)) {
      const v = q.type === "site" ? a.site : a[q.id];
      if (q.type === "site" ? !siteHasLocation(v) : isBlank(v)) continue;
      rows.push({ step: step.title, key: q.id, label: q.label, value: formatValue(q, v) });
    }
  }
  for (const q of visibleQuestions(CONTACT_STEP, a)) {
    if (q.type === "check" || isBlank(a[q.id])) continue;
    rows.push({ step: CONTACT_STEP.title, key: q.id, label: q.label, value: formatValue(q, a[q.id]) });
  }
  return rows;
}

export function orderTitle(order) {
  const a = order.answers || {};
  const s = SERVICES[order.service]?.short || "";
  const place = siteLabel(a.site) || a.firma || a.kontakt_jmeno || "";
  return [order.code, s, place].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ CRM */

export function nextWorkday(from = new Date()) {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function crmTaskId(code, key) {
  return `fvsol-${String(code).toLowerCase()}-${key}`;
}

/**
 * Zakázka do CRM (tabulka jobs, prostor „FVE a LPS“) – zakládá se až po odeslání zadání.
 * Úkoly = interní postup + chybějící podklady. Událost v kalendáři = kontrola zadání.
 */
export function toCrmJob(order, ev, { adminUrl = "", now = new Date() } = {}) {
  const a = order.answers || {};
  const svc = SERVICES[order.service];
  const site = a.site || {};
  const due = nextWorkday(now);
  const tasks = WORKFLOW.map((s, i) => ({
    id: crmTaskId(order.code, s.key),
    key: s.key,
    text: s.label,
    due: i === 0 ? due : "",
    done: false,
  }));
  for (const m of ev.missing.filter((x) => x.level !== "submit")) {
    tasks.push({ id: crmTaskId(order.code, "chybi-" + m.key), key: "chybi:" + m.key, text: `Doplnit od klienta: ${m.label}`, due: "", done: false });
  }
  const lines = [
    `${svc?.title || order.service} – zadání z webu ${order.code}`,
    ...summaryRows(order).filter((r) => !["kontakt_jmeno", "kontakt_email", "kontakt_telefon", "souhlas"].includes(r.key)).map((r) => `${r.label}: ${r.value}`),
  ];
  if (ev.missing.length) lines.push("", "Chybí:", ...ev.missing.map((m) => `– ${m.label}${m.level === "later" ? " (později)" : ""}`));
  if (ev.designer.length) lines.push("", "Posoudit:", ...ev.designer.map((d) => `– ${d.label}`));
  if (ev.manual.length) lines.push("", "Ruční posouzení:", ...ev.manual.map((d) => `– ${d}`));
  const mapUrl = Number.isFinite(site.lat) && Number.isFinite(site.lon) ? `https://mapy.com/zakladni?x=${site.lon}&y=${site.lat}&z=19&source=coor&id=${site.lon},${site.lat}` : "";
  const name = [order.code, svc?.short, siteLabel(site) || a.firma || a.kontakt_jmeno].filter(Boolean).join(" ");
  return {
    name: name.slice(0, 120),
    type: svc?.crmType || "Ostatní",
    status: "Poptávka",
    client: a.firma || a.kontakt_jmeno || "",
    phone: a.kontakt_telefon || "",
    email: a.kontakt_email || "",
    address: siteLabel(site),
    mapUrl,
    folder: "",
    info: lines.join("\n").slice(0, 4000),
    tasks,
    notes: [],
    mails: [],
    links: adminUrl ? [{ id: crmTaskId(order.code, "admin"), label: `Zakázka ${order.code} v administraci`, url: adminUrl }] : [],
    events: [{ id: crmTaskId(order.code, "kontrola"), date: due, time: "08:00", dur: 30, title: `Zkontrolovat zadání ${order.code}` }],
    created: now.getTime(),
    _src: "fvsol-web",
    _order: order.id,
  };
}

/** Promítne krok postupu do CRM zakázky (vrací upravenou kopii data). */
export function applyWorkflowToCrm(data, code, workflow) {
  const d = structuredCloneSafe(data || {});
  d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
  for (const s of WORKFLOW) {
    const id = crmTaskId(code, s.key);
    let t = d.tasks.find((x) => x.id === id);
    if (!t) {
      t = { id, key: s.key, text: s.label, due: "", done: false };
      d.tasks.push(t);
    }
    t.done = !!workflow?.[s.key]?.done;
  }
  let status = "Poptávka";
  for (const s of WORKFLOW) if (workflow?.[s.key]?.done && s.crmStatus) status = s.crmStatus;
  if (!["Zrušeno"].includes(d.status)) d.status = status;
  const next = WORKFLOW.find((s) => !workflow?.[s.key]?.done);
  if (next) {
    const t = d.tasks.find((x) => x.id === crmTaskId(code, next.key));
    if (t && !t.due) t.due = nextWorkday();
  }
  return d;
}

function structuredCloneSafe(v) {
  return JSON.parse(JSON.stringify(v));
}

/* ------------------------------------------------------------------ data pro TZ */

/**
 * Převod zakázky na datový model projektu nástroje TZ (docs/project-data.schema.json).
 * Vyplní jen to, co je skutečně známo; ostatní zůstane null a je uvedeno v _unknown.
 */
export function toProjectData(order, extra = {}) {
  const a = order.answers || {};
  const site = a.site || {};
  const num = (v) => parseNumber(v);
  const known = (v) => (isBlank(v) || isUnknown(v) ? null : v);
  const distributor = { cez: "ČEZ Distribuce", egd: "EG.D", pre: "PREdistribuce" }[a.distributor] || null;
  const data = {
    meta: {
      order_number: order.code || null,
      name: null,
      building_name: null,
      stage: null,
      date: null,
      revision: null,
    },
    company: extra.company || { name: null, ico: null, address: null },
    investor: { name: known(a.investor_nazev) || (a.role === "investor" ? known(a.kontakt_jmeno) : null), ico: null, address: null },
    contractor: ["montaz"].includes(a.role) ? { name: known(a.firma), ico: known(a.ico), address: null, contact: known(a.kontakt_jmeno) } : { name: null, ico: null, address: null, contact: null },
    site: {
      address: { full: site.address || null, municipality: site.obec || null, region: null },
      cadastre: { area: site.ku || null, parcels: site.parcel || null },
      gps: Number.isFinite(site.lat) ? `${site.lat.toFixed(6)}N, ${site.lon.toFixed(6)}E` : null,
      climate: { snow_zone: null, wind_zone: null },
      building: {
        roof_covering: known(a.krytina) || known(a.krytina_plocha) || null,
        roof_tilt_deg: null,
        existing_pv: a.fve_rozsah === "rozsireni" ? "ANO" : order.service === "fve" ? "NE" : null,
      },
    },
    pv: order.service === "fve" ? {
      count: num(a.panely_pocet),
      panel: { manufacturer: null, model: known(a.panely_typ) },
      inverters: known(a.stridac) ? [{ label: null, model: a.stridac, count: null }] : [],
      battery: a.baterie === "ano" ? { model: null, capacity_kwh: num(a.baterie_kwh), count: null } : a.baterie === "ne" ? null : undefined,
    } : undefined,
    energy: order.service === "fve" ? { p_dc_kwp: num(a.vykon_kwp) } : undefined,
    electrical: order.service === "fve" ? { grid: { distributor } } : undefined,
    lps: order.service === "lps" ? { class: ["I", "II", "III", "IV"].includes(a.trida_lps) ? a.trida_lps : null } : undefined,
  };
  const unknownPaths = [];
  (function walk(o, p) {
    for (const [k, v] of Object.entries(o || {})) {
      const path = p ? `${p}.${k}` : k;
      if (v === null) unknownPaths.push(path);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, path);
    }
  })(data, "");
  return {
    ...JSON.parse(JSON.stringify(data)),
    _source: {
      generated_by: "FVSOL zakázky",
      core_version: CORE_VERSION,
      order: order.code,
      note: "Údaje převzaté z registrů a odhady z mapy je nutné ověřit. Hodnoty null nejsou známé – nedoplňovat odhadem.",
      site_source: site.source === "ruian" ? "RÚIAN (ČÚZK), CC BY 4.0" : "zadáno ručně",
    },
    _unknown: unknownPaths,
  };
}
