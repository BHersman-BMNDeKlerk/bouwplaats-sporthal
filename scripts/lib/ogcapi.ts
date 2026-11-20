/** OGC API Features: versie-ontdekking, collecties en gepagineerd ophalen in RD. */
import { exists, getJSON } from './http';
import type { BBox } from '../../src/core/coords';

export const CRS_RD = 'http://www.opengis.net/def/crs/EPSG/0/28992';

/**
 * Zoek de hoogste beschikbare versie onder een basis-URL, bv.
 * https://api.pdok.nl/lv/bgt/ogc/  →  https://api.pdok.nl/lv/bgt/ogc/v1
 * Zo hoeft er geen (mogelijk verouderd) versienummer hardcoded te worden.
 */
export async function discoverVersion(base: string, maxVersion = 8): Promise<string> {
  for (let v = maxVersion; v >= 1; v--) {
    const url = `${base.replace(/\/$/, '')}/v${v}`;
    if (await exists(`${url}?f=json`, (b) => b.trimStart().startsWith('{') && b.includes('"links"'))) return url;
  }
  throw new Error(`Geen OGC API-versie gevonden onder ${base}`);
}

export interface CollectionInfo {
  id: string;
  title?: string;
  crs?: string[];
}

export async function listCollections(api: string): Promise<CollectionInfo[]> {
  const d = await getJSON<{ collections: CollectionInfo[] }>(`${api}/collections?f=json`);
  return d.collections;
}

/** Haal alle features in een bbox op (volgt 'next'-links), in RD New. */
export async function fetchAllItems(api: string, collection: string, bbox: BBox, limit = 1000): Promise<any[]> {
  const bb = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
  let url: string | null =
    `${api}/collections/${collection}/items?f=json&limit=${limit}&bbox=${bb}` +
    `&bbox-crs=${encodeURIComponent(CRS_RD)}&crs=${encodeURIComponent(CRS_RD)}`;
  const all: any[] = [];
  let pages = 0;
  while (url && pages < 500) {
    const d: any = await getJSON(url);
    all.push(...(d.features ?? []));
    pages++;
    const next = (d.links ?? []).find((l: any) => l.rel === 'next');
    url = next ? next.href : null;
  }
  return all;
}
