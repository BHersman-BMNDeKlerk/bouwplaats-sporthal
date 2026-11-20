/**
 * Meten: afstanden tussen geklikte punten (RD + hoogte in m NAP) en snappen
 * naar hoekpunten van bestaande objecten.
 */

export interface MeasurePoint {
  x: number;
  y: number;
  /** Hoogte in m NAP (maaiveld, dak, …). */
  h: number;
}

export interface SegmentStat {
  horizontaal: number;
  ruimtelijk: number;
  dh: number;
  /** Richting in graden t.o.v. noord, met de klok mee (0–360). */
  richting: number;
}

export function segmentStats(a: MeasurePoint, b: MeasurePoint): SegmentStat {
  const dx = b.x - a.x, dy = b.y - a.y, dh = b.h - a.h;
  const horizontaal = Math.hypot(dx, dy);
  let richting = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (richting < 0) richting += 360;
  return { horizontaal, ruimtelijk: Math.hypot(horizontaal, dh), dh, richting };
}

export function measureTotals(pts: MeasurePoint[]): { segmenten: SegmentStat[]; horizontaal: number; ruimtelijk: number } {
  const segmenten = pts.slice(1).map((p, i) => segmentStats(pts[i], p));
  return {
    segmenten,
    horizontaal: segmenten.reduce((s, x) => s + x.horizontaal, 0),
    ruimtelijk: segmenten.reduce((s, x) => s + x.ruimtelijk, 0),
  };
}

/** Eenvoudige snap-index: dichtstbijzijnd kandidaatpunt binnen een tolerantie (rasterindeling). */
export class SnapIndex {
  private cells = new Map<string, [number, number, string][]>();
  constructor(private readonly cell = 5) {}

  private key(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  clear() {
    this.cells.clear();
  }

  add(x: number, y: number, bron: string) {
    const k = this.key(x, y);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push([x, y, bron]);
  }

  addRings(rings: number[][][], bron: string) {
    for (const r of rings) for (const p of r) this.add(p[0], p[1], bron);
  }

  nearest(x: number, y: number, tol: number): { x: number; y: number; bron: string; d: number } | null {
    const n = Math.ceil(tol / this.cell);
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best: { x: number; y: number; bron: string; d: number } | null = null;
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const c = this.cells.get(`${cx + i},${cy + j}`);
        if (!c) continue;
        for (const [px, py, bron] of c) {
          const d = Math.hypot(px - x, py - y);
          if (d <= tol && (!best || d < best.d)) best = { x: px, y: py, bron, d };
        }
      }
    return best;
  }
}

/** Punten van een maatlijn verschoven over `offset` m (positief = links van de looprichting). */
export function offsetSegment(a: number[], b: number[], offset: number): [number[], number[]] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / len) * offset, ny = ((b[0] - a[0]) / len) * offset;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]];
}
