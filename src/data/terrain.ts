/**
 * Terreinraster: opvullen van gaten (onder gebouwen/water heeft het AHN-DTM
 * geen waarden) en bilineair bemonsteren.
 */

export interface Grid {
  width: number;
  height: number;
  /** RD x van celmidden kolom 0. */
  x0: number;
  /** RD y van celmidden rij 0 (noordrand). */
  y0: number;
  res: number;
  values: Float32Array;
}

/** Is een waarde een geldige hoogte? (AHN nodata is meestal 3.4e38 of -9999) */
export function isValidHeight(v: number): boolean {
  return Number.isFinite(v) && v > -100 && v < 1000;
}

/**
 * Vul ontbrekende cellen op met een "push-pull"-piramide: de raster wordt
 * herhaald gehalveerd (gemiddelde van geldige cellen) tot alles gevuld is, en
 * daarna terug opgeschaald waarbij alleen de lege cellen worden ingevuld
 * (bilineair vanuit het grovere niveau). Resultaat: gladde interpolatie die
 * aansluit op de omliggende gemeten waarden.
 * Retourneert het masker (1 = gemeten, 0 = opgevuld).
 */
export function fillGaps(values: Float32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  let any = false;
  for (let i = 0; i < values.length; i++) {
    if (isValidHeight(values[i])) { mask[i] = 1; any = true; }
  }
  if (!any) throw new Error('Terreinraster bevat geen enkele geldige hoogte');
  if (mask.every((m) => m === 1)) return mask;
  fillLevel(values, mask.slice(), width, height);
  return mask;
}

function fillLevel(vals: Float32Array, valid: Uint8Array, w: number, h: number): void {
  let hasGap = false;
  for (let i = 0; i < valid.length; i++) if (!valid[i]) { hasGap = true; break; }
  if (!hasGap) return;
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const cv = new Float32Array(w2 * h2);
  const cm = new Uint8Array(w2 * h2);
  for (let r = 0; r < h2; r++)
    for (let c = 0; c < w2; c++) {
      let s = 0, n = 0;
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++) {
          const rr = 2 * r + dr, cc = 2 * c + dc;
          if (rr < h && cc < w && valid[rr * w + cc]) { s += vals[rr * w + cc]; n++; }
        }
      if (n) { cv[r * w2 + c] = s / n; cm[r * w2 + c] = 1; }
    }
  if (w2 === w && h2 === h) {
    // 1×1 raster zonder waarde: kan niet verder
    return;
  }
  fillLevel(cv, cm, w2, h2);
  // terug opschalen: alleen lege cellen
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (valid[i]) continue;
      // positie in grof raster (celmiddens)
      const fr = Math.min(Math.max((r - 0.5) / 2, 0), h2 - 1);
      const fc = Math.min(Math.max((c - 0.5) / 2, 0), w2 - 1);
      const r0 = Math.floor(fr), c0 = Math.floor(fc);
      const r1 = Math.min(r0 + 1, h2 - 1), c1 = Math.min(c0 + 1, w2 - 1);
      const tr = fr - r0, tc = fc - c0;
      const v =
        cv[r0 * w2 + c0] * (1 - tr) * (1 - tc) + cv[r0 * w2 + c1] * (1 - tr) * tc +
        cv[r1 * w2 + c0] * tr * (1 - tc) + cv[r1 * w2 + c1] * tr * tc;
      vals[i] = v;
      valid[i] = 1;
    }
}

/** Bilineaire hoogte op RD-positie; null buiten het raster. */
export function sampleGrid(g: Grid, x: number, y: number): number | null {
  const fc = (x - g.x0) / g.res;
  const fr = (g.y0 - y) / g.res;
  if (fc < -0.5 || fr < -0.5 || fc > g.width - 0.5 || fr > g.height - 0.5) return null;
  const c = Math.min(Math.max(fc, 0), g.width - 1);
  const r = Math.min(Math.max(fr, 0), g.height - 1);
  const c0 = Math.floor(c), r0 = Math.floor(r);
  const c1 = Math.min(c0 + 1, g.width - 1), r1 = Math.min(r0 + 1, g.height - 1);
  const tc = c - c0, tr = r - r0;
  const v = g.values;
  const w = g.width;
  return (
    v[r0 * w + c0] * (1 - tr) * (1 - tc) + v[r0 * w + c1] * (1 - tr) * tc +
    v[r1 * w + c0] * tr * (1 - tc) + v[r1 * w + c1] * tr * tc
  );
}

/** Min/max van een raster (alleen geldige waarden). */
export function gridRange(values: Float32Array): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (isValidHeight(v)) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}
