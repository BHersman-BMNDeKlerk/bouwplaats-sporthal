/**
 * Omzetten van eigen invoer naar obstakels voor de routecontrole en de
 * routeplanner (fase 4). Bouwhekken zijn een obstakel, poorten niet.
 */
import type { ManualObject } from '../core/project';
import { gatePanels, panels } from '../core/polyline';
import { bboxOf, type RouteObstacle } from './sweep';

const circle = (x: number, y: number, r: number, n = 12) => [...Array(n + 1)].map((_, i) => [x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI)]);

/** Bouwhekken: één obstakel per aaneengesloten reeks hekken tussen de poorten. */
export function fenceObstacles(m: ManualObject): RouteObstacle[] {
  const ps = panels(m.coords);
  const gates = gatePanels(m.poorten ?? [], ps.length);
  const out: RouteObstacle[] = [];
  let run: number[][] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ id: `h:${m.id}:${out.length}`, naam: m.naam || 'bouwhekken', soort: 'hekwerk', lijn: run, bbox: bboxOf(run) });
    run = [];
  };
  for (const p of ps) {
    if (gates.has(p.index)) { flush(); continue; }
    const last = run[run.length - 1];
    if (!last || Math.hypot(last[0] - p.a[0], last[1] - p.a[1]) > 1e-6) { flush(); run = [p.a, p.b]; } else run.push(p.b);
  }
  flush();
  return out;
}

export function manualObstacles(list: ManualObject[]): RouteObstacle[] {
  const out: RouteObstacle[] = [];
  const add = (o: Omit<RouteObstacle, 'bbox'>) => { const g = o.ring ?? o.lijn; if (g && g.length >= 2) out.push({ ...o, bbox: bboxOf(g) }); };
  for (const m of list) {
    const ring = m.coords.length >= 3 ? [...m.coords, m.coords[0]] : undefined;
    if (m.soort === 'paaltjes') m.coords.forEach((c, i) => add({ id: `h:${m.id}:${i}`, naam: m.naam || 'paaltje', soort: 'paaltjes', ring: circle(c[0], c[1], 0.15, 8) }));
    else if (m.soort === 'hekwerk') out.push(...fenceObstacles(m));
    else if (m.soort === 'doorrijhoogte') {
      const vh = m.vrijeHoogte ?? 4.0, naam = `${m.naam || 'doorrijhoogte'} (${vh.toFixed(2).replace('.', ',')} m)`;
      if (m.geom === 'vlak' && ring) add({ id: `h:${m.id}`, naam, soort: 'doorrijhoogte', ring, vrijeHoogte: vh });
      else add({ id: `h:${m.id}`, naam, soort: 'doorrijhoogte', lijn: m.coords, vrijeHoogte: vh });
    } else if (m.soort === 'nietBerijdbaar' && ring) add({ id: `h:${m.id}`, naam: m.naam || 'niet berijdbaar', soort: 'niet berijdbaar', ring, alleenWielen: true });
  }
  return out;
}
