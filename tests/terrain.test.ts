import { describe, expect, it } from 'vitest';
import { fillGaps, isValidHeight, sampleGrid, type Grid } from '../src/data/terrain';

function plane(w: number, h: number, f: (c: number, r: number) => number): Float32Array {
  const v = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) v[r * w + c] = f(c, r);
  return v;
}

describe('terrein: gaten opvullen', () => {
  it('laat gemeten cellen ongemoeid en markeert ze', () => {
    const v = plane(8, 8, (c, r) => c * 0.1 + r * 0.05);
    v[27] = NaN;
    const before = Array.from(v);
    const mask = fillGaps(v, 8, 8);
    expect(mask[27]).toBe(0);
    expect(mask.reduce((s, m) => s + m, 0)).toBe(63);
    for (let i = 0; i < 64; i++) if (i !== 27) expect(v[i]).toBe(before[i]);
    expect(isValidHeight(v[27])).toBe(true);
  });

  it('interpoleert een gat in een hellend vlak redelijk (±5 cm)', () => {
    const w = 40, h = 40;
    const truth = (c: number, r: number) => 1 + c * 0.02 - r * 0.01;
    const v = plane(w, h, truth);
    // "gebouw" van 10×10 cellen
    for (let r = 15; r < 25; r++) for (let c = 15; c < 25; c++) v[r * w + c] = 3.4e38;
    fillGaps(v, w, h);
    for (let r = 15; r < 25; r++) for (let c = 15; c < 25; c++) expect(Math.abs(v[r * w + c] - truth(c, r))).toBeLessThan(0.05);
  });

  it('weigert een raster zonder enige meting', () => {
    expect(() => fillGaps(new Float32Array(4).fill(NaN), 2, 2)).toThrow();
  });
});

describe('terrein: bilineair bemonsteren', () => {
  const g: Grid = { width: 3, height: 2, x0: 100.25, y0: 200.75, res: 0.5, values: new Float32Array([0, 1, 2, 10, 11, 12]) };
  it('geeft de celwaarde op een celmidden', () => {
    expect(sampleGrid(g, 100.25, 200.75)).toBeCloseTo(0);
    expect(sampleGrid(g, 101.25, 200.25)).toBeCloseTo(12);
  });
  it('interpoleert tussen celmiddens', () => {
    expect(sampleGrid(g, 100.5, 200.75)).toBeCloseTo(0.5);
    expect(sampleGrid(g, 100.25, 200.5)).toBeCloseTo(5);
    expect(sampleGrid(g, 100.5, 200.5)).toBeCloseTo(5.5);
  });
  it('null buiten het raster', () => {
    expect(sampleGrid(g, 99, 200.5)).toBeNull();
  });
});
