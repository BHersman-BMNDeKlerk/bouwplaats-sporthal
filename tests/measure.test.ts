import { describe, expect, it } from 'vitest';
import { measureTotals, offsetSegment, segmentStats, SnapIndex } from '../src/core/measure';

describe('meten', () => {
  it('horizontale en ruimtelijke afstand, hoogteverschil en richting', () => {
    const s = segmentStats({ x: 0, y: 0, h: 0 }, { x: 3, y: 4, h: 12 });
    expect(s.horizontaal).toBe(5);
    expect(s.ruimtelijk).toBe(13);
    expect(s.dh).toBe(12);
    expect(s.richting).toBeCloseTo(36.87, 2); // vanaf noord met de klok mee
    expect(segmentStats({ x: 0, y: 0, h: 0 }, { x: -1, y: 0, h: 0 }).richting).toBe(270);
  });

  it('totalen over meerdere punten', () => {
    const t = measureTotals([{ x: 0, y: 0, h: 0 }, { x: 10, y: 0, h: 0 }, { x: 10, y: 5, h: 0 }]);
    expect(t.segmenten.length).toBe(2);
    expect(t.horizontaal).toBe(15);
  });

  it('snappen naar het dichtstbijzijnde hoekpunt binnen de tolerantie', () => {
    const s = new SnapIndex(5);
    s.addRings([[[100, 100], [110, 100], [110, 108]]], 'gebouw');
    s.add(104.9, 99.9, 'grens');
    expect(s.nearest(105.2, 100.1, 1)).toMatchObject({ x: 104.9, y: 99.9, bron: 'grens' });
    expect(s.nearest(109.6, 107.7, 1)).toMatchObject({ x: 110, y: 108, bron: 'gebouw' });
    expect(s.nearest(120, 120, 1)).toBeNull();
  });

  it('maatlijn verschuiven naar links van de looprichting', () => {
    const [a, b] = offsetSegment([0, 0], [10, 0], 2);
    expect(a[0]).toBeCloseTo(0);
    expect(a[1]).toBeCloseTo(2);
    expect(b).toEqual([10, 2]);
  });
});
