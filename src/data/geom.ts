import earcut from 'earcut';
import type { BBox } from '../core/coords';

/** Punt-in-polygoon (even-odd) voor één ring [[x,y],...]. */
export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punt-in-polygoon met gaten: rings[0] = buitenring. */
export function pointInPolygon(x: number, y: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(x, y, rings[k])) return false;
  return true;
}

export function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

export function ringsBBox(rings: number[][][]): BBox {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const r of rings)
    for (const p of r) {
      if (p[0] < xmin) xmin = p[0];
      if (p[0] > xmax) xmax = p[0];
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
    }
  return { xmin, ymin, xmax, ymax };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.xmin <= b.xmax && a.xmax >= b.xmin && a.ymin <= b.ymax && a.ymax >= b.ymin;
}

/** Zwaartepunt (oppervlakte-gewogen) van een ring; valt terug op gemiddelde. */
export function ringCentroid(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Trianguleer een (vlak) 3D-polygoon met gaten. De ringen worden geprojecteerd op
 * het coördinaatvlak dat het best bij de normaal past; daarna earcut.
 * Retourneert indices in de platte lijst van alle ringpunten (buitenring eerst).
 */
export function triangulate3D(rings: number[][][]): { indices: number[]; points: number[][] } {
  const points: number[][] = [];
  const holes: number[] = [];
  rings.forEach((r, k) => {
    if (k > 0) holes.push(points.length);
    for (const p of r) points.push(p);
  });
  if (points.length < 3) return { indices: [], points };
  // Newell-normaal
  let nx = 0, ny = 0, nz = 0;
  const outer = rings[0];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let u = 0, v = 1; // projectie-assen
  if (ax >= ay && ax >= az) { u = 1; v = 2; }
  else if (ay >= ax && ay >= az) { u = 0; v = 2; }
  const flat: number[] = [];
  for (const p of points) flat.push(p[u], p[v]);
  const indices = earcut(flat, holes.length ? holes : undefined, 2);
  return { indices, points };
}

/** Afstand van punt tot lijnstuk (2D). */
export function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Haal alle polygonen (als ringen) uit een GeoJSON-geometrie. */
export function polygonsOf(g: { type: string; coordinates: any }): number[][][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/** Haal alle lijnen uit een GeoJSON-geometrie (inclusief polygoonranden). */
export function linesOf(g: { type: string; coordinates: any }): number[][][] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).flat();
  return [];
}
