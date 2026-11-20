/**
 * Automatische routeplanner (Hybrid A*) voor het kinematische voertuigmodel.
 *
 * - Obstakels worden op een raster gezet; met een afstandstransformatie
 *   (EDT) wordt de vrije ruimte rond elk punt bekend.
 * - Het voertuig (en de oplegger) wordt gecontroleerd met een rij cirkels die
 *   de carrosserie volledig bedekken, plus een veiligheidsmarge.
 * - Zoeken over (x, y, koers, knikhoek) met rijbare bogen (stuurhoek −max…+max,
 *   vooruit en achteruit); achteruit en wisselen van rijrichting kosten extra,
 *   trottoir/groen ook. Heuristiek: kortste weg over het vrije raster.
 * Resultaat: routedelen (vooruit/achteruit) die daarna gewoon gesimuleerd en
 * gecontroleerd worden.
 */
import { effectiveMaxSteer, type VehicleSpec } from './vehicles';
import { referencePoint, step, trailerAxle, type Leg, type Pose } from './kinematics';
import type { RouteObstacle } from './sweep';

export interface PlanInput {
  v: VehicleSpec;
  /** Start: achteras (trekker/voertuig), koers in rad. */
  start: { x: number; y: number; theta: number };
  /** Eind: achteras (star) of as van de oplegger; koers in rad of null (vrij). */
  goal: { x: number; y: number; heading: number | null };
  obstacles: RouteObstacle[];
  /** Zachte gebieden (trottoir, groen): extra kosten per meter. */
  soft: { ring: number[][]; cost: number }[];
  /** Extra vrije ruimte rondom het voertuig (m). */
  marge?: number;
  maxTijdMs?: number;
  maxExpansies?: number;
  /** Achteruitrijden toestaan. */
  achteruit?: boolean;
  /** Boomkronen negeren (alleen stammen zijn obstakel) – route vraagt dan snoeiwerk. */
  kronenNegeren?: boolean;
}
export interface PlanResult {
  ok: boolean;
  reden?: string;
  legs: Leg[];
  expansies: number;
  lengte: number;
  wissels: number;
  /** Afstand eindpunt tot gevraagd eindpunt (m). */
  restAfstand: number;
  /** Exact traject (elke 0,25 m) met rijrichting: wordt direct als swept path gebruikt. */
  poses: PlanPose[];
}
export interface PlanPose { x: number; y: number; theta: number; phi: number; delta: number; dir: number }

/* ---------------- raster ---------------- */
export interface Grid { x0: number; y0: number; res: number; w: number; h: number; block: Uint8Array; cost: Float32Array; dist: Float32Array }

function pointInRing(x: number, y: number, r: number[][]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
  return ins;
}

function fillRing(g: Grid, ring: number[][], set: (i: number) => void) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const q of ring) { xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
  const c0 = Math.max(0, Math.floor((xmin - g.x0) / g.res)), c1 = Math.min(g.w - 1, Math.ceil((xmax - g.x0) / g.res));
  const r0 = Math.max(0, Math.floor((ymin - g.y0) / g.res)), r1 = Math.min(g.h - 1, Math.ceil((ymax - g.y0) / g.res));
  for (let r = r0; r <= r1; r++) {
    const y = g.y0 + (r + 0.5) * g.res;
    for (let c = c0; c <= c1; c++) if (pointInRing(g.x0 + (c + 0.5) * g.res, y, ring)) set(r * g.w + c);
  }
  // randen ook (dunne polygonen)
  strokeLine(g, ring, set);
}
function strokeLine(g: Grid, line: number[][], set: (i: number) => void) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g.res * 0.5)) + 1;
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      const c = Math.floor((x - g.x0) / g.res), r = Math.floor((y - g.y0) / g.res);
      if (c >= 0 && r >= 0 && c < g.w && r < g.h) set(r * g.w + c);
    }
  }
}

/** 1D kwadratische afstandstransformatie (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
export function distanceTransform(block: Uint8Array, w: number, h: number, res: number): Float32Array {
  const INF = 1e12, n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const tmp = new Float64Array(w * h);
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) f[r] = block[r * w + c] ? 0 : INF;
    edt1d(f, h, d, v, z);
    for (let r = 0; r < h; r++) tmp[r * w + c] = d[r];
  }
  const out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) f[c] = tmp[r * w + c];
    edt1d(f, w, d, v, z);
    for (let c = 0; c < w; c++) out[r * w + c] = Math.sqrt(d[c]) * res;
  }
  return out;
}

export function buildGrid(inp: PlanInput, pad = 40): Grid {
  const xs = [inp.start.x, inp.goal.x], ys = [inp.start.y, inp.goal.y];
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const res = Math.max(0.2, Math.sqrt(((x1 - x0) * (y1 - y0)) / 1.6e6));
  const w = Math.ceil((x1 - x0) / res), h = Math.ceil((y1 - y0) / res);
  const g: Grid = { x0, y0, res, w, h, block: new Uint8Array(w * h), cost: new Float32Array(w * h), dist: new Float32Array(0) };
  const bb = [x0, y0, x1, y1];
  for (const o of inp.obstacles) {
    if (o.vrijeHoogte !== undefined && o.vrijeHoogte >= inp.v.hoogte) continue;
    if (inp.kronenNegeren && o.soort === 'boom' && o.vrijeHoogte !== undefined) continue;
    if (o.bbox[2] < bb[0] || o.bbox[0] > bb[2] || o.bbox[3] < bb[1] || o.bbox[1] > bb[3]) continue;
    const set = (i: number) => { g.block[i] = 1; };
    if (o.ring && o.ring.length >= 3) fillRing(g, o.ring, set);
    else if (o.lijn) strokeLine(g, o.lijn, set);
  }
  for (const s of inp.soft) fillRing(g, s.ring, (i) => { g.cost[i] = Math.max(g.cost[i], s.cost); });
  g.dist = distanceTransform(g.block, w, h, res);
  return g;
}

const cellOf = (g: Grid, x: number, y: number) => {
  const c = Math.floor((x - g.x0) / g.res), r = Math.floor((y - g.y0) / g.res);
  return c < 0 || r < 0 || c >= g.w || r >= g.h ? -1 : r * g.w + c;
};

/* ---------------- voertuig als cirkels ---------------- */
interface Disc { u: number; r: number }
function discs(len0: number, len1: number, width: number, marge: number): Disc[] {
  const L = len1 - len0, n = Math.max(1, Math.ceil(L / 1.0)), s = L / n;
  const r = Math.hypot(width / 2, s / 2) + marge;
  return [...Array(n)].map((_, k) => ({ u: len0 + s * (k + 0.5), r }));
}

export function makeCollision(v: VehicleSpec, g: Grid, marge: number) {
  const tr = discs(-v.overhangAchter, v.wielbasis + v.overhangVoor, v.breedte, marge);
  const tl = v.soort === 'oplegger' ? discs(-((v.opleggerWielbasis ?? 0) + (v.opleggerOverhangAchter ?? 0)), v.opleggerOverhangVoor ?? 0, v.opleggerBreedte ?? v.breedte, marge) : [];
  const slack = g.res * 0.75;
  return (p: Pose): boolean => {
    const c = Math.cos(p.theta), s = Math.sin(p.theta);
    for (const d of tr) {
      const i = cellOf(g, p.x + d.u * c, p.y + d.u * s);
      if (i < 0 || g.dist[i] < d.r + slack) return true;
    }
    if (tl.length) {
      const kx = p.x + (v.koppelpunt ?? 0) * c, ky = p.y + (v.koppelpunt ?? 0) * s;
      const cp = Math.cos(p.phi), sp = Math.sin(p.phi);
      for (const d of tl) {
        const i = cellOf(g, kx + d.u * cp, ky + d.u * sp);
        if (i < 0 || g.dist[i] < d.r + slack) return true;
      }
    }
    return false;
  };
}

/* ---------------- heuristiek: kortste weg over vrij raster ---------------- */
class Heap<T> {
  private a: { k: number; v: T }[] = [];
  get size() { return this.a.length; }
  push(k: number, v: T) {
    const a = this.a; a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): T | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0].v, last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].k < a[m].k) m = l; if (r < a.length && a[r].k < a[m].k) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
    }
    return top;
  }
}

function heuristicField(g: Grid, gx: number, gy: number, halfWidth: number): { f: Float32Array; k: number; w: number; h: number } {
  const k = Math.max(1, Math.round(0.5 / g.res));
  const w = Math.ceil(g.w / k), h = Math.ceil(g.h / k), cs = g.res * k;
  const free = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = Math.min(g.h - 1, r * k + (k >> 1)) * g.w + Math.min(g.w - 1, c * k + (k >> 1));
    free[r * w + c] = g.dist[i] >= halfWidth ? 1 : 0;
  }
  const f = new Float32Array(w * h).fill(Infinity);
  const gc = Math.floor((gx - g.x0) / cs), gr = Math.floor((gy - g.y0) / cs);
  if (gc < 0 || gr < 0 || gc >= w || gr >= h) return { f, k, w, h };
  const heap = new Heap<number>();
  f[gr * w + gc] = 0; heap.push(0, gr * w + gc);
  const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const i = heap.pop()!;
    const r = Math.floor(i / w), c = i % w, d0 = f[i];
    for (const [dc, dr, l] of N) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
      const j = rr * w + cc;
      if (!free[j] && !(rr === gr && cc === gc)) continue;
      const nd = d0 + l * cs;
      if (nd < f[j]) { f[j] = nd; heap.push(nd, j); }
    }
  }
  return { f, k, w, h };
}

/* ---------------- Hybrid A* ---------------- */
interface Node { p: Pose; g: number; dir: number; steer: number; parent: Node | null; }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function plan(inp: PlanInput, grid?: Grid): PlanResult {
  const t0 = Date.now();
  const STEP = 1.0, SUB = 4;
  const v = inp.v;
  const marge = inp.marge ?? 0.2;
  const g = grid ?? buildGrid(inp);
  const collide = makeCollision(v, g, marge);
  const dmax = effectiveMaxSteer(v) * 0.98;
  const artic = v.soort === 'oplegger';
  const knikMax = ((v.maxKnikhoek ?? 90) * Math.PI) / 180 * 0.9;
  const fail = (reden: string, exp = 0): PlanResult => ({ ok: false, reden, legs: [], expansies: exp, lengte: 0, wissels: 0, restAfstand: Infinity, poses: [] });
  const rateMax = ((v.maxStuursnelheid * Math.PI) / 180) / Math.max(0.3, v.snelheid / 3.6); // rad per m
  /** Eén primitief: stuurhoek beweegt met begrensde snelheid naar het doel. */
  const prim = (p0: Pose, target: number, dir: number, cb?: (p: Pose) => boolean): Pose | null => {
    let p = p0;
    const ds = STEP / SUB;
    for (let s = 0; s < SUB; s++) {
      const dd = target - p.delta, lim = rateMax * ds;
      p = { ...p, delta: Math.abs(dd) > lim ? p.delta + Math.sign(dd) * lim : target };
      p = step(v, p, dir * ds);
      if (cb && !cb(p)) return null;
    }
    return p;
  };

  const start: Pose = { x: inp.start.x, y: inp.start.y, theta: inp.start.theta, phi: inp.start.theta, delta: 0 };
  if (collide(start)) return fail('Het voertuig past niet op de startpositie (botst met een obstakel).');
  const refOf = (p: Pose): [number, number] => (artic ? trailerAxle(v, p) : [p.x, p.y]);
  const halfW = Math.max(v.breedte, artic ? v.opleggerBreedte ?? v.breedte : 0) / 2 + marge * 0.5;
  const H = heuristicField(g, inp.goal.x, inp.goal.y, halfW);
  const hAt = (x: number, y: number) => {
    const cs = g.res * H.k;
    const c = Math.floor((x - g.x0) / cs), r = Math.floor((y - g.y0) / cs);
    const e = Math.hypot(x - inp.goal.x, y - inp.goal.y);
    if (c < 0 || r < 0 || c >= H.w || r >= H.h) return e * 3;
    const val = H.f[r * H.w + c];
    return Number.isFinite(val) ? Math.max(val, e) : e * 3 + 50;
  };
  {
    // bereikbaarheid: is er rond de start een vrije doorgang (voertuigbreedte) naar het eindpunt?
    const sr = refOf(start), cs = g.res * H.k;
    let reach = false;
    for (let dy = -3; dy <= 3 && !reach; dy++) for (let dx = -3; dx <= 3 && !reach; dx++) {
      const c = Math.floor((sr[0] - g.x0) / cs) + dx, r = Math.floor((sr[1] - g.y0) / cs) + dy;
      if (c >= 0 && r >= 0 && c < H.w && r < H.h && Number.isFinite(H.f[r * H.w + c])) reach = true;
    }
    const gi = cellOf(g, inp.goal.x, inp.goal.y);
    if (gi < 0) return fail('Het eindpunt ligt buiten het rekengebied.');
    if (g.dist[gi] < halfW) return fail('Op het eindpunt is te weinig ruimte voor dit voertuig (botst met een obstakel).');
    if (!reach) return fail('Er is geen doorgang breed genoeg voor dit voertuig tussen start en eind.');
  }
  const steers = [-1, -0.5, 0, 0.5, 1].map((f) => f * dmax);
  const dirs = inp.achteruit === false ? [1] : [1, -1];
  const POS = 0.5, ANG = (5 * Math.PI) / 180, KN = (10 * Math.PI) / 180;
  const key = (p: Pose) => {
    const a = Math.round(wrap(p.theta) / ANG);
    const kn = artic ? Math.round(wrap(p.theta - p.phi) / KN) : 0;
    return `${Math.floor(p.x / POS)},${Math.floor(p.y / POS)},${a},${kn}`;
  };
  const closed = new Map<string, number>();
  const open = new Heap<Node>();
  const W = 1.3;
  const sr0 = refOf(start);
  open.push(W * hAt(sr0[0], sr0[1]), { p: start, g: 0, dir: 1, steer: 0, parent: null });
  const tolPos = 0.75, tolAng = (10 * Math.PI) / 180;
  const maxExp = inp.maxExpansies ?? 400000, maxT = inp.maxTijdMs ?? 15000;
  let exp = 0;
  let best: { n: Node; d: number } | null = null;
  const softAt = (x: number, y: number) => { const i = cellOf(g, x, y); return i < 0 ? 0 : g.cost[i]; };
  while (open.size) {
    const n = open.pop()!;
    const k = key(n.p);
    const prev = closed.get(k);
    if (prev !== undefined && prev <= n.g) continue;
    closed.set(k, n.g);
    exp++;
    if (exp > maxExp || (exp % 2000 === 0 && Date.now() - t0 > maxT)) break;
    const ref = refOf(n.p);
    const dGoal = Math.hypot(ref[0] - inp.goal.x, ref[1] - inp.goal.y);
    const head = artic ? n.p.phi : n.p.theta;
    const angOk = inp.goal.heading == null || Math.abs(wrap(head - inp.goal.heading)) < tolAng;
    const knikOk = !artic || Math.abs(wrap(n.p.theta - n.p.phi)) < (15 * Math.PI) / 180;
    if (dGoal < tolPos && angOk && knikOk) return finish(n, exp, dGoal);
    if (!best || dGoal < best.d) best = { n, d: dGoal };
    for (const dir of dirs) {
      for (let si = 0; si < steers.length; si++) {
        // bij wisselen van rijrichting staat het voertuig stil: stuur eerst (stilstaand) naar 0 is niet nodig, de stuursnelheid geldt per meter
        let soft = 0;
        const pe = prim(n.p, steers[si], dir, (p) => {
          if (artic && Math.abs(wrap(p.theta - p.phi)) > knikMax) return false;
          if (collide(p)) return false;
          soft += softAt(p.x, p.y) + softAt(p.x + v.wielbasis * Math.cos(p.theta), p.y + v.wielbasis * Math.sin(p.theta));
          return true;
        });
        if (!pe) continue;
        const p = pe;
        const c = STEP * (dir < 0 ? 2.0 : 1.0) + (n.parent && dir !== n.dir ? 10 : 0) + 0.15 * Math.abs(steers[si] - n.p.delta) / dmax + (soft / (2 * SUB)) * STEP;
        const child: Node = { p, g: n.g + c, dir, steer: si, parent: n };
        const kc = key(p);
        const pc = closed.get(kc);
        if (pc !== undefined && pc <= child.g) continue;
        const r = refOf(p);
        let hh = hAt(r[0], r[1]);
        if (inp.goal.heading != null && Math.hypot(r[0] - inp.goal.x, r[1] - inp.goal.y) < 8) hh += 2 * Math.abs(wrap((artic ? p.phi : p.theta) - inp.goal.heading));
        open.push(child.g + W * hh, child);
      }
    }
  }
  return { ...fail(exp >= maxExp || Date.now() - t0 > maxT ? 'Geen route gevonden binnen de rekentijd – probeer een andere eindrichting, minder marge of een kleiner voertuig.' : 'Geen botsingsvrije route gevonden met dit voertuig.', exp), restAfstand: best?.d ?? Infinity };

  function finish(n: Node, expansies: number, rest: number): PlanResult {
    const chain: Node[] = [];
    for (let q: Node | null = n; q; q = q.parent) chain.push(q);
    chain.reverse();
    // dichte reeks poses met rijrichting
    const dense: PlanPose[] = [{ ...chain[0].p, dir: chain[1]?.dir ?? 1 }];
    const poses: { p: Pose; dir: number }[] = [{ p: chain[0].p, dir: chain[1]?.dir ?? 1 }];
    for (let i = 1; i < chain.length; i++) {
      let k = 0;
      prim(chain[i - 1].p, steers[chain[i].steer], chain[i].dir, (p) => {
        dense.push({ ...p, dir: chain[i].dir });
        if (k++ % 2 === 1) poses.push({ p, dir: chain[i].dir });
        return true;
      });
    }
    const legs: Leg[] = [];
    let cur: Leg | null = null, wissels = 0;
    for (let i = 0; i < poses.length; i++) {
      const dir = i === 0 ? poses[1]?.dir ?? 1 : poses[i].dir;
      const richting = dir > 0 ? 'vooruit' : 'achteruit';
      if (!cur || cur.richting !== richting) {
        if (cur) wissels++;
        const startP = i === 0 ? poses[0].p : poses[i - 1].p;
        cur = { richting, punten: [referencePoint(v, startP, richting)] };
        legs.push(cur);
      }
      if (i > 0) cur.punten.push(referencePoint(v, poses[i].p, richting));
    }
    const legsOk = legs.filter((l) => l.punten.length >= 2).map((l) => ({ ...l, punten: l.punten.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]) }));
    const r3 = (q: number) => Math.round(q * 1e4) / 1e4;
    return { ok: true, legs: legsOk, expansies, lengte: (chain.length - 1) * STEP, wissels, restAfstand: rest, poses: dense.map((q) => ({ x: r3(q.x), y: r3(q.y), theta: r3(q.theta), phi: r3(q.phi), delta: r3(q.delta), dir: q.dir })) };
  }
}
