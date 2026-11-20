/** Ontwerpmodel (IFC) in 3D, geplaatst in RD/NAP via een aanpasbare plaatsing. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import { DESIGN_CATEGORIES } from '../data/design';
import type { Placement } from '../data/ifcGeom';
import type { DesignModelFile } from '../data/types';

export const DESIGN_CONTOUR_COLOR = '#7b1fa2';

export class DesignLayer {
  readonly group = new THREE.Group();
  /** Draaigroep: IFC-lokale assen → plaatsing. */
  private readonly placed = new THREE.Group();
  readonly meshes = new Map<string, THREE.Mesh>();
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private highlighted = false;

  constructor(public readonly model: DesignModelFile, bin: ArrayBuffer, private readonly frame: LocalFrame) {
    this.group.add(this.placed);
    for (const c of model.categorieen) {
      const pos = new Float32Array(bin, c.posOffset, c.posCount);
      const idx = new Uint32Array(bin, c.idxOffset, c.idxCount);
      // IFC (x, y, z-omhoog) → Three (x, z, −y); de plaatsing doet de rest
      const p3 = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        p3[i] = pos[i];
        p3[i + 1] = pos[i + 2];
        p3[i + 2] = -pos[i + 1];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p3, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({ color: DESIGN_CATEGORIES[c.id]?.kleur ?? '#aaa', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData = { kind: 'design', categorie: c.id };
      this.meshes.set(c.id, mesh);
      this.placed.add(mesh);
    }
  }

  apply(p: Placement, visible: boolean, categories: Record<string, boolean>, transparent: boolean) {
    this.group.visible = visible;
    const L = this.frame.toLocal(p.x, p.y, p.peil);
    this.placed.position.set(L.x, L.y, L.z);
    this.placed.rotation.set(0, (p.rotatie * Math.PI) / 180, 0);
    this.placed.updateMatrixWorld(true);
    for (const [id, m] of this.meshes) m.visible = categories[id] ?? DESIGN_CATEGORIES[id]?.standaardAan ?? true;
    for (const mat of this.materials) {
      mat.transparent = transparent;
      mat.opacity = transparent ? 0.4 : 1;
      mat.depthWrite = !transparent;
      mat.needsUpdate = true;
    }
  }

  setHighlight(on: boolean) {
    if (on === this.highlighted) return;
    this.highlighted = on;
    for (const m of this.materials) m.emissive.setHex(on ? 0x2a1a00 : 0x000000);
  }

  pickable(): THREE.Object3D[] {
    return this.group.visible ? [...this.meshes.values()].filter((m) => m.visible) : [];
  }
}
