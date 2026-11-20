/**
 * Tekengereedschap voor punten, lijnen en vlakken op het maaiveld.
 * Klik = punt toevoegen (slepen blijft de kaart verschuiven), dubbelklik of
 * Enter = afronden, Backspace = laatste punt weg, Esc = annuleren.
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';

export type DrawGeom = 'punten' | 'lijn' | 'vlak';

export interface DrawRequest {
  geom: DrawGeom;
  kleur: string;
  titel: string;
  onFinish: (coords: [number, number][]) => void;
  onCancel?: () => void;
  /** Optioneel: nieuw punt laten "springen" t.o.v. het vorige (bv. hele bouwhekken). */
  snap?: (prev: [number, number], target: [number, number]) => [number, number];
  /** Optioneel: extra statustekst op basis van de punten. */
  info?: (pts: [number, number][]) => string;
  /** Optioneel: vast beginpunt (bv. huidige positie van het voertuig). */
  begin?: [number, number];
}

export class DrawTool {
  readonly group = new THREE.Group();
  private req: DrawRequest | null = null;
  private pts: [number, number][] = [];
  private cursor: [number, number] | null = null;
  private line: THREE.Line | null = null;
  private markers = new THREE.Group();

  constructor(
    private readonly frame: LocalFrame,
    private readonly heightAt: (x: number, y: number) => number | null,
    private readonly status: (msg: string) => void,
  ) {
    this.group.add(this.markers);
    this.group.renderOrder = 5;
  }

  get active(): boolean {
    return this.req !== null;
  }

  start(req: DrawRequest) {
    this.cancel(false);
    this.req = req;
    this.pts = req.begin ? [req.begin] : [];
    this.update();
  }

  private v(x: number, y: number): THREE.Vector3 {
    const p = this.frame.toLocal(x, y, (this.heightAt(x, y) ?? 0) + 0.15);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** Klik op het maaiveld (RD). */
  private snapped(x: number, y: number, free: boolean): [number, number] {
    const last = this.pts[this.pts.length - 1];
    if (!this.req?.snap || free || !last) return [x, y];
    return this.req.snap(last, [x, y]);
  }

  click(x0: number, y0: number, free = false) {
    if (!this.req) return;
    const [x, y] = this.snapped(x0, y0, free);
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 0.05) return;
    this.pts.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    this.update();
  }

  move(x: number, y: number, free = false) {
    if (!this.req) return;
    this.cursor = this.snapped(x, y, free);
    this.update();
  }

  undoPoint() {
    if (!this.req) return;
    this.pts.pop();
    this.update();
  }

  finish() {
    if (!this.req) return;
    const r = this.req;
    const min = r.geom === 'vlak' ? 3 : r.geom === 'lijn' ? 2 : 1;
    if (this.pts.length < min) {
      this.status(`Nog te weinig punten: minimaal ${min}. Esc = annuleren.`);
      return;
    }
    const pts = this.pts.slice();
    this.req = null;
    this.clear();
    r.onFinish(pts);
  }

  cancel(notify = true) {
    const r = this.req;
    this.req = null;
    this.clear();
    if (notify && r) { r.onCancel?.(); this.status('Tekenen geannuleerd'); }
  }

  private clear() {
    this.pts = [];
    this.cursor = null;
    if (this.line) { this.group.remove(this.line); this.line.geometry.dispose(); this.line = null; }
    for (const m of [...this.markers.children]) this.markers.remove(m);
  }

  private update() {
    if (!this.req) return;
    const all = [...this.pts, ...(this.cursor ? [this.cursor] : [])];
    if (this.req.geom === 'vlak' && all.length >= 3) all.push(all[0]);
    if (this.line) { this.group.remove(this.line); this.line.geometry.dispose(); this.line = null; }
    if (this.req.geom !== 'punten' && all.length >= 2) {
      const g = new THREE.BufferGeometry().setFromPoints(all.map(([x, y]) => this.v(x, y)));
      this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: this.req.kleur, depthTest: false }));
      this.line.renderOrder = 20;
      this.group.add(this.line);
    }
    for (const m of [...this.markers.children]) this.markers.remove(m);
    for (const [x, y] of this.pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: this.req.kleur, depthTest: false }));
      m.position.copy(this.v(x, y));
      m.renderOrder = 21;
      this.markers.add(m);
    }
    // status: lengte / oppervlakte
    const fmt = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
    let info = `${this.req.titel}: ${this.pts.length} punt(en)`;
    if (this.req.geom === 'lijn' && all.length >= 2) {
      let l = 0;
      for (let i = 0; i < all.length - 1; i++) l += Math.hypot(all[i + 1][0] - all[i][0], all[i + 1][1] - all[i][1]);
      info += ` · lengte ${fmt(l)} m`;
    }
    if (this.req.geom === 'vlak' && all.length >= 4) {
      let a = 0;
      for (let i = 0; i < all.length - 1; i++) a += all[i][0] * all[i + 1][1] - all[i + 1][0] * all[i][1];
      info += ` · oppervlakte ${fmt(Math.abs(a / 2), 1)} m²`;
    }
    if (this.req.info) info += ` · ${this.req.info(all)}`;
    this.status(`${info} — klik = punt, dubbelklik/Enter = klaar, Backspace = punt terug, Esc = annuleren`);
  }
}
