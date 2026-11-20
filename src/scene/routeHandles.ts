/**
 * Grepen om een route na het aanmaken te bewerken.
 *  - Getekende route: elk punt van elk deel (slepen; dubbelklik = weg) en
 *    tussenpunten (slepen = punt toevoegen).
 *  - Geplande route: start (S), tussenstops (T), eind (E) en hun rijrichting.
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { Route } from '../vehicles/routes';
import { ROUTE_KLEUR } from './routeLayer';

export type RouteHandle =
  | { type: 'v'; leg: number; idx: number }
  | { type: 'mid'; leg: number; idx: number }
  | { type: 'S' | 'E' | 'Sdir' | 'Edir' }
  | { type: 'T' | 'Tdir'; idx: number };

export const DIR_LEN = 5;

export class RouteHandles {
  readonly group = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private lines: THREE.Line[] = [];
  route: Route | null = null;

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {}

  private v(x: number, y: number) {
    const p = this.frame.toLocal(x, y, (this.heightAt(x, y) ?? 0) + 0.4);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  set(r: Route | null) {
    this.route = r;
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    this.handles = []; this.lines = [];
    if (!r) return;
    const mk = (h: RouteHandle, x: number, y: number, color: string, size = 1, box = false) => {
      const geo = box ? new THREE.BoxGeometry(0.8, 0.8, 0.8) : new THREE.SphereGeometry(0.5, 14, 10);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: size < 1, opacity: size < 1 ? 0.7 : 1 }));
      m.position.copy(this.v(x, y));
      m.renderOrder = 34;
      m.userData = { rhandle: h, size };
      this.handles.push(m);
      this.group.add(m);
    };
    const line = (a: number[], b: number[], color: string) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.v(a[0], a[1]), this.v(b[0], b[1])]), new THREE.LineBasicMaterial({ color, depthTest: false }));
      l.renderOrder = 34; l.raycast = () => {};
      this.lines.push(l); this.group.add(l);
    };
    if (r.plan) {
      const pose = (p: [number, number, number | null], t: 'S' | 'E' | 'T', idx: number, color: string) => {
        mk(t === 'T' ? { type: 'T', idx } : { type: t }, p[0], p[1], color, 1.3);
        if (p[2] != null) {
          const d = [p[0] + DIR_LEN * Math.cos(p[2]), p[1] + DIR_LEN * Math.sin(p[2])];
          line([p[0], p[1]], d, color);
          mk(t === 'T' ? { type: 'Tdir', idx } : { type: t === 'S' ? 'Sdir' : 'Edir' }, d[0], d[1], color, 0.9, true);
        }
      };
      pose(r.plan.start, 'S', 0, '#2e7d32');
      (r.plan.tussen ?? []).forEach((t, i) => pose(t, 'T', i, '#f9a825'));
      pose(r.plan.eind, 'E', 0, '#c62828');
      return;
    }
    r.legs.forEach((l, li) => {
      const col = ROUTE_KLEUR[l.richting];
      l.punten.forEach((p, pi) => {
        mk({ type: 'v', leg: li, idx: pi }, p[0], p[1], col);
        if (pi > 0) { const a = l.punten[pi - 1]; mk({ type: 'mid', leg: li, idx: pi }, (a[0] + p[0]) / 2, (a[1] + p[1]) / 2, '#ffffff', 0.6); }
      });
    });
  }

  /** Greep tijdelijk verplaatsen tijdens slepen. */
  preview(h: RouteHandle, x: number, y: number) {
    const m = this.handles.find((q) => JSON.stringify(q.userData.rhandle) === JSON.stringify(h));
    if (m) m.position.copy(this.v(x, y));
  }

  scale(mpp: number) {
    for (const m of this.handles) m.scale.setScalar(Math.max(0.2, mpp * 12) * (m.userData.size ?? 1));
  }

  pick(ray: THREE.Raycaster): RouteHandle | null {
    const hits = ray.intersectObjects(this.handles, false);
    return hits.length ? (hits[0].object.userData.rhandle as RouteHandle) : null;
  }
}
