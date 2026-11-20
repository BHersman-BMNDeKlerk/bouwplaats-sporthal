/**
 * Fase 6: één verzameling tekenobjecten (in RD) waaruit DXF, GeoJSON en de
 * legenda van de PDF worden gemaakt.
 */
export type FeatureGeom =
  | { type: 'polygon'; rings: number[][][] }
  | { type: 'line'; coords: number[][] }
  | { type: 'point'; coord: number[] }
  | { type: 'circle'; center: number[]; radius: number }
  | { type: 'text'; coord: number[]; text: string; hoogte: number; rotatie?: number };

export interface DrawFeature {
  /** Laagnaam, bv. "Bouwplaats – Keet". */
  laag: string;
  /** Groep voor de legenda (bv. "Bouwplaatselementen"). */
  groep: string;
  /** Legendatekst (standaard de laagnaam zonder groep). */
  legenda?: string;
  kleur: string;
  /** Lijnstijl voor de legenda. */
  stijl?: 'vlak' | 'lijn' | 'stippel' | 'cirkel' | 'punt';
  geom: FeatureGeom;
  props?: Record<string, unknown>;
}

/** Cirkel als polygoon (voor GeoJSON). */
export function circleRing(c: number[], r: number, n = 64): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}

export interface LegendItem { groep: string; tekst: string; kleur: string; stijl: NonNullable<DrawFeature['stijl']> }

/** Legenda: unieke (groep, tekst, kleur) in volgorde van voorkomen. */
export function legendFrom(features: DrawFeature[]): LegendItem[] {
  const seen = new Set<string>();
  const out: LegendItem[] = [];
  for (const f of features) {
    if (f.geom.type === 'text') continue;
    const tekst = f.legenda ?? f.laag.replace(/^.*? – /, '');
    const stijl = f.stijl ?? (f.geom.type === 'polygon' ? 'vlak' : f.geom.type === 'circle' ? 'cirkel' : f.geom.type === 'point' ? 'punt' : 'lijn');
    const k = `${f.groep}|${tekst}|${f.kleur}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ groep: f.groep, tekst, kleur: f.kleur, stijl });
  }
  return out;
}
