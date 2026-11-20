/**
 * Nieuw pand (uit het IFC-ontwerpmodel) als eenvoudige grijze blokken:
 * de buitenwerkse contour per hoogtezone, geëxtrudeerd tot het hoogste punt
 * van die zone. Geplaatst in RD/NAP via een aanpasbare plaatsing.
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import { signedArea, type Placement } from '../data/ifcGeom';
import type { DesignModelFile } from '../data/types';

export const DESIGN_CONTOUR_COLOR = '#7b1fa2';
/** Het blok begint iets onder peil, zodat het altijd in het maaiveld "staat". */
const ONDER_PEIL = 0.5;

export class DesignLayer {
  readonly group = new THREE.Group();
  private readonly placed = new THREE.Group();
  private readonly mat = new THREE.MeshLambertMaterial({ color: '#a9a9a9', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: '#3c3c3c' });
  readonly blocks: THREE.Mesh[] = [];

  constructor(public readonly model: DesignModelFile, private readonly frame: LocalFrame) {
    this.group.add(this.placed);
    model.zones.forEach((z, zi) => {
      const outers = z.rings.filter((r) => signedArea(r) > 0);
      const holes = z.rings.filter((r) => signedArea(r) < 0);
      for (const o of outers) {
        const shape = new THREE.Shape(o.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
        for (const h of holes) shape.holes.push(new THREE.Path(h.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))));
        const g = new THREE.ExtrudeGeometry(shape, { depth: z.top + ONDER_PEIL, bevelEnabled: false });
        g.translate(0, 0, -ONDER_PEIL);
        g.rotateX(-Math.PI / 2); // IFC (x, y, z-omhoog) → Three (x, z, −y)
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, this.mat);
        mesh.userData = { kind: 'design', zone: zi };
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), this.edgeMat);
        edges.raycast = () => {};
        this.blocks.push(mesh);
        this.placed.add(mesh, edges);
      }
    });
  }

  apply(p: Placement, visible: boolean, transparent: boolean) {
    this.group.visible = visible;
    const L = this.frame.toLocal(p.x, p.y, p.peil);
    this.placed.position.set(L.x, L.y, L.z);
    this.placed.rotation.set(0, (p.rotatie * Math.PI) / 180, 0);
    this.placed.updateMatrixWorld(true);
    this.mat.transparent = transparent;
    this.mat.opacity = transparent ? 0.4 : 1;
    this.mat.depthWrite = !transparent;
    this.mat.needsUpdate = true;
  }

  setHighlight(on: boolean) {
    this.mat.emissive.setHex(on ? 0x2a1a00 : 0x000000);
  }

  pickable(): THREE.Object3D[] {
    return this.group.visible ? this.blocks : [];
  }
}
