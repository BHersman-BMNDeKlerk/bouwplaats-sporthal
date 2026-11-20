/**
 * Routes (fase 4): voertuig + routedelen, en de berekening van swept path en
 * botsingen met een cache (alleen opnieuw rekenen als er iets verandert).
 */
import { VEHICLES, type VehicleSpec } from './vehicles';
import { simulate, referencePoint, samplesFromPoses, type Leg, type SimResult } from './kinematics';
import type { PlanPose } from './planner';
import { envelope, routeConflicts, type Envelope, type RouteConflict, type RouteObstacle } from './sweep';

export interface Route {
  id: string;
  naam: string;
  /** Kopie van de voertuigparameters (vrij te bewerken). */
  voertuig: VehicleSpec;
  legs: Leg[];
  zichtbaar: boolean;
  /** Spookbeelden om de zoveel meter (0 = uit). */
  spook: number;
  /** Automatisch gepland: start/eind en instellingen. */
  plan?: {
    start: [number, number, number];
    eind: [number, number, number | null];
    /** Tussenstops (eind van elk rijdeel bij een route met meerdere delen), in volgorde. */
    tussen?: [number, number, number][];
    marge: number; achteruit: boolean; kronen?: boolean; info?: string;
    /** Toegestane afwijking van wisselpunten en eind (m), bv. iets verder doorsteken. */
    afwijking?: number;
  };
  /** Exact gepland traject (vervalt bij handmatige wijzigingen). */
  pad?: PlanPose[];
}

export function newRoute(vehicleId: string, legs: Leg[] = []): Route {
  const v = VEHICLES.find((q) => q.id === vehicleId) ?? VEHICLES[0];
  return { id: `r-${Date.now().toString(36)}`, naam: v.naam, voertuig: { ...v }, legs, zichtbaar: true, spook: 5 };
}

export interface RouteResult {
  sim: SimResult;
  env: Envelope;
  conflicts: RouteConflict[];
}

export class RouteEngine {
  private cache = new Map<string, { key: string; res: RouteResult }>();
  /** Verhoog bij een wijziging van obstakels (gebouwen, elementen, handmatig, lagen). */
  obstacleKey = '';

  constructor(
    private readonly obstacles: () => RouteObstacle[],
    private readonly stoepAt: (x: number, y: number) => string | null,
  ) {}

  result(r: Route): RouteResult {
    const key = JSON.stringify([r.voertuig, r.legs, r.pad?.length ?? 0, r.pad?.[r.pad.length - 1], this.obstacleKey]);
    const c = this.cache.get(r.id);
    if (c && c.key === key) return c.res;
    const sim = r.pad?.length ? samplesFromPoses(r.pad) : simulate(r.voertuig, r.legs);
    const env = envelope(r.voertuig, sim.samples, 0.1);
    const conflicts = routeConflicts(r.voertuig, sim.samples, this.obstacles(), this.stoepAt);
    const res = { sim, env, conflicts };
    this.cache.set(r.id, { key, res });
    return res;
  }

  /** Huidige positie van het referentiepunt voor een nieuw routedeel. */
  // (bij een gepland traject: het eind van dat traject)
  nextStart(r: Route, richting: Leg['richting']): [number, number] | null {
    const res = this.result(r);
    const last = res.sim.samples[res.sim.samples.length - 1];
    return last ? referencePoint(r.voertuig, last, richting) : null;
  }

  forget(id: string) { this.cache.delete(id); }
}

/** Douglas-Peucker: lijn vereenvoudigen (tol in m). */
export function simplifyLine(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const DISCLAIMER = 'Indicatief: kinematisch model (fietsmodel) zonder banden­slip, last­verdeling of fabrikant­specifieke besturing. Geen vervanging van gecertificeerde software zoals AutoTURN of Vehicle Tracking. Controleer kritische manoeuvres met fabrikantgegevens of een proefrit.';
