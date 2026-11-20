import { describe, expect, it } from 'vitest';
import { fitToFootprint, footprintFromTriangles, heightZones, minAreaRect, placePoint, placeRings, signedArea } from '../src/data/ifcGeom';

/** Rechthoek als 2 driehoeken (x,y-paren). */
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];

describe('plaatsing IFC → RD', () => {
  it('rotatie linksom en verschuiving', () => {
    const p = { x: 1000, y: 2000, rotatie: 90, peil: 0.5 };
    const [x, y] = placePoint(p, 10, 0);
    expect(x).toBeCloseTo(1000);
    expect(y).toBeCloseTo(2010);
    expect(placeRings(p, [[[0, 0], [1, 0]]])[0][1][1]).toBeCloseTo(2001);
  });
});

describe('buitencontour uit driehoeken', () => {
  it('L-vorm van losse elementen met een kier wordt één ring met de juiste oppervlakte', () => {
    // 20×10 + 10×10 (L), met een kier van 3 cm tussen de delen
    const tris = [...rect(0, 0, 20, 10), ...rect(0, 10.03, 10, 20)];
    const rings = footprintFromTriangles(tris, 0.05, 3, 1);
    expect(rings.length).toBe(1);
    expect(signedArea(rings[0])).toBeGreaterThan(0); // buitenring linksom
    expect(signedArea(rings[0])).toBeCloseTo(300, -1);
    // vereenvoudigd tot (ongeveer) 6 hoekpunten
    expect(rings[0].length - 1).toBeLessThanOrEqual(8);
  });

  it('binnenplaats wordt een gat (rechtsom)', () => {
    const tris = [...rect(0, 0, 30, 5), ...rect(0, 25, 30, 30), ...rect(0, 5, 5, 25), ...rect(25, 5, 30, 25)];
    const rings = footprintFromTriangles(tris, 0.1, 1, 1);
    expect(rings.length).toBe(2);
    expect(signedArea(rings[0])).toBeCloseTo(900, -1);
    expect(signedArea(rings[1])).toBeCloseTo(-400, -1);
  });

  it('kleinste omsluitende rechthoek vindt de hoek', () => {
    const p = { x: 0, y: 0, rotatie: 12, peil: 0 };
    const pts = [[0, 0], [30, 0], [30, 15], [0, 15]].map(([x, y]) => placePoint(p, x, y));
    const r = minAreaRect(pts);
    expect(r.hoek).toBeCloseTo(12, 5);
    expect(r.l).toBeCloseTo(30, 5);
    expect(r.b).toBeCloseTo(15, 5);
  });
});

describe('automatisch uitlijnen op bestaande footprint', () => {
  // ontwerp: L-vorm in lokale coördinaten, nulpunt rechtsboven (zoals het IFC-model)
  const src = [[[-32, -17], [0, -17], [0, -4], [-9, -4], [-9, 0], [-32, 0], [-32, -17]]];
  const truth = { x: 105653.6, y: 424646.9, rotatie: 5.06, peil: 0 };

  it('vindt een bekende plaatsing terug (< 2 cm, < 0,05°)', () => {
    const target = placeRings(truth, src);
    const f = fitToFootprint(src, target);
    expect(Math.abs(f.plaatsing.rotatie - truth.rotatie)).toBeLessThan(0.05);
    expect(Math.hypot(f.plaatsing.x - truth.x, f.plaatsing.y - truth.y)).toBeLessThan(0.02);
    expect(f.gemAfwijking).toBeLessThan(0.02);
    expect(f.dekking).toBeGreaterThan(0.99);
  });

  it('robuust als het ontwerp deels afwijkt van het bestaande pand (uitbouw)', () => {
    const bestaand = placeRings(truth, src);
    const ontwerp = [[[-32, -17], [0, -17], [0, -4], [-9, -4], [-9, 0], [-32, 0], [-32, -8], [-36, -8], [-36, -13], [-32, -13], [-32, -17]]];
    const f = fitToFootprint(ontwerp, bestaand);
    expect(Math.abs(f.plaatsing.rotatie - truth.rotatie)).toBeLessThan(0.1);
    expect(Math.hypot(f.plaatsing.x - truth.x, f.plaatsing.y - truth.y)).toBeLessThan(0.05);
  });
});

/** Doos als 3D-driehoeken (dak + 4 gevels). */
function box(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  const t: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  quad([x0, y0, 0], [x1, y0, 0], [x1, y0, z], [x0, y0, z]);
  quad([x1, y0, 0], [x1, y1, 0], [x1, y1, z], [x1, y0, z]);
  quad([x1, y1, 0], [x0, y1, 0], [x0, y1, z], [x1, y1, z]);
  quad([x0, y1, 0], [x0, y0, 0], [x0, y0, z], [x0, y1, z]);
  return t;
}

describe('hoogtezones (grijze blokken)', () => {
  it('laag deel (4,2 m) naast hoge zaal (7,4 m): twee zones met eigen hoogte', () => {
    const tris = [...box(-32, -15, -14, 0, 4.2), ...box(-14, -17, 0, 0, 7.4)];
    const z = heightZones(tris, 0.1);
    expect(z.length).toBe(2);
    expect(z[0].top).toBeCloseTo(4.2, 1); // niet de hoge scheidingsmuur
    expect(z[1].top).toBeCloseTo(7.4, 1);
    expect(z[0].oppervlakte).toBeCloseTo(18 * 15, -1);
    expect(z[1].oppervlakte).toBeCloseTo(14 * 17, -1);
  });

  it('één hoogte: één zone', () => {
    const z = heightZones([...box(0, 0, 20, 10, 6), ...box(0, 0, 20, 10, 6.2)], 0.1);
    expect(z.length).toBe(1);
    expect(z[0].top).toBeCloseTo(6.2, 1);
  });
});
