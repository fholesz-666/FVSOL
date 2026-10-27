// Rovinná geometrie v místní metrické soustavě (pro rozměry z obrysů budov).
export type LonLat = [number, number];
export type XY = [number, number];

export function localFrame(lon0: number, lat0: number) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  return {
    toXY: ([lon, lat]: LonLat): XY => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLonLat: ([x, y]: XY): LonLat => [lon0 + x / kx, lat0 + y / ky],
  };
}

export function polygonArea(p: XY[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(s / 2);
}

export function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Obdélník minimální plochy opsaný polygonu → délka, šířka, orientace delší strany (° od východu). */
export function minAreaRect(p: XY[]) {
  const hull = convexHull(p);
  let best = { area: Infinity, length: 0, width: 0, orientationDeg: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of hull) {
      const x = q[0] * c - q[1] * s, y = q[0] * s + q[1] * c;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const w = maxX - minX, h = maxY - minY, area = w * h;
    if (area < best.area) {
      const long = Math.max(w, h), short = Math.min(w, h);
      let deg = ((ang * 180) / Math.PI + (w >= h ? 0 : 90)) % 180;
      if (deg < 0) deg += 180;
      best = { area, length: long, width: short, orientationDeg: deg };
    }
  }
  return best;
}

export function pointInPolygon(pt: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointPolygonDistance(pt: XY, poly: XY[]): number {
  if (pointInPolygon(pt, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(pt, poly[j], poly[i]));
  return d;
}

export function interiorSamples(poly: XY[], n = 5): XY[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: XY[] = [];
  for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) {
    const p: XY = [x0 + ((x1 - x0) * i) / (n + 1), y0 + ((y1 - y0) * j) / (n + 1)];
    if (pointInPolygon(p, poly)) out.push(p);
  }
  if (!out.length) out.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  return out.slice(0, 9);
}

export function exteriorSamples(poly: XY[], offset = 4): XY[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - offset, Math.max(...xs) + offset, Math.min(...ys) - offset, Math.max(...ys) + offset];
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [mx, y0], [mx, y1], [x0, my], [x1, my]] as XY[]).filter((p) => !pointInPolygon(p, poly));
}

export function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
