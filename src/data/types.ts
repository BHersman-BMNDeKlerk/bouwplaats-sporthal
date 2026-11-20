/**
 * Formaten van de verwerkte data in /data (geschreven door scripts/build-data.ts,
 * gelezen door de app). Coördinaten in RD New / m NAP, tenzij anders vermeld.
 */
import type { BBox, RDPoint } from '../core/coords';

export interface SourceInfo {
  id: string;
  naam: string;
  /** Beheerder / leverancier. */
  herkomst: string;
  /** Daadwerkelijk gebruikte endpoint(s). */
  endpoint: string;
  /** Datum/tijd waarop het datascript de data ophaalde (ISO). */
  opgehaald: string;
  /** Versie/jaargang van de bron, voor zover bekend. */
  versie?: string;
  /** Peildatum / inwinjaar van de bron. */
  peildatum?: string;
  nauwkeurigheid: string;
  licentie: string;
  aantal?: number;
  opmerkingen?: string[];
  status: 'ok' | 'fout' | 'overgeslagen';
}

export interface Manifest {
  formaat: 1;
  gegenereerd: string;
  project: { naam: string; adres: string; bagPandId: string };
  /** De 4 opgegeven hoekpunten. */
  kernpunten: RDPoint[];
  marge: number;
  bbox: BBox;
  origin: RDPoint;
  /** Indeling van terrein/luchtfoto in tegels. */
  tegels: { nx: number; ny: number };
  bronnen: SourceInfo[];
  bestanden: {
    terrein?: string;
    luchtfoto?: string;
    gebouwen?: string;
    bgt?: string[];
    percelen?: string;
    perceelgrenzen?: string;
    bomen?: string;
  };
}

/** Terreinraster (maaiveld). Waarden float32 little-endian, rij 0 = noordrand. */
export interface TerrainHeader {
  /** RD x van het midden van cel (kolom 0). */
  x0: number;
  /** RD y van het midden van cel (rij 0) – de noordelijkste rij. */
  y0: number;
  res: number;
  width: number;
  height: number;
  /** Bestand met float32-hoogtes (gaten opgevuld). */
  data: string;
  /** Bestand met uint8-masker: 1 = gemeten, 0 = geïnterpoleerd (onder gebouwen/water). */
  mask: string;
  min: number;
  max: number;
  bron: string;
}

export interface OrthoTile {
  file: string;
  bbox: BBox;
  /** rij (0 = noord) en kolom (0 = west) in de tegelindeling. */
  row: number;
  col: number;
}

export interface OrthoIndex {
  laag: string;
  jaar?: string;
  res: number;
  tiles: OrthoTile[];
}

export type SurfaceKind = 'roof' | 'wall' | 'ground';

export interface BuildingRecord {
  /** Volledige 3D BAG-identificatie, bv. NL.IMBAG.Pand.0505100000019476 */
  id: string;
  /** BAG pandidentificatie (16 cijfers). */
  bagId: string;
  bouwjaar: number | null;
  status: string | null;
  /** Hoogtes in m NAP. */
  maaiveld: number | null;
  /** Laagste dakrand (laagste punt van de dakvlakken, LoD 2.2). */
  goot: number | null;
  /** Hoogste punt van het dak (LoD 2.2). */
  nok: number | null;
  /** 3D BAG-kentallen (m NAP). */
  dak: { min: number | null; p50: number | null; p70: number | null; max: number | null };
  dakType: string | null;
  /** Bron puntenwolk (bv. "ahn5") en inwinjaar. */
  pwBron: string | null;
  pwDatum: string | null;
  /** Afzonderlijke (afgeronde) dakniveaus van horizontale dakvlakken. */
  dakniveaus: number[];
  oppGrond: number | null;
  /** Footprint (LoD0) als ringen, RD. */
  footprint: number[][][];
  /** Mesh: vertices lokaal t.o.v. manifest.origin: [dx, dy, z] per vertex (m). */
  mesh: { v: number[]; roof: number[]; wall: number[] };
  lod: string;
}

export interface BuildingsFile {
  origin: RDPoint;
  versie3dbag: string;
  gebouwen: BuildingRecord[];
}

export interface TreeRecord {
  id: string;
  x: number;
  y: number;
  /** Maaiveld bij de stam (m NAP). */
  maaiveld: number;
  /** Totale boomhoogte boven maaiveld (m). */
  hoogte: number;
  kroonstraal: number;
  /** Hoogte onderkant kroon boven maaiveld (m). */
  kroonOnderkant: number;
  bron: 'BGT' | 'BGT+AHN' | 'AHN';
  /** true als hoogte/kroon een aanname is (geen meting). */
  aanname: boolean;
  bgtId?: string;
}

export interface TreesFile {
  ahnBron: string;
  bomen: TreeRecord[];
}

/** Compacte BGT-feature (GeoJSON, RD). */
export interface BgtFeature {
  type: 'Feature';
  id: string;
  properties: Record<string, string | number | boolean | null>;
  geometry:
    | { type: 'Point'; coordinates: number[] }
    | { type: 'LineString'; coordinates: number[][] }
    | { type: 'MultiLineString'; coordinates: number[][][] }
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface BgtCollectionFile {
  type: 'FeatureCollection';
  collectie: string;
  features: BgtFeature[];
}
