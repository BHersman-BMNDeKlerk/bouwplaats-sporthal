/**
 * DXF-onderlegger (bv. nieuwe situatie van de architect) als 2D-lijnen.
 * Ondersteunt LINE, LWPOLYLINE/POLYLINE (incl. bogen via bulge), CIRCLE, ARC,
 * ELLIPSE, SPLINE (benaderd), POINT, TEXT/MTEXT en INSERT (blokken, genest).
 *
 * Coördinaten blijven in DXF-eenheden; de plaatsing in RD gebeurt bij het tekenen
 * (zie dxfToRD): direct RD, via het nulpunt van het IFC-model, of handmatig.
 */
import DxfParser from 'dxf-parser';
import type { Placement } from './ifcGeom';
import { placePoint } from './ifcGeom';

export interface DxfLine {
  laag: string;
  /** Platte lijst x0,y0,x1,y1,… in DXF-eenheden. */
  pts: number[];
  gesloten: boolean;
}
export interface DxfText {
  laag: string;
  x: number;
  y: number;
  tekst: string;
  hoogte: number;
  rotatie: number;
}
export interface DxfData {
  formaat: 1;
  /** Meters per DXF-eenheid volgens $INSUNITS (of geschat). */
  eenheidM: number;
  eenheidNaam: string;
  extent: { xmin: number; ymin: number; xmax: number; ymax: number };
  lagen: { naam: string; kleur: string; aantal: number }[];
  lijnen: DxfLine[];
  teksten: DxfText[];
  waarschuwingen: string[];
}

export type DxfPlacementMode = 'rd' | 'ifc' | 'handmatig';

export interface DxfPlacement {
  modus: DxfPlacementMode;
  /** Bij 'handmatig': RD-positie van DXF (0,0), rotatie (° linksom). */
  x: number;
  y: number;
  rotatie: number;
  /** Meters per DXF-eenheid (overschrijft de eenheid uit het bestand). */
  eenheidM: number;
}

const UNITS: Record<number, [number, string]> = {
  1: [0.0254, 'inch'], 2: [0.3048, 'voet'], 4: [0.001, 'mm'], 5: [0.01, 'cm'], 6: [1, 'm'], 14: [0.1, 'dm'],
};

/** AutoCAD Color Index → hex (basiskleuren; overige grijs). */
export function aciColor(i: number | undefined): string {
  const t: Record<number, string> = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#222222', 8: '#808080', 9: '#c0c0c0',
    10: '#ff0000', 30: '#ff7f00', 40: '#ffbf00', 50: '#ffff00', 90: '#00ff00', 130: '#00ffff', 150: '#007fff', 170: '#0000ff', 210: '#ff00ff', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff',
  };
  return i != null && t[i] ? t[i] : '#555555';
}

type M = [number, number, number, number, number, number]; // affine: x' = a x + c y + e, y' = b x + d y + f
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const ID: M = [1, 0, 0, 1, 0, 0];

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number): number[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(4, Math.ceil(sweep / (Math.PI / 36)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Polylijn met bulges (boogsegmenten) → punten. */
function bulgePts(vs: { x: number; y: number; bulge?: number }[], closed: boolean): number[] {
  const out: number[] = [];
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % n];
    if (i === n - 1 && !closed) { out.push(a.x, a.y); break; }
    const bulge = a.bulge ?? 0;
    if (!bulge) { out.push(a.x, a.y); continue; }
    // boog van a naar b met bulge = tan(θ/4)
    const theta = 4 * Math.atan(bulge);
    const dx = b.x - a.x, dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-12) { out.push(a.x, a.y); continue; }
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const cx = mx - (dy / chord) * h, cy = my + (dx / chord) * h;
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 36)));
    for (let k = 0; k < steps; k++) {
      const ang = a0 + (theta * k) / steps;
      out.push(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
    }
  }
  if (closed && out.length >= 2) out.push(out[0], out[1]);
  return out;
}

export function parseDxf(text: string, maxPunten = 400000): DxfData {
  let dxf: any;
  try {
    dxf = new (DxfParser as any)().parseSync(text);
  } catch (e) {
    throw new Error(`Kan de DXF niet lezen (${(e as Error).message}). Sla de tekening op als ASCII-DXF (geen binaire DXF/DWG).`);
  }
  if (!dxf) throw new Error('Leeg of ongeldig DXF-bestand.');
  const waarschuwingen: string[] = [];
  const ins = Number(dxf.header?.$INSUNITS);
  let [eenheidM, eenheidNaam] = UNITS[ins] ?? [1, 'onbekend'];
  const layerTable = dxf.tables?.layer?.layers ?? {};
  const lagen = new Map<string, { kleur: string; aantal: number }>();
  const lijnen: DxfLine[] = [];
  const teksten: DxfText[] = [];
  let nPts = 0;
  const unsupported = new Map<string, number>();
  let truncated = false;

  const addLine = (laag: string, pts: number[], gesloten: boolean, m: M) => {
    if (pts.length < 4) return;
    if (nPts > maxPunten) { truncated = true; return; }
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = apply(m, pts[i], pts[i + 1]); out.push(x, y); }
    nPts += out.length / 2;
    lijnen.push({ laag, pts: out, gesloten });
    const l = lagen.get(laag) ?? { kleur: aciColor(layerTable[laag]?.colorIndex), aantal: 0 };
    l.aantal++;
    lagen.set(laag, l);
  };

  const walk = (ents: any[], m: M, depth: number, parentLayer?: string) => {
    for (const e of ents ?? []) {
      const laag = e.layer === '0' && parentLayer ? parentLayer : e.layer ?? '0';
      if (layerTable[laag]?.visible === false) continue;
      switch (e.type) {
        case 'LINE':
          addLine(laag, [e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y], false, m);
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const closed = !!e.shape || !!e.closed;
          addLine(laag, bulgePts(e.vertices ?? [], closed), closed, m);
          break;
        }
        case 'CIRCLE':
          addLine(laag, arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2), true, m);
          break;
        case 'ARC':
          addLine(laag, arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle), false, m);
          break;
        case 'ELLIPSE': {
          const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y;
          const a = Math.hypot(mx, my), b = a * e.axisRatio, rot = Math.atan2(my, mx);
          const s = e.startAngle ?? 0, en = e.endAngle ?? Math.PI * 2;
          const pts: number[] = [];
          const n = 48;
          for (let i = 0; i <= n; i++) {
            const t = s + ((en - s) * i) / n;
            const x = a * Math.cos(t), y = b * Math.sin(t);
            pts.push(e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot));
          }
          addLine(laag, pts, false, m);
          break;
        }
        case 'SPLINE': {
          const src = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) ?? [];
          addLine(laag, src.flatMap((p: any) => [p.x, p.y]), !!e.closed, m);
          break;
        }
        case 'POINT': {
          const p = e.position;
          addLine(laag, [p.x - 0.0001, p.y, p.x + 0.0001, p.y], false, m);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = e.startPoint ?? e.position;
          if (!p) break;
          const [x, y] = apply(m, p.x, p.y);
          const scale = Math.hypot(m[0], m[1]);
          const raw = String(e.text ?? '');
          const tekst = raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
          if (tekst)
            teksten.push({ laag, x, y, tekst, hoogte: (e.textHeight ?? e.height ?? 1) * scale, rotatie: (e.rotation ?? 0) + (Math.atan2(m[1], m[0]) * 180) / Math.PI });
          break;
        }
        case 'INSERT':
        case 'DIMENSION': {
          const blk = dxf.blocks?.[e.name ?? e.block];
          if (!blk || depth > 8) break;
          const p = e.position ?? { x: 0, y: 0 };
          const sx = e.xScale ?? 1, sy = e.yScale ?? 1;
          const r = ((e.rotation ?? 0) * Math.PI) / 180;
          const bp = blk.position ?? { x: 0, y: 0 };
          // T(p) · R(r) · S(sx,sy) · T(−basispunt)
          const local: M = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, p.x, p.y];
          const tb: M = [1, 0, 0, 1, -bp.x, -bp.y];
          walk(blk.entities ?? [], mul(m, mul(local, tb)), depth + 1, laag);
          break;
        }
        default:
          unsupported.set(e.type, (unsupported.get(e.type) ?? 0) + 1);
      }
    }
  };
  walk(dxf.entities ?? [], ID, 0);

  if (truncated) waarschuwingen.push(`De tekening is erg groot; alleen de eerste ${maxPunten.toLocaleString('nl-NL')} punten zijn ingelezen.`);
  if (unsupported.size) waarschuwingen.push(`Niet getekend: ${[...unsupported].map(([t, n]) => `${t} (${n})`).join(', ')}.`);
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const l of lijnen) for (let i = 0; i < l.pts.length; i += 2) {
    xmin = Math.min(xmin, l.pts[i]); xmax = Math.max(xmax, l.pts[i]); ymin = Math.min(ymin, l.pts[i + 1]); ymax = Math.max(ymax, l.pts[i + 1]);
  }
  if (!lijnen.length) throw new Error('Geen tekenbare lijnen gevonden in de DXF.');
  if (eenheidNaam === 'onbekend') {
    // schatting: een gebouwtekening van > 2000 eenheden breed is vrijwel zeker in mm
    const w = xmax - xmin;
    if (w > 2000 && !(xmin > 0 && xmin < 300000 && ymin > 289000 && ymin < 629000)) { eenheidM = 0.001; eenheidNaam = 'mm (geschat)'; }
    else eenheidNaam = 'm (geschat)';
    waarschuwingen.push(`Geen eenheid in het bestand ($INSUNITS); aangenomen: ${eenheidNaam}. Controleer de maat.`);
  }
  return {
    formaat: 1, eenheidM, eenheidNaam, extent: { xmin, ymin, xmax, ymax },
    lagen: [...lagen.entries()].map(([naam, v]) => ({ naam, ...v })).sort((a, b) => a.naam.localeCompare(b.naam)),
    lijnen, teksten, waarschuwingen,
  };
}

/** Liggen de DXF-coördinaten (in meters) al in RD, vlak bij de projectlocatie? */
export function looksLikeRD(d: DxfData, eenheidM: number, cx: number, cy: number, maxDist = 2000): boolean {
  const mx = ((d.extent.xmin + d.extent.xmax) / 2) * eenheidM, my = ((d.extent.ymin + d.extent.ymax) / 2) * eenheidM;
  return Math.hypot(mx - cx, my - cy) < maxDist;
}

/** Functie DXF (x, y) → RD voor een plaatsing. */
export function dxfToRD(p: DxfPlacement, ifc: Placement | null): (x: number, y: number) => [number, number] {
  const s = p.eenheidM;
  if (p.modus === 'rd') return (x, y) => [x * s, y * s];
  if (p.modus === 'ifc' && ifc) return (x, y) => placePoint(ifc, x * s, y * s);
  const pl = { x: p.x, y: p.y, rotatie: p.rotatie, peil: 0 };
  return (x, y) => placePoint(pl, x * s, y * s);
}
