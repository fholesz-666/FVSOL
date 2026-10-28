/**
 * Rychlá analýza nahraných podkladů – bez externích služeb.
 * PDF: počet stran, formát listu, vektorový / rastrový / smíšený obsah (počty kreslicích operátorů a obrázků).
 * DWG/DXF: verze formátu. Obrázky: rozměr v pixelech a DPI, pokud je v souboru.
 * Výsledek je orientační a v administraci se tak i zobrazuje.
 */

const ACAD: Record<string, string> = {
  AC1009: "R12", AC1012: "R13", AC1014: "R14", AC1015: "2000", AC1018: "2004",
  AC1021: "2007", AC1024: "2010", AC1027: "2013", AC1032: "2018",
};

const SHEETS: [string, number, number][] = [
  ["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189],
];

export interface FileMeta {
  kind: "vector" | "raster" | "mixed" | "text" | "cad" | "image" | "document" | "archive" | "unknown";
  label: string;
  pages?: number;
  sheet?: string;
  page_mm?: [number, number];
  images?: number;
  path_ops?: number;
  text_ops?: number;
  cad_version?: string;
  width_px?: number;
  height_px?: number;
  dpi?: number | null;
  analyzed_at: string;
  note?: string;
}

const ext = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? "").toLowerCase();

export function sheetName(wmm: number, hmm: number): string {
  const [a, b] = [Math.min(wmm, hmm), Math.max(wmm, hmm)];
  for (const [n, x, y] of SHEETS) if (Math.abs(a - x) / x < 0.04 && Math.abs(b - y) / y < 0.04) return `${n} ${wmm > hmm ? "na šířku" : "na výšku"}`;
  return `nestandardní ${Math.round(wmm)} × ${Math.round(hmm)} mm`;
}

/** Tolerantní inflate: data za koncem zlib proudu (běžné v PDF) nezahodí už rozbalený obsah. */
async function inflate(data: Uint8Array, limit = 8 * 1024 * 1024): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    while (total < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
  } catch {
    if (!total) return null;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** ASCII85 (Adobe) dekodér pro proudy s /ASCII85Decode. */
export function ascii85(src: string): Uint8Array | null {
  const s = src.replace(/\s+/g, "").replace(/^<~/, "");
  const endIdx = s.indexOf("~>");
  const body = endIdx >= 0 ? s.slice(0, endIdx) : s;
  const out: number[] = [];
  let tuple: number[] = [];
  for (const ch of body) {
    if (ch === "z" && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return null;
    tuple.push(c);
    if (tuple.length === 5) {
      let v = 0;
      for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const t of tuple) v = v * 85 + t;
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

export async function analyzePdf(bytes: Uint8Array): Promise<Partial<FileMeta>> {
  const s = new TextDecoder("latin1").decode(bytes);
  // přírůstkově ukládané PDF obsahuje stránky víckrát – platí poslední /Count kořene stránek
  const counts = [...s.matchAll(/\/Type\s*\/Pages\b[^]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^]*?\/Type\s*\/Pages\b/g)]
    .map((m) => Number(m[1] ?? m[2])).filter((n) => n > 0 && n < 10000);
  const pages = counts.length ? counts[counts.length - 1] : (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const images = (s.match(/\/Subtype\s*\/Image/g) ?? []).length;
  const mb = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(s);
  let page_mm: [number, number] | undefined, sheet: string | undefined;
  if (mb) {
    const w = ((+mb[3] - +mb[1]) * 25.4) / 72, h = ((+mb[4] - +mb[2]) * 25.4) / 72;
    page_mm = [Math.round(w), Math.round(h)];
    sheet = sheetName(w, h);
  }
  let pathOps = 0, textOps = 0, budget = 12 * 1024 * 1024, streams = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && streams < 300 && budget > 0) {
    const head = s.slice(Math.max(0, m.index - 600), m.index);
    const dictStart = head.lastIndexOf("obj");
    const dict = dictStart >= 0 ? head.slice(dictStart) : head;
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType|XML)/.test(dict) || /\/Type\s*\/(XRef|ObjStm|Metadata|CMap|EmbeddedFile)/.test(dict) || /\/Length[123]\b/.test(dict) || /\/N\s+[134]\b/.test(dict)) continue;
    const start = m.index + m[0].length;
    const endTag = s.indexOf("endstream", start);
    if (endTag < 0) break;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const end = len && start + Number(len[1]) <= endTag ? start + Number(len[1]) : endTag;
    let content: string;
    if (/\/FlateDecode/.test(dict)) {
      let data = bytes.subarray(start, end);
      if (/\/ASCII85Decode/.test(dict)) {
        const dec = ascii85(s.slice(start, end));
        if (!dec) continue;
        data = dec;
      } else if (/\/Filter\s*\[[^\]]*\/[A-Z]/.test(dict) && !/\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(dict)) continue;
      const raw = await inflate(data);
      if (!raw) continue;
      budget -= raw.length;
      content = new TextDecoder("latin1").decode(raw.subarray(0, 4 * 1024 * 1024));
    } else if (!/\/Filter/.test(dict)) {
      content = s.slice(start, end);
    } else continue;
    streams++;
    pathOps += (content.match(/[\d.]\s+(?:m|l|c|v|y|re)\s/g) ?? []).length;
    textOps += (content.match(/(?:[)>]\s*Tj|\]\s*TJ|[)>]\s*['"])/g) ?? []).length;
    re.lastIndex = endTag;
  }
  const perPage = pages || 1;
  const drawing = pathOps >= 60 * perPage;
  const text = textOps >= 10 * perPage;
  let kind: FileMeta["kind"];
  if (!streams) kind = images ? "raster" : "unknown";
  else if (!drawing && !text) kind = images ? "raster" : textOps ? "text" : "unknown";
  else if (images >= 1) kind = drawing ? "mixed" : "text";
  else kind = drawing ? "vector" : "text";
  return { kind, pages, sheet, page_mm, images, path_ops: pathOps, text_ops: textOps };
}

function jpegInfo(b: Uint8Array) {
  let i = 2, dpi: number | null = null;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const mk = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (mk === 0xe0 && b[i + 4] === 0x4a && b[i + 5] === 0x46) {
      const units = b[i + 11], xd = (b[i + 12] << 8) | b[i + 13];
      if (units === 1 && xd > 1) dpi = xd;
      if (units === 2 && xd > 1) dpi = Math.round(xd * 2.54);
    }
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) {
      return { height_px: (b[i + 5] << 8) | b[i + 6], width_px: (b[i + 7] << 8) | b[i + 8], dpi };
    }
    i += 2 + len;
  }
  return { dpi };
}

function pngInfo(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { width_px?: number; height_px?: number; dpi?: number | null } = { width_px: dv.getUint32(16), height_px: dv.getUint32(20), dpi: null };
  for (let i = 8; i + 12 < b.length && i < 4096;) {
    const len = dv.getUint32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === "pHYs" && b[i + 16] === 1) out.dpi = Math.round(dv.getUint32(i + 8) * 0.0254);
    if (type === "IDAT") break;
    i += 12 + len;
  }
  return out;
}

export async function analyzeFile(name: string, bytes: Uint8Array): Promise<FileMeta> {
  const e = ext(name);
  const now = new Date().toISOString();
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  try {
    if (e === "pdf" || head.startsWith("%PDF")) {
      const r = await analyzePdf(bytes);
      const label = {
        vector: "Vektorové PDF – geometrii lze převzít, kontrola vrstev a měřítka",
        raster: "Rastrové PDF (sken) – nutné překreslení",
        mixed: "Smíšené PDF – vektor i vložené obrázky",
        text: "Textový PDF dokument",
        unknown: "PDF – obsah se nepodařilo určit",
      }[r.kind as "vector"] ?? "PDF";
      return { ...r, kind: r.kind!, label, analyzed_at: now };
    }
    if (e === "dwg" || head.startsWith("AC10")) {
      const v = head.slice(0, 6);
      return { kind: "cad", cad_version: ACAD[v] ? `${v} (AutoCAD ${ACAD[v]})` : v, label: `DWG ${ACAD[v] ? "AutoCAD " + ACAD[v] : "neznámá verze"}`, analyzed_at: now };
    }
    if (e === "dxf") {
      const t = new TextDecoder("latin1").decode(bytes.subarray(0, 20000));
      const v = /\$ACADVER\s*\r?\n\s*1\s*\r?\n(AC\d{4})/.exec(t)?.[1] ?? "";
      return { kind: "cad", cad_version: v ? `${v}${ACAD[v] ? " (AutoCAD " + ACAD[v] + ")" : ""}` : "neznámá", label: `DXF ${ACAD[v] ? "AutoCAD " + ACAD[v] : ""}`.trim(), analyzed_at: now };
    }
    if (["jpg", "jpeg"].includes(e)) {
      const r = jpegInfo(bytes);
      return { kind: "image", ...r, label: "Fotografie nebo sken (JPEG)", note: dpiNote(r), analyzed_at: now };
    }
    if (e === "png") {
      const r = pngInfo(bytes);
      return { kind: "image", ...r, label: "Obrázek (PNG)", note: dpiNote(r), analyzed_at: now };
    }
    if (["tif", "tiff", "bmp", "heic", "heif", "webp"].includes(e)) return { kind: "image", label: `Obrázek (${e.toUpperCase()})`, analyzed_at: now };
    if (["doc", "docx", "xls", "xlsx", "csv", "txt"].includes(e)) return { kind: "document", label: "Dokument", analyzed_at: now };
    if (e === "zip") return { kind: "archive", label: "Archiv ZIP – obsah zkontrolovat ručně", analyzed_at: now };
  } catch (err) {
    return { kind: "unknown", label: "Soubor se nepodařilo analyzovat", note: String(err).slice(0, 200), analyzed_at: now };
  }
  return { kind: "unknown", label: "Neznámý typ", analyzed_at: now };
}

function dpiNote(r: { width_px?: number; dpi?: number | null }) {
  if (!r.width_px) return undefined;
  if (r.width_px < 1600) return "Nízké rozlišení – drobné texty a kóty nemusí být čitelné.";
  return undefined;
}
