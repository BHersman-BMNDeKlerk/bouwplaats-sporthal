/** Grepen voor een geselecteerd bouwplaatselement: maat slepen (4 zijden) en draaien. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { Element } from '../core/elements';

export type ElementHandleKind = 'len+' | 'len-' | 'wid+' | 'wid-' | 'rotate';

export class ElementHandles {
  readonly group = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  el: Element | null = null;

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {}

  set(e: Element | null) {
    this.el = e;
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    this.handles = [];
    if (!e) return;
    const a = (e.rotatie * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const at = (u: number, v: number) => {
      const x = e.x + ux * u + vx * v, y = e.y + uy * u + vy * v;
      const p = this.frame.toLocal(x, y, (this.heightAt(x, y) ?? 0) + 0.3);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const mk = (kind: ElementHandleKind, pos: THREE.Vector3, color: string, geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.copy(pos);
      m.renderOrder = 33;
      m.userData = { ehandle: kind };
      this.handles.push(m);
      this.group.add(m);
    };
    const box = () => new THREE.BoxGeometry(1, 1, 1);
    mk('len+', at(e.lengte / 2, 0), '#1565c0', box());
    mk('len-', at(-e.lengte / 2, 0), '#1565c0', box());
    mk('wid+', at(0, e.breedte / 2), '#1565c0', box());
    mk('wid-', at(0, -e.breedte / 2), '#1565c0', box());
    const r = at(e.lengte / 2 + Math.max(1.5, e.lengte * 0.15), 0);
    mk('rotate', r, '#ff6f00', new THREE.SphereGeometry(0.7, 16, 12));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([at(e.lengte / 2, 0), r]), new THREE.LineBasicMaterial({ color: '#ff6f00', depthTest: false }));
    line.renderOrder = 33;
    line.raycast = () => {};
    this.group.add(line);
  }

  scale(mpp: number) {
    for (const m of this.handles) m.scale.setScalar(Math.max(0.15, mpp * 11));
  }

  pick(ray: THREE.Raycaster): ElementHandleKind | null {
    const hits = ray.intersectObjects(this.handles, false);
    return hits.length ? (hits[0].object.userData.ehandle as ElementHandleKind) : null;
  }
}
