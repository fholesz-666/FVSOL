/**
 * Zápis DXF R12 (AC1009) – nejširší kompatibilita (AutoCAD, BricsCAD, ProgeCAD, LibreCAD).
 * Skutečná geometrie (POLYLINE/VERTEX, TEXT), žádné vložené obrázky.
 * Texty s diakritikou se kódují jako \U+XXXX, což AutoCAD čte bez ohledu na kódovou stránku.
 */
import type { Feature } from "./cuzk.ts";

export interface Layer { name: string; color: number }

export function dxfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 128 ? ch : `\\U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out.replace(/[\r\n]+/g, " ");
}

export class DxfWriter {
  private ents: string[] = [];
  private layers = new Map<string, number>();
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

  layer(name: string, color: number) {
    this.layers.set(name, color);
    return this;
  }

  private ext(x: number, y: number) {
    this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y);
  }

  polyline(layer: string, pts: number[][], closed = true) {
    if (pts.length < 2) return;
    const p = closed && pts.length > 2 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1] ? pts.slice(0, -1) : pts;
    const out = ["0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0", "10", "0.0", "20", "0.0", "30", "0.0"];
    for (const [x, y] of p) {
      this.ext(x, y);
      out.push("0", "VERTEX", "8", layer, "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0");
    }
    out.push("0", "SEQEND", "8", layer);
    this.ents.push(out.join("\n"));
  }

  text(layer: string, x: number, y: number, h: number, s: string, align: "left" | "center" = "left") {
    this.ext(x, y);
    const out = ["0", "TEXT", "8", layer, "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0", "40", h.toFixed(3), "1", dxfText(s)];
    if (align === "center") out.push("72", "1", "11", x.toFixed(3), "21", y.toFixed(3), "31", "0.0");
    this.ents.push(out.join("\n"));
  }

  toString(): string {
    const hasExt = Number.isFinite(this.minX);
    const header = [
      "0", "SECTION", "2", "HEADER",
      "9", "$ACADVER", "1", "AC1009",
      "9", "$INSUNITS", "70", "6",
      "9", "$DWGCODEPAGE", "3", "ANSI_1250",
      "9", "$EXTMIN", "10", (hasExt ? this.minX : 0).toFixed(3), "20", (hasExt ? this.minY : 0).toFixed(3), "30", "0.0",
      "9", "$EXTMAX", "10", (hasExt ? this.maxX : 0).toFixed(3), "20", (hasExt ? this.maxY : 0).toFixed(3), "30", "0.0",
      "0", "ENDSEC",
    ];
    const ltype = ["0", "TABLE", "2", "LTYPE", "70", "1", "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0", "0", "ENDTAB"];
    const layers = ["0", "TABLE", "2", "LAYER", "70", String(this.layers.size + 1),
      "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS"];
    for (const [n, c] of this.layers) layers.push("0", "LAYER", "2", n, "70", "0", "62", String(c), "6", "CONTINUOUS");
    layers.push("0", "ENDTAB");
    return [
      ...header,
      "0", "SECTION", "2", "TABLES", ...ltype, ...layers, "0", "ENDSEC",
      "0", "SECTION", "2", "ENTITIES", ...this.ents, "0", "ENDSEC",
      "0", "EOF", "",
    ].join("\n").replace(/\n/g, "\r\n");
  }
}

/** S-JTSK (EPSG:5514) v ČR: X ∈ ⟨−905 000; −430 000⟩, Y ∈ ⟨−1 230 000; −930 000⟩. */
export function looksLikeSJTSK(x: number, y: number) {
  return x < -400_000 && x > -950_000 && y < -900_000 && y > -1_260_000;
}

function centroid(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

export interface SituaceInput {
  parcels: Feature[];
  buildings: Feature[];
  selectedBuildingId?: string | null;
  title: string;
  lines: string[];
}

/** Situační podklad z katastru: parcely, budovy, vybraný objekt, čísla parcel a poznámka o původu dat. */
export function situaceDxf(inp: SituaceInput): { dxf: string; stats: Record<string, number> } {
  const w = new DxfWriter()
    .layer("KN_PARCELY", 3)
    .layer("KN_CISLA_PARCEL", 3)
    .layer("KN_BUDOVY", 8)
    .layer("OBJEKT", 1)
    .layer("INFO", 7);
  let p = 0, b = 0, checked = false;
  const check = (pt: number[]) => {
    if (checked) return;
    checked = true;
    if (!looksLikeSJTSK(pt[0], pt[1])) throw new Error("Služba ČÚZK nevrátila souřadnice v S-JTSK (EPSG:5514).");
  };
  for (const f of inp.parcels) {
    for (const ring of f.geometry?.rings ?? []) {
      check(ring[0]);
      w.polyline("KN_PARCELY", ring);
    }
    const r = f.geometry?.rings?.[0];
    if (r && f.attributes.cisloparcely != null) {
      const [cx, cy] = centroid(r);
      const st = Number(f.attributes.druhcislovanikod) === 1 ? "st. " : "";
      w.text("KN_CISLA_PARCEL", cx, cy, 1.2, `${st}${f.attributes.cisloparcely}`, "center");
    }
    p++;
  }
  for (const f of inp.buildings) {
    const sel = inp.selectedBuildingId && String(f.attributes.objectid) === String(inp.selectedBuildingId);
    for (const ring of f.geometry?.rings ?? []) {
      check(ring[0]);
      w.polyline(sel ? "OBJEKT" : "KN_BUDOVY", ring);
    }
    b++;
  }
  if (!Number.isFinite(w.minX)) throw new Error("V okolí nebyla nalezena žádná geometrie katastru.");
  const x0 = w.minX, y0 = w.minY - 6;
  w.text("INFO", x0, y0, 2.0, inp.title);
  inp.lines.forEach((l, i) => w.text("INFO", x0, y0 - 3 * (i + 1), 1.2, l));
  return { dxf: w.toString(), stats: { parcels: p, buildings: b } };
}
