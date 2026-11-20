/** 3D-weergave van de bouwplaatselementen (fase 3). */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import { ELEMENTS, type Element } from '../core/elements';

export const CONFLICT_KLEUR = '#e53935';

export class ElementsLayer {
  readonly group = new THREE.Group();
  private objs = new Map<string, { key: string; g: THREE.Group }>();

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {}

  /** Bouw/actualiseer; alleen gewijzigde elementen worden opnieuw opgebouwd. */
  apply(els: Element[], visible: (e: Element) => boolean, conflicts: Set<string>, selectedId: string | null) {
    const seen = new Set<string>();
    for (const e of els) {
      seen.add(e.id);
      const key = JSON.stringify([e, conflicts.has(e.id), selectedId === e.id]);
      let o = this.objs.get(e.id);
      if (!o || o.key !== key) {
        if (o) this.dispose(o.g);
        const g = this.build(e, conflicts.has(e.id), selectedId === e.id);
        this.group.add(g);
        o = { key, g };
        this.objs.set(e.id, o);
      }
      o.g.visible = visible(e);
    }
    for (const [id, o] of this.objs) if (!seen.has(id)) { this.dispose(o.g); this.objs.delete(id); }
  }

  private dispose(g: THREE.Group) {
    this.group.remove(g);
    g.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); });
  }

  private build(e: Element, conflict: boolean, sel: boolean): THREE.Group {
    const g = new THREE.Group();
    g.userData = { kind: 'element', id: e.id };
    const base = this.heightAt(e.x, e.y) ?? 0;
    const p = this.frame.toLocal(e.x, e.y, base);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = (e.rotatie * Math.PI) / 180;
    const spec = ELEMENTS[e.type];
    const col = new THREE.Color(conflict ? CONFLICT_KLEUR : e.kleur);
    const edgeCol = sel ? '#fdd835' : conflict ? '#b71c1c' : '#37474f';
    const L = e.lengte, B = e.breedte, H = e.hoogte;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, edges = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.userData = g.userData;
      g.add(m);
      if (edges) {
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edgeCol }));
        l.position.copy(m.position);
        l.raycast = () => {};
        g.add(l);
      }
      return m;
    };
    const solid = (c: THREE.Color | string, opacity = 1) =>
      new THREE.MeshLambertMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide });

    switch (e.type) {
      case 'keet':
      case 'container20':
      case 'container40': {
        const n = Math.max(1, e.stapel ?? 1);
        for (let k = 0; k < n; k++) {
          add(new THREE.BoxGeometry(L, H - 0.02, B), solid(col), 0, k * H + H / 2);
          if (e.type === 'keet') {
            // raamband aan beide lange zijden
            const win = solid('#263238');
            add(new THREE.BoxGeometry(L * 0.8, 0.5, B + 0.02), win, 0, k * H + H * 0.62, 0, false);
          }
        }
        add(new THREE.BoxGeometry(L + 0.06, 0.06, B + 0.06), solid(col.clone().multiplyScalar(0.7)), 0, n * H + 0.03, 0, false);
        break;
      }
      case 'opslagvlak':
        add(new THREE.BoxGeometry(L, 0.04, B), solid(col, 0.55), 0, 0.02);
        if (H > 0.05) add(new THREE.BoxGeometry(L * 0.96, H, B * 0.96), solid(col, 0.3), 0, H / 2, 0, true);
        break;
      case 'laadlosvak':
      case 'parkeervak':
        add(new THREE.BoxGeometry(L, 0.04, B), solid(col, 0.6), 0, 0.03);
        break;
      case 'steiger': {
        add(new THREE.BoxGeometry(L, H, B), solid(col, 0.18), 0, H / 2);
        // werkvloeren om de 2 m
        const pts: THREE.Vector3[] = [];
        for (let y = 2; y < H; y += 2)
          for (const z of [-B / 2, B / 2]) pts.push(new THREE.Vector3(-L / 2, y, z), new THREE.Vector3(L / 2, y, z));
        for (let x = -L / 2; x <= L / 2 + 1e-6; x += Math.max(1.5, L / Math.max(1, Math.round(L / 2.5))))
          for (const z of [-B / 2, B / 2]) pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, H, z));
        const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: conflict ? CONFLICT_KLEUR : '#8d6e00' }));
        ls.raycast = () => {};
        g.add(ls);
        break;
      }
      case 'bouwlift':
        add(new THREE.BoxGeometry(0.45, H, 0.45), solid(col), -L / 2 + 0.25, H / 2, 0);
        add(new THREE.BoxGeometry(L, 1.2, B), solid(col.clone().multiplyScalar(0.85), 0.8), 0.2, 0.6);
        break;
      case 'bord': {
        add(new THREE.CylinderGeometry(0.04, 0.04, H, 8), solid('#9e9e9e'), 0, H / 2, 0, false);
        add(new THREE.BoxGeometry(L, Math.min(0.8, L), Math.max(0.03, B * 0.3)), solid(col), 0, H - 0.4);
        break;
      }
      case 'verkeersregelaar':
        add(new THREE.CylinderGeometry(0.22, 0.25, H * 0.8, 12), solid(col), 0, H * 0.4, 0, false);
        add(new THREE.SphereGeometry(0.15, 12, 8), solid('#ffe0b2'), 0, H * 0.88, 0, false);
        break;
      case 'waterpunt':
        add(new THREE.CylinderGeometry(Math.min(L, B) / 2, Math.min(L, B) / 2, H, 14), solid(col), 0, H / 2);
        break;
      case 'auto':
      case 'bestelbus': {
        const body = e.type === 'auto' ? H * 0.55 : H * 0.85;
        add(new THREE.BoxGeometry(L, body, B), solid(col), 0, body / 2 + 0.15);
        if (e.type === 'auto') add(new THREE.BoxGeometry(L * 0.55, H - body - 0.15, B * 0.9), solid(col.clone().multiplyScalar(0.8)), -L * 0.05, body + 0.15 + (H - body - 0.15) / 2);
        else add(new THREE.BoxGeometry(L * 0.25, H - body - 0.15 > 0 ? H * 0.1 : 0.01, B), solid(col), L * 0.35, body + 0.2, 0, false);
        break;
      }
      default:
        add(new THREE.BoxGeometry(L, Math.max(H, 0.02), B), solid(col, spec?.vlak ? 0.5 : 1), 0, Math.max(H, 0.02) / 2);
    }
    return g;
  }

  pickable(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const { g } of this.objs.values()) if (g.visible) g.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c); });
    return out;
  }
}
