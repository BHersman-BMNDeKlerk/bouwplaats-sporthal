import type { BBox } from './coords';

/**
 * Verdeel de projectbbox in een regelmatig tegelraster (terrein-chunks en
 * luchtfototegels gebruiken dezelfde indeling). Tegelgrootte ≤ maxSize en een
 * veelvoud van 0,5 m (zodat AHN-cellen niet over tegelgrenzen vallen).
 */
export function tileCount(length: number, maxSize = 90): number {
  let n = Math.max(1, Math.ceil(length / maxSize));
  while (Math.round(length * 2) % n !== 0 && n < 1000) n++;
  return n;
}

export function tileLayout(b: BBox, maxSize = 90): { nx: number; ny: number; tw: number; th: number } {
  const w = b.xmax - b.xmin;
  const h = b.ymax - b.ymin;
  const nx = tileCount(w, maxSize);
  const ny = tileCount(h, maxSize);
  return { nx, ny, tw: w / nx, th: h / ny };
}

/** BBox van tegel (rij 0 = noord, kolom 0 = west). */
export function tileBBox(b: BBox, nx: number, ny: number, row: number, col: number): BBox {
  const tw = (b.xmax - b.xmin) / nx;
  const th = (b.ymax - b.ymin) / ny;
  return {
    xmin: b.xmin + col * tw,
    xmax: b.xmin + (col + 1) * tw,
    ymax: b.ymax - row * th,
    ymin: b.ymax - (row + 1) * th,
  };
}
