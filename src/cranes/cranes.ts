/**
 * Kranen (fase 5): torenkraan en mobiele kraan, lasttabellen en controles.
 * Alle maten in meters, lasten in ton, posities in RD, hoeken in graden
 * (tegen de klok in vanaf oost, zoals de rest van de app).
 */

export interface LoadPoint { radius: number; last: number }

export interface CraneBase {
  id: string;
  naam: string;
  x: number;
  y: number;
  /** Richting van de giek voor de weergave (°). */
  richting: number;
  lasttabel: LoadPoint[];
  /** Interval van de draagvermogen-ringen (m). */
  ringInterval: number;
  zichtbaar: boolean;
  /** Bron/omschrijving van de lasttabel. */
  tabelBron?: string;
}

export interface TowerCrane extends CraneBase {
  type: 'toren';
  /** Voet / ondergronds funderingsblok (m). */
  voetLengte: number;
  voetBreedte: number;
  /** Haakhoogte boven maaiveld (m). */
  haakhoogte: number;
  /** Hoogte van de giek boven de haakhoogte (constructie). */
  giekHoogte: number;
  giekLengte: number;
  contragiekLengte: number;
  /** Hoogte van de onderkant contragiek boven maaiveld (m). */
  contragiekHoogte: number;
}

export interface MobileCrane extends CraneBase {
  type: 'mobiel';
  /** Rijrichting / oriëntatie van het onderwagen (°). */
  rotatie: number;
  /** Stempelbasis hart-op-hart (m). */
  stempelLengte: number;
  stempelBreedte: number;
  /** Afmeting stempelplaat (vierkant, m). */
  plaat: number;
  onderwagenLengte: number;
  onderwagenBreedte: number;
  giekLengte: number;
  /** Giekhoek t.o.v. horizontaal (°). */
  giekHoek: number;
  /** Hoogte van het giekscharnier boven maaiveld. */
  scharnierHoogte: number;
  /** Afstand giekscharnier tot draaipunt (m, naar achteren negatief). */
  scharnierOffset: number;
  /** Staartdraaistraal (contragewicht). */
  staartStraal: number;
}

export type Crane = TowerCrane | MobileCrane;

/** Voorbeeldtabellen: indicatief, vervang door de tabel van de fabrikant. */
export const VOORBEELD_TOREN: LoadPoint[] = [
  { radius: 2.5, last: 6 }, { radius: 15, last: 6 }, { radius: 20, last: 4.5 }, { radius: 25, last: 3.6 },
  { radius: 30, last: 3.0 }, { radius: 35, last: 2.55 }, { radius: 40, last: 2.25 }, { radius: 45, last: 2.0 }, { radius: 50, last: 1.8 },
];
export const VOORBEELD_MOBIEL: LoadPoint[] = [
  { radius: 3, last: 40 }, { radius: 4, last: 33 }, { radius: 5, last: 28 }, { radius: 6, last: 24 }, { radius: 8, last: 18 },
  { radius: 10, last: 14 }, { radius: 12, last: 11 }, { radius: 14, last: 9 }, { radius: 16, last: 7.5 }, { radius: 18, last: 6.2 },
  { radius: 20, last: 5.2 }, { radius: 24, last: 3.8 }, { radius: 28, last: 2.8 }, { radius: 32, last: 2.1 }, { radius: 36, last: 1.6 },
];

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function newTowerCrane(x: number, y: number): TowerCrane {
  return {
    id: uid('k'), type: 'toren', naam: 'Torenkraan', x, y, richting: 0, lasttabel: VOORBEELD_TOREN.map((p) => ({ ...p })), ringInterval: 5, zichtbaar: true,
    tabelBron: 'voorbeeldtabel (indicatief)', voetLengte: 4.5, voetBreedte: 4.5, haakhoogte: 30, giekHoogte: 2.5, giekLengte: 50, contragiekLengte: 15, contragiekHoogte: 31,
  };
}

export function newMobileCrane(x: number, y: number): MobileCrane {
  return {
    id: uid('k'), type: 'mobiel', naam: 'Mobiele kraan', x, y, richting: 0, rotatie: 0, lasttabel: VOORBEELD_MOBIEL.map((p) => ({ ...p })), ringInterval: 5, zichtbaar: true,
    tabelBron: 'voorbeeldtabel (indicatief)', stempelLengte: 7.0, stempelBreedte: 7.2, plaat: 1.0, onderwagenLengte: 12.0, onderwagenBreedte: 2.75,
    giekLengte: 30, giekHoek: 60, scharnierHoogte: 2.8, scharnierOffset: -1.2, staartStraal: 4.0,
  };
}

/** Sorteer, verwijder dubbele en ongeldige punten. */
export function normalizeTable(t: LoadPoint[]): LoadPoint[] {
  const ok = t.filter((p) => Number.isFinite(p.radius) && Number.isFinite(p.last) && p.radius >= 0 && p.last >= 0).sort((a, b) => a.radius - b.radius);
  return ok.filter((p, i) => i === 0 || p.radius > ok[i - 1].radius);
}

/**
 * Maximale last bij radius r via lineaire interpolatie. Buiten het bereik van
 * de tabel: null (er wordt nooit geëxtrapoleerd).
 */
export function maxLoadAt(table: LoadPoint[], r: number): number | null {
  const t = normalizeTable(table);
  if (!t.length || !Number.isFinite(r)) return null;
  const eps = 1e-9;
  if (r < t[0].radius - eps || r > t[t.length - 1].radius + eps) return null;
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(r - t[i].radius) <= eps) return t[i].last;
    if (i > 0 && r < t[i].radius) {
      const a = t[i - 1], b = t[i];
      return a.last + ((b.last - a.last) * (r - a.radius)) / (b.radius - a.radius);
    }
  }
  return null;
}

/** Lees een lasttabel uit tekst (per regel: radius en last; ; , tab of spatie; decimale komma toegestaan). */
export function parseTable(text: string): { tabel: LoadPoint[]; fouten: string[] } {
  const tabel: LoadPoint[] = [], fouten: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;
    // scheidingsteken: ; of tab of meerdere spaties; komma's binnen getallen = decimaal
    let parts = l.split(/[;\t]|\s+/).filter(Boolean);
    if (parts.length === 1 && l.split(',').length === 2) parts = l.split(',');
    const nums = parts.map((p) => (/^-?\d+([.,]\d+)?$/.test(p) ? Number(p.replace(',', '.')) : NaN));
    if (parts.length < 2 || nums.slice(0, 2).some((n) => !Number.isFinite(n))) {
      if (i === 0 && /[a-z]/i.test(l)) return; // kopregel
      fouten.push(`regel ${i + 1}: "${l}"`);
      return;
    }
    tabel.push({ radius: nums[0], last: nums[1] });
  });
  return { tabel: normalizeTable(tabel), fouten };
}

export function tableToText(t: LoadPoint[]): string {
  const f = (v: number) => String(v).replace('.', ',');
  return t.map((p) => `${f(p.radius)}; ${f(p.last)}`).join('\n');
}

/** Bereik waarin de kraan kan werken (min/max radius). */
export function reach(c: Crane): { min: number; max: number } {
  const t = normalizeTable(c.lasttabel);
  const tMin = t.length ? t[0].radius : 0, tMax = t.length ? t[t.length - 1].radius : 0;
  if (c.type === 'toren') return { min: tMin, max: Math.min(tMax, c.giekLengte) };
  return { min: tMin, max: tMax };
}

/** Huidige radius van de mobiele kraan bij de ingestelde giekhoek. */
export function mobileRadius(c: MobileCrane): number {
  return Math.max(0, c.scharnierOffset + c.giekLengte * Math.cos((c.giekHoek * Math.PI) / 180));
}
/** Hoogte van de giekkop (m boven maaiveld). */
export function mobileTipHeight(c: MobileCrane): number {
  return c.scharnierHoogte + c.giekLengte * Math.sin((c.giekHoek * Math.PI) / 180);
}

export interface LiftCheck {
  craneId: string;
  naam: string;
  radius: number;
  max: number | null;
  ok: boolean;
  reden: string;
}

/** Kan de kraan last (t) op punt (x, y) hijsen? */
export function canLift(c: Crane, x: number, y: number, last: number): LiftCheck {
  const radius = Math.hypot(x - c.x, y - c.y);
  const fmt = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const base = { craneId: c.id, naam: c.naam, radius };
  const t = normalizeTable(c.lasttabel);
  if (!t.length) return { ...base, max: null, ok: false, reden: 'Geen lasttabel ingevoerd.' };
  if (c.type === 'toren' && radius > c.giekLengte + 1e-9) return { ...base, max: null, ok: false, reden: `Buiten de giek (${fmt(c.giekLengte, 1)} m).` };
  const max = maxLoadAt(t, radius);
  if (max == null) {
    const lo = t[0].radius, hi = t[t.length - 1].radius;
    return { ...base, max: null, ok: false, reden: radius < lo ? `Radius kleiner dan het begin van de lasttabel (${fmt(lo, 1)} m).` : `Radius groter dan de lasttabel (${fmt(hi, 1)} m) – niet geëxtrapoleerd.` };
  }
  const ok = last <= max + 1e-9;
  return { ...base, max, ok, reden: ok ? `${fmt(last)} t ≤ ${fmt(max)} t toegestaan bij ${fmt(radius, 1)} m.` : `${fmt(last)} t > ${fmt(max)} t toegestaan bij ${fmt(radius, 1)} m.` };
}

/** Draagvermogen-ringen op vaste afstand (binnen het bereik). */
export function loadRings(c: Crane): { radius: number; last: number }[] {
  const { min, max } = reach(c);
  const step = Math.max(1, c.ringInterval || 5);
  const out: { radius: number; last: number }[] = [];
  for (let r = Math.ceil(min / step) * step; r <= max + 1e-9; r += step) {
    if (r <= 0) continue;
    const m = maxLoadAt(c.lasttabel, r);
    if (m != null) out.push({ radius: r, last: m });
  }
  // altijd de maximale radius
  const mm = maxLoadAt(c.lasttabel, max);
  if (mm != null && (!out.length || max - out[out.length - 1].radius > 0.5)) out.push({ radius: max, last: mm });
  return out;
}

/** Zwenkstraal (max. bereik van de giek, voor overdraai/overlap). */
export function slewRadius(c: Crane): number {
  if (c.type === 'toren') return c.giekLengte;
  return Math.max(reach(c).max, mobileRadius(c));
}

/* ---------------- geometrie ---------------- */

export function distPointSeg(px: number, py: number, a: number[], b: number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}
export function pointInRing(x: number, y: number, r: number[][]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
  return ins;
}
/** Snijdt of overlapt een cirkel een polygoon (ring)? */
export function circleHitsRing(cx: number, cy: number, R: number, ring: number[][]): boolean {
  if (pointInRing(cx, cy, ring)) return true;
  for (let i = 0; i < ring.length - 1 || (i === ring.length - 1 && ring.length > 2); i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (distPointSeg(cx, cy, a, b) < R) return true;
  }
  return false;
}
/** Kortste afstand van het midden tot een lijn(stuk)reeks. */
export function distToLine(cx: number, cy: number, line: number[][]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, distPointSeg(cx, cy, line[i - 1], line[i]));
  return d;
}

/* ---------------- controles ---------------- */

export interface CraneEnv {
  /** Perceelgrens: lijnen (gesloten ring = kavel); bron-omschrijving. */
  grens: { lijnen: number[][][]; gesloten: boolean; bron: string } | null;
  /** Openbare weg (BGT-vlakken). */
  wegen: { naam: string; ring: number[][] }[];
  /** Buurpanden (BAG), excl. het eigen pand. */
  panden: { id: string; naam: string; ring: number[][]; hoogteNAP: number | null }[];
  /** Overige hoge objecten: eigen blokken (nieuw pand, elementen), bomen. */
  hoog: { id: string; naam: string; soort: 'nieuw pand' | 'element' | 'boom'; ring: number[][]; hoogteNAP: number }[];
  /** Maaiveld op de kraanpositie (m NAP). */
  maaiveld: number;
}

export interface CraneWarning {
  soort: 'overdraai perceel' | 'overdraai weg' | 'overdraai buurpand' | 'hoogte' | 'overlap' | 'stempel';
  tekst: string;
  ernst: 'let op' | 'conflict';
}

/** Overdraai en hoogteconflicten voor één kraan. */
export function craneWarnings(c: Crane, env: CraneEnv): CraneWarning[] {
  const out: CraneWarning[] = [];
  const R = slewRadius(c);
  const tail = c.type === 'toren' ? c.contragiekLengte : c.staartStraal;
  const fmt = (v: number, d = 1) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
  // perceelgrens
  if (env.grens && env.grens.lijnen.length) {
    const d = Math.min(...env.grens.lijnen.map((l) => distToLine(c.x, c.y, l)));
    if (d < R) out.push({ soort: 'overdraai perceel', ernst: 'let op', tekst: `Giek draait over de ${env.grens.bron} (grens op ${fmt(d)} m, giek ${fmt(R)} m)${tail > d ? '; ook de contragiek/staart' : ''}.` });
  }
  // openbare weg
  const wegen = new Set<string>();
  for (const w of env.wegen) if (circleHitsRing(c.x, c.y, R, w.ring)) wegen.add(w.naam);
  if (wegen.size) out.push({ soort: 'overdraai weg', ernst: 'let op', tekst: `Overdraai over openbare ruimte: ${[...wegen].join(', ')} – vergunning/afzetting nodig of zwenkbegrenzing.` });
  // buurpanden + hoogte
  const giekNAP = c.type === 'toren' ? env.maaiveld + c.haakhoogte : env.maaiveld + mobileTipHeight(c);
  const contraNAP = c.type === 'toren' ? env.maaiveld + c.contragiekHoogte : env.maaiveld + c.scharnierHoogte + 0.5;
  const buur: string[] = [];
  for (const p of env.panden) {
    if (!circleHitsRing(c.x, c.y, R, p.ring)) continue;
    buur.push(p.naam);
    if (p.hoogteNAP != null) {
      const dMin = pointInRing(c.x, c.y, p.ring) ? 0 : Math.min(...p.ring.slice(1).map((q, i) => distPointSeg(c.x, c.y, p.ring[i], q)));
      if (c.type === 'toren' && p.hoogteNAP >= giekNAP) out.push({ soort: 'hoogte', ernst: 'conflict', tekst: `${p.naam} (${fmt(p.hoogteNAP, 2)} m NAP) is hoger dan de haakhoogte (${fmt(giekNAP, 2)} m NAP).` });
      else if (dMin < tail && p.hoogteNAP >= contraNAP) out.push({ soort: 'hoogte', ernst: 'conflict', tekst: `${p.naam} (${fmt(p.hoogteNAP, 2)} m NAP) raakt de ${c.type === 'toren' ? 'contragiek' : 'staart'} (${fmt(contraNAP, 2)} m NAP).` });
    }
  }
  if (buur.length) out.push({ soort: 'overdraai buurpand', ernst: 'let op', tekst: `Giek draait over ${buur.length} buurpand(en): ${buur.slice(0, 6).join(', ')}${buur.length > 6 ? ' …' : ''}.` });
  for (const o of env.hoog) {
    if (!circleHitsRing(c.x, c.y, R, o.ring)) continue;
    const dMin = pointInRing(c.x, c.y, o.ring) ? 0 : Math.min(...o.ring.slice(1).map((q, i) => distPointSeg(c.x, c.y, o.ring[i], q)));
    if (c.type === 'toren' && o.hoogteNAP >= giekNAP) out.push({ soort: 'hoogte', ernst: 'conflict', tekst: `${o.naam} (${fmt(o.hoogteNAP, 2)} m NAP) is hoger dan de haakhoogte (${fmt(giekNAP, 2)} m NAP).` });
    else if (dMin < tail && o.hoogteNAP >= contraNAP) out.push({ soort: 'hoogte', ernst: 'conflict', tekst: `${o.naam} (${fmt(o.hoogteNAP, 2)} m NAP) raakt de ${c.type === 'toren' ? 'contragiek' : 'staart'} (${fmt(contraNAP, 2)} m NAP).` });
  }
  return out;
}

/** Overlappende zwenkgebieden tussen kranen. */
export function overlaps(cranes: Crane[]): { a: string; b: string; tekst: string }[] {
  const out: { a: string; b: string; tekst: string }[] = [];
  const fmt = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  for (let i = 0; i < cranes.length; i++)
    for (let j = i + 1; j < cranes.length; j++) {
      const A = cranes[i], B = cranes[j];
      const d = Math.hypot(A.x - B.x, A.y - B.y);
      const ra = slewRadius(A), rb = slewRadius(B);
      if (d < ra + rb) {
        let tekst = `Zwenkgebieden van ${A.naam} en ${B.naam} overlappen (afstand ${fmt(d)} m < ${fmt(ra + rb)} m)`;
        if (A.type === 'toren' && B.type === 'toren') {
          const dh = Math.abs(A.haakhoogte - B.haakhoogte);
          tekst += dh < 3 ? ` en het hoogteverschil is maar ${fmt(dh)} m – giek raakt giek/mast` : `; hoogteverschil ${fmt(dh)} m – check giek tegen kabels/mast van de lagere kraan`;
          if (d < Math.max(ra, rb)) tekst += '; de giek van de ene kraan reikt tot over de mast van de andere';
        }
        out.push({ a: A.id, b: B.id, tekst: tekst + '. Anti-collisiesysteem/werkafspraken nodig.' });
      }
    }
  return out;
}

/** Stempelplaten van een mobiele kraan (4 vierkanten, RD). */
export function outriggerPads(c: MobileCrane): number[][][] {
  const a = (c.rotatie * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const pt = (u: number, v: number) => [c.x + u * co - v * si, c.y + u * si + v * co];
  const h = c.plaat / 2;
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([su, sv]) => {
    const u = (su * c.stempelLengte) / 2, v = (sv * c.stempelBreedte) / 2;
    return [pt(u - h, v - h), pt(u + h, v - h), pt(u + h, v + h), pt(u - h, v + h), pt(u - h, v - h)];
  });
}
/** Onderwagen-rechthoek (RD). */
export function carrierRect(c: MobileCrane): number[][] {
  const a = (c.rotatie * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const pt = (u: number, v: number) => [c.x + u * co - v * si, c.y + u * si + v * co];
  const L = c.onderwagenLengte / 2, B = c.onderwagenBreedte / 2;
  return [pt(-L, -B), pt(L, -B), pt(L, B), pt(-L, B), pt(-L, -B)];
}
/** Voet van de torenkraan (RD), as-uitgelijnd met de giek-standaardrichting 0. */
export function towerBase(c: TowerCrane): number[][] {
  const L = c.voetLengte / 2, B = c.voetBreedte / 2;
  return [[c.x - L, c.y - B], [c.x + L, c.y - B], [c.x + L, c.y + B], [c.x - L, c.y + B], [c.x - L, c.y - B]];
}
