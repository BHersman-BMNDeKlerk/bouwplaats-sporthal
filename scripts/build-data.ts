/**
 * Datascript – stap 2: ruwe data (data/raw) verwerken tot compacte bestanden
 * voor de app (data/*) plus data/manifest.json met herkomst, ophaaldatum en
 * nauwkeurigheid per bron.
 *
 *   npm run data:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { originFor, type BBox } from '../src/core/coords';
import { PROJECT } from '../src/core/projectConfig';
import { tileLayout } from '../src/core/tiles';
import { BGT_KEEP_PROPS, isCurrent } from '../src/data/bgt';
import { pagesToBuildings, type CJPage } from '../src/data/cityjson';
import { polygonsOf } from '../src/data/geom';
import { fillGaps, gridRange, type Grid } from '../src/data/terrain';
import { deriveTrees } from '../src/data/trees';
import type {
  BgtCollectionFile, BgtFeature, BuildingsFile, Manifest, OrthoIndex, SourceInfo, TerrainHeader, TreesFile,
} from '../src/data/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data');

const readJSON = (rel: string) => JSON.parse(fs.readFileSync(path.join(RAW, rel), 'utf8'));
const hasRaw = (rel: string) => fs.existsSync(path.join(RAW, rel));
const write = (rel: string, data: unknown) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (ArrayBuffer.isView(data)) fs.writeFileSync(file, Buffer.from((data as Uint8Array).buffer, (data as Uint8Array).byteOffset, (data as Uint8Array).byteLength));
  else fs.writeFileSync(file, JSON.stringify(data));
  const kb = fs.statSync(file).size / 1024;
  console.log(`  → data/${rel} (${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb.toFixed(0) + ' kB'})`);
};

if (!hasRaw('fetch-log.json')) {
  console.error('Geen data/raw/fetch-log.json gevonden. Draai eerst: npm run data:fetch');
  process.exit(1);
}
const log = readJSON('fetch-log.json') as { bbox: BBox; marge: number; bronnen: Record<string, any> };
const bbox = log.bbox;
const origin = originFor(bbox);
const layout = tileLayout(bbox);
const r2 = (v: number) => Math.round(v * 100) / 100;

// Vaste beschrijvingen per bron (nauwkeurigheid, licentie, herkomst).
const STATIC: Record<string, Omit<SourceInfo, 'id' | 'endpoint' | 'opgehaald' | 'status'>> = {
  bgt: {
    naam: 'BGT / IMGeo – Basisregistratie Grootschalige Topografie (incl. plus-objecten)',
    herkomst: 'Bronhouders (hier gemeente Dordrecht, G0505) via Kadaster/PDOK – OGC API Features',
    nauwkeurigheid:
      'Planimetrisch ca. 0,2–0,3 m (BGT-norm stedelijk gebied); geen hoogtes. Plus-objecten (palen, kasten, bomen) zijn niet verplicht en kunnen onvolledig zijn.',
    licentie: 'CC0 1.0',
  },
  brk: {
    naam: 'BRK – Kadastrale kaart (percelen en grenzen)',
    herkomst: 'Kadaster via PDOK – OGC API Features',
    nauwkeurigheid:
      'INDICATIEF. De kadastrale kaart is een grafische weergave; afwijkingen van enkele decimeters tot meer dan een meter zijn mogelijk. Niet gebruiken voor uitzetten of grenscontrole: daarvoor de ingemeten grens (fase 2).',
    licentie: 'CC BY 4.0',
  },
  '3dbag': {
    naam: '3D BAG – gebouwen in 3D (LoD 2.2)',
    herkomst: '3DBAG (TU Delft / 3DBAG B.V.) op basis van BAG-panden en AHN-puntenwolken – 3D BAG API',
    nauwkeurigheid:
      'Footprint volgens BAG (ca. 0,3 m). Dakvormen automatisch gereconstrueerd uit AHN; RMSE per gebouw meestal < 0,3 m. Kleine opbouwen (installaties, schoorstenen) ontbreken. Peildatum per gebouw = inwinjaar puntenwolk.',
    licentie: 'CC BY 4.0',
  },
  ahn: {
    naam: 'AHN – Actueel Hoogtebestand Nederland, DTM en DSM 0,5 m',
    herkomst: 'Rijkswaterstaat en waterschappen (Het Waterschapshuis); AHN5 via ahn.nl-downloads of AHN4 via PDOK WCS',
    nauwkeurigheid:
      'Per punt systematisch ≤ 5 cm en stochastisch ≤ 5 cm (68%). Raster 0,5 m (gemiddelde van punten). Onder gebouwen en water is het maaiveld geïnterpoleerd (in de app herkenbaar).',
    licentie: 'CC0 1.0',
  },
  luchtfoto: {
    naam: 'Luchtfoto – Beeldmateriaal Nederland (RGB, hoogste resolutie)',
    herkomst: 'Beeldmateriaal Nederland via PDOK – WMS',
    nauwkeurigheid:
      'Pixel 8 cm (zoals opgevraagd). Geen true-ortho: hoge objecten (gebouwen, bomen) staan door het perspectief schuin en dekken soms de grond af.',
    licentie: 'CC BY 4.0',
  },
};

const bronnen: SourceInfo[] = [];
const bestanden: Manifest['bestanden'] = {};
function addSource(id: string, extra: Partial<SourceInfo> = {}) {
  const l = log.bronnen[id];
  const st = STATIC[id];
  bronnen.push({
    id,
    ...st,
    endpoint: l?.endpoint ?? '',
    opgehaald: l?.opgehaald ?? '',
    versie: l?.versie,
    peildatum: l?.peildatum,
    aantal: l?.aantal,
    status: l ? l.status : 'overgeslagen',
    opmerkingen: [...(l?.details?.opmerkingen ?? []), ...(l?.melding ? [l.melding] : [])],
    ...extra,
  } as SourceInfo);
}

// --- Terrein ---------------------------------------------------------------
let dtm: Grid | null = null;
let dsm: Grid | null = null;
let ahnLabel = '';
if (hasRaw('ahn/header.json') && hasRaw('ahn/dtm.f32')) {
  console.log('\n▶ terrein (AHN)');
  const h = readJSON('ahn/header.json');
  const load = (f: string) => {
    const b = fs.readFileSync(path.join(RAW, f));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const values = load('ahn/dtm.f32');
  const mask = fillGaps(values, h.width, h.height);
  const measured = mask.reduce((s, m) => s + m, 0);
  const { min, max } = gridRange(values);
  dtm = { width: h.width, height: h.height, x0: h.x0, y0: h.y0, res: h.res, values };
  if (hasRaw('ahn/dsm.f32')) dsm = { ...dtm, values: load('ahn/dsm.f32') };
  ahnLabel = `${h.versie}${h.peildatum ? ` (${h.peildatum})` : ''}`;
  const header: TerrainHeader = {
    x0: h.x0, y0: h.y0, res: h.res, width: h.width, height: h.height,
    data: 'terrein.f32', mask: 'terrein_masker.u8', min: r2(min), max: r2(max), bron: ahnLabel,
  };
  write('terrein.f32', values);
  write('terrein_masker.u8', mask);
  write('terrein.json', header);
  bestanden.terrein = 'terrein.json';
  console.log(`  ${h.width}×${h.height} cellen, gemeten ${((measured / mask.length) * 100).toFixed(0)}%, maaiveld ${min.toFixed(2)} … ${max.toFixed(2)} m NAP`);
  addSource('ahn', { versie: h.versie, peildatum: h.peildatum });
} else addSource('ahn');

// --- Gebouwen ----------------------------------------------------------------
let footprints: number[][][][] = [];
if (hasRaw('3dbag')) {
  console.log('\n▶ gebouwen (3D BAG)');
  const files = fs.readdirSync(path.join(RAW, '3dbag')).filter((f) => f.endsWith('.json')).sort();
  const pages = files.map((f) => readJSON(`3dbag/${f}`) as CJPage);
  const gebouwen = pagesToBuildings(pages, origin);
  footprints = gebouwen.map((g) => g.footprint).filter((f) => f.length);
  const sporthal = gebouwen.find((g) => g.bagId === PROJECT.bagPandId);
  console.log(`  ${gebouwen.length} gebouwen; sporthal ${sporthal ? `gevonden (goot ${sporthal.goot}, nok ${sporthal.nok} m NAP)` : 'NIET gevonden'}`);
  const pw = new Map<string, number>();
  for (const g of gebouwen) pw.set(`${g.pwBron ?? '?'} ${g.pwDatum ?? ''}`.trim(), (pw.get(`${g.pwBron ?? '?'} ${g.pwDatum ?? ''}`.trim()) ?? 0) + 1);
  const pwTxt = [...pw.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ');
  const file: BuildingsFile = { origin, versie3dbag: log.bronnen['3dbag']?.versie ?? '', gebouwen };
  write('gebouwen.json', file);
  bestanden.gebouwen = 'gebouwen.json';
  addSource('3dbag', { aantal: gebouwen.length, peildatum: `per gebouw; puntenwolken: ${pwTxt}` });
} else addSource('3dbag');

// --- BGT ------------------------------------------------------------------------
const bgtCurrent: Record<string, BgtFeature[]> = {};
if (hasRaw('bgt')) {
  console.log('\n▶ BGT');
  bestanden.bgt = [];
  let total = 0;
  for (const f of fs.readdirSync(path.join(RAW, 'bgt')).sort()) {
    const raw = readJSON(`bgt/${f}`);
    const col: string = raw.collectie;
    const feats: BgtFeature[] = [];
    for (const ft of raw.features as any[]) {
      if (!ft.geometry || !isCurrent(ft.properties ?? {})) continue;
      const p: Record<string, any> = {};
      for (const k of BGT_KEEP_PROPS) if (ft.properties[k] != null && ft.properties[k] !== '') p[k] = ft.properties[k];
      feats.push({ type: 'Feature', id: String(ft.id ?? p.lokaal_id), properties: p, geometry: roundGeom(ft.geometry) });
    }
    if (!feats.length) continue;
    bgtCurrent[col] = feats;
    total += feats.length;
    const out: BgtCollectionFile = { type: 'FeatureCollection', collectie: col, features: feats };
    write(`bgt/${col}.geojson`, out);
    bestanden.bgt.push(`bgt/${col}.geojson`);
  }
  addSource('bgt', { aantal: total, peildatum: 'actueel (dagelijks bijgewerkt); registratiedatum per object in het infopaneel' });
} else addSource('bgt');

function roundGeom(g: any): any {
  const rc = (c: any): any => (typeof c[0] === 'number' ? c.map((v: number) => Math.round(v * 1000) / 1000) : c.map(rc));
  return { type: g.type, coordinates: rc(g.coordinates) };
}

// --- BRK --------------------------------------------------------------------------
if (hasRaw('brk/perceel.json')) {
  console.log('\n▶ BRK');
  const keep = [
    'akr_kadastrale_gemeente_code_waarde', 'kadastrale_gemeente_waarde', 'sectie', 'perceelnummer', 'kadastrale_grootte_waarde',
    'soort_grootte_waarde', 'perceelnummer_plaatscoordinaat_x', 'perceelnummer_plaatscoordinaat_y', 'perceelnummer_rotatie',
    'identificatie_lokaal_id', 'begin_geldigheid',
  ];
  const percelen = (readJSON('brk/perceel.json').features as any[])
    .filter((f) => (f.properties.status_historie_waarde ?? 'Geldig') === 'Geldig')
    .map((f) => {
      const p: Record<string, any> = {};
      for (const k of keep) if (f.properties[k] != null) p[k] = f.properties[k];
      return { type: 'Feature', id: String(f.id), properties: p, geometry: roundGeom(f.geometry) };
    });
  write('brk_percelen.geojson', { type: 'FeatureCollection', features: percelen });
  bestanden.percelen = 'brk_percelen.geojson';
  if (hasRaw('brk/kadastralegrens.json')) {
    const grenzen = (readJSON('brk/kadastralegrens.json').features as any[]).map((f) => ({
      type: 'Feature', id: String(f.id), properties: {}, geometry: roundGeom(f.geometry),
    }));
    write('brk_grenzen.geojson', { type: 'FeatureCollection', features: grenzen });
    bestanden.perceelgrenzen = 'brk_grenzen.geojson';
  }
  addSource('brk', { aantal: percelen.length, peildatum: 'actueel op ophaaldatum' });
} else addSource('brk');

// --- Bomen --------------------------------------------------------------------------
if (dtm) {
  console.log('\n▶ bomen (BGT + AHN)');
  const bgtTrees = (bgtCurrent['vegetatieobject_punt'] ?? [])
    .filter((f) => String(f.properties.plus_type ?? f.properties.type ?? '').toLowerCase().includes('boom'))
    .map((f) => ({ id: String(f.properties.lokaal_id ?? f.id), x: (f.geometry.coordinates as number[])[0], y: (f.geometry.coordinates as number[])[1] }));
  const exclude = [
    ...footprints,
    ...(bgtCurrent['pand'] ?? []).flatMap((f) => polygonsOf(f.geometry)),
    ...(bgtCurrent['overigbouwwerk'] ?? []).flatMap((f) => polygonsOf(f.geometry)),
  ];
  const poles = ['paal', 'mast', 'bord'].flatMap((c) => (bgtCurrent[c] ?? []).map((f) => ({ x: (f.geometry.coordinates as number[])[0], y: (f.geometry.coordinates as number[])[1] })));
  const bomen = deriveTrees({ dtm, dsm, bgtTrees, exclude, poles });
  const n = (b: string) => bomen.filter((t) => t.bron === b).length;
  console.log(`  ${bomen.length} bomen: ${n('BGT+AHN')} BGT met AHN-hoogte, ${n('BGT')} BGT zonder AHN-signaal (aanname), ${n('AHN')} alleen uit AHN`);
  const file: TreesFile = { ahnBron: dsm ? ahnLabel : 'geen DSM', bomen };
  write('bomen.json', file);
  bestanden.bomen = 'bomen.json';
  bronnen.push({
    id: 'bomen',
    naam: 'Bomen (afgeleid)',
    herkomst: `BGT vegetatieobject (boom) + hoogte/kroon uit AHN nDSM (${ahnLabel}); extra bomen gedetecteerd in AHN`,
    endpoint: 'afgeleid uit BGT en AHN (zie die bronnen)',
    opgehaald: log.bronnen['ahn']?.opgehaald ?? '',
    peildatum: ahnLabel,
    nauwkeurigheid:
      'Indicatief. Hoogte = hoogste AHN-punt binnen 3 m van de stam (±0,5 m), kroonstraal uit hoogteprofiel, minimaal 0,2 × hoogte (±1–2 m; het AHN wordt in de winter zonder blad ingewonnen, dus kronen lijken in het AHN kleiner). Onderkant kroon is een aanname (35% van de hoogte, 2–5 m) – controleer ter plaatse. Bomen kunnen sinds de AHN-inwinning gegroeid, gesnoeid of gekapt zijn.',
    licentie: 'afgeleid van CC0-bronnen',
    aantal: bomen.length,
    status: 'ok',
    opmerkingen: ['Er is geen open bomenregister van de gemeente Dordrecht gevonden; daarom BGT-plus + AHN.'],
  });
}

// --- Luchtfoto --------------------------------------------------------------------------
if (hasRaw('luchtfoto/index.json')) {
  console.log('\n▶ luchtfoto');
  const idx = readJSON('luchtfoto/index.json');
  fs.rmSync(path.join(OUT, 'luchtfoto'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'luchtfoto'), { recursive: true });
  for (const t of idx.tiles) fs.copyFileSync(path.join(RAW, 'luchtfoto', t.file), path.join(OUT, 'luchtfoto', t.file));
  const out: OrthoIndex = {
    laag: idx.titel ?? idx.laag, jaar: idx.jaar, res: idx.res,
    tiles: idx.tiles.map((t: any) => ({ file: `luchtfoto/${t.file}`, bbox: t.bbox, row: t.row, col: t.col })),
  };
  write('luchtfoto.json', out);
  bestanden.luchtfoto = 'luchtfoto.json';
  addSource('luchtfoto');
} else addSource('luchtfoto');

// --- Manifest -------------------------------------------------------------------------------
const manifest: Manifest = {
  formaat: 1,
  gegenereerd: new Date().toISOString(),
  project: { naam: PROJECT.naam, adres: PROJECT.adres, bagPandId: PROJECT.bagPandId },
  kernpunten: PROJECT.kernpunten,
  marge: log.marge,
  bbox,
  origin,
  tegels: { nx: layout.nx, ny: layout.ny },
  bronnen,
  bestanden,
};
write('manifest.json', manifest);
console.log('\nKlaar. Start de app met: npm run dev');
