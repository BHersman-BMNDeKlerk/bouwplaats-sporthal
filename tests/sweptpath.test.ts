import { describe, it, expect } from 'vitest';
import { VEHICLES, VehicleSpec, curbRadius, wallRadius, effectiveMaxSteer, turningCircles, deltaForCurbDiameter } from '../src/vehicles/vehicles';
import { simulate, step, Pose, trailerAxle, kingpin, Leg } from '../src/vehicles/kinematics';
import { bodyAt, envelope, routeConflicts, bboxOf } from '../src/vehicles/sweep';

const veh = (id: string): VehicleSpec => ({ ...VEHICLES.find((v) => v.id === id)! });

/** Rijd met vaste stuurhoek tot stationaire toestand; geef de poses van de laatste ronde. */
function circle(v: VehicleSpec, delta: number, rounds = 4): Pose[] {
  let p: Pose = { x: 0, y: 0, theta: 0, phi: 0, delta };
  const R = v.wielbasis / Math.tan(delta);
  const per = 2 * Math.PI * R, ds = 0.02;
  const out: Pose[] = [];
  const n = Math.ceil((rounds * per) / ds);
  for (let i = 0; i < n; i++) {
    p = step(v, p, ds);
    if (i > n - per / ds) out.push(p);
  }
  return out;
}
const centre = (v: VehicleSpec, p: Pose): [number, number] => {
  const R = v.wielbasis / Math.tan(p.delta);
  return [p.x - R * Math.sin(p.theta), p.y + R * Math.cos(p.theta)];
};

describe('Verplichte test 1: EU-ringtest (trekker-oplegger 16,5 m)', () => {
  it('blijft binnen een ring van 12,50 m buiten en 5,30 m binnen', () => {
    const v = veh('trekker-oplegger');
    // stuurhoek zodat de buitenste voorhoek op R = 12,50 m loopt
    let lo = 0.05, hi = 1.2;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (wallRadius(v, m) > 12.5) lo = m; else hi = m; }
    const delta = (lo + hi) / 2;
    expect(delta).toBeLessThan(effectiveMaxSteer(v));
    const poses = circle(v, delta, 6);
    const c = centre(v, poses[0]);
    let rMax = 0, rMin = Infinity;
    for (const p of poses)
      for (const b of bodyAt(v, p).bodies) {
        for (const q of b) rMax = Math.max(rMax, Math.hypot(q[0] - c[0], q[1] - c[1]));
        // binnenzijde: kleinste afstand tot de randen
        for (let i = 0; i < 4; i++) {
          const a = b[i], e = b[(i + 1) % 4];
          const dx = e[0] - a[0], dy = e[1] - a[1];
          const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (dx * dx + dy * dy)));
          rMin = Math.min(rMin, Math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1]));
        }
      }
    expect(rMax).toBeLessThanOrEqual(12.5 + 0.02);
    expect(rMin).toBeGreaterThanOrEqual(5.3);
  });
});

describe('Verplichte test 2: analytische opleggerstraal', () => {
  it.each([8, 14, 20])('R_oplegger = √(R_kingpin² − Lt²) binnen ±0,10 m bij δ = %i°', (d) => {
    const v = veh('trekker-oplegger');
    const delta = (d * Math.PI) / 180;
    const poses = circle(v, delta, 8);
    const c = centre(v, poses[0]);
    const R = v.wielbasis / Math.tan(delta), k = v.koppelpunt!, Lt = v.opleggerWielbasis!;
    const Rk = Math.hypot(R, k);
    const expected = Math.sqrt(Rk * Rk - Lt * Lt);
    const p = poses[poses.length - 1];
    const ta = trailerAxle(v, p);
    expect(Math.abs(Math.hypot(ta[0] - c[0], ta[1] - c[1]) - expected)).toBeLessThan(0.1);
    const kp = kingpin(v, p);
    expect(Math.abs(Math.hypot(kp[0] - c[0], kp[1] - c[1]) - Rk)).toBeLessThan(0.05);
  });
});

describe('Verplichte test 3: draaicirkel volgens fabrikant', () => {
  it.each(['bakwagen-10', 'bakwagen-12', 'kipper-4as', 'mobiele-kraan-3'])('%s: stoep-stoep en muur-muur gereproduceerd binnen ±0,10 m', (id) => {
    const v = veh(id);
    v.draaicirkelStoep = id === 'bakwagen-10' ? 17.0 : 20.0;
    const d = effectiveMaxSteer(v);
    expect(Math.abs(2 * curbRadius(v, d) - v.draaicirkelStoep)).toBeLessThan(0.01);
    // gesimuleerd: buitenste voorband (buitenkant) en buitenste voorhoek
    const poses = circle(v, d, 3);
    const c = centre(v, poses[0]);
    let curb = 0, wall = 0;
    for (const p of poses) {
      const g = bodyAt(v, p);
      // buitenste voorwiel = rechts (bij linksom draaien), buitenkant band
      const [wx, wy] = g.wheels[1];
      const out = Math.hypot(wx - c[0], wy - c[1]) + v.bandbreedte / 2;
      curb = Math.max(curb, out);
      for (const q of g.bodies[0]) wall = Math.max(wall, Math.hypot(q[0] - c[0], q[1] - c[1]));
    }
    const tc = turningCircles(v);
    expect(Math.abs(2 * curb - v.draaicirkelStoep)).toBeLessThan(0.1);
    expect(Math.abs(2 * wall - tc.muur)).toBeLessThan(0.1);
  });
  it('deltaForCurbDiameter is de inverse van curbRadius', () => {
    const v = veh('bakwagen-12');
    const d = deltaForCurbDiameter(v, 21.3);
    expect(2 * curbRadius(v, d)).toBeCloseTo(21.3, 3);
  });
});

describe('Routevolgen', () => {
  const haaks = (r: number): [number, number][] => {
    const pts: [number, number][] = [[0, 0], [20, 0]];
    for (let a = 0; a <= 90; a += 5) pts.push([20 + r * Math.sin((a * Math.PI) / 180), r - r * Math.cos((a * Math.PI) / 180)]);
    pts.push([20 + r, r + 20]);
    return pts;
  };
  it('bakwagen volgt een ruime bocht vooruit', () => {
    const r = simulate(veh('bakwagen-10'), [{ richting: 'vooruit', punten: haaks(12) }]);
    expect(r.uitvoerbaar).toBe(true);
    expect(r.maxAfwijking).toBeLessThan(0.3);
  });
  it('te krappe bocht wordt als niet uitvoerbaar gemarkeerd', () => {
    // keerlus met straal 4 m: kleiner dan de minimale straal van de vooras (≈5,1 m)
    const pts: [number, number][] = [[0, 0], [20, 0]];
    for (let a = 5; a <= 180; a += 5) pts.push([20 + 4 * Math.sin((a * Math.PI) / 180), 4 - 4 * Math.cos((a * Math.PI) / 180)]);
    pts.push([0, 8]);
    const r = simulate(veh('trekker-oplegger'), [{ richting: 'vooruit', punten: pts }]);
    expect(r.uitvoerbaar).toBe(false);
    expect(r.flags.some((f) => f.soort === 'afwijking' || f.soort === 'stuurhoek')).toBe(true);
  });
  it('bakwagen steekt achteruit een haakse bocht in', () => {
    const v = veh('bakwagen-10');
    const legs: Leg[] = [{ richting: 'vooruit', punten: [[0, 0], [30, 0]] }, { richting: 'achteruit', punten: [[30 - v.wielbasis, 0], [10, 0], ...[...Array(10)].map((_, i): [number, number] => { const a = ((i + 1) * 9 * Math.PI) / 180; return [10 - 10 * Math.sin(a), -10 + 10 * Math.cos(a)]; }), [0, -25]] }];
    const r = simulate(v, legs);
    expect(r.uitvoerbaar).toBe(true);
    const last = r.samples[r.samples.length - 1];
    expect(Math.abs(last.x - 0)).toBeLessThan(0.6);
  });
  it('trekker-oplegger steekt achteruit recht en door een ruime bocht zonder te scharen', () => {
    const v = veh('trekker-oplegger');
    const legs: Leg[] = [{ richting: 'vooruit', punten: [[0, 0], [40, 0]] }];
    const r0 = simulate(v, legs);
    const p = r0.samples[r0.samples.length - 1];
    const ta = trailerAxle(v, p);
    const back: [number, number][] = [ta as [number, number], [15, 0]];
    for (let a = 5; a <= 90; a += 5) back.push([15 - 15 * Math.sin((a * Math.PI) / 180), -15 + 15 * Math.cos((a * Math.PI) / 180)]);
    back.push([0, -30]);
    const r = simulate(v, [...legs, { richting: 'achteruit', punten: back }]);
    expect(r.flags.find((f) => f.soort === 'knikhoek')).toBeUndefined();
    expect(r.uitvoerbaar).toBe(true);
    const end = trailerAxle(v, r.samples[r.samples.length - 1]);
    expect(Math.abs(end[0])).toBeLessThan(0.6);
  });
});

describe('Omhullende en botsingen', () => {
  it('omhullende van een rechte rit is ongeveer lengte × breedte', () => {
    const v = veh('bakwagen-10');
    const r = simulate(v, [{ richting: 'vooruit', punten: [[0, 0], [30, 0]] }]);
    const env = envelope(v, r.samples, 0.1);
    const area = env.rings.reduce((s, q) => s + Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % q.length]; return a + p[0] * n[1] - n[0] * p[1]; }, 0) / 2), 0);
    const len = 30 + v.overhangAchter + v.overhangVoor; // vooras van 0 naar 30
    expect(area).toBeGreaterThan(0.9 * len * v.breedte);
    expect(area).toBeLessThan(1.15 * len * v.breedte);
  });
  it('vindt een paal op de route, negeert een hoge doorrijhoogte', () => {
    const v = veh('bakwagen-10');
    const r = simulate(v, [{ richting: 'vooruit', punten: [[0, 0], [40, 0]] }]);
    const paal = [[20, 0.5], [20.2, 0.5], [20.2, 0.7], [20, 0.7], [20, 0.5]];
    const brug = [[10, -5], [12, -5], [12, 5], [10, 5], [10, -5]];
    const c = routeConflicts(v, r.samples, [
      { id: 'p', naam: 'paal', soort: 'paal', ring: paal, bbox: bboxOf(paal) },
      { id: 'b', naam: 'brug 4,5 m', soort: 'doorrijhoogte', ring: brug, vrijeHoogte: 4.5, bbox: bboxOf(brug) },
      { id: 'b2', naam: 'kabel 3,0 m', soort: 'doorrijhoogte', lijn: [[30, -5], [30, 5]], vrijeHoogte: 3.0, bbox: [30, -5, 30, 5] },
    ]);
    expect(c.map((q) => q.obstakelId).sort()).toEqual(['b2', 'p']);
  });
});
