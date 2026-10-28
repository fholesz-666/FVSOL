import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../assets/zakazky/core.js";

const up = (category, extra = {}) => ({ category, status: "uploaded", direction: "in", file_name: "a.pdf", size: 1000, ...extra });
const contact = { kontakt_jmeno: "Jan Novák", kontakt_email: "jan@example.cz", souhlas: true };
const siteRuian = {
  source: "ruian", lat: 50.72, lon: 15.17, address: "Polní 3677/10, 46601 Jablonec nad Nisou",
  parcel: "st. 4940/1", ku: "Jablonec nad Nisou (655970)", obec: "Jablonec nad Nisou",
  building: { id: "1", use: "objekt občanské vybavenosti", floors: 2, area: 512.3, perimeter: 96.2, length: 32.1, width: 16.0, height_est: 8.4 },
};

test("každá služba má kroky a otázky s unikátními id", () => {
  for (const s of Object.keys(C.SERVICES)) {
    const ids = C.allQuestions(s).map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, `duplicitní id ve službě ${s}`);
    assert.ok(C.stepsFor(s).length >= 4);
    for (const q of C.allQuestions(s)) {
      if (["single", "multi"].includes(q.type)) assert.ok(q.options?.length, `${s}.${q.id} nemá možnosti`);
    }
  }
});

test("formulář je krátký a na kliknutí", () => {
  for (const s of ["fve", "lps", "dwg"]) {
    for (const step of C.STEPS[s]) {
      assert.ok(step.questions.length <= 6, `${s}/${step.id}: víc než 6 otázek`);
      for (const q of step.questions) assert.ok(["single", "multi", "site", "date"].includes(q.type), `${s}.${q.id}: ${q.type} – jen otázky na kliknutí`);
    }
    const required = C.allQuestions(s).filter((q) => q.need === "submit" && !q.when);
    assert.ok(required.length <= 6, `${s}: povinných otázek ${required.length}`);
  }
  // s nabídkou a smlouvou o připojení zbývají v technice jen tři otázky
  const vis = C.visibleQuestions(C.STEPS.fve[2], { komponenty_stav: "mam", zadost: "sop" }).map((q) => q.id);
  assert.deepEqual(vis, ["komponenty_stav", "zadost", "doplnky"]);
});

test("nabízené podklady se řídí odpověďmi", () => {
  const a = C.fileCategoriesFor("fve", { komponenty_stav: "navrh", zadost: "ne", fve_rozsah: "nova" });
  assert.ok(!a.includes("nabidka") && !a.includes("pripojeni") && a.includes("faktura") && a.includes("foto_er"));
  assert.ok(!a.includes("stavajici"));
  const b = C.fileCategoriesFor("fve", { komponenty_stav: "mam", zadost: "sop", fve_rozsah: "rozsireni" });
  assert.ok(b.includes("nabidka") && b.includes("pripojeni") && !b.includes("faktura") && b.includes("stavajici"));
  assert.ok(C.allowedFileCategories("fve").includes("pripojeni"), "server přijme i druh skrytý podle odpovědí");
  assert.ok(C.checkFile("strecha.MOV", 1000) === null, "krátké video jde nahrát");
});

test("FVE: prázdné zadání nejde odeslat", () => {
  const ev = C.evaluate({ service: "fve", answers: {}, files: [] });
  assert.equal(ev.canSubmit, false);
  const keys = ev.missing.filter((m) => m.level === "submit").map((m) => m.key);
  for (const k of ["fve_rozsah", "site", "komponenty_stav", "kontakt_jmeno", "kontakt_email"]) assert.ok(keys.includes(k), k);
});

test("FVE: minimální zadání jde odeslat, ale čeká na podklady", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "nova", site: { query: "Jablonec nad Nisou, p. č. 123" }, komponenty_stav: "navrh", ...contact },
    files: [],
  });
  assert.equal(ev.canSubmit, true);
  assert.equal(ev.readyForProcessing, false);
  assert.equal(ev.suggestedStatus, "ceka_na_podklady");
  assert.ok(ev.missing.some((m) => m.key === "foto" && m.level === "process"));
  assert.ok(ev.missing.some((m) => m.key === "foto_er" && m.level === "process"));
  assert.ok(ev.missing.some((m) => m.key === "objekt_typ" && m.level === "process"));
  assert.ok(ev.missing.some((m) => m.key === "spotreba" && m.level === "later"));
  assert.ok(ev.designer.some((d) => d.key === "komponenty"));
  assert.ok(ev.confirm.some((c) => c.key === "site" && c.who === "projektant"), "ručně zadané místo musí projektant ověřit");
});

test("FVE: kompletní zadání s nabídkou je připravené k ověření a převzaté údaje čekají na potvrzení", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: {
      fve_rozsah: "nova", fve_vykon: "50-100", site: { ...siteRuian, building_confirmed: true }, objekt_typ: "verejna", montaz: "plocha",
      hromosvod: "ano", komponenty_stav: "mam", pretoky: "ano", zadost: "ne",
      ...contact,
    },
    files: [up("vykresy"), up("foto"), up("foto_er"), up("nabidka")],
  });
  assert.equal(ev.canSubmit, true);
  assert.equal(ev.readyForProcessing, true);
  assert.equal(ev.suggestedStatus, "podklady_k_overeni");
  assert.ok(ev.auto.find((x) => x.key === "height" && x.quality === "odhad"), "výška je jen odhad");
  assert.ok(ev.auto.find((x) => x.key === "parcel" && x.quality === "prevzato"));
  assert.ok(ev.confirm.some((c) => c.key === "dims" && c.who === "projektant"));
  assert.ok(!ev.confirm.some((c) => c.key === "building"), "budova potvrzená zákazníkem");
  assert.ok(ev.designer.some((d) => d.key === "statika"));
  assert.ok(ev.designer.some((d) => d.key === "lps_kolize"));
  assert.ok(ev.missing.some((m) => m.key === "faktura" && m.level === "later"));
  assert.ok(ev.designer.some((d) => d.key === "zadost"), "podklady k žádosti o připojení");
  assert.ok(ev.auto.some((x) => x.key === "perimeter" && x.quality === "odhad"));
});

test("FVE: se smlouvou o připojení se na distribuci neptám, jen ji projdu", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "nova", site: siteRuian, objekt_typ: "rd", komponenty_stav: "mam", zadost: "sop", ...contact },
    files: [up("foto"), up("foto_er"), up("nabidka"), up("pripojeni")],
  });
  assert.equal(ev.readyForProcessing, true);
  assert.ok(!ev.missing.some((m) => m.key === "faktura" || m.key === "sop"));
  assert.ok(ev.designer.some((d) => d.key === "sop_tpp"));
  const bez = C.evaluate({ service: "fve", answers: { fve_rozsah: "nova", site: siteRuian, objekt_typ: "rd", komponenty_stav: "mam", zadost: "sop", ...contact }, files: [up("foto"), up("foto_er"), up("nabidka")] });
  assert.ok(bez.missing.some((m) => m.key === "sop" && m.level === "process"));
});

test("FVE: doplňkové služby jdou do nabídky, úprava dokumentace nechce fotky rozvaděče", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "uprava", site: siteRuian, objekt_typ: "rd", komponenty_stav: "mam", doplnky: ["lps", "statika"], ...contact },
    files: [up("stavajici"), up("nabidka")],
  });
  assert.ok(!ev.missing.some((m) => m.key === "foto_er" || m.key === "foto"));
  assert.ok(ev.manual.some((x) => x.includes("hromosvod")));
  assert.ok(ev.manual.some((x) => x.includes("statick")));
});

test("FVE: „Nevím“ jde na projektanta, nic se neodhaduje", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "nova", fve_vykon: "?", montaz: "?", hromosvod: "?", site: siteRuian, objekt_typ: "rd", komponenty_stav: "navrh", ...contact },
    files: [up("foto")],
  });
  assert.ok(ev.unknown.some((u) => u.key === "fve_vykon"));
  assert.ok(ev.designer.some((d) => d.key === "vykon"));
  assert.ok(ev.designer.some((d) => d.key === "montaz"));
  assert.ok(ev.designer.some((d) => d.key === "hromosvod"));
  assert.ok(ev.confirm.some((c) => c.key === "building" && c.who === "zakaznik"));
});

test("FVE: rozšíření bez stávající dokumentace blokuje zpracování", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "rozsireni", site: siteRuian, objekt_typ: "firma", komponenty_stav: "navrh", ...contact },
    files: [up("vykresy")],
  });
  assert.ok(ev.missing.some((m) => m.key === "stavajici" && m.level === "process"));
  assert.equal(ev.suggestedStatus, "ceka_na_podklady");
});

test("FVE: nahrávaný soubor brání odeslání", () => {
  const ev = C.evaluate({
    service: "fve",
    answers: { fve_rozsah: "nova", site: siteRuian, komponenty_stav: "navrh", ...contact },
    files: [{ category: "foto", status: "pending", direction: "in", file_name: "x.jpg" }],
  });
  assert.equal(ev.canSubmit, false);
});

test("LPS: rozměry se nevyplňují – z výkresů, nebo z mapy k ověření", () => {
  const base = { lps_rozsah: ["novy"], objekt_typ: "rd", fve_na_strese: "ne", ...contact };
  const a = C.evaluate({ service: "lps", answers: { ...base, site: { query: "Rychnov, p. č. 12" } }, files: [up("foto")] });
  assert.ok(a.missing.some((m) => m.key === "rozmery" && m.level === "process"), "bez výkresů i bez obrysu chybí");
  const b = C.evaluate({ service: "lps", answers: { ...base, site: siteRuian }, files: [up("foto")] });
  assert.ok(!b.missing.some((m) => m.key === "rozmery"));
  assert.ok(b.designer.some((d) => d.key === "rozmery"), "rozměry z mapy jen k ověření");
  assert.ok(b.designer.some((d) => d.key === "trida"), "třídu LPS určuje projektant");
  assert.equal(b.readyForProcessing, true);
  const c = C.evaluate({ service: "lps", answers: { ...base, site: siteRuian }, files: [up("vykresy")] });
  assert.ok(!c.designer.some((d) => d.key === "rozmery"));
});

test("LPS: úprava kvůli FVE vyžaduje projekt FVE, hořlavá krytina jde na ruční posouzení", () => {
  const ev = C.evaluate({
    service: "lps",
    answers: { lps_rozsah: ["fve", "analyza"], site: siteRuian, objekt_typ: "verejna", fve_na_strese: "planovana", krytina_lps: "horlava", ...contact },
    files: [up("vykresy")],
  });
  assert.ok(ev.missing.some((m) => m.key === "fve_projekt" && m.level === "process"));
  assert.ok(ev.missing.some((m) => m.key === "pbr" && m.level === "later"));
  assert.ok(ev.missing.some((m) => m.key === "osoby" && m.level === "later"));
  assert.ok(ev.designer.some((d) => d.key === "analyza_vstupy"));
  assert.ok(ev.manual.length > 0);
});

test("DWG: bez podkladů nelze zpracovat, sken bez měřítka jde na ruční posouzení", () => {
  const ans = { dwg_ukol: ["sken"], dwg_druh: ["pudorysy"], ...contact };
  const a = C.evaluate({ service: "dwg", answers: ans, files: [] });
  assert.equal(a.canSubmit, true);
  assert.ok(a.missing.some((m) => m.key === "zdroj" && m.level === "process"));
  const b = C.evaluate({ service: "dwg", answers: ans, files: [up("zdroj", { file_name: "sken.jpg" })] });
  assert.equal(b.readyForProcessing, true);
  assert.equal(b.suggestedStatus, "rucni_posouzeni");
  const c = C.evaluate({ service: "dwg", answers: { dwg_ukol: ["pdf"], dwg_druh: ["schemata"], zname_meritko: "ano", ...contact }, files: [up("zdroj", { meta: { kind: "vector" } })] });
  assert.equal(c.suggestedStatus, "podklady_k_overeni");
  assert.ok(c.auto.some((x) => x.key === "pdf_vector"));
});

test("Individuální zakázka vyžaduje popis a ruční posouzení", () => {
  const a = C.evaluate({ service: "individual", answers: { ...contact }, files: [] });
  assert.equal(a.canSubmit, false);
  const b = C.evaluate({ service: "individual", answers: { ind_popis: "Revize výkresů rozvaděče", ...contact }, files: [] });
  assert.equal(b.canSubmit, true);
  assert.equal(b.suggestedStatus, "rucni_posouzeni");
});

test("Firemní vzor: montážní firma s vlastním vzorem ho musí dodat", () => {
  const ev = C.evaluate({
    service: "individual",
    answers: { ind_popis: "x", role: "montaz", firma: "Solar s.r.o.", vzor: "vlastni", ...contact },
    files: [],
  });
  assert.ok(ev.missing.some((m) => m.key === "vzor" && m.level === "process"));
  assert.ok(C.fileCategoriesFor("fve", { role: "montaz", vzor: "vlastni" }).includes("vzor"));
  assert.ok(!C.fileCategoriesFor("fve", { role: "investor" }).includes("vzor"));
});

test("validace kroku: e-mail, IČO, telefon, souhlas, Nevím", () => {
  const e = C.validateStep(C.CONTACT_STEP, { kontakt_jmeno: "A", kontakt_email: "spatne", kontakt_telefon: "12", role: "montaz", ico: "12345678" });
  assert.ok(e.kontakt_email);
  assert.ok(e.kontakt_telefon);
  assert.ok(e.ico);
  assert.ok(e.souhlas);
  assert.equal(C.validIco("27082440"), true);
  const step = C.STEPS.fve[2];
  assert.ok(C.validateStep(step, {}).komponenty_stav);
  assert.deepEqual(C.validateStep(step, { komponenty_stav: "mam", zadost: "?" }), {});
  assert.deepEqual(C.validateStep(C.STEPS.fve[0], { fve_rozsah: "nova", fve_vykon: "?" }), {});
});

test("kontrola souborů", () => {
  assert.equal(C.checkFile("vykres.PDF", 1000), null);
  assert.match(C.checkFile("virus.exe", 1000), /nelze nahrát/);
  assert.match(C.checkFile("big.pdf", 60 * 1024 * 1024), /50 MB/);
  const many = Array.from({ length: 40 }, () => ({ status: "uploaded", size: 1 }));
  assert.match(C.checkFile("a.pdf", 10, many), /nejvýše/);
  assert.match(C.checkFile("a.pdf", 10 * 1024 * 1024, [{ status: "uploaded", size: 145 * 1024 * 1024 }]), /150 MB/);
});

test("CRM: úkoly podle postupu a chybějících podkladů, událost v kalendáři", () => {
  const order = { id: "o1", code: "Z26-0001", service: "fve", answers: { fve_rozsah: "nova", site: siteRuian, komponenty_stav: "navrh", ...contact } };
  const ev = C.evaluate({ ...order, files: [] });
  const job = C.toCrmJob(order, ev, { adminUrl: "https://fvsol.cz/admin/#o1", now: new Date("2026-10-30T10:00:00Z") });
  assert.equal(job.type, "FVE");
  assert.equal(job.status, "Poptávka");
  assert.equal(job.tasks.length >= C.WORKFLOW.length, true);
  assert.equal(job.tasks[0].due, "2026-11-02", "pátek → pondělí");
  assert.ok(job.tasks.some((t) => t.text.startsWith("Doplnit od klienta")));
  assert.equal(job.events[0].date, "2026-11-02");
  assert.ok(job.mapUrl.includes("15.17"));
  const wf = { kontrola_zadani: { done: true }, nabidka: { done: true }, potvrzeni: { done: true } };
  const upd = C.applyWorkflowToCrm(job, order.code, wf);
  assert.equal(upd.status, "Objednáno");
  assert.equal(upd.tasks.find((t) => t.key === "nabidka").done, true);
  assert.equal(upd.tasks.find((t) => t.key === "zpracovani").done, false);
  assert.ok(upd.tasks.find((t) => t.key === "zpracovani").due, "další krok dostane termín");
  assert.equal(job.tasks.find((t) => t.key === "nabidka").done, false, "původní data se nemění");
});

test("data pro TZ: neznámé hodnoty zůstávají null", () => {
  const pd = C.toProjectData({ code: "Z26-0002", service: "fve", answers: { site: siteRuian, fve_vykon: "do10", pretoky: "?" } });
  assert.equal(pd.pv.count, null);
  assert.equal(pd.energy.p_dc_kwp, null, "rozsah výkonu z formuláře není výkon");
  assert.equal(pd.electrical.grid.distributor, null);
  assert.equal(pd.electrical.grid.export, null);
  assert.equal(pd.site.building.floors, 2);
  assert.equal(pd.site.cadastre.parcels, "st. 4940/1");
  assert.ok(pd._unknown.includes("pv.count"));
  assert.ok(pd._unknown.includes("site.climate.snow_zone"));
});

test("stav pro zákazníka nikdy netvrdí dokončení bez předaného výstupu", () => {
  assert.notEqual(C.customerStatus({ phase: "order", status: "dokoncena" }).tone, "done");
  assert.equal(C.customerStatus({ phase: "order", status: "dokoncena", hasReleasedOutput: true }).tone, "done");
  assert.equal(C.customerStatus({ phase: "inquiry", status: "ceka_na_podklady" }).tone, "progress", "automatický stav není výzva");
  assert.equal(C.customerStatus({ phase: "inquiry", status: "ceka_na_podklady", hasOpenRequest: true }).tone, "action");
});
