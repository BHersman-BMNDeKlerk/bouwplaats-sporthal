/** 3D-weergave van eigen invoer: handmatige obstakels en ingemeten punten/grens. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { LayerState } from '../core/layers';
import type { ManualObject, ProjectData } from '../core/project';
import { PUNT_SOORTEN } from '../data/csvPoints';
import { triangulate3D } from '../data/geom';
import { GRENS_KLEUR, INGEKORT_KLEUR, MANUAL_STYLE, POORT_KLEUR, soortVan } from './overlays';
import { BOUWHEK, gatePanels, panels } from '../core/polyline';
import { offsetSegment } from '../core/measure';

const fmt = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tekstlabel als sprite (schaal in meters). */
export function labelSprite(text: string, color = '#222', heightM = 0.9): THREE.Sprite {
  const c = document.createElement('canvas');
  const px = 48;
  const g = c.getContext('2d')!;
  g.font = `600 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = px + 20;
  g.font = `600 ${px}px system-ui, sans-serif`;
  g.fillStyle = '#ffffffe6';
  g.beginPath();
  g.roundRect(0, 0, w, c.height, 10);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 12, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((heightM * w) / c.height, heightM, 1);
  s.renderOrder = 10;
  s.raycast = () => {};
  return s;
}

export class UserLayer {
  readonly group = new THREE.Group();
  private key = '';

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {}

  private L(x: number, y: number, dz = 0): THREE.Vector3 {
    const h = (this.heightAt(x, y) ?? 0) + dz;
    const p = this.frame.toLocal(x, y, h);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  apply(p: ProjectData, L: LayerState, selectedId: string | null) {
    const key = JSON.stringify([p.handmatig, p.inmeting, L.handmatig, L.meetpunten, L.grens, selectedId]);
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
    }
    for (const o of p.handmatig) if (L.handmatig[o.soort]) this.addManual(o, o.id === selectedId);
    this.addSurvey(p, L);
  }

  private addManual(o: ManualObject, sel: boolean) {
    const col = sel ? '#ffeb3b' : MANUAL_STYLE[o.soort].kleur;
    const grp = new THREE.Group();
    grp.userData = { kind: 'manual', id: o.id };
    const mat = new THREE.MeshLambertMaterial({ color: col });
    const pts = o.coords;
    if (o.soort === 'maatlijn') {
      this.addDimension(o, sel, grp);
    } else if (o.soort === 'paaltjes') {
      const h = o.hoogte ?? 0.9;
      for (const [x, y] of pts) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 10), mat);
        m.position.copy(this.L(x, y, h / 2));
        m.userData = grp.userData;
        grp.add(m);
      }
    } else if (o.soort === 'hekwerk') {
      this.addFence(o, sel, grp);
    } else if (o.soort === 'doorrijhoogte') {
      const h = o.vrijeHoogte ?? 4.0;
      const t = 0.35; // dikte van de "balk"
      const beam = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      if (o.geom === 'vlak' && pts.length >= 3) {
        const ring = pts.map(([x, y]) => { const v = this.L(x, y, h); return [v.x, v.z, v.y]; });
        const { indices, points } = triangulate3D([ring]);
        const pos: number[] = [];
        for (const q of points) pos.push(q[0], q[2], q[1]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, beam);
        m.userData = grp.userData;
        grp.add(m);
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = this.L(pts[i][0], pts[i][1], h), b = this.L(pts[i + 1][0], pts[i + 1][1], h);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + t, b.z, a.x, a.y + t, a.z]), 3));
          g.setIndex([0, 1, 2, 0, 2, 3]);
          g.computeVertexNormals();
          const m = new THREE.Mesh(g, beam);
          m.userData = grp.userData;
          grp.add(m);
        }
      }
      // staanders (stippellijn van maaiveld tot vrije hoogte) op de hoekpunten
      const lm = new THREE.LineDashedMaterial({ color: col, dashSize: 0.3, gapSize: 0.2 });
      for (const [x, y] of pts) {
        const g = new THREE.BufferGeometry().setFromPoints([this.L(x, y), this.L(x, y, h)]);
        const l = new THREE.Line(g, lm);
        l.computeLineDistances();
        grp.add(l);
      }
      const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      const lab = labelSprite(`vrije hoogte ${fmt(h)} m`, '#b35900');
      lab.position.copy(this.L(cx, cy, h + 1.0));
      grp.add(lab);
    }
    if (grp.children.length) this.group.add(grp);
  }

  /** Maatlijn zoals op tekening (hulplijnen, schuine streepjes, maat), bovenop alles getekend. */
  private addDimension(o: ManualObject, sel: boolean, grp: THREE.Group) {
    const col = sel ? '#f9a825' : MANUAL_STYLE.maatlijn.kleur;
    const off = o.offset ?? 0;
    const pos: THREE.Vector3[] = [];
    const seg = (p: number[], q: number[]) => pos.push(this.L(p[0], p[1], 0.15), this.L(q[0], q[1], 0.15));
    const pts = o.coords;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const [a2, b2] = offsetSegment(a, b, off);
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const sg = Math.sign(off || 1), nx = -uy * sg, ny = ux * sg;
      if (Math.abs(off) > 0.05)
        for (const [p, q] of [[a, a2], [b, b2]]) seg([p[0] + nx * 0.2, p[1] + ny * 0.2], [q[0] + nx * 0.3, q[1] + ny * 0.3]);
      seg(a2, b2);
      const t = 0.35;
      for (const q of [a2, b2]) seg([q[0] - (ux + nx) * t, q[1] - (uy + ny) * t], [q[0] + (ux + nx) * t, q[1] + (uy + ny) * t]);
      const lab = labelSprite(len.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), col, 0.9);
      const side = off >= 0 ? 1 : -1;
      lab.position.copy(this.L((a2[0] + b2[0]) / 2 - uy * 0.6 * side, (a2[1] + b2[1]) / 2 + ux * 0.6 * side, 0.6));
      grp.add(lab);
    }
    const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pos), new THREE.LineBasicMaterial({ color: col, depthTest: false }));
    ls.renderOrder = 35;
    ls.raycast = () => {};
    grp.add(ls);
  }

  /** Bouwhekken van 3,50 × 2,00 m: gaasveld met frame, betonvoeten en poortvleugels. */
  private addFence(o: ManualObject, sel: boolean, grp: THREE.Group) {
    const h = BOUWHEK.hoogte;
    const ps = panels(o.coords);
    const gp = gatePanels(o.poorten ?? [], ps.length);
    const mesh = (kleur: string) => new THREE.MeshLambertMaterial({ color: kleur, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const mats = {
      hek: mesh(sel ? '#fff176' : '#b0bec5'), poort: mesh(POORT_KLEUR), ingekort: mesh(INGEKORT_KLEUR),
    };
    const frame = {
      hek: new THREE.LineBasicMaterial({ color: sel ? '#f9a825' : '#546e7a' }), poort: new THREE.LineBasicMaterial({ color: '#e65100' }),
      ingekort: new THREE.LineBasicMaterial({ color: '#b71c1c' }),
    };
    const voet = new THREE.MeshLambertMaterial({ color: '#9e9e9e' });
    const lift = 0.12; // hek staat in de voet
    for (const p of ps) {
      const kind = gp.has(p.index) ? 'poort' : p.heel ? 'hek' : 'ingekort';
      const a = this.L(p.a[0], p.a[1], lift), b = this.L(p.b[0], p.b[1], lift);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z]), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mats[kind]);
      m.userData = grp.userData;
      grp.add(m);
      const f = new THREE.BufferGeometry().setFromPoints([a, b, new THREE.Vector3(b.x, b.y + h, b.z), new THREE.Vector3(a.x, a.y + h, a.z), a]);
      const line = new THREE.Line(f, frame[kind]);
      line.raycast = () => {};
      grp.add(line);
    }
    // betonvoeten op alle hekovergangen
    const joints = ps.length ? [ps[0].a, ...ps.map((p) => p.b)] : [];
    joints.forEach((q, i) => {
      const p = ps[Math.min(i, ps.length - 1)];
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.14, 0.22), voet);
      v.position.copy(this.L(q[0], q[1], 0.07));
      v.rotation.y = Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) + Math.PI / 2; // voet dwars op het hek
      v.userData = grp.userData;
      grp.add(v);
    });
  }

  private addSurvey(p: ProjectData, L: LayerState) {
    const g = p.inmeting.grens;
    if (g && L.grens) {
      const mat = new THREE.MeshLambertMaterial({ color: GRENS_KLEUR });
      g.punten.forEach((pt, i) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), mat);
        m.position.copy(this.L(pt.x, pt.y, 0.3));
        m.userData = { kind: 'grenspunt', index: i };
        this.group.add(m);
      });
    }
    const pts = p.inmeting.punten;
    if (!pts) return;
    pts.punten.forEach((pt, i) => {
      const soort = soortVan(p, pt);
      if (!L.meetpunten[soort]) return;
      const rule = p.inmeting.codes[pt.code ?? ''];
      const ud = { kind: 'meetpunt', index: i };
      // positie op de ingemeten hoogte als die er is, anders op het AHN-maaiveld
      const base = pt.z != null ? (() => { const q = this.frame.toLocal(pt.x, pt.y, pt.z!); return new THREE.Vector3(q.x, q.y, q.z); })() : this.L(pt.x, pt.y);
      if (soort === 'paal') {
        const h = rule?.hoogte ?? PUNT_SOORTEN.paal.standaardHoogte!;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 10), new THREE.MeshLambertMaterial({ color: PUNT_SOORTEN.paal.kleur }));
        m.position.set(base.x, base.y + h / 2, base.z);
        m.userData = ud;
        this.group.add(m);
      } else if (soort === 'boom') {
        const h = rule?.hoogte ?? PUNT_SOORTEN.boom.standaardHoogte!;
        const r = Math.max(1.5, h * 0.3);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, h * 0.5, 8), new THREE.MeshLambertMaterial({ color: '#6b4a2f' }));
        trunk.position.set(base.x, base.y + h * 0.25, base.z);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: PUNT_SOORTEN.boom.kleur, transparent: true, opacity: 0.85 }));
        crown.scale.set(r, (h * 0.6) / 2, r);
        crown.position.set(base.x, base.y + h - (h * 0.6) / 2, base.z);
        trunk.userData = crown.userData = ud;
        this.group.add(trunk, crown);
      }
    });
  }

  pickable(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o); });
    return out;
  }
}
