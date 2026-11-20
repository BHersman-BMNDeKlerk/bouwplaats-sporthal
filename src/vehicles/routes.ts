/**
 * Routes (fase 4): voertuig + routedelen, en de berekening van swept path en
 * botsingen met een cache (alleen opnieuw rekenen als er iets verandert).
 */
import { VEHICLES, type VehicleSpec } from './vehicles';
import { simulate, referencePoint, type Leg, type SimResult } from './kinematics';
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
    const key = JSON.stringify([r.voertuig, r.legs, this.obstacleKey]);
    const c = this.cache.get(r.id);
    if (c && c.key === key) return c.res;
    const sim = simulate(r.voertuig, r.legs);
    const env = envelope(r.voertuig, sim.samples, 0.1);
    const conflicts = routeConflicts(r.voertuig, sim.samples, this.obstacles(), this.stoepAt);
    const res = { sim, env, conflicts };
    this.cache.set(r.id, { key, res });
    return res;
  }

  /** Huidige positie van het referentiepunt voor een nieuw routedeel. */
  nextStart(r: Route, richting: Leg['richting']): [number, number] | null {
    const res = this.result(r);
    const last = res.sim.samples[res.sim.samples.length - 1];
    return last ? referencePoint(r.voertuig, last, richting) : null;
  }

  forget(id: string) { this.cache.delete(id); }
}

export const DISCLAIMER = 'Indicatief: kinematisch model (fietsmodel) zonder banden­slip, last­verdeling of fabrikant­specifieke besturing. Geen vervanging van gecertificeerde software zoals AutoTURN of Vehicle Tracking. Controleer kritische manoeuvres met fabrikantgegevens of een proefrit.';
