/**
 * CSV-import van ingemeten punten: puntnummer, X, Y, Z (RD/NAP) en optioneel code.
 * Robuust voor wat landmeetsoftware zoal uitvoert: scheidingsteken ; , tab of
 * spaties, decimale komma of punt, met of zonder kopregel, BOM, lege regels.
 */

export interface MeetPunt {
  nr: string;
  x: number;
  y: number;
  z: number | null;
  code?: string;
}

export interface CsvResult {
  punten: MeetPunt[];
  waarschuwingen: string[];
  /** Herkende kolomvolgorde, ter info voor de gebruiker. */
  kolommen: string[];
  scheidingsteken: string;
}

const NAMES: Record<'nr' | 'x' | 'y' | 'z' | 'code', RegExp> = {
  nr: /^(nr|no|nummer|punt|puntnr|puntnummer|pnt|id|naam|name|point)$/i,
  x: /^(x|rdx|rd_x|x_rd|oost|east|easting|e)$/i,
  y: /^(y|rdy|rd_y|y_rd|noord|north|northing|n)$/i,
  z: /^(z|h|hoogte|nap|z_nap|hoogte_nap|elev|elevation)$/i,
  code: /^(code|cod|omschrijving|omschr|type|beschrijving|desc|description|attr)$/i,
};

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 20);
  const count = (ch: string) => sample.reduce((s, l) => s + (l.split(ch).length - 1), 0);
  if (count(';') >= sample.length) return ';';
  if (count('\t') >= sample.length) return '\t';
  if (count(',') >= sample.length * 2) {
    // komma als scheidingsteken alleen als er ook decimale punten in staan of ≥ 3 komma's per regel
    const dots = count('.');
    if (dots > 0 || count(',') >= sample.length * 3) return ',';
  }
  return ' ';
}

function num(s: string | undefined, decimalComma: boolean): number | null {
  if (s == null) return null;
  let t = s.trim().replace(/^"|"$/g, '');
  if (!t) return null;
  if (decimalComma) t = t.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/** Lees CSV-tekst met meetpunten. `metCode`: verwacht een codekolom (overige punten). */
export function parsePointsCsv(text: string): CsvResult {
  const waarschuwingen: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  if (!lines.length) throw new Error('Het bestand is leeg.');
  const delim = detectDelimiter(lines);
  // tab en spatie: alle witruimte als scheiding (landmeetexports mengen die soms)
  const ws = delim === ' ' || delim === '\t';
  const split = (l: string) => (ws ? l.split(/\s+/) : l.split(delim)).map((c) => c.trim().replace(/^"|"$/g, ''));
  const decimalComma = delim !== ',';

  // kopregel?
  let cols: ('nr' | 'x' | 'y' | 'z' | 'code' | '')[] = [];
  let start = 0;
  const first = split(lines[0]);
  const numericCount = first.filter((c) => Number.isFinite(num(c, decimalComma) as number)).length;
  if (numericCount < 2) {
    cols = first.map((c) => (Object.keys(NAMES) as (keyof typeof NAMES)[]).find((k) => NAMES[k].test(c.replace(/\s+/g, '_'))) ?? '');
    start = 1;
    if (!cols.includes('x') || !cols.includes('y')) {
      waarschuwingen.push(`Kopregel niet herkend (${first.join(', ')}); kolommen gelezen als puntnummer, X, Y, Z, code.`);
      cols = [];
    }
  }
  if (!cols.length) {
    const n = split(lines[start]).length;
    const firstIsNum = Number.isFinite(num(split(lines[start])[0], decimalComma) as number);
    // 3 getallen zonder nummer → X, Y, Z
    cols = n === 3 && firstIsNum ? ['x', 'y', 'z'] : n === 2 ? ['x', 'y'] : ['nr', 'x', 'y', 'z', 'code'];
  }

  const punten: MeetPunt[] = [];
  let swapped = 0;
  for (let i = start; i < lines.length; i++) {
    const c = split(lines[i]);
    const get = (k: string) => { const j = cols.indexOf(k as any); return j >= 0 ? c[j] : undefined; };
    let x = num(get('x'), decimalComma), y = num(get('y'), decimalComma);
    let z = num(get('z'), decimalComma);
    if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) {
      waarschuwingen.push(`Regel ${i + 1} overgeslagen: geen geldige X/Y ("${lines[i].slice(0, 60)}").`);
      continue;
    }
    if (z != null && (Number.isNaN(z) || z <= -999 || z >= 9999)) z = null;
    // RD: in Nederland is x altijd kleiner dan y
    if (x > y && x > 280000 && y < 300000) { [x, y] = [y, x]; swapped++; }
    const code = get('code');
    // een code kan uit meerdere kolommen bestaan (spatiegescheiden bestanden)
    const rest = ws && cols.indexOf('code') >= 0 ? c.slice(cols.indexOf('code')).join(' ') : code;
    punten.push({ nr: (get('nr') ?? String(punten.length + 1)).trim(), x, y, z: z ?? null, ...(rest ? { code: rest.trim() } : {}) });
  }
  if (!punten.length) throw new Error('Geen enkel punt kunnen lezen. Verwacht: puntnummer, X, Y, Z (en eventueel code), in RD/NAP.');
  if (swapped) waarschuwingen.push(`Bij ${swapped} punt(en) leken X en Y verwisseld; omgedraaid (RD: X < Y).`);
  const outside = punten.filter((p) => p.x < 0 || p.x > 300000 || p.y < 289000 || p.y > 629000).length;
  if (outside) waarschuwingen.push(`${outside} punt(en) liggen buiten het RD-bereik van Nederland – staan de coördinaten in RD (meters)?`);
  const dupl = punten.length - new Set(punten.map((p) => p.nr)).size;
  if (dupl) waarschuwingen.push(`${dupl} dubbel(e) puntnummer(s).`);
  const names: Record<string, string> = { nr: 'puntnummer', x: 'X', y: 'Y', z: 'Z', code: 'code', '': '(genegeerd)' };
  return { punten, waarschuwingen, kolommen: cols.map((c) => names[c]), scheidingsteken: delim === '\t' ? 'tab' : delim === ' ' ? 'spatie' : delim };
}

/** Waarschuw als punten ver van het projectgebied liggen. */
export function distanceWarning(punten: MeetPunt[], cx: number, cy: number, maxDist = 1000): string | null {
  const far = punten.filter((p) => Math.hypot(p.x - cx, p.y - cy) > maxDist).length;
  return far ? `${far} van de ${punten.length} punten liggen meer dan ${maxDist} m van de projectlocatie.` : null;
}

// ---------------------------------------------------------------------------
// Codes van overige meetpunten → soort object/symbool
// ---------------------------------------------------------------------------

export type PuntSoort = 'paal' | 'putdeksel' | 'boom' | 'hoogtemaat' | 'grenspunt' | 'overig' | 'negeren';

export const PUNT_SOORTEN: Record<PuntSoort, { label: string; kleur: string; standaardHoogte?: number }> = {
  paal: { label: 'Paal / paaltje (3D)', kleur: '#b71c1c', standaardHoogte: 1.0 },
  putdeksel: { label: 'Putdeksel / kolk', kleur: '#1f3f73' },
  boom: { label: 'Boom (3D)', kleur: '#2e7d32', standaardHoogte: 8 },
  hoogtemaat: { label: 'Hoogtemaat / hoogteverschil', kleur: '#6a1b9a' },
  grenspunt: { label: 'Grenspunt / grensmarkering', kleur: '#e65100' },
  overig: { label: 'Overig punt', kleur: '#37474f' },
  negeren: { label: 'Niet tonen', kleur: '#9e9e9e' },
};

/** Voorstel voor de soort op basis van gangbare codes (aanpasbaar in de app). */
export function guessSoort(code: string | undefined): PuntSoort {
  const c = (code ?? '').toLowerCase();
  if (!c) return 'overig';
  if (/^(boom|bm|tree|bo)\b|boom/.test(c)) return 'boom';
  if (/put|kolk|deksel|rp\b|ip\b|^pd\b|^kk\b|schuif|afsluiter|brandkraan/.test(c)) return 'putdeksel';
  if (/paal|paaltje|pa\b|^pl\b|lantaarn|lichtmast|^lm\b|^mast|bord|afzet/.test(c)) return 'paal';
  if (/grens|^gp\b|^gr\b|kadastr|grenspaal|grenspijp/.test(c)) return 'grenspunt';
  if (/hoogte|peil|hv\b|^h\b|^mv\b|maaiveld|band|trede|kant|dorpel|vloer/.test(c)) return 'hoogtemaat';
  return 'overig';
}
