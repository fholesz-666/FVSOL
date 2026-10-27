/**
 * Vyplnění vzoru DOCX zástupnými značkami {{klic}}.
 * Struktura dokumentu (razítka, záhlaví, styly, obrázky) zůstává – mění se jen text v místě značky.
 * Neznámá hodnota se nevymýšlí: na místo značky se vloží „DOPLNIT – …“ a běh textu se zvýrazní žlutě,
 * stejně jako v šablonách FVSOL zůstává zvýrazněný každý nepotvrzený údaj.
 */
import JSZip from "npm:jszip@3.10.1";

export const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xmlUnesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const RPR_AFTER_HIGHLIGHT = ["<w:u ", "<w:u>", "<w:u/", "<w:effect", "<w:bdr", "<w:shd", "<w:fitText", "<w:vertAlign", "<w:rtl", "<w:cs", "<w:em ", "<w:lang", "<w:eastAsianLayout", "<w:specVanish", "<w:oMath"];

function highlightRunAt(xml: string, tIndex: number): string {
  // najdi začátek běhu <w:r> / <w:r ...> před textem
  let rs = -1;
  for (let i = tIndex; i >= 0; i--) {
    if (xml.startsWith("<w:r>", i) || xml.startsWith("<w:r ", i)) { rs = i; break; }
    if (xml.startsWith("</w:r>", i) || xml.startsWith("<w:p>", i) || xml.startsWith("<w:p ", i)) break;
  }
  if (rs < 0) return xml;
  const openEnd = xml.indexOf(">", rs) + 1;
  const rest = xml.slice(openEnd, tIndex);
  if (rest.startsWith("<w:rPr>") || rest.startsWith("<w:rPr ")) {
    const prEnd = xml.indexOf("</w:rPr>", openEnd);
    if (prEnd < 0 || prEnd > tIndex) return xml;
    let pr = xml.slice(openEnd, prEnd);
    pr = pr.replace(/<w:highlight [^>]*\/>/g, "");
    let at = pr.length;
    for (const tag of RPR_AFTER_HIGHLIGHT) {
      const k = pr.indexOf(tag);
      if (k >= 0 && k < at) at = k;
    }
    pr = pr.slice(0, at) + '<w:highlight w:val="yellow"/>' + pr.slice(at);
    return xml.slice(0, openEnd) + pr + xml.slice(prEnd);
  }
  return xml.slice(0, openEnd) + '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' + xml.slice(openEnd);
}

export interface FillResult { xml: string; used: string[]; unfilled: string[] }

export function fillXml(xml: string, values: Record<string, string | null | undefined>, labels: Record<string, string> = {}): FillResult {
  const nodes: { start: number; end: number; text: string }[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const inner = m.index + m[0].indexOf(">") + 1;
    nodes.push({ start: inner, end: inner + m[1].length, text: xmlUnesc(m[1]) });
  }
  const full = nodes.map((n) => n.text).join("");
  const offs: number[] = [];
  let acc = 0;
  for (const n of nodes) { offs.push(acc); acc += n.text.length; }
  const nodeAt = (pos: number) => {
    let lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offs[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const used: string[] = [], unfilled: string[] = [];
  const texts = nodes.map((n) => n.text);
  const highlight = new Set<number>();
  const matches = [...full.matchAll(PLACEHOLDER)];
  for (const mm of matches.reverse()) {
    const key = mm[1].toLowerCase();
    const s = mm.index!, e = s + mm[0].length;
    const ns = nodeAt(s), ne = nodeAt(e - 1);
    const v = values[key];
    const known = v != null && String(v).trim() !== "";
    const rep = known ? String(v) : `DOPLNIT – ${labels[key] ?? key}`;
    used.push(key);
    if (!known) { unfilled.push(key); highlight.add(ns); }
    const a = s - offs[ns], b = e - offs[ne];
    if (ns === ne) texts[ns] = texts[ns].slice(0, a) + rep + texts[ns].slice(b);
    else {
      texts[ns] = texts[ns].slice(0, a) + rep;
      for (let k = ns + 1; k < ne; k++) texts[k] = "";
      texts[ne] = texts[ne].slice(b);
    }
  }
  let out = xml;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (texts[i] === nodes[i].text) continue;
    out = out.slice(0, nodes[i].start) + xmlEsc(texts[i]) + out.slice(nodes[i].end);
    // zachovat mezery na okrajích
    const tagStart = out.lastIndexOf("<w:t", nodes[i].start);
    const tagHead = out.slice(tagStart, nodes[i].start);
    if (!/xml:space=/.test(tagHead) && /^\s|\s$/.test(texts[i])) {
      out = out.slice(0, tagStart) + tagHead.replace(/^<w:t/, '<w:t xml:space="preserve"') + out.slice(nodes[i].start);
    }
  }
  if (highlight.size) {
    // indexy se posunuly – zvýraznění dohledáme podle textu DOPLNIT
    const pos: number[] = [];
    const r2 = /<w:t(?:\s[^>]*)?>[^<]*DOPLNIT – /g;
    let k: RegExpExecArray | null;
    while ((k = r2.exec(out))) pos.push(k.index);
    for (const p of pos.reverse()) out = highlightRunAt(out, p);
  }
  return { xml: out, used: [...new Set(used)].reverse(), unfilled: [...new Set(unfilled)].reverse() };
}

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export async function listPlaceholders(docx: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(docx);
  const keys = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!PARTS.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => xmlUnesc(x[1])).join("");
    for (const m of text.matchAll(PLACEHOLDER)) keys.add(m[1].toLowerCase());
  }
  return [...keys];
}

export async function fillDocx(docx: Uint8Array, values: Record<string, string | null | undefined>, labels: Record<string, string> = {}) {
  const zip = await JSZip.loadAsync(docx);
  const used = new Set<string>(), unfilled = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!PARTS.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (!xml.includes("{{") && !/\{[^<]*<\/w:t>[\s\S]{0,400}?<w:t[^>]*>\{/.test(xml)) {
      // rychlá cesta: značka může být rozdělená do více běhů, proto kontrolujeme i spojený text
      const joined = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]).join("");
      if (!joined.includes("{{")) continue;
    }
    const r = fillXml(xml, values, labels);
    r.used.forEach((k) => used.add(k));
    r.unfilled.forEach((k) => unfilled.add(k));
    zip.file(name, r.xml);
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: out, used: [...used], unfilled: [...unfilled] };
}
