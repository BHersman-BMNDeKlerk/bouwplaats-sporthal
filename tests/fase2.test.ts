import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeBoundary, compareWithBrk, ownParcels, polylineLength } from '../src/core/boundary';
import { emptyProject, parseProject, ProjectStore } from '../src/core/project';
import { guessSoort, parsePointsCsv } from '../src/data/csvPoints';
import { dxfToRD, looksLikeRD, parseDxf } from '../src/data/dxf';
import { bronhouderOf, nearestDepth, parseKlicXml, themaStyle } from '../src/data/klic';

// ---------------------------------------------------------------------------
describe('CSV meetpunten', () => {
  it('puntkomma, decimale komma, kopregel', () => {
    const r = parsePointsCsv('Puntnummer;X;Y;Z;Code\n1;105600,123;424680,456;-0,12;GRENS\n2;105610,000;424680,000;0,05;GRENS\n');
    expect(r.scheidingsteken).toBe(';');
    expect(r.punten).toEqual([
      { nr: '1', x: 105600.123, y: 424680.456, z: -0.12, code: 'GRENS' },
      { nr: '2', x: 105610, y: 424680, z: 0.05, code: 'GRENS' },
    ]);
  });

  it('komma als scheidingsteken met decimale punten, zonder kopregel', () => {
    const r = parsePointsCsv('101,105600.10,424680.20,0.33,PUT\n102,105601.00,424681.00,,BOOM\n');
    expect(r.scheidingsteken).toBe(',');
    expect(r.punten[0]).toEqual({ nr: '101', x: 105600.1, y: 424680.2, z: 0.33, code: 'PUT' });
    expect(r.punten[1].z).toBeNull();
  });

  it('spaties/tab, code met meerdere woorden, BOM en commentaar', () => {
    const r = parsePointsCsv('﻿# export landmeter\n5\t105600.5\t424680.5\t0.10\tboom eik\n6  105601.5  424681.5  0.20  lichtmast oud\n');
    expect(r.punten.length).toBe(2);
    expect(r.punten[1].code).toBe('lichtmast oud');
  });

  it('herkent verwisselde X/Y en waarschuwt', () => {
    const r = parsePointsCsv('1;424680;105600;0\n');
    expect(r.punten[0].x).toBe(105600);
    expect(r.waarschuwingen.join(' ')).toMatch(/verwisseld/);
  });

  it('meldt onleesbare regels en lege bestanden', () => {
    expect(() => parsePointsCsv('')).toThrow(/leeg/);
    const r = parsePointsCsv('1;105600;424680;0\nkapot;regel\n');
    expect(r.punten.length).toBe(1);
    expect(r.waarschuwingen.some((w) => w.includes('overgeslagen'))).toBe(true);
  });

  it('codes → soort (voorstel)', () => {
    expect(guessSoort('PUT')).toBe('putdeksel');
    expect(guessSoort('kolk')).toBe('putdeksel');
    expect(guessSoort('BOOM')).toBe('boom');
    expect(guessSoort('lantaarnpaal')).toBe('paal');
    expect(guessSoort('GRENS')).toBe('grenspunt');
    expect(guessSoort('maaiveld')).toBe('hoogtemaat');
    expect(guessSoort('XYZ')).toBe('overig');
  });
});

// ---------------------------------------------------------------------------
describe('perceelgrens: ingemeten heeft voorrang op BRK', () => {
  const brk = [{ id: 'p1', properties: { sectie: 'D', perceelnummer: 4999 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]]] } },
    { id: 'p2', properties: { sectie: 'D', perceelnummer: 5000 }, geometry: { type: 'Polygon', coordinates: [[[30, 0], [60, 0], [60, 20], [30, 20], [30, 0]]] } }];
  const footprint = [[[5, 5], [25, 5], [25, 15], [5, 15]]];
  const own = ownParcels(brk, footprint);

  it('vindt het eigen BRK-perceel onder het pand', () => {
    expect(own.map((p) => p.id)).toEqual(['p1']);
  });

  it('zonder inmeting: BRK met waarschuwing "indicatieve grens"', () => {
    const b = activeBoundary(undefined, own);
    expect(b.bron).toBe('brk');
    expect(b.waarschuwing).toMatch(/Indicatieve grens/);
    expect(b.lijnen.length).toBe(1);
  });

  it('met inmeting: ingemeten grens, geen waarschuwing; gesloten ring', () => {
    const g = { bestand: 'grens.csv', geimporteerd: '', gesloten: true, punten: [{ nr: '1', x: 0.1, y: 0, z: 0 }, { nr: '2', x: 29.8, y: 0.5, z: 0 }, { nr: '3', x: 30, y: 20, z: 0 }, { nr: '4', x: 0, y: 20, z: 0 }] };
    const b = activeBoundary(g, own);
    expect(b.bron).toBe('ingemeten');
    expect(b.waarschuwing).toBeNull();
    expect(b.lijnen[0].length).toBe(5);
    expect(polylineLength(b.lijnen[0])).toBeCloseTo(99.2, 1);
    const c = compareWithBrk(g.punten, own[0].polys.map((p) => p[0]))!;
    expect(c.max).toBeCloseTo(0.2, 2);
    expect(c.maxNr).toBe('2');
  });
});

// ---------------------------------------------------------------------------
describe('KLIC (IMKL 2.0) – fragment uit een Kadaster-voorbeeldlevering', () => {
  const xml = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/klic-imkl2-voorbeeld.xml'), 'utf8');
  const k = parseKlicXml(xml);

  it('leest melding en beheerders', () => {
    expect(k.meldnummer).toMatch(/^\d{2}[A-Z]\d{6}$/);
    expect(k.beheerders.length).toBeGreaterThan(0);
    expect(k.beheerders.every((b) => b.naam)).toBe(true);
  });

  it('koppelt leidingen aan hun lijngeometrie (UtilityLink) en thema (Utiliteitsnet)', () => {
    expect(k.lijnen.length).toBe(2);
    for (const l of k.lijnen) {
      expect(l.type).toBe('Waterleiding');
      expect(l.thema).toBe('water');
      expect(l.lines[0].length).toBeGreaterThanOrEqual(2);
      expect(l.lines[0][0][0]).toBeGreaterThan(100000);
      expect(l.status).toBe('buiten gebruik'); // in deze levering staan ze als 'disused'
    }
    expect(k.themas.water).toBe(2);
    expect(themaStyle('water').label).toBe('Water');
  });

  it('leest diepte-aanduidingen (t.o.v. maaiveld)', () => {
    expect(k.diepten.length).toBe(1);
    const d = k.diepten[0];
    expect(d.soort).toBe('tovMaaiveld');
    expect(d.waarde).toBeGreaterThan(0);
    expect(d.thema).toBe('water');
    expect(nearestDepth(k.diepten, d.x + 1, d.y, 'water')).toBe(d);
    expect(nearestDepth(k.diepten, d.x + 1, d.y, 'gasLageDruk')).toBeNull();
  });

  it('leest EV-vlakken en annotaties', () => {
    expect(k.ev.length).toBe(1);
    expect(k.ev[0].rings[0].length).toBeGreaterThan(3);
    expect(k.ev[0].eis).not.toBe('');
    expect(k.labels.some((l) => l.soort === 'annotatie' && l.label)).toBe(true);
  });

  it('bronhoudercode uit IMKL-id', () => {
    expect(bronhouderOf('nl.imkl-KL1040.UNET_electricityMS_3')).toBe('KL1040');
    expect(bronhouderOf('nl.imkl-GM1735.RVV_10066')).toBe('GM1735');
  });

  it('weigert geen-GML met duidelijke melding', () => {
    expect(() => parseKlicXml('<foo/>')).toThrow(/KLIC/);
  });
});

// ---------------------------------------------------------------------------
const DXF = [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'BLOCKS',
  '0', 'BLOCK', '8', '0', '2', 'KOLOM', '70', '0', '10', '0', '20', '0', '30', '0',
  '0', 'LINE', '8', '0', '10', '-150', '20', '0', '30', '0', '11', '150', '21', '0', '31', '0',
  '0', 'ENDBLK', '8', '0',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', 'GEVEL', '10', '0', '20', '0', '30', '0', '11', '10000', '21', '0', '31', '0',
  '0', 'LWPOLYLINE', '8', 'GEVEL', '90', '3', '70', '1', '10', '0', '20', '0', '10', '10000', '20', '0', '10', '10000', '20', '5000',
  '0', 'ARC', '8', 'MAAT', '10', '0', '20', '0', '30', '0', '40', '1000', '50', '0', '51', '90',
  '0', 'TEXT', '8', 'TEKST', '10', '500', '20', '500', '30', '0', '40', '250', '1', 'Gymzaal',
  '0', 'INSERT', '8', 'CONSTRUCTIE', '2', 'KOLOM', '10', '2000', '20', '1000', '30', '0', '50', '90',
  '0', 'ENDSEC', '0', 'EOF',
].join('\n');

describe('DXF-onderlegger', () => {
  const d = parseDxf(DXF);

  it('leest eenheid, lagen, lijnen, bogen, teksten en blokken', () => {
    expect(d.eenheidM).toBe(0.001);
    expect(d.lagen.map((l) => l.naam)).toEqual(['CONSTRUCTIE', 'GEVEL', 'MAAT']);
    expect(d.teksten[0].tekst).toBe('Gymzaal');
    // boog van 90° in stukjes van max 5°
    const arc = d.lijnen.find((l) => l.laag === 'MAAT')!;
    expect(arc.pts.length / 2).toBeGreaterThanOrEqual(19);
    expect(arc.pts[arc.pts.length - 2]).toBeCloseTo(0, 6);
    expect(arc.pts[arc.pts.length - 1]).toBeCloseTo(1000, 6);
    // gesloten polylijn: eindpunt = beginpunt
    const pl = d.lijnen.find((l) => l.gesloten)!;
    expect(pl.pts.slice(-2)).toEqual(pl.pts.slice(0, 2));
    // blok 90° gedraaid op (2000, 1000): lijn van (2000,850) tot (2000,1150)
    const k = d.lijnen.find((l) => l.laag === 'CONSTRUCTIE')!;
    expect(k.pts[0]).toBeCloseTo(2000, 6);
    expect(k.pts[1]).toBeCloseTo(850, 6);
    expect(k.pts[3]).toBeCloseTo(1150, 6);
  });

  it('plaatsing: RD, via IFC-nulpunt of handmatig', () => {
    const ifc = { x: 105653.6, y: 424646.8, rotatie: 90, peil: -0.08 };
    const viaIfc = dxfToRD({ modus: 'ifc', x: 0, y: 0, rotatie: 0, eenheidM: 0.001 }, ifc);
    const [x, y] = viaIfc(10000, 0); // 10 m langs IFC-x, 90° gedraaid → 10 m naar het noorden
    expect(x).toBeCloseTo(105653.6, 6);
    expect(y).toBeCloseTo(424656.8, 6);
    const hand = dxfToRD({ modus: 'handmatig', x: 105000, y: 424000, rotatie: 0, eenheidM: 1 }, null);
    expect(hand(1, 2)).toEqual([105001, 424002]);
    expect(looksLikeRD(d, 0.001, 105600, 424680)).toBe(false);
  });

  it('melding bij geen tekenbare inhoud', () => {
    expect(() => parseDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'ENDSEC', '0', 'EOF'].join('\n'))).toThrow(/Geen tekenbare/);
  });
});

// ---------------------------------------------------------------------------
describe('projectbestand fase 2', () => {
  it('grote importdata (bijlagen) valt buiten undo, maar wordt wel opgeslagen', () => {
    const s = new ProjectStore(emptyProject('x'));
    s.addBijlage('klic-1', { formaat: 1 } as any);
    s.change('KLIC', (d) => { d.klic.push({ id: 'klic-1', meldnummer: '26G000001', referentie: '', bestand: 'a.zip', geimporteerd: '', datumLevering: '', zichtbaar: true }); });
    s.change('obstakel', (d) => { d.handmatig.push({ id: 'm1', soort: 'paaltjes', geom: 'punten', coords: [[1, 2]], naam: 'P', hoogte: 0.9 }); });
    const saved = JSON.parse(s.serialize());
    expect(Object.keys(saved.bijlagen)).toEqual(['klic-1']);
    s.undo();
    s.undo();
    expect(s.data.klic.length).toBe(0);
    expect(s.data.bijlagen['klic-1']).toBeDefined(); // blijft in geheugen voor redo
    expect(Object.keys(JSON.parse(s.serialize()).bijlagen)).toEqual([]); // niet meer opgeslagen
    s.redo();
    expect(s.data.klic.length).toBe(1);
    const back = parseProject(s.serialize());
    expect(back.klic[0].meldnummer).toBe('26G000001');
  });

  it('weigert een project met ontbrekende bijlage', () => {
    const p = emptyProject('x');
    p.klic.push({ id: 'k', meldnummer: '1', referentie: '', bestand: '', geimporteerd: '', datumLevering: '', zichtbaar: true });
    expect(() => parseProject(JSON.stringify(p))).toThrow(/ontbreken/);
  });
});
