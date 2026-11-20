/** Bovengrondse obstakels uit BGT/IMGeo (plus): palen, masten, borden, kasten, straatmeubilair. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { LayerState } from '../core/layers';
import type { ObstacleOverride } from '../core/project';
import { OBSTACLE_COLLECTIONS, obstacleSpec, type ObstacleSpec } from '../data/bgt';
import type { LoadedData } from '../data/loader';
import { OVERRIDE_COLOR } from './buildingsLayer';

export interface Obstacle {
  id: string;
  collection: string;
  props: Record<string, any>;
  x: number;
  y: number;
  maaiveld: number;
  spec: ObstacleSpec;
  obj: THREE.Group;
}

export class ObstaclesLayer {
  readonly group = new THREE.Group();
  readonly items: Obstacle[] = [];
  readonly byId = new Map<string, Obstacle>();
  private selected: Obstacle | null = null;

  constructor(data: LoadedData, private readonly frame: LocalFrame, heightAt: (x: number, y: number) => number | null) {
    for (const [col, fc] of data.bgt) {
      if (!OBSTACLE_COLLECTIONS.has(col)) continue;
      for (const f of fc.features) {
        if (f.geometry.type !== 'Point') continue;
        const [x, y] = f.geometry.coordinates as number[];
        const spec = obstacleSpec(col, f.properties);
        const id = `${col}:${f.properties.lokaal_id ?? f.id}`;
        const o: Obstacle = { id, collection: col, props: f.properties, x, y, maaiveld: heightAt(x, y) ?? 0, spec, obj: new THREE.Group() };
        o.obj.userData = { kind: 'obstacle', id };
        this.items.push(o);
        this.byId.set(id, o);
        this.group.add(o.obj);
      }
    }
  }

  apply(L: LayerState, overrides: Record<string, ObstacleOverride>) {
    for (const o of this.items) {
      const ov = overrides[o.id];
      const h = typeof ov?.hoogte === 'number' ? ov.hoogte : o.spec.hoogte;
      const key = `${h}|${!!ov?.hoogte}|${o === this.selected}`;
      o.obj.visible = !!L.obstakels[o.spec.categorie] && !ov?.verborgen;
      if (o.obj.userData.key === key) continue;
      o.obj.userData.key = key;
      this.build(o, h, typeof ov?.hoogte === 'number');
    }
  }

  private build(o: Obstacle, h: number, overridden: boolean) {
    for (const c of [...o.obj.children]) {
      o.obj.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const p = this.frame.toLocal(o.x, o.y, o.maaiveld);
    o.obj.position.set(p.x, p.y, p.z);
    const color = o === this.selected ? '#ffeb3b' : overridden ? OVERRIDE_COLOR : o.spec.kleur;
    const mat = new THREE.MeshLambertMaterial({ color });
    const s = o.spec;
    const add = (g: THREE.BufferGeometry, y: number) => {
      const m = new THREE.Mesh(g, mat);
      m.position.y = y;
      m.userData = { kind: 'obstacle', id: o.id };
      o.obj.add(m);
    };
    if (s.vorm === 'paal' || s.vorm === 'mast') {
      const r = Math.max(0.06, s.breedte / 2);
      add(new THREE.CylinderGeometry(r * 0.8, r, h, 10), h / 2);
      if (s.vorm === 'mast') add(new THREE.BoxGeometry(0.25, 0.15, 0.9), h - 0.1);
    } else if (s.vorm === 'bord') {
      add(new THREE.CylinderGeometry(0.04, 0.04, h, 6), h / 2);
      add(new THREE.BoxGeometry(s.breedte, Math.min(0.8, s.breedte), 0.04), h - 0.35);
    } else {
      add(new THREE.BoxGeometry(s.breedte, h, s.diepte), h / 2);
    }
    // ring op maaiveld zodat kleine objecten van bovenaf zichtbaar zijn
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(s.breedte, 0.3) * 0.7 + 0.15, Math.max(s.breedte, 0.3) * 0.7 + 0.3, 20),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.raycast = () => {};
    o.obj.add(ring);
  }

  setSelected(o: Obstacle | null) {
    const prev = this.selected;
    this.selected = o;
    for (const x of [prev, o]) if (x) x.obj.userData.key = '';
  }

  pickable(): THREE.Object3D[] {
    return this.items.filter((o) => o.obj.visible).map((o) => o.obj);
  }
}
