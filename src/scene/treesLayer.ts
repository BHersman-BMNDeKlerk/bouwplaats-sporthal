/** Bomen als eenvoudige 3D-bomen (stam + kroon), instanced. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { TreeOverride } from '../core/project';
import type { TreeRecord } from '../data/types';
import { OVERRIDE_COLOR } from './buildingsLayer';

export interface EffectiveTree extends TreeRecord {
  overschreven: boolean;
  verborgen: boolean;
}

export function effectiveTree(t: TreeRecord, ov?: TreeOverride): EffectiveTree {
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return {
    ...t,
    hoogte: num(ov?.hoogte) ? ov!.hoogte! : t.hoogte,
    kroonstraal: num(ov?.kroonstraal) ? ov!.kroonstraal! : t.kroonstraal,
    kroonOnderkant: num(ov?.kroonOnderkant) ? ov!.kroonOnderkant! : t.kroonOnderkant,
    overschreven: !!ov && (num(ov.hoogte) || num(ov.kroonstraal) || num(ov.kroonOnderkant)),
    verborgen: !!ov?.verborgen,
  };
}

export const TREE_COLORS = {
  gemeten: '#3d8b37',
  ahn: '#7fae4a',
  aanname: '#c9a227',
  handmatig: OVERRIDE_COLOR,
};

export class TreesLayer {
  readonly group = new THREE.Group();
  readonly crowns: THREE.InstancedMesh;
  readonly trunks: THREE.InstancedMesh;
  private hoverIdx = -1;
  private selIdx = -1;
  private colors: THREE.Color[] = [];

  constructor(public readonly trees: TreeRecord[], private readonly frame: LocalFrame) {
    const n = Math.max(1, trees.length);
    const crownGeo = new THREE.IcosahedronGeometry(1, 2);
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.6, 1, 8);
    trunkGeo.translate(0, 0.5, 0);
    this.crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.88 }), n);
    this.trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b4a2f' }), n);
    this.crowns.userData.kind = 'tree';
    this.trunks.raycast = () => {};
    this.crowns.count = trees.length;
    this.trunks.count = trees.length;
    this.group.add(this.trunks, this.crowns);
  }

  apply(visible: boolean, overrides: Record<string, TreeOverride>) {
    this.group.visible = visible;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.colors = [];
    this.trees.forEach((t0, i) => {
      const t = effectiveTree(t0, overrides[t0.id]);
      const p = this.frame.toLocal(t.x, t.y, t.maaiveld);
      if (t.verborgen) {
        m.makeScale(0, 0, 0);
        this.crowns.setMatrixAt(i, m);
        this.trunks.setMatrixAt(i, m);
        this.colors.push(new THREE.Color('#000'));
        this.crowns.setColorAt(i, this.colors[i]);
        return;
      }
      const base = Math.min(t.kroonOnderkant, t.hoogte - 0.5);
      const ry = Math.max(0.5, (t.hoogte - base) / 2);
      m.compose(new THREE.Vector3(p.x, p.y + base + ry, p.z), q, new THREE.Vector3(t.kroonstraal, ry, t.kroonstraal));
      this.crowns.setMatrixAt(i, m);
      const tr = Math.min(0.35, Math.max(0.12, t.hoogte / 60));
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(tr * 2, base + ry * 0.5, tr * 2));
      this.trunks.setMatrixAt(i, m);
      const c = new THREE.Color(
        t.overschreven ? TREE_COLORS.handmatig : t.aanname ? TREE_COLORS.aanname : t.bron === 'AHN' ? TREE_COLORS.ahn : TREE_COLORS.gemeten,
      );
      this.colors.push(c);
    });
    this.crowns.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.computeBoundingSphere();
    this.paint();
  }

  private paint() {
    this.colors.forEach((c, i) => {
      const col = c.clone();
      if (i === this.selIdx) col.lerp(new THREE.Color('#ffeb3b'), 0.6);
      else if (i === this.hoverIdx) col.offsetHSL(0, 0, 0.15);
      this.crowns.setColorAt(i, col);
    });
    if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
  }

  setHover(i: number) {
    if (i === this.hoverIdx) return;
    this.hoverIdx = i;
    this.paint();
  }

  setSelected(i: number) {
    this.selIdx = i;
    this.paint();
  }
}
