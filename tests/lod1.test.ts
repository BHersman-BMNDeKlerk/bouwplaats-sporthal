import { describe, expect, it } from 'vitest';
import { lod1Block, LOD1_DEFAULT_HEIGHT } from '../src/data/lod1';
import type { Grid } from '../src/data/terrain';

// 40×40 m raster (0,5 m), maaiveld 0,2 m NAP; "gebouw" van 10×6 m met dak op 6,2 m NAP
const w = 80, h = 80;
const dtm: Grid = { width: w, height: h, x0: 1000.25, y0: 2039.75, res: 0.5, values: new Float32Array(w * h).fill(0.2) };
const dsmVals = new Float32Array(w * h).fill(0.2);
for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
  const x = 1000.25 + c * 0.5, y = 2039.75 - r * 0.5;
  if (x > 1010 && x < 1020 && y > 2010 && y < 2016) dsmVals[r * w + c] = 6.2;
}
const dsm: Grid = { ...dtm, values: dsmVals };
const poly = [[[1010, 2010], [1020, 2010], [1020, 2016], [1010, 2016], [1010, 2010]]];
const origin = { x: 1000, y: 2000 };

describe('aanvulling panden zonder 3D BAG (LoD 1)', () => {
  it('blok met dakhoogte uit het AHN', () => {
    const r = lod1Block('123', [poly], dtm, dsm, origin, { bron: 'ahn5', jaar: '2024' })!;
    expect(r.aanname).toBe(false);
    expect(r.rec.maaiveld).toBeCloseTo(0.2);
    expect(r.rec.nok).toBeCloseTo(6.2);
    expect(r.rec.oppGrond).toBeCloseTo(60, -1);
    expect(r.rec.bron).toBe('bgt-ahn');
    expect(r.rec.mesh.wall.length).toBe(4 * 6); // 4 gevels × 2 driehoeken
    expect(r.rec.mesh.roof.length).toBe(2 * 3);
  });

  it('geen gebouw in het AHN (nieuwbouw): aangenomen hoogte, gemarkeerd', () => {
    const r = lod1Block('456', [poly], dtm, { ...dtm }, origin, { bron: 'ahn5', jaar: '2024' })!;
    expect(r.aanname).toBe(true);
    expect(r.rec.nok! - r.rec.maaiveld!).toBeCloseTo(LOD1_DEFAULT_HEIGHT);
    expect(r.rec.bron).toBe('bgt-aanname');
  });
});
