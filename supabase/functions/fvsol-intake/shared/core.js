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
  // „Prosím o doplnění“ jen u skutečné výzvy projektanta – automaticky zjištěné mezery se ukazují jako seznam
  if (order.hasOpenRequest) return { label: "Prosím o doplnění podkladů", tone: "action" };
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
    "mp4", "mov", "doc", "docx", "xls", "xlsx", "csv", "txt", "zip",
  ],
};

/**
 * Druhy podkladů. Technické údaje (výkony, jistič, EAN, typy komponent…) se nezjišťují otázkami,
 * ale z dokumentů, které zákazník běžně má: nabídka, smlouva o připojení, vyúčtování, fotky.
 */
export const FILE_CATEGORIES = {
  nabidka: { label: "Nabídka nebo seznam komponent", help: "Panely, střídač, baterie – stačí nabídka od montážní firmy." },
  pripojeni: { label: "Smlouva o připojení", help: "Nebo podaná žádost o připojení, pokud smlouvu ještě nemáte." },
  faktura: { label: "Vyúčtování elektřiny", help: "Stačí první strana – je na ní distributor, EAN, jistič a spotřeba." },
  foto: { label: "Fotky domu a střechy", help: "Mobilem stačí. Střecha, dům ze všech stran, případně půda. Můžete přidat i krátké video." },
  foto_er: { label: "Fotka elektroměrového rozvaděče", help: "Otevřená skříň s elektroměrem, aby byl vidět hlavní jistič. Případně i místo, kam má přijít střídač." },
  vykresy: { label: "Výkresy domu (pokud máte)", help: "Půdorysy, řezy, výkres střechy – PDF, DWG nebo sken." },
  stavajici: { label: "Stávající dokumentace", help: "Projekt, který se má rozšířit nebo upravit, případně revizní zpráva." },
  revize: { label: "Revizní zpráva hromosvodu", help: "" },
  fve_projekt: { label: "Projekt fotovoltaiky", help: "Rozmístění panelů na střeše – pokud ho máte." },
  pbr: { label: "Požárně bezpečnostní řešení", help: "Pokud ho máte." },
  datasheet: { label: "Technické listy", help: "" },
  zdroj: { label: "Výkresy k překreslení", help: "PDF, sken nebo fotka výkresu, případně DWG/DXF k úpravě." },
  sablona: { label: "Vaše šablona hladin nebo razítko", help: "Pokud chcete výkresy ve vlastním standardu." },
  vzor: { label: "Firemní vzor dokumentace", help: "Razítko, titulní list, vzorová technická zpráva." },
  jine: { label: "Ostatní", help: "Cokoli dalšího – statika, PBŘ, poznámky, náčrt." },
};

const FILE_CATS_BY_SERVICE = {
  fve: ["nabidka", "pripojeni", "faktura", "foto", "foto_er", "vykresy", "stavajici", "jine"],
  lps: ["foto", "vykresy", "stavajici", "fve_projekt", "pbr", "jine"],
  dwg: ["zdroj", "sablona", "jine"],
  individual: ["jine", "vykresy", "foto"],
};

const isFirm = (a) => ["montaz", "projekce"].includes(a.role);

/** Které druhy podkladů nabídnout zákazníkovi – jen ty, které podle odpovědí dávají smysl. */
export function fileCategoriesFor(service, answers = {}) {
  const a = answers || {};
  const show = {
    nabidka: a.komponenty_stav !== "navrh",
    pripojeni: a.zadost === "sop" || a.zadost === "podana",
    faktura: a.zadost !== "sop",
    stavajici: service !== "fve" || ["rozsireni", "uprava", "dsps"].includes(a.fve_rozsah) || has(a, "lps_rozsah", "rekonstrukce"),
    fve_projekt: has(a, "lps_rozsah", "fve") || ["stavajici", "planovana"].includes(a.fve_na_strese),
    pbr: has(a, "lps_rozsah", "analyza") && ["bd", "firma", "verejna"].includes(a.objekt_typ),
  };
  if (service === "lps") show.stavajici = has(a, "lps_rozsah", "rekonstrukce") || a.stavajici_lps === "ano" || has(a, "lps_rozsah", "dsps");
  const cats = (FILE_CATS_BY_SERVICE[service] || ["jine"]).filter((c) => show[c] !== false);
  if (isFirm(a) && a.vzor === "vlastni") cats.splice(cats.length - 1, 0, "vzor");
  return cats;
}

/** Druhy, které server přijme pro danou službu (nezávisle na aktuálních odpovědích). */
export function allowedFileCategories(service) {
  return [...new Set([...(FILE_CATS_BY_SERVICE[service] || ["jine"]), "vzor", "jine"])];
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

export const POWER_RANGES = [
  o("do10", "do 10 kWp", "Běžný rodinný dům"),
  o("10-20", "10–20 kWp"),
  o("20-50", "20–50 kWp"),
  o("50-100", "50–100 kWp"),
  o("nad100", "nad 100 kWp"),
];

/**
 * Kroky formuláře podle služby. Zásada: jen základní otázky, které zvládne každý,
 * skoro všechny na kliknutí. Technické parametry se berou z nahraných dokumentů
 * a z katastru; co v nich chybí, dořeší projektant (viz evaluate).
 *
 * Otázka: id, label, type (single|multi|text|textarea|date|site|check|email|tel),
 *  options, unknown (nabídnout „Nevím“), when(answers), need: "submit" | "process" | "later" | null,
 *  help, ask (jak o údaj požádat později), designer (co posoudí projektant při „Nevím“).
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
            o("nova", "Nová fotovoltaika"),
            o("rozsireni", "Rozšíření stávající FVE"),
            o("uprava", "Úprava hotové dokumentace"),
            o("dsps", "Dokumentace skutečného provedení"),
            o("cast", "Jen některé části"),
          ],
        },
        {
          id: "fve_casti", type: "multi", need: "submit", label: "Které části?",
          when: (a) => a.fve_rozsah === "cast",
          options: [
            o("tz", "Technická zpráva"),
            o("vykresy", "Rozmístění panelů na střeše"),
            o("jps", "Jednopólové schéma"),
            o("rozvadece", "Rozvaděče, jištění a ochrany"),
            o("stringy", "Kontrola stringů a kabelů"),
            o("distributor", "Podklady pro distributora"),
          ],
        },
        {
          id: "fve_vykon", type: "single", unknown: true, need: null, label: "Jak velká bude elektrárna?",
          help: "Stačí přibližně.",
          options: POWER_RANGES,
        },
      ],
    },
    {
      id: "objekt",
      title: "Budova",
      questions: [
        { id: "site", type: "site", need: "submit", label: "Kde je budova?", help: "Napište adresu nebo číslo parcely a budovu pak potvrďte v mapě." },
        { id: "objekt_typ", type: "single", need: "process", label: "Co je to za budovu?", options: OBJECT_TYPES, ask: "Typ budovy" },
        {
          id: "montaz", type: "single", unknown: true, need: null, label: "Kam přijdou panely?",
          options: [o("sikma", "Šikmá střecha"), o("plocha", "Plochá střecha"), o("fasada", "Fasáda"), o("zem", "Na zem nebo přístřešek")],
          designer: "Určit typ montáže z fotek",
        },
        {
          id: "hromosvod", type: "single", unknown: true, need: null, label: "Je na budově hromosvod?",
          options: [o("ano", "Ano"), o("ne", "Ne")],
          designer: "Ověřit hromosvod z fotek",
        },
      ],
    },
    {
      id: "technologie",
      title: "Technologie a připojení",
      questions: [
        {
          id: "komponenty_stav", type: "single", need: "submit", label: "Máte už nabídku na panely a střídač?",
          options: [o("mam", "Ano, přiložím ji"), o("navrh", "Ne, navrhněte je")],
        },
        {
          id: "baterie", type: "single", unknown: true, need: null, label: "Chcete baterii?",
          when: (a) => a.komponenty_stav === "navrh",
          options: [o("ano", "Ano"), o("ne", "Ne")],
        },
        {
          id: "zadost", type: "single", unknown: true, need: null, label: "Smlouva o připojení k síti",
          help: "Tu vydává distributor elektřiny (ČEZ, EG.D, PRE).",
          options: [o("sop", "Mám ji, přiložím"), o("podana", "Žádost je podaná"), o("ne", "Zatím nic")],
        },
        {
          id: "pretoky", type: "single", unknown: true, need: null, label: "Budete posílat přebytky do sítě?",
          when: (a) => a.zadost !== "sop",
          options: [o("ano", "Ano"), o("ne", "Ne, vše spotřebuji")],
        },
        {
          id: "doplnky", type: "multi", need: null, label: "Mám zajistit i něco z tohoto? (nepovinné)",
          options: [
            o("lps", "Hromosvod"),
            o("analyza", "Analýza rizika"),
            o("statika", "Statický posudek"),
            o("pbr", "Požární řešení (PBŘ)"),
            o("wallbox", "Nabíječka auta"),
          ],
        },
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
            o("rekonstrukce", "Úprava stávajícího hromosvodu"),
            o("fve", "Hromosvod kvůli fotovoltaice"),
            o("analyza", "Analýza rizika"),
            o("dsps", "Dokumentace skutečného provedení"),
          ],
        },
      ],
    },
    {
      id: "objekt",
      title: "Budova",
      questions: [
        { id: "site", type: "site", need: "submit", label: "Kde je budova?", help: "Napište adresu nebo číslo parcely a budovu pak potvrďte v mapě." },
        { id: "objekt_typ", type: "single", need: "process", label: "Co je to za budovu?", options: OBJECT_TYPES, ask: "Typ budovy" },
        {
          id: "podlazi", type: "single", unknown: true, need: null, label: "Kolik má pater nad zemí?",
          options: [o("1", "1"), o("2", "2"), o("3", "3"), o("4", "4"), o("5", "5 a víc")],
          designer: "Zjistit počet podlaží",
        },
        {
          id: "osoby", type: "single", unknown: true, need: null, label: "Kolik lidí v budově obvykle bývá?",
          options: [o("5", "do 5"), o("10", "6–10"), o("30", "11–30"), o("100", "31–100"), o("vice", "víc než 100")],
          ask: "Kolik lidí v budově obvykle bývá",
        },
      ],
    },
    {
      id: "strecha",
      title: "Střecha a fasáda",
      questions: [
        {
          id: "strecha_tvar", type: "single", unknown: true, need: null, label: "Jakou má střechu?",
          options: [o("plocha", "Plochá"), o("sedlova", "Sedlová"), o("valbova", "Valbová"), o("pultova", "Pultová"), o("kombinovana", "Členitá")],
          designer: "Určit tvar střechy z fotek",
        },
        {
          id: "krytina_lps", type: "single", unknown: true, need: null, label: "Čím je střecha pokrytá?",
          options: [o("plech", "Plech"), o("taska", "Taška"), o("folie", "Fólie"), o("asfalt", "Asfaltové pásy"), o("horlava", "Šindel, dřevo, došky")],
          designer: "Určit krytinu z fotek",
        },
        {
          id: "fasada", type: "single", unknown: true, need: null, label: "Jakou má fasádu?",
          options: [o("zateplena", "Zateplená"), o("nezateplena", "Nezateplená"), o("drevo", "Dřevěná"), o("plech", "Plechová")],
          designer: "Určit fasádu z fotek",
        },
        {
          id: "stavajici_lps", type: "single", unknown: true, need: null, label: "Je tam už hromosvod?",
          options: [o("ano", "Ano"), o("ne", "Ne")],
          designer: "Ověřit stávající hromosvod z fotek",
        },
        {
          id: "fve_na_strese", type: "single", need: null, label: "Je nebo bude na střeše fotovoltaika?",
          options: [o("ne", "Ne"), o("stavajici", "Už tam je"), o("planovana", "Plánuje se")],
        },
        {
          id: "provedeni", type: "single", need: null, label: "Jaký hromosvod by se vám líbil? (nepovinné)",
          options: [o("klasicke", "Klasický drát"), o("hvi", "Izolovaný, méně vidět"), o("projektant", "Nechám na vás")],
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
            o("sken", "Překreslit papírový výkres, sken nebo fotku"),
            o("pdf", "Převést PDF do DWG/DXF"),
            o("uprava", "Upravit nebo doplnit DWG/DXF"),
          ],
        },
        {
          id: "dwg_druh", type: "multi", need: null, label: "Jaké výkresy? (nepovinné)",
          options: [o("pudorysy", "Půdorysy"), o("rezy", "Řezy a pohledy"), o("situace", "Situace"), o("schemata", "Elektro schémata"), o("jine", "Jiné")],
        },
        {
          id: "dwg_pocet", type: "single", unknown: true, need: null, label: "Kolik výkresů?",
          options: [o("1", "1"), o("5", "2–5"), o("20", "6–20"), o("vice", "víc než 20")],
          designer: "Spočítat listy v podkladech",
        },
      ],
    },
    {
      id: "vystup",
      title: "Výstup",
      questions: [
        { id: "dwg_format", type: "single", need: null, label: "V jakém formátu?", options: [o("dwg", "DWG"), o("dxf", "DXF"), o("oba", "Oba"), o("jedno", "Je mi to jedno")] },
        {
          id: "dwg_verze", type: "single", unknown: true, need: null, label: "Verze AutoCADu",
          when: (a) => a.dwg_format === "dwg" || a.dwg_format === "oba",
          options: [o("2018", "2018 a novější"), o("2013", "2013"), o("2010", "2010"), o("2007", "2007")],
        },
        {
          id: "zachovat", type: "multi", need: null, label: "Co má výkres zachovat? (nepovinné)",
          options: [o("vrstvy", "Vrstvy"), o("texty", "Texty"), o("koty", "Kóty"), o("meritko", "Měřítko 1:1"), o("razitko", "Razítko")],
        },
        {
          id: "zname_meritko", type: "single", unknown: true, need: null, label: "Je na výkresu kóta nebo známý rozměr?",
          help: "Podle něj ověřím měřítko.",
          when: (a) => has(a, "dwg_ukol", "sken") || has(a, "dwg_ukol", "pdf"),
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
          id: "ind_obor", type: "multi", need: null, label: "Čeho se to týká?",
          options: [o("fve", "Fotovoltaika"), o("lps", "Hromosvod"), o("elektro", "Elektro"), o("cad", "Výkresy, CAD"), o("jine", "Jiné")],
        },
        { id: "ind_popis", type: "textarea", need: "submit", label: "Co potřebujete?", placeholder: "Pár vět stačí." },
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
      id: "role", type: "single", need: null, label: "Jste",
      options: [o("investor", "Majitel"), o("montaz", "Montážní firma"), o("projekce", "Projektant"), o("jine", "Jiné")],
    },
    { id: "firma", type: "text", need: null, label: "Firma", when: (a) => isRole(a, "montaz", "projekce", "jine"), autocomplete: "organization" },
    { id: "ico", type: "text", need: null, label: "IČO (nepovinné)", when: (a) => isRole(a, "montaz", "projekce", "jine"), placeholder: "8 číslic" },
    {
      id: "vzor", type: "single", need: null, label: "Podle jakého vzoru?",
      when: (a) => isRole(a, "montaz", "projekce"),
      options: [o("univerzalni", "Vaše standardní"), o("drive", "Jako minule"), o("vlastni", "Náš firemní – přiložím")],
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

  // obvod budovy z katastru (pro nacenění LPS) – jen odhad
  if ((service === "fve" || service === "lps") && site?.building?.perimeter)
    auto.push({ key: "perimeter", label: "Obvod budovy (z obrysu)", value: `${fmt1(site.building.perimeter)} m`, source: "obrys budovy v katastrální mapě", quality: "odhad" });

  // pravidla podle služby – technické údaje se berou z dokumentů, na co se dá, se neptáme
  if (service === "fve") {
    const r = a.fve_rozsah;
    const parts = Array.isArray(a.fve_casti) ? a.fve_casti : [];
    const newWork = r === "nova" || r === "rozsireni";
    const needsRoof = newWork || parts.includes("vykresy") || parts.includes("stringy");
    const needsElectro = newWork || ["jps", "rozvadece", "distributor"].some((x) => parts.includes(x));
    const needsGrid = newWork || parts.includes("distributor") || parts.includes("jps");

    if (needsRoof && !filesIn(files, "vykresy", "foto")) miss("foto", "Fotky střechy a domu (nebo výkresy)", "process");
    if (needsElectro && !filesIn(files, "foto_er")) miss("foto_er", "Fotka elektroměrového rozvaděče s hlavním jističem", "process");
    if (["rozsireni", "uprava", "dsps"].includes(r) && !filesIn(files, "stavajici"))
      miss("stavajici", r === "dsps" ? "Projekt, podle kterého se stavělo, a změny při montáži" : "Stávající dokumentace FVE", "process");

    if (a.komponenty_stav === "mam" && !filesIn(files, "nabidka")) miss("komponenty", "Nabídka nebo seznam komponent (panely, střídač, baterie)", "process");
    if (a.komponenty_stav === "navrh") {
      des("komponenty", "Navrhnout panely, střídač a počet panelů (určuje projektant)");
      if (!filesIn(files, "faktura")) miss("spotreba", "Roční spotřeba elektřiny (stačí vyúčtování)", "later");
    }
    if (!a.fve_vykon || isUnknown(a.fve_vykon)) des("vykon", "Výkon FVE neznám – určit z nabídky nebo návrhu");

    if (needsGrid) {
      if (a.zadost === "sop" && !filesIn(files, "pripojeni")) miss("sop", "Smlouva o připojení", "process");
      else if (a.zadost === "podana" && !filesIn(files, "pripojeni")) miss("sop", "Smlouva o připojení, až ji dostanete (nebo podaná žádost)", "later");
      else if (a.zadost !== "sop" && !filesIn(files, "pripojeni", "faktura")) miss("faktura", "Vyúčtování elektřiny (distributor, EAN, hlavní jistič)", "later");
      if (a.zadost === "ne" || isUnknown(a.zadost) || !a.zadost) des("zadost", "Připravit podklady k žádosti o připojení (případně ji podat za klienta)");
      if (a.zadost !== "sop" && (!a.pretoky || isUnknown(a.pretoky))) des("pretoky", "Přetoky do sítě – domluvit s klientem");
      if (filesIn(files, "pripojeni")) des("sop_tpp", "Projít smlouvu o připojení: Pinst/Prez, místo připojení a požadavky TPP vs. střídač");
    }

    if (a.montaz === "plocha") des("statika", "Ověřit únosnost ploché střechy (zátěžová konstrukce) – případně statický posudek");
    else if (a.montaz && a.montaz !== "zem" && !isUnknown(a.montaz) && ["firma", "verejna", "bd", "zemedelska"].includes(a.objekt_typ))
      des("statika", "Ověřit, zda investor potřebuje statické posouzení střechy");
    if (a.hromosvod === "ano" && !has(a, "doplnky", "lps")) des("lps_kolize", "Ověřit polohu panelů v ochranném prostoru a dostatečné vzdálenosti s");
    if (["firma", "verejna", "bd"].includes(a.objekt_typ) && !has(a, "doplnky", "pbr")) des("pbr", "Komerční / veřejná budova – ověřit požadavky PBŘ (STOP tlačítko, trasy kabelů)");

    const extra = { lps: "Zahrnout do nabídky návrh hromosvodu", analyza: "Zahrnout do nabídky analýzu rizika", statika: "Zajistit statický posudek (subdodávka)", pbr: "Zajistit PBŘ (subdodávka)", wallbox: "Zahrnout nabíječku elektromobilu" };
    for (const [k, label] of Object.entries(extra)) if (has(a, "doplnky", k)) manual.push(label);
    if (a.objekt_typ === "jine") manual.push("Neobvyklý typ objektu");
  }

  if (service === "lps") {
    if (!filesIn(files, "vykresy", "foto")) miss("foto", "Fotky budovy ze všech stran a střechy (nebo výkresy)", "process");
    if (!filesIn(files, "vykresy")) {
      if (site?.building?.length) des("rozmery", "Rozměry a výška jen z katastru a výškopisu – ověřit z fotek nebo na místě");
      else miss("rozmery", "Výkresy budovy, nebo její délka, šířka a výška", "process");
    }
    if ((has(a, "lps_rozsah", "rekonstrukce") || has(a, "lps_rozsah", "dsps")) && !filesIn(files, "stavajici", "revize"))
      miss("stavajici", "Stávající projekt nebo poslední revizní zpráva hromosvodu", "later");
    if ((has(a, "lps_rozsah", "fve") || a.fve_na_strese === "planovana" || a.fve_na_strese === "stavajici") && !filesIn(files, "fve_projekt"))
      miss("fve_projekt", "Projekt fotovoltaiky (rozmístění panelů)", has(a, "lps_rozsah", "fve") ? "process" : "later");
    des("trida", has(a, "lps_rozsah", "analyza") ? "Třída LPS z analýzy rizika" : "Určit třídu LPS (doporučit analýzu rizika)");
    if (has(a, "lps_rozsah", "analyza")) {
      if (!a.osoby || isUnknown(a.osoby)) miss("osoby", "Kolik lidí v budově obvykle bývá", "later");
      des("analyza_vstupy", "Analýza rizika: přípojky do objektu, okolí, hodnota budovy a vybavení – z mapy, fotek nebo dotazem");
      if (["verejna", "bd", "firma"].includes(a.objekt_typ) && !filesIn(files, "pbr")) miss("pbr", "Požárně bezpečnostní řešení (pokud existuje)", "later");
    }
    if (a.krytina_lps === "horlava") manual.push("Hořlavá krytina – zvláštní požadavky na vzdálenosti vodičů");
    if (a.fasada === "drevo") manual.push("Dřevěná fasáda – hořlavý povrch, ověřit vedení svodů");
    if (a.fasada === "zateplena") des("svody", "Zateplená fasáda – svody v izolaci nebo oddáleně");
    if (a.objekt_typ === "jine") manual.push("Neobvyklý typ objektu");
  }

  if (service === "dwg") {
    if (!filesIn(files, "zdroj")) miss("zdroj", "Výkresy k překreslení (PDF, sken, fotka nebo DWG)", "process");
    const raster = files.filter((f) => f.category === "zdroj" && f.status === "uploaded" && (f.meta?.kind === "raster" || /^(jpe?g|png|heic|heif|tiff?|bmp|webp)$/.test(extOf(f.file_name))));
    if ((has(a, "dwg_ukol", "sken") || raster.length) && a.zname_meritko !== "ano")
      manual.push("Rastrový podklad bez známého rozměru – měřítko je nutné ověřit");
    if (raster.length) des("kvalita", "Posoudit čitelnost skenů – nečitelné části překreslit ručně po domluvě");
    if (has(a, "zachovat", "vrstvy") && !filesIn(files, "sablona")) confirm.push({ key: "vrstvy", label: "Šablona hladin – vlastní od zákazníka, nebo moje?", who: "projektant" });
    if (a.dwg_pocet === "vice") manual.push("Větší sada výkresů – nacenit po prohlídce podkladů");
    const vector = files.filter((f) => f.category === "zdroj" && f.meta?.kind === "vector").length;
    if (vector) auto.push({ key: "pdf_vector", label: "Vektorové PDF", value: `${vector} soubor(ů) – geometrii lze převzít`, source: "analýza podkladů", quality: "prevzato" });
    if (raster.length) auto.push({ key: "pdf_raster", label: "Rastrové podklady", value: `${raster.length} soubor(ů) – nutné překreslení`, source: "analýza podkladů", quality: "prevzato" });
  }

  if (service === "individual") manual.push("Individuální zakázka – posoudit rozsah a cenu");

  // kontakt a vzor
  if (isFirm(a)) {
    if (a.vzor === "vlastni" && !filesIn(files, "vzor")) miss("vzor", "Firemní vzor dokumentace (razítko, titulní list, TZ)", "process");
    if (a.vzor === "drive") confirm.push({ key: "vzor", label: "Přiřadit firemní profil a vzor z dřívější spolupráce", who: "projektant" });
    // investora do razítka zákazník nevyplňuje – je ve smlouvě o připojení, jinak se doptám
    if (!filesIn(files, "pripojeni")) miss("investor", "Investor stavby do razítka (jméno a adresa)", "later");
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
  const b = site.building || {};
  const known = (v) => (isBlank(v) || isUnknown(v) ? null : v);
  const covering = { taska: "taška", plech: "plech", folie: "fólie", asfalt: "asfaltové pásy", horlava: "hořlavá krytina" }[a.krytina_lps] || null;
  // Technické parametry (panely, střídač, výkon, SoP) se doplňují z nahraných dokumentů projektantem – formulář je nezjišťuje.
  const data = {
    meta: { order_number: order.code || null, name: null, building_name: null, stage: null, date: null, revision: null },
    company: extra.company || { name: null, ico: null, address: null },
    investor: { name: a.role === "investor" ? known(a.kontakt_jmeno) : null, ico: null, address: null },
    contractor: a.role === "montaz" ? { name: known(a.firma), ico: known(a.ico), address: null, contact: known(a.kontakt_jmeno) } : { name: null, ico: null, address: null, contact: null },
    site: {
      address: { full: site.address || null, municipality: site.obec || null, region: null },
      cadastre: { area: site.ku || null, parcels: site.parcel || null },
      gps: Number.isFinite(site.lat) ? `${site.lat.toFixed(6)}N, ${site.lon.toFixed(6)}E` : null,
      climate: { snow_zone: null, wind_zone: null },
      building: {
        roof_covering: covering,
        roof_tilt_deg: null,
        floors: b.floors ?? (known(a.podlazi) ? Number(a.podlazi) : null),
        existing_pv: a.fve_rozsah === "rozsireni" ? "ANO" : order.service === "fve" ? "NE" : null,
      },
    },
    pv: order.service === "fve" ? {
      count: null,
      panel: { manufacturer: null, model: null },
      inverters: [],
      battery: a.baterie === "ne" ? null : { model: null, capacity_kwh: null, count: null },
    } : undefined,
    energy: order.service === "fve" ? { p_dc_kwp: null } : undefined,
    electrical: order.service === "fve" ? { grid: { distributor: null, export: a.pretoky === "ano" ? true : a.pretoky === "ne" ? false : null } } : undefined,
    lps: order.service === "lps" ? { class: null } : undefined,
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
