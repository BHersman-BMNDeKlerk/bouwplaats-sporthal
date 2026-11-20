/**
 * 2D-lagen op de terreintextuur (fase 2): KLIC, inmeting, DXF-onderleggers en
 * eigen obstakels (vlakken/lijnen). Plus aanwijzen (hit-test) in RD.
 */
import type { LayerState } from '../core/layers';
import type { DxfRef, ManualObject, ProjectData } from '../core/project';
import { boundaryRing, polylineLength } from '../core/boundary';
import { PUNT_SOORTEN, type MeetPunt, type PuntSoort } from '../data/csvPoints';
import { dxfToRD, type DxfData } from '../data/dxf';
import { distPointSegment, pointInRing } from '../data/geom';
import type { Placement } from '../data/ifcGeom';
import { themaStyle, type KlicData, type KlicLine } from '../data/klic';
import type { CanvasOverlay, DrawContext } from './terrainLayer';

const inView = (c: DrawContext, x: number, y: number, m = 5) => x > c.bb.xmin - m && x < c.bb.xmax + m && y > c.bb.ymin - m && y < c.bb.ymax + m;
const fmt = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------------------------------------------------------------------
// KLIC
// ---------------------------------------------------------------------------

const bboxCache = new WeakMap<object, [number, number, number, number]>();
function lineBBox(l: { lines: number[][][] } | { lines: [number, number][][] }): [number, number, number, number] {
  let b = bboxCache.get(l);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of l.lines) for (const p of s) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    b = [x0, y0, x1, y1];
    bboxCache.set(l, b);
  }
  return b;
}
const overlaps = (c: DrawContext, b: [number, number, number, number], m = 2) => b[0] < c.bb.xmax + m && b[2] > c.bb.xmin - m && b[1] < c.bb.ymax + m && b[3] > c.bb.ymin - m;

export function klicVisible(L: LayerState, thema: string) {
  return L.klicThemas[thema] !== false;
}

export function klicOverlay(getP: () => ProjectData): CanvasOverlay {
  return (c, L) => {
    const p = getP();
    const { ctx, ppm } = c;
    for (const ref of p.klic) {
      if (!ref.zichtbaar) continue;
      const k = p.bijlagen[ref.id] as KlicData | undefined;
      if (!k) continue;
      if (L.klicGraafpolygoon && k.graafpolygoon.length) {
        ctx.beginPath();
        for (const r of k.graafpolygoon) c.ring(r);
        ctx.setLineDash([1.2 * ppm, 0.6 * ppm]);
        ctx.strokeStyle = '#000000aa';
        ctx.lineWidth = Math.max(1.5, 0.12 * ppm);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (L.klicEv)
        for (const ev of k.ev) {
          if (!klicVisible(L, ev.thema)) continue;
          const col = themaStyle(ev.thema).kleur;
          ctx.beginPath();
          for (const r of ev.rings) c.ring(r);
          ctx.fillStyle = col + '33';
          ctx.fill('evenodd');
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1.5, 0.12 * ppm);
          ctx.setLineDash([0.6 * ppm, 0.3 * ppm]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      // banen (kabelbed, duct, mantelbuis) eerst, breed en licht
      for (const l of k.lijnen) {
        if (l.breedte < 0.1 || !klicVisible(L, l.thema) || !overlaps(c, lineBBox(l))) continue;
        ctx.beginPath();
        for (const s of l.lines) c.path(s);
        ctx.strokeStyle = themaStyle(l.thema).kleur + '55';
        ctx.lineWidth = Math.max(3, l.breedte * ppm);
        ctx.stroke();
      }
      for (const l of k.lijnen) {
        if (!klicVisible(L, l.thema) || !overlaps(c, lineBBox(l))) continue;
        ctx.beginPath();
        for (const s of l.lines) c.path(s);
        ctx.strokeStyle = themaStyle(l.thema).kleur;
        ctx.globalAlpha = l.status === 'buiten gebruik' ? 0.55 : 1;
        ctx.lineWidth = Math.max(1.6, 0.14 * ppm);
        ctx.setLineDash(l.status === 'gepland' ? [1 * ppm, 0.5 * ppm] : l.status === 'buiten gebruik' ? [0.3 * ppm, 0.3 * ppm] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (L.klicPunten)
        for (const pt of k.punten) {
          if (!klicVisible(L, pt.thema) || !inView(c, pt.x, pt.y)) continue;
          ctx.beginPath();
          ctx.arc(c.X(pt.x), c.Y(pt.y), Math.max(2, 0.22 * ppm), 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = Math.max(1.2, 0.08 * ppm);
          ctx.strokeStyle = themaStyle(pt.thema).kleur;
          ctx.stroke();
        }
      if (L.klicMaatvoering)
        for (const lb of k.labels) {
          if (lb.soort !== 'maatvoering' || !klicVisible(L, lb.thema)) continue;
          ctx.beginPath();
          for (const s of lb.lines) c.path(s);
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (lb.label && lb.punt) c.label(lb.label, lb.punt[0], lb.punt[1], lb.rotatie, 0.6, '#222', '#ffffffcc');
        }
      if (L.klicAnnotatie)
        for (const lb of k.labels) {
          if (lb.soort !== 'annotatie' || !klicVisible(L, lb.thema)) continue;
          const col = themaStyle(lb.thema).kleur;
          if (lb.lines.length) {
            ctx.beginPath();
            for (const s of lb.lines) c.path(s);
            ctx.strokeStyle = col;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (lb.label && lb.punt && inView(c, lb.punt[0], lb.punt[1], 20)) c.label(lb.label, lb.punt[0], lb.punt[1], lb.rotatie, 0.7, darker(col), '#ffffffdd');
        }
      if (L.klicDiepte)
        for (const d of k.diepten) {
          if (!klicVisible(L, d.thema) || !inView(c, d.x, d.y, 20)) continue;
          const col = themaStyle(d.thema).kleur;
          ctx.beginPath();
          ctx.arc(c.X(d.x), c.Y(d.y), Math.max(2.5, 0.2 * ppm), 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          const t = d.soort === 'NAP' ? `${d.waarde >= 0 ? '+' : '−'}${fmt(Math.abs(d.waarde))} NAP` : `${fmt(d.waarde)} −mv`;
          c.label(t, d.x + 1.6, d.y + 0.6, 0, 0.8, darker(col), '#ffffffee', true);
        }
    }
  };
}

function darker(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = 0.6;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

export interface KlicHit {
  refId: string;
  line: KlicLine;
  dist: number;
}

/** Dichtstbijzijnde zichtbare KLIC-lijn binnen `tol` m. */
export function hitKlic(p: ProjectData, L: LayerState, x: number, y: number, tol: number): KlicHit | null {
  let best: KlicHit | null = null;
  for (const ref of p.klic) {
    if (!ref.zichtbaar) continue;
    const k = p.bijlagen[ref.id] as KlicData | undefined;
    if (!k) continue;
    for (const l of k.lijnen) {
      if (!klicVisible(L, l.thema)) continue;
      const b = lineBBox(l);
      const t = tol + l.breedte / 2;
      if (x < b[0] - t || x > b[2] + t || y < b[1] - t || y > b[3] + t) continue;
      for (const s of l.lines)
        for (let i = 0; i < s.length - 1; i++) {
          const d = distPointSegment(x, y, s[i][0], s[i][1], s[i + 1][0], s[i + 1][1]) - l.breedte / 2;
          if (d < t && (!best || d < best.dist)) best = { refId: ref.id, line: l, dist: d };
        }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Inmeting: perceelgrens en meetpunten
// ---------------------------------------------------------------------------

export const GRENS_KLEUR = '#e65100';

export function soortVan(p: ProjectData, pt: MeetPunt): PuntSoort {
  return p.inmeting.codes[pt.code ?? '']?.soort ?? 'overig';
}

export function surveyOverlay(getP: () => ProjectData): CanvasOverlay {
  return (c, L) => {
    const p = getP();
    const { ctx, ppm } = c;
    const g = p.inmeting.grens;
    if (g && L.grens) {
      const r = boundaryRing(g);
      ctx.beginPath();
      c.path(r);
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = Math.max(4, 0.5 * ppm);
      ctx.stroke();
      ctx.strokeStyle = GRENS_KLEUR;
      ctx.lineWidth = Math.max(2.5, 0.25 * ppm);
      ctx.stroke();
      for (const pt of g.punten) {
        if (!inView(c, pt.x, pt.y)) continue;
        ctx.beginPath();
        ctx.arc(c.X(pt.x), c.Y(pt.y), Math.max(3, 0.3 * ppm), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, 0.1 * ppm);
        ctx.strokeStyle = GRENS_KLEUR;
        ctx.stroke();
        c.label(pt.nr, pt.x + 0.9, pt.y + 0.9, 0, 0.9, GRENS_KLEUR, '#ffffffee', true);
      }
      if (L.grensMaten)
        for (let i = 0; i < r.length - 1; i++) {
          const [a, b] = [r[i], r[i + 1]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.5) continue;
          const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          // label iets naast de lijn (links van de looprichting)
          const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
          c.label(`${fmt(len)} m`, (a[0] + b[0]) / 2 + nx * 0.8, (a[1] + b[1]) / 2 + ny * 0.8, ang, 0.8, '#7a2e00', '#ffffffdd');
        }
    }
    const pts = p.inmeting.punten;
    if (pts)
      for (const pt of pts.punten) {
        const soort = soortVan(p, pt);
        if (soort === 'negeren' || !L.meetpunten[soort] || !inView(c, pt.x, pt.y)) continue;
        const col = PUNT_SOORTEN[soort].kleur;
        const X = c.X(pt.x), Y = c.Y(pt.y), s = Math.max(3, 0.3 * ppm);
        ctx.lineWidth = Math.max(1.5, 0.08 * ppm);
        ctx.strokeStyle = col;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (soort === 'putdeksel') { ctx.rect(X - s, Y - s, 2 * s, 2 * s); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X - s, Y - s); ctx.lineTo(X + s, Y + s); ctx.stroke(); }
        else if (soort === 'hoogtemaat') { ctx.moveTo(X - s, Y); ctx.lineTo(X + s, Y); ctx.moveTo(X, Y - s); ctx.lineTo(X, Y + s); ctx.stroke(); }
        else if (soort === 'grenspunt') { ctx.moveTo(X, Y - s * 1.2); ctx.lineTo(X + s, Y + s * 0.8); ctx.lineTo(X - s, Y + s * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        else { ctx.arc(X, Y, s * 0.7, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
        if (L.meetpuntLabels) {
          const z = pt.z != null ? ` ${pt.z >= 0 ? '+' : '−'}${fmt(Math.abs(pt.z))}` : '';
          const t = soort === 'hoogtemaat' ? `${pt.nr}${z}` : `${pt.nr}${pt.code ? ` ${pt.code}` : ''}`;
          c.label(t, pt.x + 0.7, pt.y + 0.6, 0, 0.7, col, '#ffffffdd');
        }
      }
  };
}

export type SurveyHit = { kind: 'grenspunt'; punt: MeetPunt; index: number } | { kind: 'meetpunt'; punt: MeetPunt; index: number } | { kind: 'grenslijn'; dist: number };

export function hitSurvey(p: ProjectData, L: LayerState, x: number, y: number, tol: number): SurveyHit | null {
  const g = p.inmeting.grens;
  if (g && L.grens) {
    const i = g.punten.findIndex((q) => Math.hypot(q.x - x, q.y - y) < tol);
    if (i >= 0) return { kind: 'grenspunt', punt: g.punten[i], index: i };
  }
  const pts = p.inmeting.punten;
  if (pts) {
    let bi = -1, bd = tol;
    pts.punten.forEach((q, i) => {
      const s = soortVan(p, q);
      if (s === 'negeren' || !L.meetpunten[s]) return;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; bi = i; }
    });
    if (bi >= 0) return { kind: 'meetpunt', punt: pts.punten[bi], index: bi };
  }
  if (g && L.grens) {
    const r = boundaryRing(g);
    for (let i = 0; i < r.length - 1; i++) {
      const d = distPointSegment(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]);
      if (d < tol) return { kind: 'grenslijn', dist: d };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DXF-onderleggers
// ---------------------------------------------------------------------------

interface DxfCache { key: string; lines: { laag: string; pts: number[][]; bbox: [number, number, number, number] }[]; teksten: { laag: string; x: number; y: number; tekst: string; h: number; rot: number }[] }
const dxfCache = new Map<string, DxfCache>();

export function dxfInRD(ref: DxfRef, d: DxfData, ifc: Placement | null): DxfCache {
  const key = JSON.stringify([ref.plaatsing, ifc]);
  const hit = dxfCache.get(ref.id);
  if (hit && hit.key === key) return hit;
  const f = dxfToRD(ref.plaatsing, ifc);
  const rot = ref.plaatsing.modus === 'handmatig' ? ref.plaatsing.rotatie : ref.plaatsing.modus === 'ifc' ? ifc?.rotatie ?? 0 : 0;
  const lines = d.lijnen.map((l) => {
    const pts: number[][] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < l.pts.length; i += 2) {
      const q = f(l.pts[i], l.pts[i + 1]);
      pts.push(q);
      x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
    }
    return { laag: l.laag, pts, bbox: [x0, y0, x1, y1] as [number, number, number, number] };
  });
  const teksten = d.teksten.map((t) => { const [x, y] = f(t.x, t.y); return { laag: t.laag, x, y, tekst: t.tekst, h: t.hoogte * ref.plaatsing.eenheidM, rot: t.rotatie + rot }; });
  const c = { key, lines, teksten };
  dxfCache.set(ref.id, c);
  return c;
}

export function dxfOverlay(getP: () => ProjectData, getIfc: () => Placement | null): CanvasOverlay {
  return (c) => {
    const p = getP();
    const { ctx } = c;
    for (const ref of p.onderleggers) {
      if (!ref.zichtbaar) continue;
      const d = p.bijlagen[ref.id] as DxfData | undefined;
      if (!d) continue;
      const hidden = new Set(ref.verborgenLagen);
      const kleuren = new Map(d.lagen.map((l) => [l.naam, l.kleur]));
      const cache = dxfInRD(ref, d, getIfc());
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      if (!ref.laagkleuren) {
        ctx.strokeStyle = ref.kleur;
        ctx.beginPath();
        for (const l of cache.lines) if (!hidden.has(l.laag) && overlaps(c, l.bbox, 0.5)) c.path(l.pts);
        ctx.stroke();
      } else {
        for (const l of cache.lines) {
          if (hidden.has(l.laag) || !overlaps(c, l.bbox, 0.5)) continue;
          ctx.strokeStyle = kleuren.get(l.laag) === '#ffffff' ? '#222' : kleuren.get(l.laag) ?? ref.kleur;
          ctx.beginPath();
          c.path(l.pts);
          ctx.stroke();
        }
      }
      if (ref.teksten)
        for (const t of cache.teksten) if (!hidden.has(t.laag) && inView(c, t.x, t.y, 10) && t.h > 0.05) c.label(t.tekst, t.x, t.y, t.rot, Math.min(t.h, 3), ref.kleur, '#ffffffaa');
    }
  };
}

// ---------------------------------------------------------------------------
// Eigen obstakels (2D-deel)
// ---------------------------------------------------------------------------

export const MANUAL_STYLE: Record<ManualObject['soort'], { label: string; kleur: string }> = {
  doorrijhoogte: { label: 'Vrije doorrijhoogte', kleur: '#f57c00' },
  paaltjes: { label: 'Paaltjes', kleur: '#c62828' },
  hekwerk: { label: 'Hekwerk', kleur: '#37474f' },
  nietBerijdbaar: { label: 'Niet berijdbaar', kleur: '#d32f2f' },
};

let hatch: HTMLCanvasElement | null = null;
function hatchPattern(ctx: CanvasRenderingContext2D, col: string): CanvasPattern | string {
  if (typeof document === 'undefined') return col + '44';
  if (!hatch) {
    hatch = document.createElement('canvas');
    hatch.width = hatch.height = 16;
    const h = hatch.getContext('2d')!;
    h.strokeStyle = col;
    h.lineWidth = 2;
    h.beginPath();
    h.moveTo(0, 16); h.lineTo(16, 0); h.moveTo(-4, 4); h.lineTo(4, -4); h.moveTo(12, 20); h.lineTo(20, 12);
    h.stroke();
  }
  return ctx.createPattern(hatch, 'repeat') ?? col + '44';
}

export function manualOverlay(getP: () => ProjectData, selectedId: () => string | null): CanvasOverlay {
  return (c, L) => {
    const p = getP();
    const { ctx, ppm } = c;
    for (const o of p.handmatig) {
      if (!L.handmatig[o.soort]) continue;
      const st = MANUAL_STYLE[o.soort];
      const sel = selectedId() === o.id;
      const pts = o.coords;
      if (o.geom === 'vlak' && pts.length >= 3) {
        ctx.beginPath();
        c.ring([...pts, pts[0]]);
        if (o.soort === 'nietBerijdbaar') {
          ctx.fillStyle = st.kleur + '30';
          ctx.fill();
          ctx.fillStyle = hatchPattern(ctx, st.kleur);
          ctx.fill();
        } else {
          ctx.fillStyle = st.kleur + '22';
          ctx.fill();
        }
        ctx.strokeStyle = sel ? '#ffeb3b' : st.kleur;
        ctx.lineWidth = Math.max(2, 0.2 * ppm);
        ctx.setLineDash(o.soort === 'doorrijhoogte' ? [0.8 * ppm, 0.4 * ppm] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.geom === 'lijn' && pts.length >= 2) {
        ctx.beginPath();
        c.path(pts);
        ctx.strokeStyle = sel ? '#ffeb3b' : st.kleur;
        ctx.lineWidth = Math.max(2, (o.soort === 'hekwerk' ? 0.12 : 0.2) * ppm);
        ctx.setLineDash(o.soort === 'doorrijhoogte' ? [0.8 * ppm, 0.4 * ppm] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.geom === 'punten') {
        for (const q of pts) {
          ctx.beginPath();
          ctx.arc(c.X(q[0]), c.Y(q[1]), Math.max(2.5, 0.15 * ppm), 0, Math.PI * 2);
          ctx.fillStyle = sel ? '#ffeb3b' : st.kleur;
          ctx.fill();
        }
      }
      // label
      const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      let t = o.naam;
      if (o.soort === 'doorrijhoogte' && o.vrijeHoogte != null) t = `${o.naam} – vrij ${fmt(o.vrijeHoogte)} m`;
      if (o.soort === 'hekwerk') t = `${o.naam} ${fmt(polylineLength(pts), 1)} m`;
      if (t) c.label(t, cx, cy, 0, 0.9, st.kleur, '#ffffffee', true);
    }
  };
}

/** Aanwijzen van een eigen obstakel in 2D (vlak of lijn). */
export function hitManual(p: ProjectData, L: LayerState, x: number, y: number, tol: number): ManualObject | null {
  for (let i = p.handmatig.length - 1; i >= 0; i--) {
    const o = p.handmatig[i];
    if (!L.handmatig[o.soort]) continue;
    const pts = o.coords;
    if (o.geom === 'vlak' && pts.length >= 3 && pointInRing(x, y, pts)) return o;
    if (o.geom !== 'punten')
      for (let k = 0; k < pts.length - (o.geom === 'vlak' ? 0 : 1); k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        if (distPointSegment(x, y, a[0], a[1], b[0], b[1]) < tol) return o;
      }
    if (o.geom === 'punten' && pts.some((q) => Math.hypot(q[0] - x, q[1] - y) < tol)) return o;
  }
  return null;
}
