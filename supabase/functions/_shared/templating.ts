// Hodnoty pro vzory DOCX ({{klic}}). Jen údaje, které v zakázce opravdu jsou – nic se nedopočítává.
import * as core from "./core.js";
import { fmtDateCz } from "./util.ts";

export const TEMPLATE_KEYS: Record<string, string> = {
  "zakazka.cislo": "číslo zakázky",
  "zakazka.sluzba": "služba",
  "zakazka.datum": "datum",
  "investor.nazev": "investor",
  "zhotovitel.nazev": "zhotovitel (firma zákazníka)",
  "zhotovitel.ico": "IČO zhotovitele",
  "kontakt.jmeno": "kontaktní osoba",
  "kontakt.email": "e-mail",
  "kontakt.telefon": "telefon",
  "misto.adresa": "adresa stavby",
  "misto.parcela": "parcela",
  "misto.ku": "katastrální území",
  "misto.gps": "GPS",
  "objekt.typ": "typ objektu",
  "objekt.rozmery": "rozměry objektu",
  "fve.vykon_kwp": "výkon FVE",
  "fve.panely": "typ panelů",
  "fve.pocet_panelu": "počet panelů",
  "fve.stridac": "střídač",
  "fve.baterie_kwh": "kapacita baterie",
  "fve.distributor": "distributor",
  "fve.jistic_a": "hlavní jistič",
  "lps.trida": "třída LPS",
  "firma.nazev": "zpracovatel – firma",
  "firma.ico": "zpracovatel – IČO",
  "firma.adresa": "zpracovatel – adresa",
  "projektant.jmeno": "projektant",
};

const known = (v: unknown) => (v == null || v === "" || v === core.UNKNOWN ? null : String(v));

export function templateValues(order: any, profile: any | null, designer = "Filip Holesz") {
  const a = order.answers ?? {};
  const s = a.site ?? {};
  const q = (id: string) => core.allQuestions(order.service).find((x: any) => x.id === id);
  const fmt = (id: string) => (q(id) && known(a[id]) ? core.formatValue(q(id), a[id]) : null);
  const dims = ["delka_m", "sirka_m", "vyska_m"].map((k) => core.parseNumber(a[k]));
  return {
    "zakazka.cislo": order.code ?? null,
    "zakazka.sluzba": core.SERVICES[order.service as keyof typeof core.SERVICES]?.title ?? null,
    "zakazka.datum": fmtDateCz(),
    "investor.nazev": known(a.investor_nazev) ?? (a.role === "investor" ? known(a.kontakt_jmeno) : null),
    "zhotovitel.nazev": a.role === "montaz" ? known(a.firma) : null,
    "zhotovitel.ico": a.role === "montaz" ? known(a.ico) : null,
    "kontakt.jmeno": known(a.kontakt_jmeno),
    "kontakt.email": known(a.kontakt_email),
    "kontakt.telefon": known(a.kontakt_telefon),
    "misto.adresa": known(s.address) ?? known(s.query),
    "misto.parcela": known(s.parcel) ?? known(s.parcel_manual),
    "misto.ku": known(s.ku),
    "misto.gps": Number.isFinite(s.lat) ? `${Number(s.lat).toFixed(6)} N, ${Number(s.lon).toFixed(6)} E` : null,
    "objekt.typ": fmt("objekt_typ"),
    "objekt.rozmery": dims.every((d) => d != null) ? `${dims[0]} × ${dims[1]} m, výška ${dims[2]} m` : null,
    "fve.vykon_kwp": fmt("vykon_kwp"),
    "fve.panely": known(a.panely_typ),
    "fve.pocet_panelu": fmt("panely_pocet"),
    "fve.stridac": known(a.stridac),
    "fve.baterie_kwh": a.baterie === "ano" ? fmt("baterie_kwh") : a.baterie === "ne" ? "bez baterie" : null,
    "fve.distributor": fmt("distributor"),
    "fve.jistic_a": fmt("jistic_a"),
    "lps.trida": ["I", "II", "III", "IV"].includes(a.trida_lps) ? `LPS ${a.trida_lps}` : null,
    "firma.nazev": profile?.name ?? null,
    "firma.ico": profile?.ico ?? null,
    "firma.adresa": profile?.address ?? null,
    "projektant.jmeno": designer,
  } as Record<string, string | null>;
}
