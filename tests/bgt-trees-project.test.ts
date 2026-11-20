import { describe, expect, it } from 'vitest';
import { emptyProject, parseProject, ProjectStore } from '../src/core/project';
import { mergeLayers } from '../src/core/layers';
import { classify, isCurrent, obstacleSpec } from '../src/data/bgt';
import { pointInPolygon } from '../src/data/geom';
import type { Grid } from '../src/data/terrain';
import { deriveTrees } from '../src/data/trees';

describe('BGT-classificatie', () => {
  it('wegdelen op functie', () => {
    expect(classify('wegdeel', { functie: 'rijbaan lokale weg' })).toBe('rijbaan');
    expect(classify('wegdeel', { functie: 'parkeervlak' })).toBe('parkeervak');
    expect(classify('wegdeel', { functie: 'voetpad op trap' })).toBe('voetpad');
    expect(classify('wegdeel', { functie: 'fietspad' })).toBe('fietspad');
    expect(classify('wegdeel', { functie: 'woonerf' })).toBe('woonerf');
  });
  it('terreindelen en scheidingen', () => {
    expect(classify('onbegroeidterreindeel', { fysiek_voorkomen: 'erf' })).toBe('erf');
    expect(classify('onbegroeidterreindeel', { fysiek_voorkomen: 'onverhard', plus_fysiek_voorkomen: 'zand' })).toBe('onverhard');
    expect(classify('begroeidterreindeel', { fysiek_voorkomen: 'struiken' })).toBe('struiken');
    expect(classify('scheiding_lijn', { type: 'niet-bgt', plus_type: 'hek' })).toBe('hek');
    expect(classify('scheiding_lijn', { type: 'muur' })).toBe('muur');
  });
  it('historische objecten vallen af', () => {
    expect(isCurrent({ eind_registratie: null, status: 'bestaand' })).toBe(true);
    expect(isCurrent({ eind_registratie: '2016-11-08T08:52:29Z' })).toBe(false);
  });
  it('obstakels krijgen een (aangenomen) hoogte', () => {
    expect(obstacleSpec('paal', { type: 'niet-bgt', plus_type: 'lichtmast' })).toMatchObject({ omschrijving: 'Lichtmast', hoogte: 6 });
    expect(obstacleSpec('bord', { type: 'niet-bgt', plus_type: 'verkeersbord' }).hoogte).toBeGreaterThan(2);
  });
});

describe('geometrie', () => {
  it('punt in polygoon met gat', () => {
    const poly = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
    expect(pointInPolygon(2, 2, poly)).toBe(true);
    expect(pointInPolygon(5, 5, poly)).toBe(false);
    expect(pointInPolygon(11, 5, poly)).toBe(false);
  });
});

describe('bomen uit BGT + AHN', () => {
  // vlak maaiveld 0 m NAP, 0,5 m raster van 60×60 m
  const w = 120, h = 120;
  const base: Grid = { width: w, height: h, x0: 0.25, y0: 59.75, res: 0.5, values: new Float32Array(w * h) };
  const dsmVals = new Float32Array(w * h);
  // boom 1 op (15, 45): kegelvormige kroon, top 12 m, straal 4 m
  // boom 2 op (45, 15): niet in BGT, top 9 m, straal 3 m
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const x = 0.25 + c * 0.5, y = 59.75 - r * 0.5;
      const d1 = Math.hypot(x - 15, y - 45), d2 = Math.hypot(x - 45, y - 15);
      dsmVals[r * w + c] = Math.max(0, d1 < 4 ? 12 - d1 * 1.2 : 0, d2 < 3 ? 9 - d2 : 0);
    }
  const dsm: Grid = { ...base, values: dsmVals };

  it('vult BGT-boom aan met hoogte en vindt een extra boom', () => {
    const trees = deriveTrees({ dtm: base, dsm, bgtTrees: [{ id: 'b1', x: 15.3, y: 44.8 }, { id: 'weg', x: 30, y: 30 }], exclude: [], poles: [] });
    const b1 = trees.find((t) => t.bgtId === 'b1')!;
    expect(b1.bron).toBe('BGT+AHN');
    expect(b1.hoogte).toBeGreaterThan(11);
    expect(b1.hoogte).toBeLessThanOrEqual(12);
    expect(b1.kroonstraal).toBeGreaterThan(2.5);
    expect(b1.kroonstraal).toBeLessThan(5);
    const leeg = trees.find((t) => t.bgtId === 'weg')!;
    expect(leeg.aanname).toBe(true);
    const extra = trees.filter((t) => t.bron === 'AHN');
    expect(extra.length).toBe(1);
    expect(Math.hypot(extra[0].x - 45, extra[0].y - 15)).toBeLessThan(1);
    expect(extra[0].hoogte).toBeGreaterThan(8);
  });

  it('geen detectie binnen gebouwen of bij lantaarnpalen', () => {
    const square = [[[40, 10], [50, 10], [50, 20], [40, 20], [40, 10]]];
    const t1 = deriveTrees({ dtm: base, dsm, bgtTrees: [], exclude: [square], poles: [] });
    expect(t1.some((t) => Math.hypot(t.x - 45, t.y - 15) < 3)).toBe(false);
    const t2 = deriveTrees({ dtm: base, dsm, bgtTrees: [], exclude: [], poles: [{ x: 45, y: 15 }] });
    expect(t2.some((t) => Math.hypot(t.x - 45, t.y - 15) < 3)).toBe(false);
  });

  it('zonder DSM: BGT-bomen met standaardwaarden (aanname)', () => {
    const t = deriveTrees({ dtm: base, dsm: null, bgtTrees: [{ id: 'x', x: 10, y: 10 }], exclude: [], poles: [] });
    expect(t[0]).toMatchObject({ bron: 'BGT', aanname: true });
  });
});

describe('projectbestand en undo/redo', () => {
  it('undo en redo van overschrijvingen', () => {
    const s = new ProjectStore(emptyProject('test'));
    s.change('nok', (d) => { d.overschrijvingen.gebouwen['A'] = { nok: 8 }; });
    s.change('goot', (d) => { d.overschrijvingen.gebouwen['A'].goot = 5; });
    expect(s.data.overschrijvingen.gebouwen['A']).toEqual({ nok: 8, goot: 5 });
    s.undo();
    expect(s.data.overschrijvingen.gebouwen['A']).toEqual({ nok: 8 });
    s.undo();
    expect(s.data.overschrijvingen.gebouwen['A']).toBeUndefined();
    expect(s.canUndo()).toBe(false);
    s.redo();
    expect(s.data.overschrijvingen.gebouwen['A']).toEqual({ nok: 8 });
    s.change('nieuw', (d) => { d.overschrijvingen.bomen['t'] = { hoogte: 4 }; });
    expect(s.canRedo()).toBe(false);
  });

  it('opslaan en weer inlezen geeft hetzelfde project', () => {
    const s = new ProjectStore(emptyProject('Sporthal'));
    s.change('x', (d) => { d.overschrijvingen.gebouwen['NL.IMBAG.Pand.1'] = { nok: 9.1, opmerking: 'tekening' }; });
    const p = parseProject(s.serialize());
    expect(p.overschrijvingen.gebouwen['NL.IMBAG.Pand.1']).toEqual({ nok: 9.1, opmerking: 'tekening' });
    expect(p.project.naam).toBe('Sporthal');
  });

  it('weigert vreemde bestanden met een duidelijke melding', () => {
    expect(() => parseProject('{"foo":1}')).toThrow(/geen projectbestand/);
    expect(() => parseProject('geen json')).toThrow(/geen geldig JSON/);
  });

  it('laaginstellingen: nieuwe sleutels krijgen de standaardwaarde', () => {
    const l = mergeLayers({ luchtfoto: false, bgtKlassen: { rijbaan: false } });
    expect(l.luchtfoto).toBe(false);
    expect(l.bgtKlassen.rijbaan).toBe(false);
    expect(l.bgtKlassen.voetpad).toBe(true);
    expect(l.gebouwen).toBe(true);
  });
});
