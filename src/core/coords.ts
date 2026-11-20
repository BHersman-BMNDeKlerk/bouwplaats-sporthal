/**
 * Coördinaten: RD New (EPSG:28992) met hoogtes in NAP.
 *
 * Intern werkt de 3D-scène met een lokale origin rond de projectlocatie om
 * float32-precisieproblemen op de GPU te voorkomen (RD-waarden van ~100 000 m
 * hebben in float32 slechts ~1 cm resolutie; lokaal is dat < 0,01 mm).
 *
 * Asconventie (Three.js is rechtshandig met Y omhoog):
 *   lokaal X  =  RD x − x0      (oost)
 *   lokaal Y  =  hoogte in m NAP
 *   lokaal Z  = −(RD y − y0)    (noord is −Z)
 */

export interface RDPoint {
  x: number;
  y: number;
}

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

export interface BBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export class LocalFrame {
  constructor(
    public readonly x0: number,
    public readonly y0: number,
  ) {}

  /** RD (x, y) + NAP-hoogte → lokale scènecoördinaten. */
  toLocal(x: number, y: number, h = 0): LocalPoint {
    return { x: x - this.x0, y: h, z: -(y - this.y0) };
  }

  /** Lokale scènecoördinaten → RD (x, y) en NAP-hoogte. */
  toRD(lx: number, ly: number, lz: number): { x: number; y: number; h: number } {
    return { x: lx + this.x0, y: -lz + this.y0, h: ly };
  }
}

/** Bounding box rond een set punten, met marge en afgerond (naar buiten) op een veelvoud van `round` meter. */
export function bboxAround(points: RDPoint[], margin: number, round = 10): BBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const f = (v: number, up: boolean) => (up ? Math.ceil(v / round) * round : Math.floor(v / round) * round);
  return {
    xmin: f(Math.min(...xs) - margin, false),
    ymin: f(Math.min(...ys) - margin, false),
    xmax: f(Math.max(...xs) + margin, true),
    ymax: f(Math.max(...ys) + margin, true),
  };
}

export function bboxCenter(b: BBox): RDPoint {
  return { x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2 };
}

/** Lokale origin: midden van de bbox, afgerond op 10 m (mooie ronde getallen). */
export function originFor(b: BBox): RDPoint {
  const c = bboxCenter(b);
  return { x: Math.round(c.x / 10) * 10, y: Math.round(c.y / 10) * 10 };
}

// ---------------------------------------------------------------------------
// RD ⇄ WGS84 benadering (Schreutelkamp & Strang van Hees, ±1 m nauwkeurig).
// Alleen bedoeld voor weergave (bv. link naar een online kaart); alle
// berekeningen in de app gebeuren in RD.
// ---------------------------------------------------------------------------

const X0 = 155000;
const Y0 = 463000;
const PHI0 = 52.1551744;
const LAM0 = 5.38720621;

const K: [number, number, number][] = [
  [0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.2475], [2, 1, -0.84978], [0, 3, -0.0655],
  [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.0053], [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012],
];
const L: [number, number, number][] = [
  [1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594],
  [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022],
  [2, 0, -0.00022], [5, 0, 0.00026],
];
const R: [number, number, number][] = [
  [0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705],
  [3, 1, -2.34], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148],
];
const S: [number, number, number][] = [
  [1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788],
  [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054],
];

export function rdToWgs84(x: number, y: number): { lat: number; lon: number } {
  const dx = (x - X0) * 1e-5;
  const dy = (y - Y0) * 1e-5;
  let lat = 0;
  let lon = 0;
  for (const [p, q, k] of K) lat += k * dx ** p * dy ** q;
  for (const [p, q, l] of L) lon += l * dx ** p * dy ** q;
  return { lat: PHI0 + lat / 3600, lon: LAM0 + lon / 3600 };
}

export function wgs84ToRd(lat: number, lon: number): RDPoint {
  const dphi = 0.36 * (lat - PHI0);
  const dlam = 0.36 * (lon - LAM0);
  let x = 0;
  let y = 0;
  for (const [p, q, r] of R) x += r * dphi ** p * dlam ** q;
  for (const [p, q, s] of S) y += s * dphi ** p * dlam ** q;
  return { x: X0 + x, y: Y0 + y };
}

/** Formatteer een RD-coördinaat als "x 105 600,00  y 424 680,00". */
export function fmtRD(x: number, y: number, decimals = 2): string {
  const f = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `x ${f(x)}  y ${f(y)}`;
}

/** Formatteer een hoogte in m+NAP (met teken). */
export function fmtNAP(h: number | null | undefined, decimals = 2): string {
  if (h == null || !Number.isFinite(h)) return '–';
  const s = Math.abs(h).toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${h < 0 ? '−' : '+'}${s} m NAP`;
}

export function fmtM(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} m`;
}
