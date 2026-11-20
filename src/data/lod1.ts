/**
 * Aanvulling op de 3D BAG: panden die wel in BGT/BAG staan maar (nog) niet in de
 * 3D BAG (vaak nieuwbouw) worden als eenvoudig blok (LoD 1) gemaakt: de
 * BGT-footprint, geëxtrudeerd tot de dakhoogte uit het AHN-DSM.
 */
import type { RDPoint } from '../core/coords';
import { pointInPolygon, ringsBBox, triangulate3D } from './geom';
import { isValidHeight, sampleGrid, type Grid } from './terrain';
import type { BuildingRecord } from './types';

/** Aangenomen hoogte (m boven maaiveld) als het AHN geen gebouw laat zien. */
export const LOD1_DEFAULT_HEIGHT = 3;

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

export interface Lod1Result {
  rec: BuildingRecord;
  /** true als de hoogte een aanname is (geen AHN-signaal, bv. gebouwd na de inwinning). */
  aanname: boolean;
}

/**
 * Maak een LoD 1-blok. Maaiveld = mediaan DTM binnen de footprint; dakhoogte =
 * 90e percentiel van het DSM binnen de footprint (randen 0,5 m genegeerd).
 */
export function lod1Block(
  bagId: string,
  polys: number[][][][],
  dtm: Grid,
  dsm: Grid | null,
  origin: RDPoint,
  ahnLabel: { bron: string; jaar: string },
): Lod1Result | null {
  const rings = polys.flat();
  if (!rings.length) return null;
  const bb = ringsBBox(rings);
  const mv: number[] = [];
  const top: number[] = [];
  let area = 0;
  const step = 0.25;
  for (let x = bb.xmin + step / 2; x < bb.xmax; x += step)
    for (let y = bb.ymin + step / 2; y < bb.ymax; y += step) {
      if (!polys.some((p) => pointInPolygon(x, y, p))) continue;
      area += step * step;
      const g = sampleGrid(dtm, x, y);
      if (g != null) mv.push(g);
      // kern van de footprint (0,5 m van de rand) voor de dakhoogte
      const inner = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].every(([dx, dy]) => polys.some((p) => pointInPolygon(x + dx, y + dy, p)));
      if (dsm && inner) {
        const s = sampleGrid(dsm, x, y);
        if (s != null && isValidHeight(s)) top.push(s);
      }
    }
  if (!mv.length) return null;
  const maaiveld = pct(mv, 0.5);
  let dak = pct(top, 0.9);
  let aanname = false;
  if (!Number.isFinite(dak) || dak - maaiveld < 1.5) {
    dak = maaiveld + LOD1_DEFAULT_HEIGHT;
    aanname = true;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const v: number[] = [];
  const roof: number[] = [];
  const wall: number[] = [];
  for (const poly of polys) {
    // dak
    const roofRings = poly.map((r) => r.map(([x, y]) => [x - origin.x, y - origin.y, dak]));
    const t = triangulate3D(roofRings);
    const base = v.length / 3;
    for (const p of t.points) v.push(r2(p[0]), r2(p[1]), r2(p[2]));
    for (const i of t.indices) roof.push(base + i);
    // gevels
    for (const r of poly)
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i], [bx, by] = r[i + 1];
        const b0 = v.length / 3;
        v.push(r2(ax - origin.x), r2(ay - origin.y), r2(maaiveld), r2(bx - origin.x), r2(by - origin.y), r2(maaiveld),
          r2(bx - origin.x), r2(by - origin.y), r2(dak), r2(ax - origin.x), r2(ay - origin.y), r2(dak));
        wall.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
      }
  }
  return {
    aanname,
    rec: {
      id: `NL.IMBAG.Pand.${bagId}`,
      bagId,
      bouwjaar: null,
      status: null,
      maaiveld: r2(maaiveld),
      goot: r2(dak),
      nok: r2(dak),
      dak: { min: null, p50: null, p70: null, max: null },
      dakType: aanname ? 'onbekend (geen AHN-signaal)' : 'blok (LoD 1)',
      pwBron: aanname ? null : ahnLabel.bron,
      pwDatum: aanname ? null : ahnLabel.jaar,
      dakniveaus: [],
      oppGrond: Math.round(area),
      footprint: rings.map((r) => r.map(([x, y]) => [r2(x), r2(y)])),
      mesh: { v, roof, wall },
      lod: '1',
      bron: aanname ? 'bgt-aanname' : 'bgt-ahn',
    },
  };
}
