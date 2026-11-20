/**
 * Bomen: BGT-boompunten (vegetatieobject_punt, plus-type "boom") aangevuld met
 * hoogte en kroonstraal uit het AHN (nDSM = DSM − DTM). Daarnaast worden bomen
 * gedetecteerd die niet in de BGT staan (bv. in privétuinen).
 * Alles is indicatief: de AHN-inwinning is een momentopname en de onderkant van
 * de kroon is niet uit het AHN af te leiden (aanname, bewerkbaar).
 */
import type { Grid } from './terrain';
import { isValidHeight, sampleGrid } from './terrain';
import { pointInPolygon, ringsBBox } from './geom';
import type { TreeRecord } from './types';

export interface TreeInput {
  dtm: Grid;
  /** DSM op hetzelfde raster als het DTM (zelfde x0/y0/res/afmetingen), of null. */
  dsm: Grid | null;
  bgtTrees: { id: string; x: number; y: number }[];
  /** Polygonen (gebouwen, overkappingen) waar geen bomen gezocht worden. */
  exclude: number[][][][];
  /** Palen/masten: geen boomdetectie vlakbij (lantaarnpalen geven ook hoge punten). */
  poles: { x: number; y: number }[];
}

export const TREE_DEFAULTS = { hoogte: 8, kroonstraal: 3 };

/** Aangenomen onderkant kroon als functie van de boomhoogte (m boven maaiveld). */
export function assumedCrownBase(h: number): number {
  return Math.round(Math.min(Math.max(h * 0.35, 2.0), 5.0) * 10) / 10;
}

export function deriveTrees(inp: TreeInput): TreeRecord[] {
  const { dtm, dsm } = inp;
  const w = dtm.width, h = dtm.height, res = dtm.res;
  const out: TreeRecord[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  if (!dsm) {
    for (const t of inp.bgtTrees) {
      const mv = sampleGrid(dtm, t.x, t.y) ?? 0;
      out.push({
        id: `bgt:${t.id}`, x: r2(t.x), y: r2(t.y), maaiveld: r2(mv), hoogte: TREE_DEFAULTS.hoogte,
        kroonstraal: TREE_DEFAULTS.kroonstraal, kroonOnderkant: assumedCrownBase(TREE_DEFAULTS.hoogte),
        bron: 'BGT', aanname: true, bgtId: t.id,
      });
    }
    return out;
  }

  // nDSM + uitsluitingsmasker
  const ndsm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = dsm.values[i], b = dtm.values[i];
    ndsm[i] = isValidHeight(a) && isValidHeight(b) ? Math.max(0, a - b) : 0;
  }
  const blocked = new Uint8Array(w * h);
  const col = (x: number) => Math.round((x - dtm.x0) / res);
  const row = (y: number) => Math.round((dtm.y0 - y) / res);
  for (const poly of inp.exclude) {
    const bb = ringsBBox(poly);
    const c0 = Math.max(0, col(bb.xmin) - 1), c1 = Math.min(w - 1, col(bb.xmax) + 1);
    const rr0 = Math.max(0, row(bb.ymax) - 1), rr1 = Math.min(h - 1, row(bb.ymin) + 1);
    for (let r = rr0; r <= rr1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = dtm.x0 + c * res, y = dtm.y0 - r * res;
        if (pointInPolygon(x, y, poly)) blocked[r * w + c] = 1;
      }
  }
  // dilateer masker met 2 cellen (1 m) tegen gebouwranden
  const dil = blocked.slice();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (!blocked[r * w + c]) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < h && cc >= 0 && cc < w) dil[rr * w + cc] = 1;
        }
    }
  const val = (r: number, c: number) => (r < 0 || c < 0 || r >= h || c >= w || dil[r * w + c] ? 0 : ndsm[r * w + c]);

  // AHN wordt in de winter ingewonnen (blad eraf): de kroon is "gatenkaas".
  // Een 3×3-maximumfilter overbrugt die gaten voor de kroonbepaling.
  const vmax = new Float32Array(w * h);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let mx = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) mx = Math.max(mx, val(r + dr, c + dc));
      vmax[r * w + c] = mx;
    }
  const vm = (r: number, c: number) => (r < 0 || c < 0 || r >= h || c >= w ? 0 : vmax[r * w + c]);

  /**
   * Kroonstraal: mediane afstand (16 richtingen) tot het (gefilterde) nDSM onder
   * de drempel, met als ondergrens een allometrische schatting (0,2 × hoogte).
   */
  const crownRadius = (r: number, c: number, top: number): number => {
    const thr = Math.max(1.5, top * 0.25);
    const ds: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let d = 0;
      for (let step = 1; step <= 30; step++) {
        const rr = Math.round(r + Math.sin(a) * step), cc = Math.round(c + Math.cos(a) * step);
        if (vm(rr, cc) < thr) break;
        d = step * res;
      }
      ds.push(d);
    }
    ds.sort((x, y) => x - y);
    const measured = (ds[7] + ds[8]) / 2;
    return Math.min(Math.max(measured, top * 0.2, 1), 12);
  };

  const peakNear = (x: number, y: number, radius: number) => {
    const c0 = col(x), r0 = row(y), n = Math.ceil(radius / res);
    let best = 0, br = r0, bc = c0;
    for (let dr = -n; dr <= n; dr++)
      for (let dc = -n; dc <= n; dc++) {
        if (dr * dr + dc * dc > n * n) continue;
        const v = val(r0 + dr, c0 + dc);
        if (v > best) { best = v; br = r0 + dr; bc = c0 + dc; }
      }
    return { top: best, r: br, c: bc };
  };

  const claimed: { x: number; y: number; rad: number }[] = [];

  // 1. BGT-bomen aanvullen met AHN
  for (const t of inp.bgtTrees) {
    const mv = sampleGrid(dtm, t.x, t.y) ?? 0;
    const pk = peakNear(t.x, t.y, 3);
    if (pk.top >= 2.5) {
      const rad = crownRadius(pk.r, pk.c, pk.top);
      out.push({
        id: `bgt:${t.id}`, x: r2(t.x), y: r2(t.y), maaiveld: r2(mv), hoogte: r1(pk.top), kroonstraal: r1(rad),
        kroonOnderkant: assumedCrownBase(pk.top), bron: 'BGT+AHN', aanname: false, bgtId: t.id,
      });
      claimed.push({ x: t.x, y: t.y, rad });
    } else {
      out.push({
        id: `bgt:${t.id}`, x: r2(t.x), y: r2(t.y), maaiveld: r2(mv), hoogte: TREE_DEFAULTS.hoogte,
        kroonstraal: TREE_DEFAULTS.kroonstraal, kroonOnderkant: assumedCrownBase(TREE_DEFAULTS.hoogte),
        bron: 'BGT', aanname: true, bgtId: t.id,
      });
      claimed.push({ x: t.x, y: t.y, rad: 2 });
    }
  }

  // 2. Extra bomen uit het AHN (lokale maxima van het gladgestreken nDSM)
  const sm = new Float32Array(w * h);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += val(r + dr, c + dc);
      sm[r * w + c] = sum / 9;
    }
  const win = Math.round(3 / res);
  const cand: { r: number; c: number; v: number }[] = [];
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const v = sm[r * w + c];
      if (v < 4) continue;
      let isMax = true;
      for (let dr = -win; dr <= win && isMax; dr++)
        for (let dc = -win; dc <= win; dc++) {
          if (dr * dr + dc * dc > win * win || (dr === 0 && dc === 0)) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
          const o = sm[rr * w + cc];
          if (o > v || (o === v && (dr < 0 || (dr === 0 && dc < 0)))) { isMax = false; break; }
        }
      if (!isMax) continue;
      // minimale kroonoppervlakte: ≥ 10 cellen (2,5 m²) boven 2 m binnen 2 m
      let n = 0;
      const k = Math.round(2 / res);
      for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) if (val(r + dr, c + dc) > 2) n++;
      if (n < 10) continue;
      cand.push({ r, c, v });
    }
  cand.sort((a, b) => b.v - a.v);
  for (const cd of cand) {
    const x = dtm.x0 + cd.c * res, y = dtm.y0 - cd.r * res;
    if (inp.poles.some((p) => Math.hypot(p.x - x, p.y - y) < 1.5)) continue;
    if (claimed.some((t) => Math.hypot(t.x - x, t.y - y) < Math.max(3, t.rad * 0.8))) continue;
    const top = val(cd.r, cd.c);
    const rad = crownRadius(cd.r, cd.c, top);
    const mv = sampleGrid(dtm, x, y) ?? 0;
    out.push({
      id: `ahn:${Math.round(x * 10)}_${Math.round(y * 10)}`, x: r2(x), y: r2(y), maaiveld: r2(mv), hoogte: r1(top),
      kroonstraal: r1(rad), kroonOnderkant: assumedCrownBase(top), bron: 'AHN', aanname: false,
    });
    claimed.push({ x, y, rad });
  }
  return out;
}
