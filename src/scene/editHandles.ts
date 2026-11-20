/**
 * Sleepgrepen voor het geselecteerde eigen object:
 *  - hoekpunten (blauw): verplaatsen; dubbelklik = verwijderen;
 *  - tussenpunten (wit, klein): slepen voegt een hoekpunt toe;
 *  - poorten (oranje blokje): verschuiven langs het hek.
 * Plus de omtrek van het object, zodat ook 2D-objecten tijdens het slepen
 * zichtbaar blijven. Grepen hebben een vaste schermgrootte.
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { ManualObject } from '../core/project';
import { gatePanels, panels } from '../core/polyline';

export type HandleKind = 'vertex' | 'mid' | 'gate';
export interface HandleInfo {
  kind: HandleKind;
  index: number;
  gateId?: string;
}

export class EditHandles {
  readonly group = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private outline: THREE.Line | null = null;
  obj: ManualObject | null = null;

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {
    this.group.renderOrder = 30;
  }

  private v(x: number, y: number, dz = 0.25): THREE.Vector3 {
    const p = this.frame.toLocal(x, y, (this.heightAt(x, y) ?? 0) + dz);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** Toon grepen voor dit object (of geen, bij null); de omtrek alleen tijdens het slepen. */
  set(o: ManualObject | null, outline = false) {
    this.obj = o;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.handles = [];
    this.outline = null;
    if (!o) return;
    const pts = o.coords;
    const closed = o.geom === 'vlak';
    if (outline && o.geom !== 'punten' && pts.length >= 2) {
      const line = [...pts, ...(closed ? [pts[0]] : [])].map(([x, y]) => this.v(x, y, 0.1));
      this.outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: '#1565c0', depthTest: false, transparent: true, opacity: 0.9 }));
      this.outline.renderOrder = 30;
      this.outline.raycast = () => {};
      this.group.add(this.outline);
    }
    const mk = (geom: THREE.BufferGeometry, color: string, info: HandleInfo, pos: THREE.Vector3, base: number) => {
      const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: info.kind === 'mid' ? 0.75 : 1 }));
      m.position.copy(pos);
      m.renderOrder = 31;
      m.userData = { handle: info, base };
      this.handles.push(m);
      this.group.add(m);
    };
    pts.forEach(([x, y], i) => mk(new THREE.SphereGeometry(1, 16, 12), '#1565c0', { kind: 'vertex', index: i }, this.v(x, y), 1));
    if (o.geom !== 'punten') {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        mk(new THREE.SphereGeometry(1, 12, 8), '#ffffff', { kind: 'mid', index: i }, this.v((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), 0.65);
      }
    }
    if (o.soort === 'hekwerk' && o.poorten?.length) {
      const ps = panels(pts);
      const gp = gatePanels(o.poorten, ps.length);
      for (const g of o.poorten) {
        const gs = ps.filter((p) => gp.get(p.index)?.id === g.id);
        if (!gs.length) continue;
        const a = gs[0].a, b = gs[gs.length - 1].b;
        mk(new THREE.BoxGeometry(1.4, 1.4, 1.4), '#ff9800', { kind: 'gate', index: gs[0].index, gateId: g.id }, this.v((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 2.4), 1);
      }
    }
  }

  /** Vaste schermgrootte: schaal met meters per pixel. */
  scale(mpp: number) {
    for (const m of this.handles) m.scale.setScalar(Math.max(0.12, mpp * 7 * m.userData.base));
  }

  pick(ray: THREE.Raycaster): HandleInfo | null {
    if (!this.handles.length) return null;
    const hits = ray.intersectObjects(this.handles, false);
    if (!hits.length) return null;
    // hoekpunten en poorten gaan voor tussenpunten
    hits.sort((a, b) => (a.object.userData.handle.kind === 'mid' ? 1 : 0) - (b.object.userData.handle.kind === 'mid' ? 1 : 0));
    return hits[0].object.userData.handle as HandleInfo;
  }

  get visible() {
    return this.obj !== null;
  }
}
