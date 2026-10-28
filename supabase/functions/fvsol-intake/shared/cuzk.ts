/**
 * Veřejné služby ČÚZK (ArcGIS REST), bez klíče, data CC BY 4.0 © ČÚZK.
 * Endpointy převzaty z aplikace ARONLINE, kde byly ověřeny 20. 10. 2026:
 *  RUIAN MapServer: 1 AdresniMisto, 3 StavebniObjekt (polygony), 5 Parcela, 7 KatastralniUzemi
 *  GeocodeSOE: suggest, find, tables/1/reverseGeocode
 *  Výškopis: 3D/dmr5g (terén), 3D/dmp (povrch) – jen operace identify
 * Každý údaj nese zdroj; co se nepodaří zjistit, zůstane prázdné – nic se nedomýšlí.
 */
import { admin, sha256hex } from "./util.ts";
import {
  exteriorSamples, interiorSamples, localFrame, median, minAreaRect, pointInPolygon,
  pointPolygonDistance, polygonArea, polygonPerimeter, type LonLat, type XY,
} from "./geometry.ts";

export const CUZK = {
  ruian: "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer",
  geocode: "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer/exts/GeocodeSOE",
  dmr: "https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g/ImageServer",
  dmp: "https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmp/ImageServer",
};

export class GeoError extends Error {}

// hlavičky HTTP smí obsahovat jen ASCII (pomlčka „–“ v User-Agent shodila všechny dotazy na ČÚZK)
export const CUZK_HEADERS = { Accept: "application/json", "User-Agent": "FVSOL/1.0 (fvsol.cz - zadani zakazky)" };

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const DAY = 24 * 3600 * 1000;

export async function getJson<T>(url: string, ttlMs = 30 * DAY): Promise<T> {
  const key = "cuzk:" + (await sha256hex(url));
  try {
    const { data } = await admin().from("geo_cache").select("data,expires_at").eq("key", key).maybeSingle();
    if (data && new Date(data.expires_at) > new Date()) return data.data as T;
  } catch (_) { /* cache je jen zrychlení */ }
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: CUZK_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new GeoError(`Služba ČÚZK odpověděla chybou HTTP ${res.status}`);
      const data = await res.json();
      if (data?.error) throw new GeoError(`Služba ČÚZK vrátila chybu: ${data.error.message ?? "neznámá"}`);
      admin().from("geo_cache").upsert({ key, data, expires_at: new Date(Date.now() + ttlMs).toISOString() }).then(() => {}, () => {});
      return data as T;
    } catch (e) {
      last = e;
    }
  }
  console.warn("cuzk_request_failed", String(last));
  throw last instanceof GeoError ? last : new GeoError("Služba ČÚZK teď není dostupná. Pokračujte zadáním adresy ručně.");
}

export interface Suggestion { text: string; magicKey: string; type: "address" | "parcel" | "other" }

export async function suggest(text: string): Promise<Suggestion[]> {
  const data = await getJson<{ suggestions?: { text: string; magicKey: string; type?: string }[] }>(
    `${CUZK.geocode}/suggest?${qs({ text, maxSuggestions: "8", f: "json" })}`, DAY);
  return (data.suggestions ?? []).map((s) => ({
    text: s.text,
    magicKey: s.magicKey,
    type: s.type === "AdresniMisto" ? "address" : s.type?.startsWith("Parcela") ? "parcel" : "other",
  }));
}

export async function findLocation(text: string, magicKey: string) {
  const data = await getJson<{ locations?: { name: string; feature: { geometry: { x: number; y: number } } }[] }>(
    `${CUZK.geocode}/find?${qs({ text, magicKey, outSR: "4326", f: "json" })}`);
  const loc = data.locations?.[0];
  return loc ? { lon: loc.feature.geometry.x, lat: loc.feature.geometry.y, label: loc.name } : null;
}

export async function reverseGeocode(lon: number, lat: number): Promise<string | null> {
  try {
    const data = await getJson<{ address?: { Address?: string } }>(
      `${CUZK.geocode}/tables/1/reverseGeocode?${qs({
        location: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
        distance: "60", outSR: "4326", f: "json",
      })}`);
    return data.address?.Address ?? null;
  } catch {
    return null;
  }
}

function envelope(lon: number, lat: number, r: number) {
  const dLat = r / 110_574, dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { xmin: lon - dLon, ymin: lat - dLat, xmax: lon + dLon, ymax: lat + dLat, spatialReference: { wkid: 4326 } };
}

export interface Feature { attributes: Record<string, unknown>; geometry?: { rings?: number[][][]; x?: number; y?: number } }

export async function queryLayer(layer: number, geom: unknown, geomType: string, outFields: string, outSR = "4326", withGeometry = true): Promise<Feature[]> {
  const data = await getJson<{ features?: Feature[] }>(`${CUZK.ruian}/${layer}/query?${qs({
    geometry: JSON.stringify(geom), geometryType: geomType, inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields, returnGeometry: String(withGeometry), outSR, f: "json",
  })}`);
  return data.features ?? [];
}

const BUILDING_FIELDS = "objectid,kod,cisladomovni,zpusobvyuzitikod,pocetpodlazi,zastavenaplocha,zdroj";

export const buildingsAround = (lon: number, lat: number, r: number, outSR = "4326") =>
  queryLayer(3, envelope(lon, lat, r), "esriGeometryEnvelope", BUILDING_FIELDS, outSR);

export const parcelsAround = (lon: number, lat: number, r: number, outSR = "5514") =>
  queryLayer(5, envelope(lon, lat, r), "esriGeometryEnvelope", "objectid,cisloparcely,druhcislovanikod,katastralniuzemi", outSR);

export async function parcelAt(lon: number, lat: number) {
  const f = (await queryLayer(5, { x: lon, y: lat, spatialReference: { wkid: 4326 } }, "esriGeometryPoint",
    "cisloparcely,katastralniuzemi,vymeraparcely,druhcislovanikod", "4326", false))[0];
  const a = f?.attributes;
  if (!a) return null;
  let ku: string | null = null;
  if (a.katastralniuzemi != null) {
    try {
      const k = await getJson<{ features?: { attributes: { nazev?: string } }[] }>(
        `${CUZK.ruian}/7/query?${qs({ where: `kod=${Number(a.katastralniuzemi)}`, outFields: "kod,nazev", returnGeometry: "false", f: "json" })}`);
      const n = k.features?.[0]?.attributes.nazev;
      ku = n ? `${n} [${Number(a.katastralniuzemi)}]` : String(a.katastralniuzemi);
    } catch {
      ku = String(a.katastralniuzemi);
    }
  }
  const prefix = Number(a.druhcislovanikod) === 1 ? "st. " : "";
  return { parcel: `${prefix}${a.cisloparcely ?? ""}`.trim(), ku, area: a.vymeraparcely != null ? Number(a.vymeraparcely) : null };
}

export async function elevation(service: "dmr" | "dmp", lon: number, lat: number): Promise<number | null> {
  try {
    const d = await getJson<{ value?: string }>(`${service === "dmr" ? CUZK.dmr : CUZK.dmp}/identify?${qs({
      geometry: JSON.stringify({ x: Number(lon.toFixed(7)), y: Number(lat.toFixed(7)), spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint", returnGeometry: "false", returnCatalogItems: "false", f: "json",
    })}`);
    const v = d.value != null ? Number(d.value) : NaN;
    return Number.isFinite(v) && v > -100 && v < 2000 ? v : null;
  } catch {
    return null;
  }
}

/** Číselník způsobu využití stavebního objektu RÚIAN (převzato z ARONLINE, ověřeno 20. 10. 2026). */
export const RUIAN_USE: Record<number, string> = {
  1: "průmyslový objekt", 2: "zemědělská usedlost", 3: "objekt k bydlení", 4: "objekt lesního hospodářství",
  5: "objekt občanské vybavenosti", 6: "bytový dům", 7: "rodinný dům", 8: "stavba pro rodinnou rekreaci",
  9: "stavba pro shromažďování většího počtu osob", 10: "stavba pro obchod", 11: "stavba ubytovacího zařízení",
  12: "stavba pro výrobu a skladování", 13: "zemědělská stavba", 14: "stavba pro administrativu",
  15: "stavba občanského vybavení", 16: "stavba technického vybavení", 17: "stavba pro dopravu", 18: "garáž",
  19: "jiná stavba", 20: "víceúčelová stavba", 21: "skleník",
};
/** Návrh typu objektu pro formulář – jen předvyplnění, zákazník ho potvrdí. */
export const RUIAN_USE_TO_TYPE: Record<number, string> = {
  1: "firma", 2: "zemedelska", 3: "rd", 5: "verejna", 6: "bd", 7: "rd", 8: "rd", 9: "verejna", 10: "firma",
  11: "firma", 12: "firma", 13: "zemedelska", 14: "firma", 15: "verejna",
};

const outer = (rings: number[][][]) => [...rings].sort((a, b) => b.length - a.length)[0] as LonLat[];
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** Zjištění objektu v bodě: budovy v okolí (pro výběr v mapě), parcela, adresa, rozměry a odhad výšky. */
export async function lookupSite(lon: number, lat: number, opts: { pick?: string | null; height?: boolean } = {}) {
  const notes: string[] = [];
  const frame = localFrame(lon, lat);
  const here: XY = [0, 0];
  const [features, parcel, address] = await Promise.all([
    buildingsAround(lon, lat, 70).catch((e) => {
      notes.push(`Budovy z katastru se nepodařilo načíst (${e instanceof Error ? e.message : "chyba"}).`);
      return [] as Feature[];
    }),
    parcelAt(lon, lat).catch(() => {
      notes.push("Parcelu se nepodařilo zjistit.");
      return null;
    }),
    reverseGeocode(lon, lat),
  ]);

  const shapes = features.filter((f) => f.geometry?.rings?.length).slice(0, 300).map((f) => {
    const ring = outer(f.geometry!.rings!);
    const xy = ring.map((p) => frame.toXY(p));
    return { f, ring, xy, dist: pointPolygonDistance(here, xy), area: polygonArea(xy) };
  });

  const main =
    (opts.pick ? shapes.find((s) => String(s.f.attributes.objectid) === String(opts.pick)) : undefined) ??
    shapes.find((s) => pointInPolygon(here, s.xy)) ??
    [...shapes].filter((s) => s.dist <= 15).sort((a, b) => a.dist - b.dist)[0];

  let building = null;
  if (!main) {
    notes.push("V místě není v katastru budova s obrysem. Vyberte ji v mapě, nebo pokračujte bez ní.");
  } else {
    const rect = minAreaRect(main.xy);
    const use = Number(main.f.attributes.zpusobvyuzitikod);
    const zdroj = Number(main.f.attributes.zdroj);
    let height: number | null = null, terrain: number | null = null;
    if (opts.height !== false) {
      const inside = interiorSamples(main.xy, 3).map((p) => frame.toLonLat(p));
      const outside = exteriorSamples(main.xy, 4).map((p) => frame.toLonLat(p));
      const surf = (await Promise.all(inside.map(([x, y]) => elevation("dmp", x, y)))).filter((v): v is number => v != null);
      const terr = (await Promise.all(outside.map(([x, y]) => elevation("dmr", x, y)))).filter((v): v is number => v != null);
      terrain = median(terr);
      const top = surf.length ? Math.max(...surf) : null;
      const h = terrain != null && top != null ? top - terrain : null;
      height = h != null && h >= 1.5 && h < 300 ? Math.round(h * 10) / 10 : null;
      if (height == null) notes.push("Výšku objektu se nepodařilo odhadnout z výškopisu.");
      else notes.push("Výška je jen odhad z digitálního modelu povrchu (může zachytit stromy nebo být starší než stavba).");
    }
    building = {
      id: String(main.f.attributes.objectid),
      code: main.f.attributes.kod != null ? Number(main.f.attributes.kod) : null,
      use: RUIAN_USE[use] ?? null,
      suggested_type: RUIAN_USE_TO_TYPE[use] ?? null,
      floors: main.f.attributes.pocetpodlazi != null ? Number(main.f.attributes.pocetpodlazi) : null,
      area: Math.round(main.area * 10) / 10,
      perimeter: Math.round(polygonPerimeter(main.xy) * 10) / 10,
      length: Math.round(rect.length * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      orientation_deg: Math.round(rect.orientationDeg),
      height_est: height,
      terrain_m: terrain != null ? Math.round(terrain * 10) / 10 : null,
      geometry_source: zdroj === 1 ? "DKM" : zdroj === 2 ? "KMD/UKM" : null,
    };
  }

  const buildings = shapes
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 60)
    .map((s) => ({ id: String(s.f.attributes.objectid), ring: s.ring.map(([x, y]) => [r7(x), r7(y)]), dist: Math.round(s.dist) }));

  return {
    source: "ruian",
    lat, lon,
    address: address ?? null,
    parcel: parcel?.parcel ?? null,
    ku: parcel?.ku ?? null,
    parcel_area: parcel?.area ?? null,
    building,
    buildings,
    notes,
    fetched_at: new Date().toISOString(),
    attribution: "© ČÚZK, data RÚIAN a výškopis (CC BY 4.0)",
  };
}
