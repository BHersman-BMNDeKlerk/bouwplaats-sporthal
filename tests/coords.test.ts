import { describe, expect, it } from 'vitest';
import { LocalFrame, bboxAround, fmtNAP, originFor, rdToWgs84, wgs84ToRd } from '../src/core/coords';
import { PROJECT } from '../src/core/projectConfig';
import { tileBBox, tileCount, tileLayout } from '../src/core/tiles';

describe('lokale origin (RD ⇄ scène)', () => {
  const f = new LocalFrame(105600, 424680);

  it('zet RD om naar lokale coördinaten (x oost, y omhoog, −z noord)', () => {
    expect(f.toLocal(105610, 424700, 1.5)).toEqual({ x: 10, y: 1.5, z: -20 });
  });

  it('heen en terug is exact', () => {
    for (const [x, y, h] of [[105440.123, 424510.987, -1.01], [105770, 424850, 25.3], [105600, 424680, 0]]) {
      const l = f.toLocal(x, y, h);
      const r = f.toRD(l.x, l.y, l.z);
      expect(r.x).toBeCloseTo(x, 9);
      expect(r.y).toBeCloseTo(y, 9);
      expect(r.h).toBeCloseTo(h, 9);
    }
  });

  it('lokale waarden passen in float32 met mm-precisie', () => {
    const l = f.toLocal(105770.001, 424510.001, 0);
    expect(Math.abs(Math.fround(l.x) - l.x)).toBeLessThan(1e-4);
    expect(Math.abs(Math.fround(l.z) - l.z)).toBeLessThan(1e-4);
  });
});

describe('projectgebied', () => {
  it('bbox met 100 m marge rond de kernpunten, afgerond op 10 m', () => {
    const b = bboxAround(PROJECT.kernpunten, 100, 10);
    expect(b).toEqual({ xmin: 105440, ymin: 424510, xmax: 105770, ymax: 424850 });
    expect(originFor(b)).toEqual({ x: 105610, y: 424680 }); // midden 105605 → afgerond op 10 m
  });

  it('tegelindeling: tegels ≤ 90 m en een veelvoud van 0,5 m', () => {
    const b = bboxAround(PROJECT.kernpunten, 100, 10);
    const t = tileLayout(b);
    expect(t).toEqual({ nx: 4, ny: 4, tw: 82.5, th: 85 });
    expect(tileBBox(b, 4, 4, 0, 0)).toEqual({ xmin: 105440, xmax: 105522.5, ymax: 424850, ymin: 424765 });
    expect(tileBBox(b, 4, 4, 3, 3).ymin).toBe(424510);
    for (const len of [10, 95, 330, 340, 517]) {
      const n = tileCount(len);
      expect(len / n).toBeLessThanOrEqual(90);
      expect(((len * 2) / n) % 1).toBe(0);
    }
  });
});

describe('RD ⇄ WGS84 (benadering, ±1 m)', () => {
  it('Amersfoort (referentiepunt)', () => {
    const w = rdToWgs84(155000, 463000);
    expect(w.lat).toBeCloseTo(52.1551744, 7);
    expect(w.lon).toBeCloseTo(5.38720621, 7);
  });

  it('heen en terug binnen 1 m rond de projectlocatie', () => {
    const w = rdToWgs84(105600, 424680);
    // Dordrecht ligt rond 51,81° N, 4,67° O
    expect(w.lat).toBeGreaterThan(51.8);
    expect(w.lat).toBeLessThan(51.82);
    expect(w.lon).toBeGreaterThan(4.66);
    expect(w.lon).toBeLessThan(4.68);
    const r = wgs84ToRd(w.lat, w.lon);
    expect(Math.hypot(r.x - 105600, r.y - 424680)).toBeLessThan(1);
  });
});

describe('opmaak', () => {
  it('hoogtes in m NAP met teken', () => {
    expect(fmtNAP(-0.429)).toBe('−0,43 m NAP');
    expect(fmtNAP(6.069)).toBe('+6,07 m NAP');
    expect(fmtNAP(null)).toBe('–');
  });
});
