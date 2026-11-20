/** Fase 5: weergave van kranen in 2D (terreintextuur) en 3D. */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { CanvasOverlay, DrawContext } from './terrainLayer';
import { carrierRect, hasOutriggers, towerRadius, towerTipHeight, loadRings, mobileRadius, mobileTipHeight, outriggerPads, pointInRing, reach, slewRadius, towerBase, type Crane, type LiftCheck } from '../cranes/cranes';
import { labelSprite } from './userLayer';

export const KRAAN_KLEUR = '#f57c00';
const fmt = (v: number, d = 1) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

export interface LiftMarker { x: number; y: number; last: number; checks: LiftCheck[] }

function circle(c: DrawContext, x: number, y: number, r: number) {
  c.ctx.moveTo(c.X(x + r), c.Y(y));
  c.ctx.arc(c.X(x), c.Y(y), r * c.ppm, 0, Math.PI * 2);
}

export function cranesOverlay(getCranes: () => Crane[], selectedId: () => string | null, marker: () => LiftMarker | null, warn: () => Set<string>, hidden: () => string | null = () => null): CanvasOverlay {
  return (c, L) => {
    if (!L.kranen) return;
    const { ctx, ppm } = c;
    const lw = (m: number, min = 1) => Math.max(min, m * ppm);
    for (const k of getCranes()) {
      if (!k.zichtbaar || hidden() === k.id) continue;
      const sel = selectedId() === k.id;
      const bad = warn().has(k.id);
      const R = slewRadius(k);
      const dir = (k.richting * Math.PI) / 180;
      // zwenkgebied
      ctx.beginPath();
      circle(c, k.x, k.y, R);
      ctx.fillStyle = KRAAN_KLEUR + (sel ? '22' : '14');
      ctx.fill();
      ctx.strokeStyle = bad ? '#d32f2f' : KRAAN_KLEUR;
      ctx.lineWidth = lw(sel ? 0.4 : 0.3, 2);
      ctx.stroke();
      // draagvermogen-ringen
      ctx.strokeStyle = '#e65100d0';
      ctx.lineWidth = lw(0.22, 2);
      ctx.setLineDash([1.5 * ppm, 0.8 * ppm]);
      const rings = loadRings(k);
      for (const r of rings) { ctx.beginPath(); circle(c, k.x, k.y, r.radius); ctx.stroke(); }
      ctx.setLineDash([]);
      // labels van de ringen en de kraannaam staan als 3D-label in beeld (ook boven daken)
      if (k.type === 'toren') {
        // contragiek
        ctx.beginPath(); circle(c, k.x, k.y, k.contragiekLengte);
        ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = lw(0.25, 1.5); ctx.setLineDash([1.2 * ppm, 0.6 * ppm]); ctx.stroke(); ctx.setLineDash([]);
        if (hasOutriggers(k)) {
          const pads = outriggerPads(k);
          ctx.beginPath();
          for (const p of pads) { const m = [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2]; ctx.moveTo(c.X(k.x), c.Y(k.y)); ctx.lineTo(c.X(m[0]), c.Y(m[1])); }
          ctx.strokeStyle = '#424242'; ctx.lineWidth = lw(0.25, 2); ctx.stroke();
          ctx.beginPath(); c.ring(carrierRect(k)); ctx.fillStyle = '#ffb300dd'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = lw(0.06); ctx.stroke();
          for (const p of pads) { ctx.beginPath(); c.ring(p); ctx.fillStyle = '#5d4037'; ctx.fill(); }
        } else {
          // voet
          ctx.beginPath(); c.ring(towerBase(k)); ctx.fillStyle = '#9e9e9ecc'; ctx.fill(); ctx.strokeStyle = '#424242'; ctx.lineWidth = lw(0.08); ctx.stroke();
        }
        // giek + contragiek in de huidige stand
        ctx.beginPath();
        ctx.moveTo(c.X(k.x - k.contragiekLengte * Math.cos(dir)), c.Y(k.y - k.contragiekLengte * Math.sin(dir)));
        ctx.lineTo(c.X(k.x + towerRadius(k) * Math.cos(dir)), c.Y(k.y + towerRadius(k) * Math.sin(dir)));
        ctx.strokeStyle = '#e6a100'; ctx.lineWidth = lw(0.9, 3); ctx.stroke();
        ctx.beginPath(); ctx.rect(c.X(k.x) - 0.8 * ppm, c.Y(k.y) - 0.8 * ppm, 1.6 * ppm, 1.6 * ppm); ctx.fillStyle = '#ffb300'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.stroke();
      } else {
        // staart, huidige radius, onderwagen, stempels
        ctx.beginPath(); circle(c, k.x, k.y, k.staartStraal);
        ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = lw(0.2, 1.5); ctx.setLineDash([0.8 * ppm, 0.4 * ppm]); ctx.stroke(); ctx.setLineDash([]);
        const rr = mobileRadius(k);
        ctx.beginPath(); circle(c, k.x, k.y, rr); ctx.strokeStyle = '#1565c0'; ctx.lineWidth = lw(0.25, 1.5); ctx.stroke();
        const pads = outriggerPads(k);
        ctx.beginPath();
        for (const p of pads) { const m = [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2]; ctx.moveTo(c.X(k.x), c.Y(k.y)); ctx.lineTo(c.X(m[0]), c.Y(m[1])); }
        ctx.strokeStyle = '#424242'; ctx.lineWidth = lw(0.25, 2); ctx.stroke();
        ctx.beginPath(); c.ring(carrierRect(k)); ctx.fillStyle = '#ffb300dd'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = lw(0.06); ctx.stroke();
        for (const p of pads) { ctx.beginPath(); c.ring(p); ctx.fillStyle = '#5d4037'; ctx.fill(); }
        ctx.beginPath();
        ctx.moveTo(c.X(k.x + k.scharnierOffset * Math.cos(dir)), c.Y(k.y + k.scharnierOffset * Math.sin(dir)));
        ctx.lineTo(c.X(k.x + rr * Math.cos(dir)), c.Y(k.y + rr * Math.sin(dir)));
        ctx.strokeStyle = '#e6a100'; ctx.lineWidth = lw(0.7, 3); ctx.stroke();
      }
    }
    const m = marker();
    if (m) {
      const ok = m.checks.some((q) => q.ok);
      ctx.beginPath();
      ctx.arc(c.X(m.x), c.Y(m.y), lw(1.2, 7), 0, Math.PI * 2);
      ctx.fillStyle = ok ? '#2e7d32' : '#c62828';
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      c.label(`${fmt(m.last, 2)} t: ${ok ? 'OK' : 'NIET OK'}`, m.x, m.y + 3, 0, 2.0, '#fff', ok ? '#2e7d32' : '#c62828', true);
    }
  };
}

export function hitCrane(cranes: Crane[], x: number, y: number, tol: number): Crane | null {
  for (const k of [...cranes].reverse()) {
    if (!k.zichtbaar) continue;
    if (Math.hypot(x - k.x, y - k.y) < Math.max(1.5, tol)) return k;
    if (k.type === 'toren' && pointInRing(x, y, towerBase(k))) return k;
    if (hasOutriggers(k) && (pointInRing(x, y, carrierRect(k)) || pointInRing(x, y, carrierRect({ ...k, onderwagenLengte: k.stempelLengte + (k.plaat ?? 1), onderwagenBreedte: k.stempelBreedte + (k.plaat ?? 1) })))) return k;
    if (k.type === 'mobiel' && (pointInRing(x, y, carrierRect(k)) || pointInRing(x, y, carrierRect({ ...k, onderwagenLengte: k.stempelLengte + k.plaat, onderwagenBreedte: k.stempelBreedte + k.plaat })))) return k;
  }
  return null;
}

/** 3D-kranen. */
export class CraneLayer {
  readonly group = new THREE.Group();
  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {}

  private clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse((q: any) => { q.geometry?.dispose?.(); if (q.material) (Array.isArray(q.material) ? q.material : [q.material]).forEach((m: any) => { m.map?.dispose?.(); m.dispose(); }); });
    }
  }

  private v(x: number, y: number, z: number) { const p = this.frame.toLocal(x, y, z); return new THREE.Vector3(p.x, p.y, p.z); }

  /** Balk van punt a (RD + hoogte NAP) in richting (heading, pitch) met lengte len. */
  private beam(x: number, y: number, z: number, heading: number, pitch: number, len: number, w: number, h: number, color: string, id: string): THREE.Mesh {
    const g = new THREE.BoxGeometry(len, h, w);
    g.translate(len / 2, 0, 0);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    m.position.copy(this.v(x, y, z));
    m.rotation.order = 'YZX';
    m.rotation.y = heading;
    m.rotation.z = pitch;
    m.userData = { kind: 'crane', id };
    return m;
  }

  private ring(x: number, y: number, z: number, r: number, color: string, dashed = false): THREE.Line {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(this.v(x + r * Math.cos(a), y + r * Math.sin(a), z)); }
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    l.renderOrder = 9;
    if (dashed) l.computeLineDistances();
    l.raycast = () => {};
    return l;
  }

  /** Draagvermogen-ringen met labels (altijd zichtbaar, ook boven daken). */
  private loadRings3D(k: Crane, z: number, labels: boolean) {
    const la = (k.richting * Math.PI) / 180 + Math.PI / 4;
    for (const r of loadRings(k)) {
      this.group.add(this.ring(k.x, k.y, z, r.radius, '#e65100', true));
      if (!labels) continue;
      const s = labelSprite(`${fmt(r.radius, 0)} m · ${fmt(r.last, r.last < 10 ? 2 : 1)} t`, '#8a3c00', 1.6);
      s.position.copy(this.v(k.x + r.radius * Math.cos(la), k.y + r.radius * Math.sin(la), z + 0.5));
      this.group.add(s);
    }
  }

  private outriggers3D(k: Crane, g0: number) {
    if (!hasOutriggers(k)) return;
    const rot = ((k.rotatie ?? 0) * Math.PI) / 180, plaat = k.plaat ?? 1;
    const cr = carrierRect(k);
    this.group.add(this.beam(cr[0][0] + (cr[3][0] - cr[0][0]) / 2, cr[0][1] + (cr[3][1] - cr[0][1]) / 2, g0 + 0.6, rot, 0, k.onderwagenLengte ?? 12, k.onderwagenBreedte ?? 2.75, 2.2, '#ffb300', k.id));
    for (const p of outriggerPads(k)) {
      const cx = (p[0][0] + p[2][0]) / 2, cy = (p[0][1] + p[2][1]) / 2;
      this.group.add(this.beam(cx - (plaat / 2) * Math.cos(rot), cy - (plaat / 2) * Math.sin(rot), g0 + 0.1, rot, 0, plaat, plaat, 0.2, '#5d4037', k.id));
      const len = Math.hypot(cx - k.x, cy - k.y);
      this.group.add(this.beam(k.x, k.y, g0 + 0.9, Math.atan2(cy - k.y, cx - k.x), 0, len, 0.4, 0.4, '#616161', k.id));
    }
  }

  apply(cranes: Crane[], visible: boolean, selectedId: string | null, marker: LiftMarker | null = null) {
    this.clear();
    if (!visible) return;
    if (marker) {
      const ok = marker.checks.some((q) => q.ok);
      const g = this.heightAt(marker.x, marker.y) ?? 0;
      const col = ok ? '#2e7d32' : '#c62828';
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      ball.position.copy(this.v(marker.x, marker.y, g + 0.5)); ball.renderOrder = 11; ball.raycast = () => {};
      this.group.add(ball);
      for (const c of marker.checks) {
        const k = cranes.find((q) => q.id === c.craneId);
        if (!k) continue;
        const gk = this.heightAt(k.x, k.y) ?? 0;
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.v(k.x, k.y, gk + 0.5), this.v(marker.x, marker.y, g + 0.5)]), new THREE.LineDashedMaterial({ color: c.ok ? '#2e7d32' : '#c62828', dashSize: 1, gapSize: 0.6, depthTest: false }));
        l.computeLineDistances(); l.renderOrder = 11; l.raycast = () => {};
        this.group.add(l);
      }
      const lab = labelSprite(`${fmt(marker.last, 2)} t: ${ok ? 'OK' : 'NIET OK'}${marker.checks.length === 1 ? ` (R ${fmt(marker.checks[0].radius)} m${marker.checks[0].max != null ? `, max ${fmt(marker.checks[0].max, 2)} t` : ''})` : ''}`, col, 1.8);
      lab.position.copy(this.v(marker.x, marker.y, g + 3));
      this.group.add(lab);
    }
    for (const k of cranes) {
      if (!k.zichtbaar) continue;
      const g0 = this.heightAt(k.x, k.y) ?? 0;
      const head = (k.richting * Math.PI) / 180;
      const sel = selectedId === k.id;
      if (k.type === 'toren') {
        const top = g0 + k.haakhoogte + k.giekHoogte;
        // voet of onderwagen met stempels, en mast
        if (hasOutriggers(k)) this.outriggers3D(k, g0);
        else this.group.add(this.beam(k.x - k.voetLengte / 2, k.y, g0 - 0.2, 0, 0, k.voetLengte, k.voetBreedte, 0.6, '#9e9e9e', k.id));
        const mast = this.beam(k.x, k.y, g0, 0, Math.PI / 2, top - g0 + 1.5, 1.6, 1.6, '#ffb300', k.id);
        this.group.add(mast);
        // giek en contragiek
        const hk = ((k.giekHoek ?? 0) * Math.PI) / 180;
        this.group.add(this.beam(k.x, k.y, g0 + k.haakhoogte + k.giekHoogte / 2, head, hk, k.giekLengte, 1.2, k.giekHoogte * 0.6, '#ffc107', k.id));
        this.group.add(this.beam(k.x, k.y, g0 + k.contragiekHoogte + 0.5, head + Math.PI, 0, k.contragiekLengte, 2.0, 1.0, '#ffc107', k.id));
        this.group.add(this.beam(k.x - (k.contragiekLengte - 2.5) * Math.cos(head), k.y - (k.contragiekLengte - 2.5) * Math.sin(head), k.contragiekHoogte + g0 - 1.5, head + Math.PI, 0, 2.5, 2.4, 2.2, '#757575', k.id));
        // haak op 2/3 van de giek
        const hr = towerRadius(k) * (hk ? 1 : 0.66), hz = g0 + (hk ? towerTipHeight(k) : k.haakhoogte);
        const hx = k.x + hr * Math.cos(head), hy = k.y + hr * Math.sin(head);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.v(hx, hy, hz), this.v(hx, hy, hz - 8)]), new THREE.LineBasicMaterial({ color: '#222' }));
        line.raycast = () => {};
        this.group.add(line);
        this.group.add(this.ring(k.x, k.y, g0 + k.haakhoogte, towerRadius(k), sel ? '#d84315' : KRAAN_KLEUR));
        this.group.add(this.ring(k.x, k.y, g0 + k.contragiekHoogte, k.contragiekLengte, '#6d4c41', true));
        this.loadRings3D(k, g0 + k.haakhoogte, true);
        const lab = labelSprite(`${k.naam} · haak ${fmt(k.haakhoogte)} m`, '#5d2a00', 1.4);
        lab.position.copy(this.v(k.x, k.y, top + 3));
        this.group.add(lab);
      } else {
        this.outriggers3D(k, g0);
        // bovenwagen
        this.group.add(this.beam(k.x - 3 * Math.cos(head), k.y - 3 * Math.sin(head), g0 + 2.6, head, 0, 5, 2.6, 1.6, '#ffa000', k.id));
        const px = k.x + k.scharnierOffset * Math.cos(head), py = k.y + k.scharnierOffset * Math.sin(head);
        this.group.add(this.beam(px, py, g0 + k.scharnierHoogte, head, (k.giekHoek * Math.PI) / 180, k.giekLengte, 0.9, 0.9, '#ffc107', k.id));
        const rr = mobileRadius(k), tip = g0 + mobileTipHeight(k);
        const tx = k.x + rr * Math.cos(head), ty = k.y + rr * Math.sin(head);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.v(tx, ty, tip), this.v(tx, ty, g0 + 2)]), new THREE.LineBasicMaterial({ color: '#222' }));
        line.raycast = () => {};
        this.group.add(line);
        this.group.add(this.ring(k.x, k.y, g0 + 0.3, reach(k).max, sel ? '#d84315' : KRAAN_KLEUR));
        this.group.add(this.ring(k.x, k.y, g0 + 0.3, mobileRadius(k), '#1565c0'));
        this.loadRings3D(k, g0 + 0.3, sel);
        const lab = labelSprite(`${k.naam} · R ${fmt(rr)} m`, '#5d2a00', 1.2);
        lab.position.copy(this.v(tx, ty, tip + 2));
        this.group.add(lab);
      }
    }
  }

  pickable(): THREE.Object3D[] { return this.group.visible ? [this.group] : []; }
}
