/**
 * Perceelgrens voor alle controles (overdraai, hekwerk, overlap – fase 3 en 5).
 * De ingemeten grens heeft voorrang; zonder inmeting wordt de BRK-grens van
 * het eigen perceel gebruikt, met de waarschuwing "indicatieve grens".
 */
import { pointInPolygon, polygonsOf, ringsBBox, distPointSegment } from '../data/geom';
import type { MeetPunt } from '../data/csvPoints';
import type { MeasuredBoundary } from './project';

export interface ActiveBoundary {
  bron: 'ingemeten' | 'brk' | 'geen';
  /** Ringen (RD) – bij een open ingemeten lijn: één niet-gesloten lijn. */
  lijnen: number[][][];
  gesloten: boolean;
  waarschuwing: string | null;
  omschrijving: string;
}

/** BRK-percelen die de footprint van het pand raken (het "eigen perceel"). */
export function ownParcels(
  parcels: { id: string; properties: Record<string, any>; geometry: { type: string; coordinates: any } }[],
  footprint: number[][][],
): { id: string; props: Record<string, any>; polys: number[][][][] }[] {
  const pts = footprint.flat();
  if (!pts.length) return [];
  // bemonster de footprint (hoekpunten iets naar binnen + zwaartepunt)
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const samples = [[cx, cy], ...pts.map(([x, y]) => [x + (cx - x) * 0.1, y + (cy - y) * 0.1])];
  const out: { id: string; props: Record<string, any>; polys: number[][][][] }[] = [];
  for (const p of parcels) {
    const polys = polygonsOf(p.geometry);
    const n = samples.filter(([x, y]) => polys.some((pl) => pointInPolygon(x, y, pl))).length;
    // minstens 20% van de monsterpunten in het perceel
    if (n >= Math.max(1, samples.length * 0.2)) out.push({ id: p.id, props: p.properties, polys });
  }
  return out;
}

export function boundaryRing(b: MeasuredBoundary): number[][] {
  const r = b.punten.map((p) => [p.x, p.y]);
  if (b.gesloten && r.length > 2 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
  return r;
}

export function activeBoundary(measured: MeasuredBoundary | undefined, own: { props: Record<string, any>; polys: number[][][][] }[]): ActiveBoundary {
  if (measured && measured.punten.length >= 2) {
    return {
      bron: 'ingemeten',
      lijnen: [boundaryRing(measured)],
      gesloten: measured.gesloten,
      waarschuwing: null,
      omschrijving: `Ingemeten perceelgrens (${measured.punten.length} punten, ${measured.bestand})`,
    };
  }
  if (own.length) {
    const aand = own.map((p) => `${p.props.sectie ?? ''} ${p.props.perceelnummer ?? ''}`.trim()).join(', ');
    return {
      bron: 'brk',
      lijnen: own.flatMap((p) => p.polys.map((pl) => pl[0])),
      gesloten: true,
      waarschuwing: 'Indicatieve grens: BRK-perceelgrens, niet ingemeten.',
      omschrijving: `BRK-perceel ${aand} (indicatief)`,
    };
  }
  return { bron: 'geen', lijnen: [], gesloten: false, waarschuwing: 'Geen perceelgrens beschikbaar.', omschrijving: 'Geen perceelgrens' };
}

/** Kortste afstand van een punt tot een set lijnen. */
export function distToLines(x: number, y: number, lines: number[][][]): number {
  let d = Infinity;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) d = Math.min(d, distPointSegment(x, y, l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]));
  return d;
}

/** Vergelijking ingemeten grens ↔ BRK: afstand per meetpunt tot de BRK-grenslijnen. */
export function compareWithBrk(punten: MeetPunt[], brkLines: number[][][]): { gemiddeld: number; max: number; maxNr: string } | null {
  if (!punten.length || !brkLines.length) return null;
  let s = 0, max = -1, maxNr = '';
  for (const p of punten) {
    const d = distToLines(p.x, p.y, brkLines);
    s += d;
    if (d > max) { max = d; maxNr = p.nr; }
  }
  return { gemiddeld: s / punten.length, max, maxNr };
}

/** Lengte van een polylijn (m). */
export function polylineLength(pts: number[][]): number {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
}

export { ringsBBox };
