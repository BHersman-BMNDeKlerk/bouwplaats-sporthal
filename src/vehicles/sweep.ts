/**
 * Swept path: carrosserie- en wielposities per simulatiestap, omhullende en
 * botsingscontrole (fase 4).
 */
import { VehicleSpec } from './vehicles';
import { Pose, Sample, kingpin } from './kinematics';
import { rasterizeTriangles, traceRings, simplifyRing } from '../data/ifcGeom';
import { polygonsOverlap, polygonCrossesLine } from '../core/elements';

type P2 = [number, number];
const rect = (cx: number, cy: number, h: number, u0: number, u1: number, w: number): P2[] => {
  const c = Math.cos(h), s = Math.sin(h);
  const pt = (u: number, v: number): P2 => [cx + u * c - v * s, cy + u * s + v * c];
  return [pt(u0, -w / 2), pt(u1, -w / 2), pt(u1, w / 2), pt(u0, w / 2)];
};

export interface BodyGeom {
  /** Carrosserie(ën): trekker/voertuig en eventueel oplegger. */
  bodies: P2[][];
  /** Wielposities (midden band): [linksvoor, rechtsvoor, linksachter, rechtsachter, (oplegger links, rechts)]. */
  wheels: P2[];
  /** Band-rechthoeken (voor tekenen en stoepcontrole). */
  tyres: P2[][];
}

export function bodyAt(v: VehicleSpec, p: Pose): BodyGeom {
  const bodies: P2[][] = [rect(p.x, p.y, p.theta, -v.overhangAchter, v.wielbasis + v.overhangVoor, v.breedte)];
  const c = Math.cos(p.theta), s = Math.sin(p.theta);
  const at = (u: number, w: number, h = p.theta, x = p.x, y = p.y): P2 => [x + u * Math.cos(h) - w * Math.sin(h), y + u * Math.sin(h) + w * Math.cos(h)];
  const half = v.spoorbreedte / 2;
  const wheels: P2[] = [at(v.wielbasis, half), at(v.wielbasis, -half), at(0, half), at(0, -half)];
  const tl = 1.0, tb = v.bandbreedte;
  const tyres: P2[][] = [
    rect(...at(v.wielbasis, half), p.theta + p.delta, -tl / 2, tl / 2, tb),
    rect(...at(v.wielbasis, -half), p.theta + p.delta, -tl / 2, tl / 2, tb),
    rect(...at(0, half), p.theta, -tl / 2, tl / 2, tb),
    rect(...at(0, -half), p.theta, -tl / 2, tl / 2, tb),
  ];
  void c; void s;
  if (v.soort === 'oplegger') {
    const [kx, ky] = kingpin(v, p), Lt = v.opleggerWielbasis ?? 0;
    bodies.push(rect(kx, ky, p.phi, -(Lt + (v.opleggerOverhangAchter ?? 0)), v.opleggerOverhangVoor ?? 0, v.opleggerBreedte ?? v.breedte));
    const tw = (v.opleggerBreedte ?? v.breedte) / 2 - 0.3;
    const l = at(-Lt, tw, p.phi, kx, ky), r = at(-Lt, -tw, p.phi, kx, ky);
    wheels.push(l, r);
    tyres.push(rect(...l, p.phi, -1.4, 1.4, tb), rect(...r, p.phi, -1.4, 1.4, tb));
  }
  return { bodies, wheels, tyres };
}

/** Kies monsters op een vaste onderlinge afstand (m afgelegde weg). */
export function thin(samples: Sample[], every: number): Sample[] {
  const out: Sample[] = [];
  let last = -Infinity;
  for (const s of samples) if (s.s - last >= every - 1e-9) { out.push(s); last = s.s; }
  if (samples.length && out[out.length - 1] !== samples[samples.length - 1]) out.push(samples[samples.length - 1]);
  return out;
}

export interface Envelope {
  /** Omhullende van de carrosserie (ringen, RD). */
  rings: number[][][];
  /** Wielsporen per wiel (polylijnen, RD). */
  sporen: P2[][];
}

/** Omhullende van alle carrosseriestanden via een raster (res in m). */
export function envelope(v: VehicleSpec, samples: Sample[], res = 0.1): Envelope {
  const thinS = thin(samples, Math.max(0.05, res));
  const tris: number[] = [];
  const sporen: P2[][] = [];
  for (const s of thinS) {
    const g = bodyAt(v, s);
    for (const b of g.bodies) tris.push(b[0][0], b[0][1], b[1][0], b[1][1], b[2][0], b[2][1], b[0][0], b[0][1], b[2][0], b[2][1], b[3][0], b[3][1]);
    g.wheels.forEach((w, i) => (sporen[i] ??= []).push(w));
  }
  if (!tris.length) return { rings: [], sporen };
  // raster niet groter dan ~6 Mcellen
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < tris.length; i += 2) { xmin = Math.min(xmin, tris[i]); xmax = Math.max(xmax, tris[i]); ymin = Math.min(ymin, tris[i + 1]); ymax = Math.max(ymax, tris[i + 1]); }
  const r = Math.max(res, Math.sqrt(((xmax - xmin) * (ymax - ymin)) / 6e6));
  const m = rasterizeTriangles(tris, r);
  const rings = traceRings(m).map((q) => simplifyRing(q, r * 0.6)).filter((q) => q.length >= 3);
  return { rings, sporen };
}

/* ---------------- botsingen ---------------- */

export interface RouteObstacle {
  id: string;
  naam: string;
  soort: 'gebouw' | 'nieuw pand' | 'element' | 'boom' | 'paal' | 'paaltjes' | 'hekwerk' | 'doorrijhoogte' | 'niet berijdbaar' | 'muur';
  /** Polygoon (gesloten ring) of lijn (open). */
  ring?: number[][];
  lijn?: number[][];
  /** Vrije hoogte onder het obstakel (m boven maaiveld). Botsing alleen als het voertuig hoger is. */
  vrijeHoogte?: number;
  /** Alleen de banden controleren (niet berijdbaar vlak, stoep). */
  alleenWielen?: boolean;
  bbox: [number, number, number, number];
}

export interface RouteConflict {
  obstakelId: string;
  naam: string;
  soort: RouteObstacle['soort'] | 'stoep';
  s: number;
  x: number;
  y: number;
  /** 'carrosserie' of 'wiel'. */
  deel: 'carrosserie' | 'wiel';
}

export function bboxOf(p: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  return [x0, y0, x1, y1];
}
const pointIn = (q: number[], r: number[][]) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > q[1]) !== (r[j][1] > q[1]) && q[0] < ((r[j][0] - r[i][0]) * (q[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
  return ins;
};
const hit = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const centroid = (p: number[][]): P2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/**
 * Botsingscontrole langs de route. Per obstakel wordt alleen de eerste botsing
 * (kleinste afgelegde weg) gerapporteerd. `stoepAt` geeft voor een wielpositie
 * een omschrijving als het wiel op een niet-rijbaan staat (bv. voetpad, groen).
 */
export function routeConflicts(
  v: VehicleSpec,
  samples: Sample[],
  obstacles: RouteObstacle[],
  stoepAt?: (x: number, y: number) => string | null,
  every = 0.25,
): RouteConflict[] {
  const out = new Map<string, RouteConflict>();
  const relevant = obstacles.filter((o) => o.vrijeHoogte === undefined || o.vrijeHoogte < v.hoogte);
  let lastStoep: string | null = null;
  for (const s of thin(samples, every)) {
    const g = bodyAt(v, s);
    const bbs = g.bodies.map(bboxOf);
    const tbb = g.tyres.map(bboxOf);
    for (const o of relevant) {
      if (out.has(o.id)) continue;
      const parts = o.alleenWielen ? g.tyres : g.bodies;
      const pbs = o.alleenWielen ? tbb : bbs;
      for (let i = 0; i < parts.length; i++) {
        if (!hit(pbs[i], o.bbox)) continue;
        const touch = o.ring ? polygonsOverlap(parts[i], o.ring) : o.lijn ? polygonCrossesLine(parts[i], o.lijn) || o.lijn.some((q) => pointIn(q, parts[i])) : false;
        if (touch) {
          const [x, y] = centroid(parts[i]);
          out.set(o.id, { obstakelId: o.id, naam: o.naam, soort: o.soort, s: s.s, x, y, deel: o.alleenWielen ? 'wiel' : 'carrosserie' });
          break;
        }
      }
    }
    if (stoepAt) {
      let st: string | null = null, w: P2 | null = null;
      for (const q of g.wheels) { st = stoepAt(q[0], q[1]); if (st) { w = q; break; } }
      if (st && w && st !== lastStoep) {
        const id = `stoep:${out.size}:${Math.round(s.s)}`;
        out.set(id, { obstakelId: id, naam: st, soort: 'stoep', s: s.s, x: w[0], y: w[1], deel: 'wiel' });
      }
      lastStoep = st;
    }
  }
  return [...out.values()].sort((a, b) => a.s - b.s);
}
