import { groundOffset } from '../core/flatten';
/** Gebouwen uit de 3D BAG (LoD 2.2) met hoogte-overschrijvingen en kleuring. */
import * as THREE from 'three';
import type { LocalFrame, RDPoint } from '../core/coords';
import type { LayerState } from '../core/layers';
import { effectiveHeights, heightMapper, type HeightOverride } from '../data/heights';
import type { BuildingRecord } from '../data/types';

export const OVERRIDE_COLOR = '#ff8f00';

/** Kleurschaal voor gebouwhoogte (nok t.o.v. maaiveld). */
export const HEIGHT_STOPS: [number, string][] = [
  [0, '#4575b4'], [5, '#74add1'], [10, '#abd9e9'], [15, '#fee090'], [20, '#fdae61'], [30, '#d73027'],
];

export function heightColor(h: number): THREE.Color {
  const s = HEIGHT_STOPS;
  if (h <= s[0][0]) return new THREE.Color(s[0][1]);
  for (let i = 0; i < s.length - 1; i++) {
    if (h <= s[i + 1][0]) {
      const t = (h - s[i][0]) / (s[i + 1][0] - s[i][0]);
      return new THREE.Color(s[i][1]).lerp(new THREE.Color(s[i + 1][1]), t);
    }
  }
  return new THREE.Color(s[s.length - 1][1]);
}

function isFlatRoof(rec: BuildingRecord): boolean {
  return rec.dakType !== 'slanted' && (rec.dakType ?? '').includes('horizontal');
}

export interface BuildingObj {
  rec: BuildingRecord;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  roofMat: THREE.MeshLambertMaterial;
  wallMat: THREE.MeshLambertMaterial;
  basePos: Float32Array;
  isSporthal: boolean;
}

const ROOF = new THREE.Color('#c8826b');
const ROOF_FLAT = new THREE.Color('#9d9d9d');
const WALL = new THREE.Color('#ece7de');
const SPORTHAL_WALL = new THREE.Color('#9ec5f0');
const SPORTHAL_ROOF = new THREE.Color('#4f86c6');

export class BuildingsLayer {
  readonly group = new THREE.Group();
  readonly items: BuildingObj[] = [];
  readonly byId = new Map<string, BuildingObj>();
  private hovered: BuildingObj | null = null;
  private selected: BuildingObj | null = null;

  constructor(recs: BuildingRecord[], origin: RDPoint, frame: LocalFrame, sporthalBagId: string) {
    const dx = origin.x - frame.x0, dy = origin.y - frame.y0;
    for (const rec of recs) {
      const v = rec.mesh.v;
      const pos = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) {
        pos[i] = v[i] + dx;
        pos[i + 1] = v[i + 2];
        pos[i + 2] = -(v[i + 1] + dy);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
      g.setIndex([...rec.mesh.roof, ...rec.mesh.wall]);
      g.addGroup(0, rec.mesh.roof.length, 0);
      g.addGroup(rec.mesh.roof.length, rec.mesh.wall.length, 1);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const isSporthal = rec.bagId === sporthalBagId;
      const flat = isFlatRoof(rec);
      const roofMat = new THREE.MeshLambertMaterial({ color: isSporthal ? SPORTHAL_ROOF : flat ? ROOF_FLAT : ROOF, side: THREE.DoubleSide });
      const wallMat = new THREE.MeshLambertMaterial({ color: isSporthal ? SPORTHAL_WALL : WALL, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, [roofMat, wallMat]);
      mesh.userData = { kind: 'building', id: rec.id };
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 25),
        new THREE.LineBasicMaterial({ color: '#4a4a4a', transparent: true, opacity: 0.55 }),
      );
      edges.raycast = () => {};
      const obj: BuildingObj = { rec, mesh, edges, roofMat, wallMat, basePos: pos, isSporthal };
      this.items.push(obj);
      this.byId.set(rec.id, obj);
      this.group.add(mesh, edges);
    }
  }

  get sporthal(): BuildingObj | undefined {
    return this.items.find((b) => b.isSporthal);
  }

  /** Pas overschrijvingen, kleuren en zichtbaarheid toe. */
  apply(L: LayerState, overrides: Record<string, HeightOverride>) {
    this.group.visible = L.gebouwen;
    for (const b of this.items) {
      const ov = overrides[b.rec.id];
      this.applyGeometry(b, ov);
      const eff = effectiveHeights(b.rec, ov);
      const dy = groundOffset(eff.maaiveld);
      b.mesh.position.y = dy;
      b.edges.position.y = dy;
      const anyOv = eff.overschreven.goot || eff.overschreven.nok || eff.overschreven.maaiveld;
      // kleur
      if (L.gebouwKleurHoogte) {
        const rel = eff.nok != null && eff.maaiveld != null ? eff.nok - eff.maaiveld : 0;
        const c = heightColor(rel);
        b.roofMat.color.copy(c);
        b.wallMat.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.35);
      } else {
        const flat = isFlatRoof(b.rec);
        b.roofMat.color.copy(b.isSporthal ? SPORTHAL_ROOF : flat ? ROOF_FLAT : ROOF);
        b.wallMat.color.copy(b.isSporthal ? SPORTHAL_WALL : WALL);
      }
      // sporthal-modus
      let visible = true;
      let opacity = 1;
      if (b.isSporthal) {
        if (L.sporthal === 'verborgen') visible = false;
        if (L.sporthal === 'transparant') opacity = 0.3;
      }
      for (const m of [b.roofMat, b.wallMat]) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.depthWrite = opacity >= 1;
        m.needsUpdate = true;
      }
      b.mesh.visible = visible;
      b.edges.visible = visible;
      const em = b.edges.material as THREE.LineBasicMaterial;
      em.color.set(anyOv ? OVERRIDE_COLOR : '#4a4a4a');
      em.opacity = anyOv ? 1 : 0.55;
      em.linewidth = 1;
    }
    this.refreshHighlight();
  }

  private applyGeometry(b: BuildingObj, ov?: HeightOverride) {
    const attr = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const eff = effectiveHeights(b.rec, ov);
    const changed = eff.overschreven.goot || eff.overschreven.nok || eff.overschreven.maaiveld;
    const key = changed ? JSON.stringify([eff.maaiveld, eff.goot, eff.nok]) : '';
    if (b.mesh.userData.geomKey === key) return;
    b.mesh.userData.geomKey = key;
    const f = changed ? heightMapper(b.rec, eff) : (z: number) => z;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = b.basePos[i];
      arr[i + 1] = f(b.basePos[i + 1]);
      arr[i + 2] = b.basePos[i + 2];
    }
    attr.needsUpdate = true;
    b.mesh.geometry.computeVertexNormals();
    b.mesh.geometry.computeBoundingSphere();
    b.edges.geometry.dispose();
    b.edges.geometry = new THREE.EdgesGeometry(b.mesh.geometry, 25);
  }

  setHover(b: BuildingObj | null) {
    if (this.hovered === b) return;
    this.hovered = b;
    this.refreshHighlight();
  }

  setSelected(b: BuildingObj | null) {
    this.selected = b;
    this.refreshHighlight();
  }

  private refreshHighlight() {
    for (const b of this.items) {
      const e = b === this.selected ? 0x553300 : b === this.hovered ? 0x2a2a2a : 0x000000;
      b.roofMat.emissive.setHex(e);
      b.wallMat.emissive.setHex(e);
    }
  }

  pickable(): THREE.Object3D[] {
    return this.group.visible ? this.items.filter((b) => b.mesh.visible).map((b) => b.mesh) : [];
  }
}
