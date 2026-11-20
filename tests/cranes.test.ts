import { describe, it, expect } from 'vitest';
import { maxLoadAt, parseTable, canLift, newTowerCrane, newMobileCrane, overlaps, craneWarnings, circleHitsRing, loadRings, mobileRadius, outriggerPads, type CraneEnv } from '../src/cranes/cranes';

const T = [{ radius: 3, last: 10 }, { radius: 10, last: 6 }, { radius: 20, last: 2 }];

describe('Lasttabel-interpolatie', () => {
  it('geeft tabelwaarden exact terug', () => {
    expect(maxLoadAt(T, 3)).toBe(10);
    expect(maxLoadAt(T, 10)).toBe(6);
    expect(maxLoadAt(T, 20)).toBe(2);
  });
  it('interpoleert lineair', () => {
    expect(maxLoadAt(T, 15)).toBeCloseTo(4, 10);
    expect(maxLoadAt(T, 6.5)).toBeCloseTo(8, 10);
  });
  it('extrapoleert nooit', () => {
    expect(maxLoadAt(T, 2.99)).toBeNull();
    expect(maxLoadAt(T, 20.01)).toBeNull();
    expect(maxLoadAt([], 5)).toBeNull();
  });
  it('sorteert ongeordende invoer en negeert dubbele radii', () => {
    expect(maxLoadAt([{ radius: 20, last: 2 }, { radius: 3, last: 10 }, { radius: 10, last: 6 }, { radius: 10, last: 99 }], 15)).toBeCloseTo(4, 10);
  });
  it('leest tabellen met komma, puntkomma, tab en kopregel', () => {
    const r = parseTable('Radius;Last\n3;10\n10\t6\n20 2\n12,5;5,0\nfout');
    expect(r.tabel.map((p) => p.radius)).toEqual([3, 10, 12.5, 20]);
    expect(r.tabel[2].last).toBe(5);
    expect(r.fouten.length).toBe(1);
  });
});

describe('Kan last X op positie Y', () => {
  const c = { ...newTowerCrane(0, 0), lasttabel: T, giekLengte: 20 };
  it('OK binnen het draagvermogen', () => {
    const r = canLift(c, 15, 0, 3.9);
    expect(r.ok).toBe(true);
    expect(r.max).toBeCloseTo(4, 6);
    expect(r.radius).toBeCloseTo(15, 6);
  });
  it('NIET OK boven het draagvermogen', () => expect(canLift(c, 0, 15, 4.1).ok).toBe(false));
  it('NIET OK buiten de tabel of de giek', () => {
    expect(canLift(c, 25, 0, 0.1).ok).toBe(false);
    expect(canLift(c, 1, 0, 0.1).ok).toBe(false);
    expect(canLift(c, 25, 0, 0.1).max).toBeNull();
  });
});

describe('Kraancontroles', () => {
  it('waarschuwt bij overlappende zwenkgebieden', () => {
    const a = { ...newTowerCrane(0, 0), giekLengte: 40 };
    const b = { ...newTowerCrane(60, 0), giekLengte: 30 };
    const c = { ...newTowerCrane(200, 0), giekLengte: 30 };
    const o = overlaps([a, b, c]);
    expect(o.length).toBe(1);
    expect(o[0].a).toBe(a.id);
  });
  it('cirkel-polygoon', () => {
    const sq = [[10, -1], [12, -1], [12, 1], [10, 1], [10, -1]];
    expect(circleHitsRing(0, 0, 10.5, sq)).toBe(true);
    expect(circleHitsRing(0, 0, 9.5, sq)).toBe(false);
    expect(circleHitsRing(11, 0, 0.1, sq)).toBe(true);
  });
  it('overdraai en hoogteconflict', () => {
    const c = { ...newTowerCrane(0, 0), giekLengte: 30, haakhoogte: 20, contragiekLengte: 10, contragiekHoogte: 21 };
    const env: CraneEnv = {
      maaiveld: 0,
      grens: { lijnen: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]], gesloten: true, bron: 'perceelgrens' },
      wegen: [{ naam: 'Rijbaan', ring: [[25, -50], [35, -50], [35, 50], [25, 50], [25, -50]] }],
      panden: [
        { id: 'p1', naam: 'pand A', ring: [[-28, -2], [-24, -2], [-24, 2], [-28, 2], [-28, -2]], hoogteNAP: 25 },
        { id: 'p2', naam: 'pand B', ring: [[-8, 0], [-6, 0], [-6, 2], [-8, 2], [-8, 0]], hoogteNAP: 21.5 },
        { id: 'p3', naam: 'pand C', ring: [[-90, 0], [-80, 0], [-80, 2], [-90, 0]], hoogteNAP: 50 },
      ],
      hoog: [],
    };
    const w = craneWarnings(c, env);
    const soorten = w.map((q) => q.soort);
    expect(soorten).toContain('overdraai perceel');
    expect(soorten).toContain('overdraai weg');
    expect(soorten).toContain('overdraai buurpand');
    const h = w.filter((q) => q.soort === 'hoogte').map((q) => q.tekst);
    expect(h.some((t) => t.includes('pand A'))).toBe(true); // hoger dan de haak
    expect(h.some((t) => t.includes('pand B'))).toBe(true); // raakt contragiek
    expect(h.some((t) => t.includes('pand C'))).toBe(false); // buiten bereik
  });
  it('ringen en mobiele kraan', () => {
    const c = newMobileCrane(0, 0);
    const r = loadRings(c);
    expect(r[0].radius).toBe(5);
    expect(r[r.length - 1].radius).toBe(36);
    expect(mobileRadius({ ...c, giekHoek: 60, giekLengte: 30, scharnierOffset: 0 })).toBeCloseTo(15, 6);
    expect(outriggerPads(c)).toHaveLength(4);
  });
});
