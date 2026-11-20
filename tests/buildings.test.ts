import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureToBuilding, pageFeatures, pageTransform, pagesToBuildings, pickGeometry, type CJPage } from '../src/data/cityjson';
import { clusterLevels, effectiveHeights, heightMapper } from '../src/data/heights';
import { triangulate3D } from '../src/data/geom';

/** Echte 3D BAG-respons voor de sporthal (opgehaald via api.3dbag.nl). */
const page = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/3dbag-sporthal.json'), 'utf8')) as CJPage;
const origin = { x: 105600, y: 424680 };

describe('3D BAG CityJSON → gebouw', () => {
  const b = featureToBuilding(pageFeatures(page)[0], pageTransform(page), origin)!;

  it('leest identificatie en attributen', () => {
    expect(b.bagId).toBe('0505100000019476');
    expect(b.bouwjaar).toBe(1969);
    expect(b.pwBron).toBe('ahn5');
    expect(b.pwDatum).toBe('2024');
    expect(b.lod).toBe('2.2');
    expect(b.maaiveld).toBeCloseTo(-0.43, 2);
  });

  it('goot = laagste dakrand, nok = hoogste dakpunt (LoD 2.2)', () => {
    expect(b.goot!).toBeCloseTo(2.84, 1);
    expect(b.nok!).toBeCloseTo(6.07, 1);
    expect(b.goot!).toBeLessThan(b.nok!);
    // consistent met de 3D BAG-kentallen
    expect(Math.abs(b.nok! - b.dak.max!)).toBeLessThan(0.15);
  });

  it('herkent de twee platte dakniveaus', () => {
    expect(b.dakniveaus.length).toBe(2);
    expect(b.dakniveaus[0]).toBeCloseTo(2.86, 1);
    expect(b.dakniveaus[1]).toBeCloseTo(6.06, 1);
  });

  it('maakt een geldige mesh in lokale coördinaten', () => {
    const n = b.mesh.v.length / 3;
    expect(n).toBeGreaterThan(10);
    for (const i of [...b.mesh.roof, ...b.mesh.wall]) expect(i).toBeLessThan(n);
    expect(b.mesh.roof.length % 3).toBe(0);
    // vertices liggen rond de sporthal (binnen 100 m van de origin)
    for (let i = 0; i < b.mesh.v.length; i += 3) {
      expect(Math.abs(b.mesh.v[i])).toBeLessThan(100);
      expect(Math.abs(b.mesh.v[i + 1])).toBeLessThan(100);
    }
    // dakoppervlak (horizontale projectie) ≈ grondoppervlak
    let area = 0;
    const v = b.mesh.v;
    for (let k = 0; k < b.mesh.roof.length; k += 3) {
      const [a, c, d] = [b.mesh.roof[k], b.mesh.roof[k + 1], b.mesh.roof[k + 2]];
      area += Math.abs((v[c * 3] - v[a * 3]) * (v[d * 3 + 1] - v[a * 3 + 1]) - (v[d * 3] - v[a * 3]) * (v[c * 3 + 1] - v[a * 3 + 1])) / 2;
    }
    expect(area).toBeGreaterThan(b.oppGrond! * 0.9);
    expect(area).toBeLessThan(b.oppGrond! * 1.15);
  });

  it('footprint (LoD0) aanwezig in RD', () => {
    expect(b.footprint.length).toBeGreaterThan(0);
    expect(b.footprint[0][0][0]).toBeGreaterThan(105500);
  });

  it('ontdubbelt over pagina’s', () => {
    expect(pagesToBuildings([page, page], origin).length).toBe(1);
  });

  it('kiest LoD 2.2, anders de hoogste', () => {
    const g = (lod: string) => ({ type: 'Solid', lod, boundaries: [] });
    expect(pickGeometry([g('1.2'), g('2.2'), g('1.3')] as any)!.lod).toBe('2.2');
    expect(pickGeometry([g('1.2'), g('1.3')] as any)!.lod).toBe('1.3');
  });
});

describe('triangulatie', () => {
  it('verticaal vlak met gat', () => {
    const outer = [[0, 0, 0], [10, 0, 0], [10, 0, 5], [0, 0, 5]];
    const hole = [[4, 0, 1], [6, 0, 1], [6, 0, 3], [4, 0, 3]];
    const { indices } = triangulate3D([outer, hole]);
    expect(indices.length / 3).toBe(8);
  });
});

describe('hoogte-overschrijvingen', () => {
  const src = { maaiveld: 0, goot: 3, nok: 6 };

  it('effectieve waarden en markering', () => {
    const e = effectiveHeights(src, { nok: 8.4 });
    expect(e).toMatchObject({ maaiveld: 0, goot: 3, nok: 8.4, overschreven: { maaiveld: false, goot: false, nok: true } });
    expect(effectiveHeights(src, null).overschreven.nok).toBe(false);
  });

  it('vervormt het model stuksgewijs lineair (maaiveld/goot/nok vast)', () => {
    const f = heightMapper(src, { maaiveld: 0, goot: 4, nok: 9 });
    expect(f(0)).toBeCloseTo(0);
    expect(f(3)).toBeCloseTo(4);
    expect(f(6)).toBeCloseTo(9);
    expect(f(1.5)).toBeCloseTo(2);
    expect(f(4.5)).toBeCloseTo(6.5);
  });

  it('plat dak (goot = nok): alleen schalen tussen maaiveld en nok', () => {
    const f = heightMapper({ maaiveld: 1, goot: 7, nok: 7 }, { maaiveld: 1, goot: 7, nok: 9 });
    expect(f(7)).toBeCloseTo(9);
    expect(f(4)).toBeCloseTo(5);
  });

  it('alleen maaiveld aangepast: verschuift het hele gebouw', () => {
    const f = heightMapper({ maaiveld: 0, goot: null, nok: null }, { maaiveld: 0.5, goot: null, nok: null });
    expect(f(3)).toBeCloseTo(3.5);
  });

  it('dakniveaus clusteren', () => {
    expect(clusterLevels([{ z: 2.85, area: 100 }, { z: 2.87, area: 100 }, { z: 6.06, area: 300 }, { z: 9, area: 0.5 }])).toEqual([2.86, 6.06]);
  });
});
