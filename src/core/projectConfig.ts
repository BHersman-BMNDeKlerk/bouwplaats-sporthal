import type { RDPoint } from './coords';

/**
 * Vaste projectgegevens. Het datascript gebruikt de kernpunten + marge om de
 * bounding box te bepalen; de app leest de werkelijke bbox uit data/manifest.json.
 */
export const PROJECT = {
  naam: 'Verbouw sporthal Latourpad 16',
  adres: 'Latourpad 16, Dordrecht',
  /** BAG-pandidentificatie van de sporthal (oorspronkelijk bouwjaar 1969). */
  bagPandId: '0505100000019476',
  /** De 4 opgegeven hoekpunten (RD New). */
  kernpunten: [
    { x: 105664, y: 424622 },
    { x: 105652, y: 424750 },
    { x: 105546, y: 424738 },
    { x: 105571, y: 424613 },
  ] as RDPoint[],
  /** Marge rond de kernpunten in meters (afgesproken: 100 m). */
  marge: 100,
};

export function bagObjectId(pandId: string): string {
  return `NL.IMBAG.Pand.${pandId}`;
}
