/**
 * Rekenen langs een polylijn (RD, meters): positie op afstand, projectie van
 * een punt, en het opdelen in hekdelen en poortopeningen.
 */

export type Pt = [number, number];

export function cumulative(pts: Pt[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}

export function totalLength(pts: Pt[]): number {
  const c = cumulative(pts);
  return c[c.length - 1] ?? 0;
}

/** Punt en richting (radialen) op afstand `d` vanaf het begin. */
export function pointAt(pts: Pt[], d: number): { p: Pt; hoek: number; seg: number } {
  const c = cumulative(pts);
  const L = c[c.length - 1];
  const t = Math.max(0, Math.min(L, d));
  let i = 0;
  while (i < pts.length - 2 && c[i + 1] < t) i++;
  const a = pts[i], b = pts[i + 1] ?? pts[i];
  const len = c[i + 1] - c[i] || 1e-12;
  const f = (t - c[i]) / len;
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], hoek: Math.atan2(b[1] - a[1], b[0] - a[0]), seg: i };
}

/** Afstand langs de lijn van het dichtstbijzijnde punt op de lijn, plus de dwarsafstand. */
export function project(pts: Pt[], x: number, y: number): { d: number; dist: number } {
  const c = cumulative(pts);
  let best = { d: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const dist = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (dist < best.dist) best = { d: c[i] + t * Math.sqrt(l2), dist };
  }
  return best;
}

/** Deel van de polylijn tussen afstanden a en b (a < b), inclusief tussenliggende hoekpunten. */
export function subLine(pts: Pt[], a: number, b: number): Pt[] {
  const c = cumulative(pts);
  const out: Pt[] = [pointAt(pts, a).p];
  for (let i = 1; i < pts.length - 1; i++) if (c[i] > a && c[i] < b) out.push(pts[i]);
  out.push(pointAt(pts, b).p);
  return out;
}

// ---------------------------------------------------------------------------
// Bouwhekken (Heras): hele hekelementen van 3,50 × 2,00 m
// ---------------------------------------------------------------------------

export const BOUWHEK = { lengte: 3.5, hoogte: 2.0 };

/** Lengte afgerond op hele hekken (minimaal één). */
export function snapLength(len: number, element = BOUWHEK.lengte): number {
  return Math.max(1, Math.round(len / element)) * element;
}

/** Punt vanaf `from` in de richting van `to`, op een afstand van hele hekken. */
export function snapFrom(from: Pt, to: Pt, element = BOUWHEK.lengte): Pt {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [from[0] + element, from[1]];
  const s = snapLength(len, element) / len;
  return [from[0] + dx * s, from[1] + dy * s];
}

export interface Panel {
  /** Volgnummer van het hek vanaf het begin (0, 1, 2, …). */
  index: number;
  seg: number;
  a: Pt;
  b: Pt;
  lengte: number;
  /** false = ingekort hek (zijde is geen veelvoud van de hekmaat). */
  heel: boolean;
}

/** Verdeel de lijn per zijde in hekken; de laatste van een zijde kan ingekort zijn. */
export function panels(pts: Pt[], element = BOUWHEK.lengte): Panel[] {
  const out: Panel[] = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [a, b] = [pts[s], pts[s + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / element - 1e-3));
    for (let k = 0; k < n; k++) {
      const t0 = (k * element) / len, t1 = Math.min(1, ((k + 1) * element) / len);
      const pa: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const pb: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      out.push({ index: out.length, seg: s, a: pa, b: pb, lengte: l, heel: Math.abs(l - element) < 0.01 });
    }
  }
  return out;
}

/** Maak alle zijden hele hekken (richtingen blijven gelijk, vanaf het beginpunt). */
export function wholePanels(pts: Pt[], element = BOUWHEK.lengte): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prevOrig = pts[i - 1], cur = pts[i];
    const dir: Pt = [cur[0] - prevOrig[0], cur[1] - prevOrig[1]];
    const from = out[i - 1];
    out.push(snapFrom(from, [from[0] + dir[0], from[1] + dir[1]], element));
  }
  return out;
}

/** Poort in een hekwerk: een reeks hele hekken die als poort dienen. */
export interface Gate {
  id: string;
  /** Index van het eerste hek van de poort. */
  start: number;
  /** Aantal hekken (1 = 3,50 m, 2 = 7,00 m). */
  aantal: number;
  naam?: string;
}

/** Poort begrensd tot het aantal hekken. */
export function clampGate(g: Gate, nPanels: number): Gate {
  const aantal = Math.max(1, Math.min(g.aantal, nPanels));
  return { ...g, aantal, start: Math.max(0, Math.min(nPanels - aantal, g.start)) };
}

/** Set van hek-indices die poort zijn. */
export function gatePanels(gates: Gate[], nPanels: number): Map<number, Gate> {
  const m = new Map<number, Gate>();
  for (const g0 of gates) {
    const g = clampGate(g0, nPanels);
    for (let i = g.start; i < g.start + g.aantal; i++) m.set(i, g);
  }
  return m;
}

/** Index van het hek het dichtst bij een punt. */
export function nearestPanel(ps: Panel[], x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (const p of ps) {
    const d = Math.hypot((p.a[0] + p.b[0]) / 2 - x, (p.a[1] + p.b[1]) / 2 - y);
    if (d < bd) { bd = d; best = p.index; }
  }
  return best;
}
