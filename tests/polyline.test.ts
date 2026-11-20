import { describe, expect, it } from 'vitest';
import { pointAt, project, subLine, totalLength, type Pt } from '../src/core/polyline';

const L: Pt[] = [[0, 0], [10, 0], [10, 5]]; // 15 m

describe('polylijn: hek en poorten', () => {
  it('lengte, punt op afstand en projectie', () => {
    expect(totalLength(L)).toBe(15);
    expect(pointAt(L, 12).p).toEqual([10, 2]);
    expect(pointAt(L, 12).hoek).toBeCloseTo(Math.PI / 2);
    expect(pointAt(L, 99).p).toEqual([10, 5]);
    expect(project(L, 4, 1)).toEqual({ d: 4, dist: 1 });
    expect(project(L, 11, 3).d).toBeCloseTo(13);
  });

  it('deel van de lijn neemt hoekpunten mee', () => {
    expect(subLine(L, 8, 12)).toEqual([[8, 0], [10, 0], [10, 2]]);
  });
});

import { BOUWHEK, clampGate, gatePanels, nearestPanel, panels, snapFrom, snapLength, wholePanels } from '../src/core/polyline';

describe('bouwhekken 3,50 × 2,00 m', () => {
  it('maat', () => {
    expect(BOUWHEK).toEqual({ lengte: 3.5, hoogte: 2 });
  });

  it('zijden springen naar hele hekken', () => {
    expect(snapLength(8)).toBe(7);
    expect(snapLength(9)).toBe(10.5);
    expect(snapLength(1)).toBe(3.5);
    const p = snapFrom([0, 0], [6, 8]); // 10 m → 10,5 m in dezelfde richting
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(10.5);
    expect(p[1] / p[0]).toBeCloseTo(8 / 6);
  });

  it('verdeling in hekken, ingekort hek gemarkeerd', () => {
    const ps = panels([[0, 0], [7, 0], [7, 5]]);
    expect(ps.length).toBe(4);
    expect(ps.map((p) => p.heel)).toEqual([true, true, true, false]);
    expect(ps[3].lengte).toBeCloseTo(1.5);
    expect(ps[2].seg).toBe(1);
  });

  it('hele hekken maken behoudt richtingen', () => {
    const w = wholePanels([[0, 0], [8, 0], [8, 5]]);
    expect(w[1]).toEqual([7, 0]);
    expect(w[2][0]).toBeCloseTo(7);
    expect(w[2][1]).toBeCloseTo(3.5);
    expect(panels(w).every((p) => p.heel)).toBe(true);
  });

  it('poort van 2 hekken', () => {
    const ps = panels([[0, 0], [17.5, 0]]); // 5 hekken
    const gp = gatePanels([{ id: 'p', start: 1, aantal: 2 }], ps.length);
    expect([...gp.keys()]).toEqual([1, 2]);
    expect(clampGate({ id: 'p', start: 4, aantal: 2 }, 5).start).toBe(3);
    expect(nearestPanel(ps, 12, 1)).toBe(3);
  });
});
