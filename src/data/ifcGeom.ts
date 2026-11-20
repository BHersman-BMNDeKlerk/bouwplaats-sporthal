/**
 * Ontwerpmodel (IFC): buitencontour bepalen, plaatsing in RD/NAP en automatisch
 * uitlijnen op een bestaande footprint.
 *
 * Plaatsing: RD = R(rotatie) · (x_ifc, y_ifc) + (x, y);  NAP = z_ifc + peil
 * rotatie in graden, tegen de klok in (gezien van boven), x/y = RD-positie van
 * het IFC-nulpunt, peil = NAP-hoogte van IFC z = 0 (meestal vloerpeil BG, "0 P").
 */

export interface Placement {
  x: number;
  y: number;
  rotatie: number;
  peil: number;
}

export function placePoint(p: Placement, x: number, y: number): [number, number] {
  const a = (p.rotatie * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [p.x + c * x - s * y, p.y + s * x + c * y];
}

export function placeRings(p: Placement, rings: number[][][]): number[][][] {
  return rings.map((r) => r.map(([x, y]) => placePoint(p, x, y)));
}

// ---------------------------------------------------------------------------
// Contour uit geprojecteerde driehoeken
// ---------------------------------------------------------------------------

export interface Mask {
  x0: number; // linkeronderhoek
  y0: number;
  res: number;
  w: number;
  h: number;
  data: Uint8Array; // rij 0 = onder (y0)
}

/** Rasteriseer 2D-driehoeken (x,y-paren, 6 getallen per driehoek) tot een masker. */
export function rasterizeTriangles(tris: Float64Array | number[], res: number, pad = 3): Mask {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (let i = 0; i < tris.length; i += 2) {
    xmin = Math.min(xmin, tris[i]); xmax = Math.max(xmax, tris[i]);
    ymin = Math.min(ymin, tris[i + 1]); ymax = Math.max(ymax, tris[i + 1]);
  }
  const x0 = xmin - pad * res, y0 = ymin - pad * res;
  const w = Math.ceil((xmax - x0) / res) + pad + 1, h = Math.ceil((ymax - y0) / res) + pad + 1;
  const data = new Uint8Array(w * h);
  for (let t = 0; t < tris.length; t += 6) {
    const ax = (tris[t] - x0) / res, ay = (tris[t + 1] - y0) / res;
    const bx = (tris[t + 2] - x0) / res, by = (tris[t + 3] - y0) / res;
    const cx = (tris[t + 4] - x0) / res, cy = (tris[t + 5] - y0) / res;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    const r0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), r1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), c1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    if (Math.abs(area) < 1e-9) {
      // gedegenereerd (verticaal vlak van boven): markeer de lijnstukken
      for (const [px, py, qx, qy] of [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]]) {
        const n = Math.ceil(Math.hypot(qx - px, qy - py) * 2) + 1;
        for (let k = 0; k <= n; k++) {
          const c = Math.floor(px + ((qx - px) * k) / n), r = Math.floor(py + ((qy - py) * k) / n);
          if (c >= 0 && r >= 0 && c < w && r < h) data[r * w + c] = 1;
        }
      }
      continue;
    }
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const px = c + 0.5, py = r + 0.5;
        const w0 = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
        const w1 = (cx - bx) * (py - by) - (px - bx) * (cy - by);
        const w2 = (ax - cx) * (py - cy) - (px - cx) * (ay - cy);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) data[r * w + c] = 1;
      }
  }
  return { x0, y0, res, w, h, data };
}

/** Morfologisch sluiten (dilatatie gevolgd door erosie) met een vierkant van (2k+1) cellen. */
export function closeMask(m: Mask, k: number): Mask {
  const op = (src: Uint8Array, dilate: boolean) => {
    const out = new Uint8Array(src.length);
    for (let r = 0; r < m.h; r++)
      for (let c = 0; c < m.w; c++) {
        let v = dilate ? 0 : 1;
        for (let dr = -k; dr <= k && v === (dilate ? 0 : 1); dr++)
          for (let dc = -k; dc <= k; dc++) {
            const rr = r + dr, cc = c + dc;
            const s = rr < 0 || cc < 0 || rr >= m.h || cc >= m.w ? 0 : src[rr * m.w + cc];
            if (dilate && s) { v = 1; break; }
            if (!dilate && !s) { v = 0; break; }
          }
        out[r * m.w + c] = v;
      }
    return out;
  };
  return { ...m, data: op(op(m.data, true), false) };
}

/**
 * Volg de randen van het masker: geeft gesloten ringen (in wereldcoördinaten)
 * met gevulde cellen links. Buitenringen zijn tegen de klok in, gaten met de klok mee.
 */
export function traceRings(m: Mask): number[][][] {
  const { w, h, data } = m;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= h || c >= w ? 0 : data[r * w + c]);
  // gerichte randen tussen hoekpunten (c, r) op het celrooster
  const next = new Map<number, number[]>();
  const key = (c: number, r: number) => r * (w + 1) + c;
  const add = (c0: number, r0: number, c1: number, r1: number) => {
    const k = key(c0, r0);
    if (!next.has(k)) next.set(k, []);
    next.get(k)!.push(key(c1, r1));
  };
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (!at(r, c)) continue;
      if (!at(r - 1, c)) add(c, r, c + 1, r); // onderrand, naar rechts
      if (!at(r, c + 1)) add(c + 1, r, c + 1, r + 1); // rechterrand, omhoog
      if (!at(r + 1, c)) add(c + 1, r + 1, c, r + 1); // bovenrand, naar links
      if (!at(r, c - 1)) add(c, r + 1, c, r); // linkerrand, omlaag
    }
  const rings: number[][][] = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const ring: number[] = [start];
      let cur = outs.pop()!;
      let prev = start;
      let guard = 0;
      while (cur !== start && guard++ < 1e7) {
        ring.push(cur);
        const cand = next.get(cur)!;
        // bij een kruising (diagonaal): kies de scherpste linksaf
        let pick = cand.length - 1;
        if (cand.length > 1) {
          const [pc, pr] = [prev % (w + 1), Math.floor(prev / (w + 1))];
          const [cc, cr] = [cur % (w + 1), Math.floor(cur / (w + 1))];
          const din = [cc - pc, cr - pr];
          let best = -Infinity;
          cand.forEach((n, i) => {
            const d = [n % (w + 1) - cc, Math.floor(n / (w + 1)) - cr];
            const crs = din[0] * d[1] - din[1] * d[0];
            if (crs > best) { best = crs; pick = i; }
          });
        }
        prev = cur;
        cur = cand.splice(pick, 1)[0];
      }
      rings.push(ring.map((k) => [m.x0 + (k % (w + 1)) * m.res, m.y0 + Math.floor(k / (w + 1)) * m.res]));
    }
  }
  return rings.map((r) => [...r, r[0]]);
}

export function signedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

/** Douglas-Peucker voor een gesloten ring. */
export function simplifyRing(ring: number[][], tol: number): number[][] {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return ring;
  // splits op het punt het verst van het eerste punt
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  const dp = (a: number[][]): number[][] => {
    if (a.length < 3) return a;
    const [p, q] = [a[0], a[a.length - 1]];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-12;
    let idx = 0, dmax = 0;
    for (let i = 1; i < a.length - 1; i++) {
      const d = Math.abs((q[0] - p[0]) * (p[1] - a[i][1]) - (p[0] - a[i][0]) * (q[1] - p[1])) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= tol) return [p, q];
    const l = dp(a.slice(0, idx + 1)), r = dp(a.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  const a = dp(pts.slice(0, far + 1));
  const b = dp([...pts.slice(far), pts[0]]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return [...out, out[0]];
}

/**
 * Buitencontour van een set geprojecteerde driehoeken: rasteren, kleine gaten
 * sluiten, randen volgen en vereenvoudigen. Alleen ringen > minArea m².
 */
export function footprintFromTriangles(tris: Float64Array | number[], res = 0.05, closeCells = 3, minArea = 1): number[][][] {
  const m = closeMask(rasterizeTriangles(tris, res, closeCells + 2), closeCells);
  const rings = traceRings(m)
    .map((r) => simplifyRing(r, res * 1.2))
    .filter((r) => Math.abs(signedArea(r)) >= minArea);
  // buitenringen (CCW) eerst, op grootte
  return rings.sort((a, b) => signedArea(b) - signedArea(a));
}

// ---------------------------------------------------------------------------
// Uitlijnen op een bestaande footprint
// ---------------------------------------------------------------------------

function convexHull(pts: number[][]): number[][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Hoek (graden, 0–90) van de kleinst omsluitende rechthoek + het midden ervan. */
export function minAreaRect(pts: number[][]): { hoek: number; cx: number; cy: number; l: number; b: number } {
  const hull = convexHull(pts);
  let best = { area: Infinity, hoek: 0, cx: 0, cy: 0, l: 0, b: 0 };
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const h of hull) {
      const u = c * h[0] + s * h[1], v = -s * h[0] + c * h[1];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      let hoek = ((a * 180) / Math.PI) % 90;
      if (hoek < 0) hoek += 90;
      best = { area, hoek, cx: c * um - s * vm, cy: s * um + c * vm, l: Math.max(u1 - u0, v1 - v0), b: Math.min(u1 - u0, v1 - v0) };
    }
  }
  return best;
}

/** Punten op gelijke afstand langs de ringen. */
export function sampleRings(rings: number[][][], step: number): number[][] {
  const out: number[][] = [];
  for (const r of rings)
    for (let i = 0; i < r.length - 1; i++) {
      const [a, b] = [r[i], r[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  return out;
}

function distToRings(x: number, y: number, rings: number[][][]): number {
  let d = Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  return d;
}

export interface FitResult {
  plaatsing: Omit<Placement, 'peil'>;
  /** Gemiddelde afstand (m) van de ontwerpcontour tot de bestaande footprint. */
  gemAfwijking: number;
  /** Aandeel contourpunten binnen 0,5 m van de bestaande footprint. */
  dekking: number;
}

/**
 * Lijn een contour (IFC-coördinaten) uit op een doelfootprint (RD) met een
 * starre transformatie (rotatie + verschuiving). Startwaarden uit de
 * kleinst-omsluitende rechthoeken (4 oriëntaties), daarna lokaal verfijnen
 * door een begrensde gemiddelde afstand te minimaliseren (robuust voor delen
 * die in het ontwerp anders zijn dan bestaand).
 */
export function fitToFootprint(src: number[][][], target: number[][][], cap = 1.5): FitResult {
  const pts = sampleRings(src, 0.25);
  const rs = minAreaRect(src.flat()), rt = minAreaRect(target.flat());
  const cost = (rot: number, tx: number, ty: number) => {
    const p = { x: tx, y: ty, rotatie: rot, peil: 0 };
    let s = 0;
    for (const q of pts) { const [x, y] = placePoint(p, q[0], q[1]); s += Math.min(cap, distToRings(x, y, target)); }
    return s / pts.length;
  };
  let best = { rot: 0, tx: 0, ty: 0, c: Infinity };
  for (const k of [0, 90, 180, 270]) {
    const rot = rt.hoek - rs.hoek + k;
    // verschuiving zodat de rechthoekmiddens samenvallen
    const p0 = { x: 0, y: 0, rotatie: rot, peil: 0 };
    const [mx, my] = placePoint(p0, rs.cx, rs.cy);
    // grof raster van startposities rond de middens (±3 m): vangt verschuivingen
    // door uitbouwen/afwijkingen, waar alleen de middens uitlijnen niet volstaat
    for (let dx = -3; dx <= 3; dx += 0.5)
      for (let dy = -3; dy <= 3; dy += 0.5) {
        const tx = rt.cx - mx + dx, ty = rt.cy - my + dy;
        const c = cost(rot, tx, ty);
        if (c < best.c) best = { rot, tx, ty, c };
      }
  }
  // patroonzoektocht
  let sr = 1, st = 0.5;
  while (st > 0.002) {
    let improved = false;
    for (const [dr, dx, dy] of [[sr, 0, 0], [-sr, 0, 0], [0, st, 0], [0, -st, 0], [0, 0, st], [0, 0, -st]]) {
      // rotatie om het rechthoekmidden van de bron, zodat rotatie en verschuiving ontkoppeld zijn
      let tx = best.tx + dx, ty = best.ty + dy;
      if (dr) {
        const [ax, ay] = placePoint({ x: best.tx, y: best.ty, rotatie: best.rot, peil: 0 }, rs.cx, rs.cy);
        const [bx, by] = placePoint({ x: best.tx, y: best.ty, rotatie: best.rot + dr, peil: 0 }, rs.cx, rs.cy);
        tx += ax - bx; ty += ay - by;
      }
      const c = cost(best.rot + dr, tx, ty);
      if (c < best.c - 1e-6) { best = { rot: best.rot + dr, tx, ty, c }; improved = true; }
    }
    if (!improved) { sr /= 2; st /= 2; }
  }
  const p = { x: best.tx, y: best.ty, rotatie: best.rot, peil: 0 };
  let near = 0;
  for (const q of pts) { const [x, y] = placePoint(p, q[0], q[1]); if (distToRings(x, y, target) < 0.5) near++; }
  const rot = ((best.rot % 360) + 360) % 360;
  return { plaatsing: { x: best.tx, y: best.ty, rotatie: rot }, gemAfwijking: best.c, dekking: near / pts.length };
}

// ---------------------------------------------------------------------------
// Hoogtezones: het pand als grijze blokken (buitencontour per dakhoogte)
// ---------------------------------------------------------------------------

export interface HeightZone {
  /** Ringen (buitenring linksom, gaten rechtsom), IFC x/y in m. */
  rings: number[][][];
  /** Hoogste punt binnen de zone (m t.o.v. IFC z = 0, d.w.z. t.o.v. peil). */
  top: number;
  oppervlakte: number;
}

/**
 * Hoogste z per rastercel uit 3D-driehoeken (x,y,z × 3 per driehoek).
 * Verticale vlakken (van boven gezien een lijn) tellen mee via hun randen.
 */
export function topRaster(tris: Float64Array | Float32Array | number[], res: number, pad = 4): Mask & { top: Float32Array } {
  const flat: number[] = [];
  for (let t = 0; t < tris.length; t += 3) flat.push(tris[t], tris[t + 1]);
  const m = rasterizeTriangles(flat, res, pad);
  const top = new Float32Array(m.w * m.h).fill(-Infinity);
  const set = (c: number, r: number, z: number) => {
    if (c >= 0 && r >= 0 && c < m.w && r < m.h && z > top[r * m.w + c]) top[r * m.w + c] = z;
  };
  for (let t = 0; t < tris.length; t += 9) {
    const P = [0, 1, 2].map((k) => [(tris[t + 3 * k] - m.x0) / res, (tris[t + 3 * k + 1] - m.y0) / res, tris[t + 3 * k + 2]]);
    const [a, b, c] = P;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) {
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2) + 1;
        for (let k = 0; k <= n; k++) set(Math.floor(p[0] + ((q[0] - p[0]) * k) / n), Math.floor(p[1] + ((q[1] - p[1]) * k) / n), Math.max(p[2], q[2]));
      }
      continue;
    }
    const r0 = Math.floor(Math.min(a[1], b[1], c[1])), r1 = Math.ceil(Math.max(a[1], b[1], c[1]));
    const c0 = Math.floor(Math.min(a[0], b[0], c[0])), c1 = Math.ceil(Math.max(a[0], b[0], c[0]));
    for (let r = r0; r <= r1; r++)
      for (let cc = c0; cc <= c1; cc++) {
        const px = cc + 0.5, py = r + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        set(cc, r, w0 * a[2] + w1 * b[2] + w2 * c[2]);
      }
  }
  return { ...m, top };
}

/**
 * Deel de buitencontour op in zones met (ongeveer) gelijke dakhoogte.
 * Dakhoogtes worden geclusterd (tolerantie `tol` m); zones kleiner dan
 * `minAandeel` van het totaal worden bij de buurzone gevoegd.
 * De hoogte van een zone is het hoogste punt erin (dakrand/acroterie).
 */
export function heightZones(tris: Float64Array | Float32Array | number[], res = 0.1, tol = 0.75, minAandeel = 0.05, closeCells = 4): HeightZone[] {
  const t = topRaster(tris, res, closeCells + 2);
  const { w, h } = t;
  const filled = closeMask({ ...t, data: t.data }, closeCells).data;
  // dakhoogteclusters (gewogen naar oppervlak)
  const vals: number[] = [];
  for (let i = 0; i < w * h; i++) if (filled[i] && Number.isFinite(t.top[i])) vals.push(t.top[i]);
  vals.sort((a, b) => a - b);
  const groups: { lo: number; hi: number; n: number }[] = [];
  for (const v of vals) {
    const g = groups[groups.length - 1];
    if (g && v - g.hi <= tol / 4) { g.hi = v; g.n++; } else groups.push({ lo: v, hi: v, n: 1 });
  }
  // voeg naburige groepen samen tot clusters met spreiding ≤ tol
  const clusters: { lo: number; hi: number; n: number }[] = [];
  for (const g of groups) {
    const c = clusters[clusters.length - 1];
    if (c && g.hi - c.lo <= tol) { c.hi = g.hi; c.n += g.n; } else clusters.push({ ...g });
  }
  const big = clusters.filter((c) => c.n >= vals.length * minAandeel);
  if (!big.length) return [];
  const levelOf = (z: number) => {
    let best = 0, d = Infinity;
    big.forEach((c, i) => {
      const dd = z < c.lo ? c.lo - z : z > c.hi ? z - c.hi : 0;
      if (dd < d) { d = dd; best = i; }
    });
    return best;
  };
  // label per cel; cellen zonder hoogte (gesloten kieren) krijgen het label van een buur
  let lab = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) if (filled[i] && Number.isFinite(t.top[i])) lab[i] = levelOf(t.top[i]);
  const raw = lab.slice();
  for (let it = 0; it < 50; it++) {
    let changed = false;
    const next = lab.slice();
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!filled[i] || lab[i] >= 0) continue;
        for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const j = (r + dr) * w + c + dc;
          if (r + dr >= 0 && r + dr < h && c + dc >= 0 && c + dc < w && lab[j] >= 0) { next[i] = lab[j]; changed = true; break; }
        }
      }
    lab = next;
    if (!changed) break;
  }
  // meerderheidsfilter (5×5) tegen spikkels; hoge dakranden langs een lage zone blijven zo bij de hoge zone
  const sm = lab.slice();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (lab[i] < 0) continue;
      const cnt = new Map<number, number>();
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
          const l = lab[rr * w + cc];
          if (l >= 0) cnt.set(l, (cnt.get(l) ?? 0) + 1);
        }
      let best = lab[i], bn = 0;
      for (const [l, n] of cnt) if (n > bn) { bn = n; best = l; }
      sm[i] = best;
    }
  const zones: HeightZone[] = [];
  big.forEach((_, k) => {
    const data = new Uint8Array(w * h);
    let top = -Infinity;
    // hoogte alleen uit cellen die zelf tot deze hoogteklasse horen (niet uit een hogere buurmuur)
    for (let i = 0; i < w * h; i++) if (sm[i] === k) { data[i] = 1; if (raw[i] === k) top = Math.max(top, t.top[i]); }
    const rings = traceRings({ ...t, data }).map((r) => simplifyRing(r, res * 1.2)).filter((r) => Math.abs(signedArea(r)) >= 1);
    const opp = rings.reduce((s, r) => s + signedArea(r), 0);
    if (opp >= 1) zones.push({ rings: rings.sort((a, b) => signedArea(b) - signedArea(a)), top: Math.round(top * 100) / 100, oppervlakte: Math.round(opp * 10) / 10 });
  });
  return zones.sort((a, b) => a.top - b.top);
}
