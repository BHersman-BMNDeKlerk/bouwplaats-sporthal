/**
 * Fase 4: weergave van routes.
 *  - 2D (terreintextuur): omhullende, wielsporen, getekende lijn met pijlen,
 *    spookbeelden, botsingen en meldingen;
 *  - 3D: het voertuig op de afspeelpositie, met optionele debugweergave
 *    (stuurhoek, draaipool, knikhoek).
 */
import * as THREE from 'three';
import type { LocalFrame } from '../core/coords';
import type { LayerState } from '../core/layers';
import type { CanvasOverlay, DrawContext } from './terrainLayer';
import type { Route, RouteEngine } from '../vehicles/routes';
import { bodyAt, thin } from '../vehicles/sweep';
import { frontAxle, kingpin, trailerAxle, type Pose, type Sample } from '../vehicles/kinematics';
import { labelSprite } from './userLayer';

export const ROUTE_KLEUR = { vooruit: '#1565c0', achteruit: '#7b1fa2', omhullende: '#1e88e5', fout: '#e53935', spoor: '#0d47a1' };

function arrow(c: DrawContext, a: number[], b: number[], color: string, sizeM: number) {
  const { ctx } = c;
  const ang = Math.atan2(c.Y(b[1]) - c.Y(a[1]), c.X(b[0]) - c.X(a[0]));
  const mx = (c.X(a[0]) + c.X(b[0])) / 2, my = (c.Y(a[1]) + c.Y(b[1])) / 2;
  const s = sizeM * c.ppm;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(ang) * s, my + Math.sin(ang) * s);
  ctx.lineTo(mx + Math.cos(ang + 2.5) * s, my + Math.sin(ang + 2.5) * s);
  ctx.lineTo(mx + Math.cos(ang - 2.5) * s, my + Math.sin(ang - 2.5) * s);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function routesOverlay(getRoutes: () => Route[], engine: RouteEngine, selectedId: () => string | null): CanvasOverlay {
  return (c, L) => {
    if (!L.routes) return;
    const { ctx, ppm } = c;
    const lw = (m: number, min = 1) => Math.max(min, m * ppm);
    for (const r of getRoutes()) {
      if (!r.zichtbaar || !r.legs.length) continue;
      const res = engine.result(r);
      const sel = selectedId() === r.id;
      const bad = !res.sim.uitvoerbaar || res.conflicts.length > 0;
      const kleur = bad ? ROUTE_KLEUR.fout : ROUTE_KLEUR.omhullende;
      // omhullende
      if (res.env.rings.length) {
        ctx.beginPath();
        for (const ring of res.env.rings) c.ring(ring);
        ctx.fillStyle = kleur + (sel ? '40' : '2a');
        ctx.fill('evenodd');
        ctx.strokeStyle = kleur;
        ctx.lineWidth = lw(sel ? 0.12 : 0.08, 1.2);
        ctx.stroke();
      }
      // wielsporen
      if (L.routeSporen) {
        ctx.strokeStyle = ROUTE_KLEUR.spoor + 'aa';
        ctx.lineWidth = lw(0.05);
        ctx.setLineDash([0.4 * ppm, 0.25 * ppm]);
        for (const sp of res.env.sporen) { ctx.beginPath(); c.path(sp); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // spookbeelden
      if (r.spook > 0) {
        ctx.strokeStyle = '#37474fcc';
        ctx.lineWidth = lw(0.04);
        for (const s of thin(res.sim.samples, r.spook)) {
          for (const b of bodyAt(r.voertuig, s).bodies) { ctx.beginPath(); c.ring([...b, b[0]]); ctx.stroke(); }
        }
      }
      // getekende lijnen
      for (const leg of r.legs) {
        const col = ROUTE_KLEUR[leg.richting];
        ctx.beginPath();
        c.path(leg.punten);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw(sel ? 0.16 : 0.1, 1.5);
        ctx.setLineDash(leg.richting === 'achteruit' ? [0.8 * ppm, 0.4 * ppm] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 1; i < leg.punten.length; i++) {
          const a = leg.punten[i - 1], b = leg.punten[i];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 4) arrow(c, a, b, col, 0.7);
        }
      }
      // botsingen en meldingen
      for (const k of res.conflicts) {
        ctx.beginPath();
        ctx.arc(c.X(k.x), c.Y(k.y), lw(0.7, 6), 0, Math.PI * 2);
        ctx.strokeStyle = ROUTE_KLEUR.fout;
        ctx.lineWidth = lw(0.15, 2);
        ctx.stroke();
        if (sel) c.label(k.naam, k.x, k.y + 1.2, 0, 0.6, '#b71c1c', '#ffffffdd', true);
      }
      for (const f of res.sim.flags) {
        if (f.soort === 'stuursnelheid') continue;
        const s = lw(0.6, 5);
        ctx.beginPath();
        ctx.moveTo(c.X(f.x), c.Y(f.y) - s); ctx.lineTo(c.X(f.x) + s, c.Y(f.y) + s * 0.8); ctx.lineTo(c.X(f.x) - s, c.Y(f.y) + s * 0.8); ctx.closePath();
        ctx.fillStyle = f.soort === 'stuurhoek' ? '#ff9800' : ROUTE_KLEUR.fout;
        ctx.fill();
      }
      if (!res.sim.uitvoerbaar) {
        const last = res.sim.samples[res.sim.samples.length - 1];
        if (last) c.label('NIET UITVOERBAAR', last.x, last.y, 0, 1.0, '#ffffff', '#c62828', true);
      }
      // naam bij het begin
      const p0 = r.legs[0].punten[0];
      c.label(r.naam, p0[0], p0[1] - 1.5, 0, 0.7, '#0d47a1', '#ffffffdd', true);
    }
  };
}

/** Hit-test in 2D: binnen de omhullende of nabij de getekende lijn. */
export function hitRoute(routes: Route[], engine: RouteEngine, L: LayerState, x: number, y: number, tol: number): Route | null {
  if (!L.routes) return null;
  const inRing = (r: number[][]) => {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
    return ins;
  };
  for (const r of [...routes].reverse()) {
    if (!r.zichtbaar) continue;
    for (const leg of r.legs)
      for (let i = 1; i < leg.punten.length; i++) {
        const a = leg.punten[i - 1], b = leg.punten[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
        if (Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) < tol) return r;
      }
    const env = engine.result(r).env;
    let n = 0;
    for (const ring of env.rings) if (inRing(ring)) n++;
    if (n % 2 === 1) return r;
  }
  return null;
}

/** 3D-voertuig op de afspeelpositie. */
export class RouteLayer {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private debug = new THREE.Group();

  constructor(private readonly frame: LocalFrame, private readonly heightAt: (x: number, y: number) => number | null) {
    this.group.add(this.body, this.debug);
  }

  private clear(g: THREE.Group) {
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse((q: any) => { q.geometry?.dispose?.(); if (q.material) (Array.isArray(q.material) ? q.material : [q.material]).forEach((m: any) => { m.map?.dispose?.(); m.dispose(); }); });
    }
  }

  private v(x: number, y: number, dz = 0) {
    const p = this.frame.toLocal(x, y, (this.heightAt(x, y) ?? 0) + dz);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** Doos langs een rechthoek (4 hoeken RD), van z0 tot z1 boven maaiveld. */
  private box(rect: number[][], z0: number, z1: number, color: string, opacity = 1): THREE.Mesh {
    const cx = rect.reduce((s, q) => s + q[0], 0) / 4, cy = rect.reduce((s, q) => s + q[1], 0) / 4;
    const len = Math.hypot(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]);
    const wid = Math.hypot(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
    const ang = Math.atan2(rect[1][1] - rect[0][1], rect[1][0] - rect[0][0]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, z1 - z0, wid), new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }));
    const c = this.v(cx, cy, (z0 + z1) / 2);
    m.position.copy(c);
    m.rotation.y = ang; // lokaal: z = −noord, dus draaiing om y met +hoek
    m.castShadow = false;
    return m;
  }

  hide() { this.clear(this.body); this.clear(this.debug); }

  show(r: Route, s: Sample, debug: boolean) {
    this.hide();
    const v = r.voertuig;
    const g = bodyAt(v, s);
    const cab = Math.min(v.hoogte, 3.2);
    // trekker/voertuig
    this.body.add(this.box(g.bodies[0], 0.5, v.soort === 'oplegger' ? cab : v.hoogte, v.soort === 'oplegger' ? '#ffb300' : '#ffa000', 0.92));
    if (g.bodies[1]) this.body.add(this.box(g.bodies[1], 1.2, v.hoogte, '#90a4ae', 0.85));
    for (const t of g.tyres) this.body.add(this.box(t, 0, 1.0, '#212121'));
    if (!debug) return;
    // debug: draaipool, stuurhoek, knikhoek
    const mat = (c: string) => new THREE.LineBasicMaterial({ color: c, depthTest: false });
    const line = (pts: THREE.Vector3[], c: string) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(c)); l.renderOrder = 12; this.debug.add(l); };
    const fa = frontAxle(v, s);
    const deg = (a: number) => `${(Math.round((a * 180) / Math.PI * 10) / 10).toString().replace('.', ',')}°`;
    const R = Math.abs(s.delta) > 1e-3 ? v.wielbasis / Math.tan(s.delta) : Infinity;
    if (Math.abs(R) < 60) {
      const cx = s.x - R * Math.sin(s.theta), cy = s.y + R * Math.cos(s.theta);
      line([this.v(s.x, s.y, 0.3), this.v(cx, cy, 0.3)], '#d81b60');
      line([this.v(fa[0], fa[1], 0.3), this.v(cx, cy, 0.3)], '#d81b60');
      if (v.soort === 'oplegger') { const ta = trailerAxle(v, s); line([this.v(ta[0], ta[1], 0.3), this.v(cx, cy, 0.3)], '#8e24aa'); }
      const pole = new THREE.Mesh(new THREE.SphereGeometry(0.35), new THREE.MeshBasicMaterial({ color: '#d81b60', depthTest: false }));
      pole.position.copy(this.v(cx, cy, 0.3)); pole.renderOrder = 12; this.debug.add(pole);
      const lab = labelSprite(`draaipool R = ${Math.abs(R).toFixed(1).replace('.', ',')} m`, '#ad1457', 0.7);
      lab.position.copy(this.v(cx, cy, 1.5)); this.debug.add(lab);
    }
    // wielrichting voor
    const dir = s.theta + s.delta;
    for (const w of g.wheels.slice(0, 2)) line([this.v(w[0] - 2 * Math.cos(dir), w[1] - 2 * Math.sin(dir), 1.1), this.v(w[0] + 2 * Math.cos(dir), w[1] + 2 * Math.sin(dir), 1.1)], '#00c853');
    const knik = v.soort === 'oplegger' ? ` · knik ${deg(Math.atan2(Math.sin(s.theta - s.phi), Math.cos(s.theta - s.phi)))}` : '';
    const lab = labelSprite(`δ ${deg(s.delta)}${knik} · afw. ${s.afwijking.toFixed(2).replace('.', ',')} m`, '#1b5e20', 0.7);
    const kp = kingpin(v, s as Pose);
    lab.position.copy(this.v(kp[0], kp[1], v.hoogte + 1.2));
    this.debug.add(lab);
  }
}
