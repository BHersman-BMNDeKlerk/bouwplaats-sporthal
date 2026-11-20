import { describe, it, expect } from 'vitest';
import DxfParser from 'dxf-parser';
import { toDxf, dxfLayerName, aciFromHex } from '../src/export/dxf';
import { toGeoJSON } from '../src/export/geojson';
import { legendFrom, type DrawFeature } from '../src/export/features';

const F: DrawFeature[] = [
  { laag: 'Bouwplaats – Keet', groep: 'Bouwplaatselementen', kleur: '#1e88e5', geom: { type: 'polygon', rings: [[[105600, 424600], [105606, 424600], [105606, 424602.4], [105600, 424602.4], [105600, 424600]]] } },
  { laag: 'Bouwplaats – Bouwhekken', groep: 'Eigen objecten', kleur: '#ff9800', geom: { type: 'line', coords: [[105590, 424590], [105593.5, 424590], [105597, 424590]] } },
  { laag: 'Kraan – Zwenkcirkel', groep: 'Kranen', kleur: '#f57c00', geom: { type: 'circle', center: [105650, 424620], radius: 45 } },
  { laag: 'Teksten', groep: 'Teksten', kleur: '#000000', geom: { type: 'text', coord: [105603, 424601], text: 'Keet (2×) – één', hoogte: 0.5 } },
  { laag: 'Bouwplaats – Keet', groep: 'Bouwplaatselementen', kleur: '#1e88e5', geom: { type: 'polygon', rings: [[[105610, 424600], [105616, 424600], [105616, 424602.4], [105610, 424600]]] } },
];

describe('DXF-export', () => {
  const txt = toDxf(F, { titel: 'test' });
  const d: any = new DxfParser().parseSync(txt);
  it('is leesbaar en heeft lagen per soort', () => {
    expect(Object.keys(d.tables.layer.layers)).toEqual(expect.arrayContaining(['BOUWPLAATS_KEET', 'BOUWPLAATS_BOUWHEKKEN', 'KRAAN_ZWENKCIRKEL', 'TEKSTEN']));
  });
  it('bevat de geometrie in RD-coördinaten', () => {
    const keet = d.entities.filter((e: any) => e.layer === 'BOUWPLAATS_KEET');
    expect(keet.length).toBe(2);
    expect(keet[0].shape).toBe(true);
    expect(keet[0].vertices.length).toBe(4);
    expect(keet[0].vertices[1].x).toBeCloseTo(105606, 3);
    const c = d.entities.find((e: any) => e.type === 'CIRCLE');
    expect(c.radius).toBeCloseTo(45, 3);
    expect(c.center.y).toBeCloseTo(424620, 3);
    expect(d.entities.find((e: any) => e.type === 'TEXT').text).toContain('Keet');
  });
  it('laagnamen en kleuren', () => {
    expect(dxfLayerName('Bouwplaats – Steiger (gevel)')).toBe('BOUWPLAATS_STEIGER_GEVEL');
    expect(dxfLayerName('ééé')).toBe('EEE');
    expect(aciFromHex('#ff0000')).toBe(1);
    expect(aciFromHex('#00ff00')).toBe(3);
  });
});

describe('GeoJSON-export', () => {
  const g: any = toGeoJSON(F);
  it('RD met crs en gesloten ringen', () => {
    expect(g.crs.properties.name).toContain('28992');
    const ring = g.features[4].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(g.features[2].properties.straal).toBe(45);
    expect(g.features[1].geometry.type).toBe('LineString');
  });
});

describe('Legenda', () => {
  it('unieke items per groep, zonder teksten', () => {
    const l = legendFrom(F);
    expect(l.map((q) => q.tekst)).toEqual(['Keet', 'Bouwhekken', 'Zwenkcirkel']);
    expect(l[2].stijl).toBe('cirkel');
  });
});

import { layout, kaartMeters, schaalbalk, makePdf, pdfTekst } from '../src/export/pdf';
describe('PDF-indeling', () => {
  it('A3 liggend: kaart + kolom passen binnen het kader', () => {
    const L = layout('A3');
    expect(L.blad).toEqual([420, 297]);
    expect(L.kaart.x + L.kaart.w).toBeCloseTo(L.kolom.x, 6);
    expect(L.kolom.x + L.kolom.w).toBeCloseTo(410, 6);
    expect(L.titel.y + L.titel.h).toBeCloseTo(287, 6);
  });
  it('kaartvlak op schaal', () => {
    const m = kaartMeters('A3', 200);
    expect(m.w).toBeCloseTo((layout('A3').kaart.w * 200) / 1000, 6);
    expect(kaartMeters('A1', 500).w).toBeGreaterThan(300);
  });
  it('schaalbalk heeft een ronde lengte en de juiste lengte op papier', () => {
    const s = schaalbalk(200, 55);
    expect(s.meters).toBe(10);
    expect(s.mm).toBeCloseTo(50, 6);
    expect(schaalbalk(500, 55).meters).toBe(20);
  });
  it('maakt een PDF', () => {
    const png1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const doc = makePdf({ papier: 'A3', schaal: 200, kaart: { dataUrl: png1, formaat: 'PNG' }, titel: { project: 'Sporthal Latourpad', nummer: '123', onderdeel: 'Bouwplaatsinrichting', fase: 'Ruwbouw', datum: '20-11-2026', getekendDoor: 'BH', status: 'Concept' },
      legenda: [{ groep: 'Bouwplaatselementen', tekst: 'Keet', kleur: '#1e88e5', stijl: 'vlak' }], ondergrond: 'luchtfoto', bronnen: ['BGT', '3D BAG'], disclaimer: 'Indicatief.', middenRD: [105610, 424680] });
    const out = doc.output('arraybuffer');
    expect(new TextDecoder().decode(new Uint8Array(out).slice(0, 5))).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBe(1);
  });
  it('tekens die PDF-lettertypen niet kennen worden vervangen', () => {
    expect(pdfTekst('≈ 1:200 ⚠ ✔ – é')).toBe('~ 1:200 ! v – é');
  });
});

import { inFase } from '../src/core/project';
describe('Bouwfases', () => {
  it('objecten zonder fase-indeling zijn altijd zichtbaar', () => {
    expect(inFase({}, 'sloop')).toBe(true);
    expect(inFase({ fases: [] }, 'sloop')).toBe(true);
    expect(inFase({ fases: ['ruwbouw'] }, 'sloop')).toBe(false);
    expect(inFase({ fases: ['ruwbouw', 'sloop'] }, 'sloop')).toBe(true);
    expect(inFase({ fases: ['ruwbouw'] }, '')).toBe(true);
  });
});

import { collectFeatures } from '../src/export/collect';
import { newElement } from '../src/core/elements';
import { newTowerCrane } from '../src/cranes/cranes';
describe('Tekenobjecten verzamelen', () => {
  it('elementen, hekken met poort, kranen en legenda', () => {
    const e = newElement('keet', 105600, 424600, 0);
    const hek = { id: 'h', soort: 'hekwerk' as const, geom: 'lijn' as const, naam: 'hek', coords: [[0, 0], [14, 0]] as [number, number][], poorten: [{ id: 'p', start: 1, aantal: 2 }] };
    const f = collectFeatures({ elementen: [e], handmatig: [hek], routes: [], kranen: [newTowerCrane(10, 10)], grens: null, ontwerp: null });
    const lagen = new Set(f.map((q) => q.laag));
    expect(lagen.has('Bouwplaats – Schaftkeet / kantoorunit')).toBe(true);
    expect(f.filter((q) => q.laag === 'Eigen – Poorten').length).toBe(2);
    expect(f.filter((q) => q.laag === 'Eigen – Bouwhekken').length).toBe(2);
    expect(f.some((q) => q.geom.type === 'circle' && q.laag === 'Kraan – zwenkcirkel giek')).toBe(true);
    const leg = legendFrom(f).map((q) => q.tekst);
    expect(leg).toContain('Poort in bouwhek');
    expect(leg).toContain('Zwenkcirkel giek');
    // DXF van het geheel is leesbaar
    const d: any = new DxfParser().parseSync(toDxf(f, { titel: 't' }));
    expect(d.entities.length).toBeGreaterThan(10);
  });
});
