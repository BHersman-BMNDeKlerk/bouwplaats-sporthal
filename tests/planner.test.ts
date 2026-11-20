import { describe, it, expect } from 'vitest';
import { VEHICLES, type VehicleSpec } from '../src/vehicles/vehicles';
import { plan, distanceTransform, type PlanInput } from '../src/vehicles/planner';
import { samplesFromPoses, trailerAxle } from '../src/vehicles/kinematics';
import { routeConflicts, bboxOf, type RouteObstacle } from '../src/vehicles/sweep';

const veh = (id: string): VehicleSpec => ({ ...VEHICLES.find((v) => v.id === id)! });
const box = (id: string, x0: number, y0: number, x1: number, y1: number): RouteObstacle => {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  return { id, naam: id, soort: 'gebouw', ring, bbox: bboxOf(ring) };
};
function check(inp: PlanInput) {
  const r = plan(inp);
  expect(r.ok, r.reden).toBe(true);
  const sim = samplesFromPoses(r.poses);
  const conf = routeConflicts(inp.v, sim.samples, inp.obstacles);
  return { r, sim, conf };
}

describe('Afstandstransformatie', () => {
  it('geeft de afstand tot het dichtstbijzijnde obstakel', () => {
    const b = new Uint8Array(21 * 21); b[10 * 21 + 10] = 1;
    const d = distanceTransform(b, 21, 21, 0.5);
    expect(d[10 * 21 + 10]).toBe(0);
    expect(d[10 * 21 + 14]).toBeCloseTo(2, 6);
    expect(d[13 * 21 + 14]).toBeCloseTo(2.5, 6);
  });
});

describe('Routeplanner (Hybrid A*)', () => {
  it('rechtdoor in een vrij veld', () => {
    const { r, sim, conf } = check({ v: veh('bakwagen-10'), start: { x: 0, y: 0, theta: 0 }, goal: { x: 30, y: 0, heading: 0 }, obstacles: [], soft: [] });
    expect(r.wissels).toBe(0);
    expect(sim.uitvoerbaar).toBe(true);
    expect(conf.length).toBe(0);
  });

  it('haakse bocht in een straat van 8 m zonder botsing', () => {
    // straat langs x (y −4…4) tot x = 40, dan naar boven (x 32…40)
    const obs = [box('zuid', -10, -14, 60, -4), box('blok', -10, 4, 32, 40), box('oost', 40, -4, 60, 40)];
    const { sim, conf } = check({ v: veh('bakwagen-10'), start: { x: 0, y: 0, theta: 0 }, goal: { x: 36, y: 25, heading: Math.PI / 2 }, obstacles: obs, soft: [] });
    expect(conf).toEqual([]);
    expect(sim.uitvoerbaar).toBe(true);
  });

  it('steekt achteruit een laadvak in (met wissel van rijrichting)', () => {
    // straat y 0…10, laadvak aan de noordkant: x 20…24, y 10…22
    const obs = [box('zuid', -20, -10, 70, 0), box('noordW', -20, 10, 19.5, 30), box('noordO', 24.5, 10, 70, 30), box('eind', 19.5, 22, 24.5, 30)];
    const v = veh('bakwagen-10');
    const { r, conf } = check({ v, start: { x: 0, y: 5, theta: 0 }, goal: { x: 22, y: 18, heading: -Math.PI / 2 }, obstacles: obs, soft: [] });
    expect(r.legs.some((l) => l.richting === 'achteruit')).toBe(true);
    expect(conf).toEqual([]);
  });

  it('meldt dat er geen route is als het doel ingesloten is', () => {
    const obs = [box('a', 18, -10, 40, -6), box('b', 18, 6, 40, 10), box('c', 36, -10, 40, 10), box('d', 18, -10, 20, 10)];
    const r = plan({ v: veh('bestelbus'), start: { x: 0, y: 0, theta: 0 }, goal: { x: 28, y: 0, heading: null }, obstacles: obs, soft: [], maxTijdMs: 4000 });
    expect(r.ok).toBe(false);
  });

  it('trekker-oplegger door een haakse bocht van 12 m breed', () => {
    const obs = [box('zuid', -30, -16, 80, -6), box('blok', -30, 6, 40, 60), box('oost', 52, -6, 80, 60)];
    const v = veh('trekker-oplegger');
    const { r, conf, sim } = check({ v, start: { x: 0, y: 0, theta: 0 }, goal: { x: 46, y: 35, heading: Math.PI / 2 }, obstacles: obs, soft: [] });
    expect(conf).toEqual([]);
    const end = trailerAxle(v, sim.samples[sim.samples.length - 1]);
    expect(Math.hypot(end[0] - 46, end[1] - 35)).toBeLessThan(1.5);
    expect(r.ok).toBe(true);
  }, 30000);
});

describe('Start of eind op een obstakel', () => {
  it('schuift naar de dichtstbijzijnde vrije plek', () => {
    const obs = [box('paal', -1, -6, 1, -1)]; // achterkant van de wagen staat erin
    const r = plan({ v: veh('bakwagen-10'), start: { x: 0, y: -3, theta: Math.PI / 2 }, goal: { x: 0, y: 25, heading: Math.PI / 2 }, obstacles: obs, soft: [] });
    expect(r.ok, r.reden).toBe(true);
    expect(r.startVerschoven).toBeGreaterThan(0);
    expect(routeConflicts(veh('bakwagen-10'), samplesFromPoses(r.poses).samples, obs)).toEqual([]);
  });
  it('start met afwijkende knikhoek (vervolgdeel van een oplegger)', () => {
    const r = plan({ v: veh('trekker-oplegger'), start: { x: 0, y: 0, theta: 0.3, phi: 0 }, goal: { x: 40, y: 5, heading: 0 }, obstacles: [], soft: [] });
    expect(r.ok, r.reden).toBe(true);
    expect(r.poses[0].phi).toBe(0);
  });
});
