/**
 * Verwerking van 3D BAG CityJSON(Feature)-pagina's naar compacte gebouwrecords.
 * Bron: 3D BAG API (https://api.3dbag.nl), CityJSON 2.0, EPSG:7415 (RD New + NAP).
 */
import type { RDPoint } from '../core/coords';
import { clusterLevels } from './heights';
import { triangulate3D } from './geom';
import type { BuildingRecord } from './types';

export interface CJTransform {
  scale: [number, number, number];
  translate: [number, number, number];
}

interface CJGeometry {
  type: string;
  lod: string | number;
  boundaries: any;
  semantics?: { surfaces: { type: string }[]; values: any };
}

interface CJObject {
  type: string;
  attributes?: Record<string, any>;
  geometry?: CJGeometry[];
  children?: string[];
  parents?: string[];
}

export interface CJFeature {
  type?: string;
  id: string;
  CityObjects: Record<string, CJObject>;
  vertices: number[][];
}

/** Een pagina van /collections/pand/items (of één item, met `feature`). */
export interface CJPage {
  metadata?: { transform?: CJTransform };
  transform?: CJTransform;
  features?: CJFeature[];
  feature?: CJFeature;
}

export function pageTransform(page: CJPage): CJTransform {
  const t = page.metadata?.transform ?? page.transform;
  return t ?? { scale: [1, 1, 1], translate: [0, 0, 0] };
}

export function pageFeatures(page: CJPage): CJFeature[] {
  if (page.features) return page.features;
  if (page.feature) return [page.feature];
  return [];
}

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v: number) => Math.round(v * 100) / 100;

function lodValue(l: string | number): number {
  return typeof l === 'number' ? l : parseFloat(l);
}

/** Kies de geometrie met de gewenste LoD (standaard 2.2), anders de hoogst beschikbare. */
export function pickGeometry(geoms: CJGeometry[] | undefined, wanted = 2.2): CJGeometry | null {
  if (!geoms || !geoms.length) return null;
  const exact = geoms.find((g) => Math.abs(lodValue(g.lod) - wanted) < 1e-6);
  if (exact) return exact;
  return [...geoms].sort((a, b) => lodValue(b.lod) - lodValue(a.lod))[0];
}

/** Lijst van (ringen, semantisch type) per oppervlak, ongeacht Solid/MultiSurface. */
function surfacesOf(g: CJGeometry): { rings: number[][]; type: string }[] {
  const out: { rings: number[][]; type: string }[] = [];
  const semType = (idx: number | null | undefined) =>
    idx == null || !g.semantics ? 'unknown' : g.semantics.surfaces[idx]?.type ?? 'unknown';
  if (g.type === 'Solid') {
    (g.boundaries as number[][][][]).forEach((shell, si) =>
      shell.forEach((surf, fi) => out.push({ rings: surf, type: semType(g.semantics?.values?.[si]?.[fi]) })),
    );
  } else if (g.type === 'MultiSolid' || g.type === 'CompositeSolid') {
    (g.boundaries as number[][][][][]).forEach((solid, so) =>
      solid.forEach((shell, si) =>
        shell.forEach((surf, fi) =>
          out.push({ rings: surf, type: semType(g.semantics?.values?.[so]?.[si]?.[fi]) }),
        ),
      ),
    );
  } else if (g.type === 'MultiSurface' || g.type === 'CompositeSurface') {
    (g.boundaries as number[][][]).forEach((surf, fi) => out.push({ rings: surf, type: semType(g.semantics?.values?.[fi]) }));
  }
  return out;
}

/** Zet één CityJSONFeature om naar een gebouwrecord (of null als er geen bruikbare geometrie is). */
export function featureToBuilding(f: CJFeature, t: CJTransform, origin: RDPoint): BuildingRecord | null {
  const objs = f.CityObjects;
  const mainId = objs[f.id] ? f.id : Object.keys(objs).find((k) => objs[k].type === 'Building');
  if (!mainId) return null;
  const main = objs[mainId];
  const a = main.attributes ?? {};
  const [sx, sy, sz] = t.scale;
  const [tx, ty, tz] = t.translate;
  const V = f.vertices;
  const X = (i: number) => V[i][0] * sx + tx;
  const Y = (i: number) => V[i][1] * sy + ty;
  const Z = (i: number) => V[i][2] * sz + tz;

  // footprint (LoD0 op het hoofdobject)
  const footprint: number[][][] = [];
  const g0 = main.geometry?.find((g) => lodValue(g.lod) === 0);
  if (g0) for (const s of surfacesOf(g0)) for (const ring of s.rings) footprint.push(ring.map((i) => [r2(X(i)), r2(Y(i))]));

  // 3D-geometrie van de BuildingParts (of het hoofdobject zelf)
  const partIds = main.children?.length ? main.children : [mainId];
  const v: number[] = [];
  const roof: number[] = [];
  const wall: number[] = [];
  let lod = '';
  let roofMin = Infinity, roofMax = -Infinity;
  const horiz: { z: number; area: number }[] = [];
  for (const pid of partIds) {
    const part = objs[pid];
    if (!part) continue;
    const g = pickGeometry(part.geometry?.filter((gg) => lodValue(gg.lod) > 0));
    if (!g) continue;
    lod = String(g.lod);
    for (const s of surfacesOf(g)) {
      if (s.type === 'GroundSurface') continue;
      const ringsXYZ = s.rings.map((ring) => ring.map((i) => [X(i) - origin.x, Y(i) - origin.y, Z(i)]));
      const { indices, points } = triangulate3D(ringsXYZ);
      if (!indices.length) continue;
      const base = v.length / 3;
      for (const p of points) v.push(r2(p[0]), r2(p[1]), r2(p[2]));
      const target = s.type === 'RoofSurface' ? roof : wall;
      for (const idx of indices) target.push(base + idx);
      if (s.type === 'RoofSurface') {
        let zmin = Infinity, zmax = -Infinity, zs = 0;
        for (const p of ringsXYZ[0]) { zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); zs += p[2]; }
        roofMin = Math.min(roofMin, zmin);
        roofMax = Math.max(roofMax, zmax);
        // oppervlakte (horizontale projectie) en helling
        let area3 = 0;
        for (let k = 0; k < indices.length; k += 3) {
          const p = points[indices[k]], q = points[indices[k + 1]], r = points[indices[k + 2]];
          area3 += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
        }
        if (zmax - zmin < 0.5) horiz.push({ z: zs / ringsXYZ[0].length, area: area3 });
      }
    }
  }
  if (!v.length) return null;

  const bagId = String(a.identificatie ?? mainId).replace(/^NL\.IMBAG\.Pand\./, '');
  return {
    id: mainId,
    bagId,
    bouwjaar: num(a.oorspronkelijkbouwjaar),
    status: a.status ?? null,
    maaiveld: num(a.b3_h_maaiveld) != null ? r2(a.b3_h_maaiveld) : null,
    goot: Number.isFinite(roofMin) ? r2(roofMin) : num(a.b3_h_dak_min),
    nok: Number.isFinite(roofMax) ? r2(roofMax) : num(a.b3_h_dak_max),
    dak: {
      min: num(a.b3_h_dak_min) != null ? r2(a.b3_h_dak_min) : null,
      p50: num(a.b3_h_dak_50p) != null ? r2(a.b3_h_dak_50p) : null,
      p70: num(a.b3_h_dak_70p) != null ? r2(a.b3_h_dak_70p) : null,
      max: num(a.b3_h_dak_max) != null ? r2(a.b3_h_dak_max) : null,
    },
    dakType: a.b3_dak_type ?? null,
    pwBron: a.b3_pw_bron ?? null,
    pwDatum: a.b3_pw_datum != null ? String(a.b3_pw_datum) : null,
    dakniveaus: clusterLevels(horiz),
    oppGrond: num(a.b3_opp_grond),
    footprint,
    mesh: { v, roof, wall },
    lod,
  };
}

/** Verwerk alle pagina's; ontdubbelt op id. */
export function pagesToBuildings(pages: CJPage[], origin: RDPoint): BuildingRecord[] {
  const seen = new Map<string, BuildingRecord>();
  for (const page of pages) {
    const t = pageTransform(page);
    for (const f of pageFeatures(page)) {
      if (seen.has(f.id)) continue;
      const b = featureToBuilding(f, t, origin);
      if (b) seen.set(b.id, b);
    }
  }
  return [...seen.values()];
}
