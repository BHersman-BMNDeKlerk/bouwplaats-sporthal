/**
 * Fase 3: parametrische bouwplaatselementen (rechthoekige plattegrond, hoogte),
 * hun footprint en de botsingscontrole.
 */
import { pointInPolygon, pointInRing } from '../data/geom';

export type ElementType =
  | 'keet' | 'toilet' | 'container20' | 'container40' | 'afvalcontainer'
  | 'opslagvlak' | 'laadlosvak' | 'parkeervak'
  | 'steiger' | 'bouwlift' | 'bouwstroomkast' | 'waterpunt'
  | 'bord' | 'verkeersregelaar'
  | 'blok' | 'auto' | 'bestelbus';

export interface ElementSpec {
  label: string;
  categorie: 'Units en containers' | 'Opslag en vakken' | 'Steigers en materieel' | 'Verkeer' | 'Eigen objecten en voertuigen';
  lengte: number;
  breedte: number;
  hoogte: number;
  kleur: string;
  /** Vlak op maaiveld (botst niet met andere elementen; voertuigen/units mogen erop). */
  vlak?: boolean;
  stapelbaar?: boolean;
  /** Extern obstakel (geparkeerd voertuig): alleen controle op overlap met bouwplaatselementen. */
  extern?: boolean;
  /** Keuzelijst voor het veld "soort" (bv. opslag van materiaal/wapening). */
  soorten?: string[];
}

export const ELEMENTS: Record<ElementType, ElementSpec> = {
  keet: { label: 'Schaftkeet / kantoorunit', categorie: 'Units en containers', lengte: 6.0, breedte: 2.4, hoogte: 2.6, kleur: '#90a4ae', stapelbaar: true },
  toilet: { label: 'Toiletunit', categorie: 'Units en containers', lengte: 1.2, breedte: 1.2, hoogte: 2.3, kleur: '#4fc3f7' },
  container20: { label: "Magazijncontainer 20'", categorie: 'Units en containers', lengte: 6.06, breedte: 2.44, hoogte: 2.59, kleur: '#2e7d32', stapelbaar: true },
  container40: { label: "Magazijncontainer 40'", categorie: 'Units en containers', lengte: 12.19, breedte: 2.44, hoogte: 2.59, kleur: '#1565c0', stapelbaar: true },
  afvalcontainer: { label: 'Afvalcontainer', categorie: 'Units en containers', lengte: 3.7, breedte: 2.0, hoogte: 1.5, kleur: '#ef6c00', soorten: ['bouw- en sloopafval', 'puin', 'hout', 'restafval', 'papier'] },
  opslagvlak: { label: 'Opslagvlak', categorie: 'Opslag en vakken', lengte: 10, breedte: 5, hoogte: 1.5, kleur: '#a1887f', vlak: true, soorten: ['materiaal', 'wapening', 'steigermateriaal', 'prefab elementen', 'grond'] },
  laadlosvak: { label: 'Laad-/losvak', categorie: 'Opslag en vakken', lengte: 12, breedte: 3.5, hoogte: 0, kleur: '#fdd835', vlak: true },
  parkeervak: { label: 'Parkeervak', categorie: 'Opslag en vakken', lengte: 5, breedte: 2.5, hoogte: 0, kleur: '#78909c', vlak: true },
  steiger: { label: 'Steiger langs gevel', categorie: 'Steigers en materieel', lengte: 10, breedte: 1.0, hoogte: 8, kleur: '#ffb300' },
  bouwlift: { label: 'Bouwlift', categorie: 'Steigers en materieel', lengte: 2.0, breedte: 1.6, hoogte: 15, kleur: '#fbc02d' },
  bouwstroomkast: { label: 'Bouwstroomkast', categorie: 'Steigers en materieel', lengte: 0.8, breedte: 0.4, hoogte: 1.4, kleur: '#fdd835' },
  waterpunt: { label: 'Waterpunt', categorie: 'Steigers en materieel', lengte: 0.5, breedte: 0.5, hoogte: 1.0, kleur: '#0288d1' },
  bord: { label: 'Verkeersbord / informatiebord', categorie: 'Verkeer', lengte: 0.8, breedte: 0.1, hoogte: 2.5, kleur: '#c62828' },
  verkeersregelaar: { label: 'Verkeersregelaar', categorie: 'Verkeer', lengte: 0.6, breedte: 0.6, hoogte: 1.8, kleur: '#ff6d00' },
  blok: { label: 'Blok (eigen object)', categorie: 'Eigen objecten en voertuigen', lengte: 3, breedte: 2, hoogte: 2.5, kleur: '#8d6e63' },
  auto: { label: 'Personenauto (geparkeerd)', categorie: 'Eigen objecten en voertuigen', lengte: 4.5, breedte: 1.8, hoogte: 1.5, kleur: '#546e7a', extern: true },
  bestelbus: { label: 'Bestelbus (geparkeerd)', categorie: 'Eigen objecten en voertuigen', lengte: 6.0, breedte: 2.0, hoogte: 2.5, kleur: '#cfd8dc', extern: true },
};

export interface Element {
  id: string;
  type: ElementType;
  naam: string;
  /** Eigen laag (aan/uit in het lagenpaneel). */
  laag: string;
  kleur: string;
  /** Middelpunt in RD. */
  x: number;
  y: number;
  /** Rotatie in graden, linksom vanaf oost (lengterichting). */
  rotatie: number;
  lengte: number;
  breedte: number;
  hoogte: number;
  /** Aantal gestapelde units (keet, container). */
  stapel?: number;
  /** Bv. soort opslag, tekst op het bord. */
  soort?: string;
  label?: string;
  /** Groep voor in één keer verwijderen (bv. "parkeervakken bezet"). */
  groep?: string;
}

export function newElement(type: ElementType, x: number, y: number, rotatie = 0): Element {
  const s = ELEMENTS[type];
  return {
    id: `e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    type, naam: s.label, laag: s.categorie, kleur: s.kleur, x, y, rotatie,
    lengte: s.lengte, breedte: s.breedte, hoogte: s.hoogte,
    ...(s.stapelbaar ? { stapel: 1 } : {}), ...(s.soorten ? { soort: s.soorten[0] } : {}),
  };
}

/** Totale hoogte (incl. stapeling). */
export function totalHeight(e: Element): number {
  return e.hoogte * (e.stapel ?? 1);
}

/** Hoekpunten van de footprint (RD), linksom. */
export function footprint(e: Pick<Element, 'x' | 'y' | 'rotatie' | 'lengte' | 'breedte'>, inset = 0): [number, number][] {
  const a = (e.rotatie * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const l = Math.max(0, e.lengte / 2 - inset), b = Math.max(0, e.breedte / 2 - inset);
  return [[-l, -b], [l, -b], [l, b], [-l, b]].map(([u, v]) => [e.x + c * u - s * v, e.y + s * u + c * v]);
}

/** Rotatie afronden op een stap (5/15/90°). */
export function snapAngle(deg: number, step: number): number {
  const r = Math.round(deg / step) * step;
  return ((r % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Geometrie voor de botsingscontrole
// ---------------------------------------------------------------------------

function segIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Overlappen twee polygonen (randen snijden of de ene ligt binnen de andere)? */
export function polygonsOverlap(p: number[][], q: number[][]): boolean {
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++)
      if (segIntersect(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])) return true;
  if (pointInRing(p[0][0], p[0][1], q)) return true;
  if (pointInRing(q[0][0], q[0][1], p)) return true;
  return false;
}

/** Snijdt een polygoon een (open of gesloten) lijn? */
export function polygonCrossesLine(p: number[][], line: number[][]): boolean {
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < line.length - 1; j++) if (segIntersect(p[i], p[(i + 1) % p.length], line[j], line[j + 1])) return true;
  return false;
}

/** Monsterpunten op en in een polygoon (hoekpunten, randen, midden). */
function samples(p: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    for (let k = 0; k < 4; k++) out.push([a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4]);
  }
  out.push([p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
  return out;
}

/** Ligt de polygoon volledig binnen de vereniging van toegestane gebieden? */
export function insideAllowed(p: number[][], allowed: number[][][][]): boolean {
  return samples(p).every(([x, y]) => allowed.some((poly) => pointInPolygon(x, y, poly)));
}

export interface Obstacle2D {
  id: string;
  soort: 'gebouw' | 'nieuw pand';
  naam: string;
  rings: number[][][];
  bbox: [number, number, number, number];
}

export interface Conflict {
  elementId: string;
  met: string;
  soort: 'element' | 'gebouw' | 'nieuw pand' | 'perceelgrens' | 'buiten kavel';
}

function bbox(p: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  return [x0, y0, x1, y1];
}
const bboxHit = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export interface CollisionInput {
  elementen: Element[];
  obstakels: Obstacle2D[];
  /** Perceelgrens (actief): lijnen; gesloten = ring. */
  grens: { lijnen: number[][][]; gesloten: boolean; bron: string } | null;
  /** Toegestaan gebied: eigen kavel + vergunde zones (polygonen). Leeg = niet controleren. */
  toegestaan: number[][][][];
}

/**
 * Botsingscontrole. Elementen worden 2 cm "gekrompen" zodat elkaar rakende
 * units geen conflict geven. Vlakke elementen (opslagvlak, vakken) botsen niet
 * met andere elementen, wel met gebouwen, grens en kavel.
 */
export function checkCollisions(inp: CollisionInput): Conflict[] {
  const out: Conflict[] = [];
  const polys = inp.elementen.map((e) => ({ e, p: footprint(e, 0.02), bb: bbox(footprint(e)) }));
  for (let i = 0; i < polys.length; i++) {
    const A = polys[i];
    const aVlak = !!ELEMENTS[A.e.type]?.vlak;
    if (!aVlak)
      for (let j = i + 1; j < polys.length; j++) {
        const B = polys[j];
        if (ELEMENTS[B.e.type]?.vlak || !bboxHit(A.bb, B.bb)) continue;
        // twee geparkeerde voertuigen onderling: geen bouwplaatsconflict
        if (ELEMENTS[A.e.type]?.extern && ELEMENTS[B.e.type]?.extern) continue;
        if (polygonsOverlap(A.p, B.p)) {
          out.push({ elementId: A.e.id, met: B.e.naam || ELEMENTS[B.e.type].label, soort: 'element' });
          out.push({ elementId: B.e.id, met: A.e.naam || ELEMENTS[A.e.type].label, soort: 'element' });
        }
      }
    if (ELEMENTS[A.e.type]?.extern) continue;
    for (const o of inp.obstakels) {
      if (!bboxHit(A.bb, o.bbox)) continue;
      if (o.rings.some((r) => r.length >= 3 && polygonsOverlap(A.p, r))) out.push({ elementId: A.e.id, met: o.naam, soort: o.soort });
    }
    // over de grens is toegestaan als het element binnen kavel + vergunde zones ligt
    const crosses = !!inp.grens && inp.grens.lijnen.some((l) => polygonCrossesLine(A.p, l));
    const inside = inp.toegestaan.length ? insideAllowed(A.p, inp.toegestaan) : !crosses;
    if (!inside) out.push({ elementId: A.e.id, met: crosses ? inp.grens!.bron : 'eigen kavel / vergunde zone', soort: crosses ? 'perceelgrens' : 'buiten kavel' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parkeervakken bezet: auto's in BGT-parkeervakken
// ---------------------------------------------------------------------------

/** Kleinst omsluitende rechthoek van een ring: midden, lengte (lange zijde), breedte, hoek (°). */
export function orientedRect(ring: number[][]): { x: number; y: number; lengte: number; breedte: number; hoek: number } {
  const pts = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
  let best = { area: Infinity, x: 0, y: 0, lengte: 0, breedte: 0, hoek: 0 };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const r of pts) {
      const u = c * r[0] + s * r[1], v = -s * r[0] + c * r[1];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area - 1e-9) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = {
        area, x: c * um - s * vm, y: s * um + c * vm,
        lengte: Math.max(u1 - u0, v1 - v0), breedte: Math.min(u1 - u0, v1 - v0),
        hoek: ((a * 180) / Math.PI + (long ? 0 : 90) + 360) % 360,
      };
    }
  }
  return best;
}

/**
 * Plaats auto's in een parkeervak. Haaks/schuin vak (kort): één auto in het
 * midden. Langsparkeerstrook (lang): zoveel auto's als er passen (6 m per auto).
 */
export function carsForBay(ring: number[][], autoLengte = 4.5, autoBreedte = 1.8): { x: number; y: number; rotatie: number }[] {
  const r = orientedRect(ring);
  if (r.lengte < autoBreedte || r.breedte < 1.2) return [];
  // lang en smal → langsparkeren in de lengterichting
  if (r.lengte >= 8 && r.breedte < 3.2) {
    const n = Math.max(1, Math.floor(r.lengte / 6));
    const a = (r.hoek * Math.PI) / 180;
    return Array.from({ length: n }, (_, k) => {
      const t = (k + 0.5) * (r.lengte / n) - r.lengte / 2;
      return { x: r.x + Math.cos(a) * t, y: r.y + Math.sin(a) * t, rotatie: r.hoek };
    });
  }
  // haaks parkeren: auto in de lengterichting van het vak (lange zijde ≈ autolengte)
  if (r.lengte >= autoLengte * 0.85) return [{ x: r.x, y: r.y, rotatie: r.hoek }];
  return [];
}

/**
 * Lijn een element (bv. steiger) uit op de dichtstbijzijnde gevel (rand van een
 * van de ringen) binnen `maxDist` m: lengterichting langs de gevel, aan de kant
 * waar het element nu ligt, op `gap` m afstand van de gevel.
 */
export function alignToEdge(e: Element, rings: number[][][], maxDist = 6, gap = 0.15): Pick<Element, 'x' | 'y' | 'rotatie'> | null {
  let best: { d: number; a: number[]; b: number[]; t: number; r: number[][] } | null = null;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      if (l2 < 0.25 || Math.sqrt(l2) < Math.min(e.lengte / 2, 6)) continue; // korte tussenstukken overslaan
      const t = Math.max(0, Math.min(1, ((e.x - a[0]) * dx + (e.y - a[1]) * dy) / l2));
      const d = Math.hypot(e.x - a[0] - t * dx, e.y - a[1] - t * dy);
      if (d <= maxDist && (!best || d < best.d)) best = { d, a, b, t, r };
    }
  if (!best) return null;
  const { a, b, t } = best;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
  // kant: altijd buiten het gebouw (proef een punt links van de gevel)
  const leftInside = pointInRing(px - uy * 0.5, py + ux * 0.5, best.r);
  const side = leftInside ? -1 : 1;
  const off = e.breedte / 2 + gap;
  return { x: px - uy * off * side, y: py + ux * off * side, rotatie: ((Math.atan2(uy, ux) * 180) / Math.PI + 360) % 360 };
}
