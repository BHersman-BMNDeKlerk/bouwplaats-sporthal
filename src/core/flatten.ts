/**
 * Weergave van hoogteverschillen in het maaiveld. Factor 1 = werkelijke
 * NAP-hoogtes; factor 0 = alles op één vlak niveau (h0). Objecten schuiven
 * mee met het maaiveld eronder, zodat ze er altijd op blijven staan.
 * Alle berekeningen (kranen, doorrijhoogtes) blijven in NAP.
 */
export const HEIGHT = { factor: 1, h0: 0 };

/** Weergegeven hoogte van een maaiveldpunt (m NAP → scène). */
export function dispGround(hNAP: number): number {
  return HEIGHT.h0 + HEIGHT.factor * (hNAP - HEIGHT.h0);
}
/** Verticale verschuiving van een object dat op maaiveld hNAP staat. */
export function groundOffset(hNAP: number | null | undefined): number {
  if (hNAP == null || !Number.isFinite(hNAP)) return 0;
  return dispGround(hNAP) - hNAP;
}
