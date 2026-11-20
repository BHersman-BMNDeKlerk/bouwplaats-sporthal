/**
 * Snel meten: klik punten (op maaiveld of gebouwen); toont per stuk de
 * horizontale afstand, de 3D-afstand en het hoogteverschil. Niet opgeslagen.
 * Bevat ook de snap-markering (ring) die ook bij het tekenen gebruikt wordt.
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import { measureTotals, segmentStats, type MeasurePoint } from '../core/measure';
import { labelSprite } from './userLayer';

const fmt = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export class MeasureTool {
  readonly group = new THREE.Group();
  private readonly snapRing: THREE.Mesh;
  private content = new THREE.Group();
  active = false;
  finished = false;
  pts: MeasurePoint[] = [];
  private cursor: MeasurePoint | null = null;

  constructor(private readonly frame: LocalFrame) {
    this.snapRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), new THREE.MeshBasicMaterial({ color: '#e91e63', depthTest: false, side: THREE.DoubleSide }));
    this.snapRing.rotation.x = -Math.PI / 2;
    this.snapRing.renderOrder = 40;
    this.snapRing.visible = false;
    this.group.add(this.snapRing, this.content);
  }

  private v(p: MeasurePoint): THREE.Vector3 {
    const q = this.frame.toLocal(p.x, p.y, p.h + 0.05);
    return new THREE.Vector3(q.x, q.y, q.z);
  }

  /** Snap-markering tonen (grootte in m) of verbergen. */
  showSnap(p: MeasurePoint | null, size = 0.5) {
    this.snapRing.visible = !!p;
    if (p) { this.snapRing.position.copy(this.v(p)); this.snapRing.scale.setScalar(size); }
  }

  start() {
    this.active = true;
    this.finished = false;
    this.pts = [];
    this.cursor = null;
    this.render();
  }

  add(p: MeasurePoint) {
    if (this.finished) { this.pts = []; this.finished = false; }
    this.pts.push(p);
    this.render();
  }

  move(p: MeasurePoint | null) {
    if (this.finished) return;
    this.cursor = p;
    this.render();
  }

  undoPoint() {
    this.pts.pop();
    this.finished = false;
    this.render();
  }

  finish() {
    this.finished = true;
    this.cursor = null;
    this.render();
  }

  stop() {
    this.active = false;
    this.finished = false;
    this.pts = [];
    this.cursor = null;
    this.showSnap(null);
    this.render();
  }

  private render() {
    for (const c of [...this.content.children]) {
      this.content.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const all = [...this.pts, ...(this.cursor && !this.finished ? [this.cursor] : [])];
    if (!all.length) return;
    const col = '#e91e63';
    if (all.length >= 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(all.map((p) => this.v(p))), new THREE.LineBasicMaterial({ color: col, depthTest: false }));
      line.renderOrder = 41;
      this.content.add(line);
      for (let i = 0; i < all.length - 1; i++) {
        const s = segmentStats(all[i], all[i + 1]);
        const t = Math.abs(s.dh) >= 0.05 ? `${fmt(s.horizontaal)} m · ΔH ${s.dh >= 0 ? '+' : '−'}${fmt(Math.abs(s.dh))}` : `${fmt(s.horizontaal)} m`;
        const lab = labelSprite(t, col, 1.1);
        lab.position.copy(this.v(all[i]).lerp(this.v(all[i + 1]), 0.5)).add(new THREE.Vector3(0, 1.2, 0));
        this.content.add(lab);
      }
      if (all.length > 2) {
        const tot = measureTotals(all);
        const lab = labelSprite(`totaal ${fmt(tot.horizontaal)} m`, '#880e4f', 1.2);
        lab.position.copy(this.v(all[all.length - 1])).add(new THREE.Vector3(0, 2.6, 0));
        this.content.add(lab);
      }
    }
    for (const p of this.pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      m.position.copy(this.v(p));
      m.renderOrder = 42;
      this.content.add(m);
    }
  }
}
