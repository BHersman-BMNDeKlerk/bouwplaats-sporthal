import { describe, expect, it } from 'vitest';
import { alignToEdge, carsForBay, checkCollisions, footprint, newElement, orientedRect, polygonsOverlap, snapAngle, totalHeight } from '../src/core/elements';

describe('elementen', () => {
  it('standaardmaten (keet 6,0 × 2,4, containers 20/40 voet, auto, bus)', () => {
    expect([newElement('keet', 0, 0).lengte, newElement('keet', 0, 0).breedte]).toEqual([6, 2.4]);
    expect(newElement('container40', 0, 0).lengte).toBeCloseTo(12.19);
    expect([newElement('auto', 0, 0).lengte, newElement('auto', 0, 0).breedte, newElement('auto', 0, 0).hoogte]).toEqual([4.5, 1.8, 1.5]);
    expect([newElement('bestelbus', 0, 0).lengte, newElement('bestelbus', 0, 0).hoogte]).toEqual([6, 2.5]);
  });

  it('stapelen verhoogt de totale hoogte', () => {
    const k = { ...newElement('keet', 0, 0), stapel: 2 };
    expect(totalHeight(k)).toBeCloseTo(5.2);
  });

  it('footprint met rotatie', () => {
    const f = footprint({ x: 10, y: 10, rotatie: 90, lengte: 6, breedte: 2 });
    // na 90° ligt de lengte in y-richting
    const xs = f.map((p) => p[0]), ys = f.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6);
  });

  it('rotatie-snap 5/15/90 graden', () => {
    expect(snapAngle(37, 15)).toBe(30);
    expect(snapAngle(38, 5)).toBe(40);
    expect(snapAngle(50, 90)).toBe(90);
    expect(snapAngle(-10, 15)).toBe(345);
  });

  it('overlap van polygonen', () => {
    const a = [[0, 0], [4, 0], [4, 4], [0, 4]], b = [[3, 3], [6, 3], [6, 6], [3, 6]], c = [[5, 5], [6, 5], [6, 6], [5, 6]];
    expect(polygonsOverlap(a, b)).toBe(true);
    expect(polygonsOverlap(a, c)).toBe(false);
    expect(polygonsOverlap(a, [[1, 1], [2, 1], [2, 2], [1, 2]])).toBe(true); // binnenin
  });
});

describe('botsingscontrole', () => {
  const kavel = [[[0, 0], [50, 0], [50, 30], [0, 30], [0, 0]]];
  const base = { obstakels: [], grens: { lijnen: [kavel[0]], gesloten: true, bron: 'BRK' }, toegestaan: [kavel] };

  it('tegen elkaar geplaatste keten geven geen conflict, overlappende wel', () => {
    const k1 = newElement('keet', 10, 10), k2 = { ...newElement('keet', 16, 10), id: 'k2' }, k3 = { ...newElement('keet', 12, 11), id: 'k3' };
    expect(checkCollisions({ ...base, elementen: [k1, k2] })).toEqual([]);
    const c = checkCollisions({ ...base, elementen: [k1, k3] });
    expect(c.filter((x) => x.soort === 'element').length).toBe(2);
  });

  it('geparkeerde auto buiten de kavel is geen conflict, maar een keet erop wel', () => {
    const a = newElement('auto', 70, 10);
    expect(checkCollisions({ ...base, elementen: [a] })).toEqual([]);
    const k = { ...newElement('keet', 70, 10), id: 'k' };
    const c = checkCollisions({ ...base, elementen: [a, k] });
    expect(c.filter((x) => x.elementId === a.id).map((x) => x.soort)).toEqual(['element']);
  });

  it('auto op een opslagvlak/parkeervak is geen conflict', () => {
    const v = newElement('parkeervak', 10, 10), a = { ...newElement('auto', 10, 10), id: 'a' };
    expect(checkCollisions({ ...base, elementen: [v, a] })).toEqual([]);
  });

  it('gebouw, perceelgrens en buiten de kavel', () => {
    const geb = { id: 'g', soort: 'gebouw' as const, naam: 'Pand 1', rings: [[[20, 20], [30, 20], [30, 28], [20, 28]]], bbox: [20, 20, 30, 28] as [number, number, number, number] };
    const e1 = newElement('container20', 22, 21);
    expect(checkCollisions({ ...base, obstakels: [geb], elementen: [e1] }).map((c) => c.soort)).toContain('gebouw');
    const e2 = newElement('keet', 49, 10); // steekt over de grens
    expect(checkCollisions({ ...base, elementen: [e2] }).map((c) => c.soort)).toEqual(['perceelgrens']);
    const e3 = newElement('keet', 70, 10); // helemaal buiten
    expect(checkCollisions({ ...base, elementen: [e3] }).map((c) => c.soort)).toEqual(['buiten kavel']);
    // met een vergunde zone naast de kavel is buiten de grens wel toegestaan
    const zone = [[[50, 0], [80, 0], [80, 30], [50, 30], [50, 0]]];
    expect(checkCollisions({ ...base, grens: null, toegestaan: [kavel, zone], elementen: [e3] })).toEqual([]);
  });
});

describe('parkeervakken bezet', () => {
  it('haaks vak: één auto in de lengterichting', () => {
    const vak = [[0, 0], [2.5, 0], [2.5, 5], [0, 5], [0, 0]];
    const r = orientedRect(vak);
    expect(r.lengte).toBeCloseTo(5);
    const cars = carsForBay(vak);
    expect(cars.length).toBe(1);
    expect(cars[0].x).toBeCloseTo(1.25);
    expect(cars[0].y).toBeCloseTo(2.5);
    expect(Math.round(cars[0].rotatie) % 180).toBe(90);
  });

  it('langsparkeerstrook van 18 m: drie auto’s', () => {
    expect(carsForBay([[0, 0], [18, 0], [18, 2], [0, 2], [0, 0]]).length).toBe(3);
  });

  it('te klein vak: geen auto', () => {
    expect(carsForBay([[0, 0], [1, 0], [1, 1], [0, 1]])).toEqual([]);
  });
});

describe('steiger uitlijnen op gevel', () => {
  it('legt de steiger evenwijdig aan de dichtstbijzijnde gevel, 0,15 m ervan af', () => {
    const gebouw = [[[0, 0], [20, 0], [20, 10], [0, 10]]];
    const st = { ...newElement('steiger', 8, -2.5, 30), breedte: 1 };
    const r = alignToEdge(st, gebouw)!;
    expect(r.rotatie).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(-0.65); // 0,5 m halve breedte + 0,15 m
    expect(r.x).toBeCloseTo(8);
    expect(alignToEdge({ ...st, x: 50, y: 50 }, gebouw)).toBeNull();
    // cursor binnen het gebouw: steiger komt toch aan de buitenkant
    expect(alignToEdge({ ...st, x: 8, y: 1 }, gebouw)!.y).toBeCloseTo(-0.65);
  });
});
