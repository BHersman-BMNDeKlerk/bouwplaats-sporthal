/**
 * Gebouwhoogtes: effectieve waarden (bron of handmatige overschrijving) en de
 * verticale vervorming van het 3D-model zodat het model de overschreven
 * goot-/nokhoogte volgt.
 */

export interface HeightSet {
  maaiveld: number | null;
  goot: number | null;
  nok: number | null;
}

export interface HeightOverride {
  maaiveld?: number;
  goot?: number;
  nok?: number;
  opmerking?: string;
}

export interface EffectiveHeights {
  maaiveld: number | null;
  goot: number | null;
  nok: number | null;
  /** Welke waarden handmatig zijn overschreven. */
  overschreven: { maaiveld: boolean; goot: boolean; nok: boolean };
}

export function effectiveHeights(src: HeightSet, ov?: HeightOverride | null): EffectiveHeights {
  const has = (k: keyof HeightSet) => ov != null && typeof ov[k] === 'number' && Number.isFinite(ov[k] as number);
  return {
    maaiveld: has('maaiveld') ? (ov!.maaiveld as number) : src.maaiveld,
    goot: has('goot') ? (ov!.goot as number) : src.goot,
    nok: has('nok') ? (ov!.nok as number) : src.nok,
    overschreven: { maaiveld: has('maaiveld'), goot: has('goot'), nok: has('nok') },
  };
}

/** Hoogte t.o.v. maaiveld (m), of null. */
export function relative(h: number | null, maaiveld: number | null): number | null {
  return h == null || maaiveld == null ? null : h - maaiveld;
}

/**
 * Maak een functie z → z' die het model verticaal vervormt (stuksgewijs lineair):
 *   maaiveld → maaiveld',  goot → goot',  nok → nok'
 * Boven de nok en onder het maaiveld wordt met de grenshelling doorgetrokken.
 * Als goot ≈ nok (plat dak) wordt alleen maaiveld→nok gebruikt.
 */
export function heightMapper(src: HeightSet, dst: HeightSet): (z: number) => number {
  const m = src.maaiveld, g = src.goot, n = src.nok;
  const m2 = dst.maaiveld ?? m, g2 = dst.goot ?? g, n2 = dst.nok ?? n;
  if (m == null || n == null || m2 == null || n2 == null || n - m < 0.01) {
    const shift = (m2 ?? 0) - (m ?? 0);
    return (z) => z + shift;
  }
  const knots: [number, number][] = [[m, m2]];
  if (g != null && g2 != null && g - m > 0.01 && n - g > 0.05) knots.push([g, g2]);
  knots.push([n, n2]);
  return (z) => {
    if (z <= knots[0][0]) return knots[0][1] + (z - knots[0][0]);
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, a2] = knots[i];
      const [b, b2] = knots[i + 1];
      if (z <= b) return a2 + ((z - a) / (b - a)) * (b2 - a2);
    }
    const [a, a2] = knots[knots.length - 2];
    const [b, b2] = knots[knots.length - 1];
    const slope = (b2 - a2) / (b - a);
    return b2 + (z - b) * slope;
  };
}

/** Clusteren van dakhoogtes (horizontale vlakken) tot afzonderlijke niveaus. */
export function clusterLevels(heights: { z: number; area: number }[], tol = 0.3): number[] {
  const sorted = [...heights].sort((a, b) => a.z - b.z);
  const groups: { sum: number; area: number; last: number }[] = [];
  for (const h of sorted) {
    const g = groups[groups.length - 1];
    if (g && h.z - g.last <= tol) {
      g.sum += h.z * h.area;
      g.area += h.area;
      g.last = h.z;
    } else groups.push({ sum: h.z * h.area, area: h.area, last: h.z });
  }
  return groups.filter((g) => g.area >= 2).map((g) => Math.round((g.sum / g.area) * 100) / 100);
}
