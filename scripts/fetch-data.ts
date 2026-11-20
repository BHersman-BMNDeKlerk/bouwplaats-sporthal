/**
 * Datascript – stap 1: brondata ophalen voor de projectbbox en opslaan in data/raw.
 *
 *   npm run data          (ophalen + verwerken)
 *   npm run data:fetch    (alleen ophalen)
 *
 * Opties:
 *   --marge=100           marge rond de kernpunten in m (standaard 100)
 *   --alleen=bgt,brk      alleen deze bronnen (bgt, brk, 3dbag, ahn, luchtfoto)
 *   --ahn=auto|ahn5|ahn4  AHN-versie (auto: AHN5 indien bereikbaar, anders AHN4 via PDOK)
 *   --luchtfoto-res=0.08  resolutie van de luchtfoto in m/pixel
 *
 * Endpoints worden zo veel mogelijk ontdekt i.p.v. hardcoded: de OGC API-versie
 * wordt opgezocht (hoogste vN die bestaat), collecties/lagen/coverages komen uit
 * /collections of GetCapabilities.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromArrayBuffer, fromUrl } from 'geotiff';
import { bboxAround, type BBox } from '../src/core/coords';
import { PROJECT, bagObjectId } from '../src/core/projectConfig';
import { tileBBox, tileLayout } from '../src/core/tiles';
import { BGT_SKIP } from '../src/data/bgt';
import { exists, getBuffer, getJSON, getText, short } from './lib/http';
import { discoverVersion, fetchAllItems, listCollections } from './lib/ogcapi';

// Achter een proxy (bv. bedrijfsnetwerk) gebruikt Node's fetch die standaard niet.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? 'true'];
  }),
);
const marge = Number(args.marge ?? PROJECT.marge);
const alleen = args.alleen ? new Set(String(args.alleen).split(',')) : null;
const ahnMode = String(args.ahn ?? 'auto');
const orthoRes = Number(args['luchtfoto-res'] ?? 0.08);
const want = (k: string) => !alleen || alleen.has(k);

const bbox = bboxAround(PROJECT.kernpunten, marge, 10);
const layout = tileLayout(bbox);

export interface FetchLogEntry {
  id: string;
  status: 'ok' | 'fout' | 'overgeslagen';
  opgehaald: string;
  endpoint: string;
  versie?: string;
  peildatum?: string;
  aantal?: number;
  details?: Record<string, unknown>;
  melding?: string;
}

const logPath = path.join(RAW, 'fetch-log.json');
const log: { bbox: BBox; marge: number; bronnen: Record<string, FetchLogEntry> } = fs.existsSync(logPath)
  ? JSON.parse(fs.readFileSync(logPath, 'utf8'))
  : { bbox, marge, bronnen: {} };
log.bbox = bbox;
log.marge = marge;

function save(rel: string, data: unknown) {
  const file = path.join(RAW, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (data instanceof ArrayBuffer) fs.writeFileSync(file, Buffer.from(data));
  else if (ArrayBuffer.isView(data)) fs.writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  else fs.writeFileSync(file, JSON.stringify(data));
}

async function step(id: string, fn: () => Promise<Omit<FetchLogEntry, 'id' | 'status' | 'opgehaald'>>) {
  if (!want(id)) return;
  console.log(`\n▶ ${id}`);
  const t = Date.now();
  try {
    const r = await fn();
    log.bronnen[id] = { id, status: 'ok', opgehaald: new Date().toISOString(), ...r };
    console.log(`✔ ${id} klaar (${((Date.now() - t) / 1000).toFixed(1)} s)${r.aantal != null ? ` – ${r.aantal} objecten` : ''}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`✖ ${id} mislukt: ${msg}`);
    log.bronnen[id] = { ...(log.bronnen[id] ?? {}), id, status: 'fout', opgehaald: new Date().toISOString(), endpoint: log.bronnen[id]?.endpoint ?? '', melding: msg };
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------

async function fetchBgt() {
  const api = await discoverVersion('https://api.pdok.nl/lv/bgt/ogc/');
  console.log(`  BGT OGC API: ${api}`);
  const cols = (await listCollections(api)).filter((c) => !BGT_SKIP.has(c.id));
  let total = 0;
  const counts: Record<string, number> = {};
  for (const c of cols) {
    const feats = await fetchAllItems(api, c.id, bbox);
    counts[c.id] = feats.length;
    total += feats.length;
    save(`bgt/${c.id}.json`, { collectie: c.id, titel: c.title, features: feats });
    process.stdout.write(`  ${c.id}: ${feats.length}\n`);
  }
  return { endpoint: api, aantal: total, details: { collecties: counts } };
}

async function fetchBrk() {
  const api = await discoverVersion('https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/');
  console.log(`  BRK OGC API: ${api}`);
  const cols = await listCollections(api);
  const ids = cols.map((c) => c.id);
  if (!ids.includes('perceel')) throw new Error(`Collectie 'perceel' niet gevonden (wel: ${ids.join(', ')})`);
  const percelen = await fetchAllItems(api, 'perceel', bbox);
  save('brk/perceel.json', { features: percelen });
  let grenzen: any[] = [];
  if (ids.includes('kadastralegrens')) {
    grenzen = await fetchAllItems(api, 'kadastralegrens', bbox);
    save('brk/kadastralegrens.json', { features: grenzen });
  }
  console.log(`  percelen: ${percelen.length}, grenzen: ${grenzen.length}`);
  return { endpoint: api, aantal: percelen.length, details: { grenzen: grenzen.length } };
}

async function fetch3dbag() {
  const base = 'https://api.3dbag.nl';
  const colls = await getJSON<any>(`${base}/collections`);
  const pand = colls.collections.find((c: any) => c.id === 'pand') ?? colls.collections[0];
  const itemsLink = pand.links.find((l: any) => l.rel === 'items')?.href ?? `${base}/collections/${pand.id}/items`;
  let url: string | null = `${itemsLink}?bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}&limit=100`;
  fs.rmSync(path.join(RAW, '3dbag'), { recursive: true, force: true });
  let n = 0, pages = 0;
  const ids = new Set<string>();
  while (url && pages < 500) {
    const d: any = await getJSON(url);
    pages++;
    save(`3dbag/page_${String(pages).padStart(3, '0')}.json`, d);
    for (const f of d.features ?? []) ids.add(f.id);
    n += d.features?.length ?? 0;
    url = (d.links ?? []).find((l: any) => l.rel === 'next')?.href ?? null;
    process.stdout.write(`  pagina ${pages}: totaal ${n}\r`);
  }
  console.log('');
  // sporthal altijd meenemen (ook als hij buiten de bbox zou vallen)
  const sid = bagObjectId(PROJECT.bagPandId);
  if (!ids.has(sid)) {
    const d: any = await getJSON(`${base}/collections/${pand.id}/items/${sid}`);
    save('3dbag/sporthal.json', d);
    console.log('  sporthal apart opgehaald');
  }
  return {
    endpoint: itemsLink,
    versie: pand.version?.collection ?? undefined,
    aantal: ids.size,
    details: { paginas: pages },
  };
}

// --- AHN ---------------------------------------------------------------------

interface RasterOut {
  x0: number; y0: number; res: number; width: number; height: number;
}
const RES = 0.5;
const target: RasterOut = {
  x0: bbox.xmin + RES / 2,
  y0: bbox.ymax - RES / 2,
  res: RES,
  width: Math.round((bbox.xmax - bbox.xmin) / RES),
  height: Math.round((bbox.ymax - bbox.ymin) / RES),
};

/** Kopieer een GeoTIFF-venster in het doelraster (dichtstbijzijnde cel). */
async function pasteTiff(tiff: Awaited<ReturnType<typeof fromUrl>>, out: Float32Array) {
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const W = img.getWidth(), H = img.getHeight();
  const nodata = img.getGDALNoData();
  // pixelvenster dat de doelbbox afdekt
  const c0 = Math.max(0, Math.floor((bbox.xmin - ox) / rx));
  const c1 = Math.min(W, Math.ceil((bbox.xmax - ox) / rx));
  const r0 = Math.max(0, Math.floor((bbox.ymax - oy) / ry));
  const r1 = Math.min(H, Math.ceil((bbox.ymin - oy) / ry));
  if (c1 <= c0 || r1 <= r0) return 0;
  const rasters = await img.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
  const band = rasters[0] as unknown as ArrayLike<number>;
  const ww = c1 - c0;
  let n = 0;
  for (let r = 0; r < target.height; r++) {
    const y = target.y0 - r * RES;
    const pr = Math.floor((y - oy) / ry) - r0;
    if (pr < 0 || pr >= r1 - r0) continue;
    for (let c = 0; c < target.width; c++) {
      const x = target.x0 + c * RES;
      const pc = Math.floor((x - ox) / rx) - c0;
      if (pc < 0 || pc >= ww) continue;
      const v = band[pr * ww + pc];
      if (nodata != null && v === nodata) continue;
      if (!(v > -100 && v < 1000)) continue;
      out[r * target.width + c] = v;
      n++;
    }
  }
  return n;
}

async function ahn5(kind: 'dtm' | 'dsm'): Promise<{ data: Float32Array; urls: string[] }> {
  const idx = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'ahn-bladindex.json'), 'utf8'));
  const bladen = idx.bladen.filter((b: any) => b.bbox[0] < bbox.xmax && b.bbox[2] > bbox.xmin && b.bbox[1] < bbox.ymax && b.bbox[3] > bbox.ymin);
  if (!bladen.length) throw new Error('Geen AHN-kaartblad gevonden voor de bbox');
  const data = new Float32Array(target.width * target.height).fill(NaN);
  const urls: string[] = [];
  for (const b of bladen) {
    const url = b[`ahn5_${kind}_05m`];
    if (!url) throw new Error(`Geen AHN5-${kind} voor blad ${b.blad}`);
    console.log(`  AHN5 ${kind.toUpperCase()} blad ${b.blad}: ${short(url)}`);
    const tiff = await fromUrl(url, { allowFullFile: false });
    const n = await pasteTiff(tiff, data);
    console.log(`    ${n} cellen`);
    urls.push(url);
  }
  return { data, urls };
}

async function ahn4Wcs(kind: 'dtm' | 'dsm'): Promise<{ data: Float32Array; urls: string[]; abstract: string }> {
  let wcs = '';
  for (const v of ['v2_0', 'v1_1', 'v1_0']) {
    const u = `https://service.pdok.nl/rws/ahn/wcs/${v}`;
    if (await exists(`${u}?service=WCS&request=GetCapabilities`, (b) => b.includes('Capabilities'))) { wcs = u; break; }
  }
  if (!wcs) throw new Error('AHN WCS bij PDOK niet gevonden');
  const caps = await getText(`${wcs}?service=WCS&request=GetCapabilities&version=2.0.1`);
  const ids = [...caps.matchAll(/<wcs:CoverageId>([^<]+)<\/wcs:CoverageId>/g)].map((m) => m[1]);
  const cov = ids.find((i) => i.toLowerCase().includes(kind) && /05|0_5/.test(i));
  if (!cov) throw new Error(`Geen ${kind} 0,5 m-coverage in ${ids.join(', ')}`);
  const desc = await getText(`${wcs}?service=WCS&request=DescribeCoverage&version=2.0.1&coverageId=${cov}`);
  const axes = (desc.match(/axisLabels="([^"]+)"/)?.[1] ?? 'x y').split(' ');
  const url =
    `${wcs}?service=WCS&request=GetCoverage&version=2.0.1&coverageId=${cov}&format=image/tiff` +
    `&subset=${axes[0]}(${bbox.xmin},${bbox.xmax})&subset=${axes[1]}(${bbox.ymin},${bbox.ymax})`;
  console.log(`  AHN WCS ${cov}: ${short(url)}`);
  const { buf, type } = await getBuffer(url);
  if (!type.includes('tiff')) throw new Error(`Onverwacht antwoord (${type}): ${Buffer.from(buf).toString('utf8', 0, 300)}`);
  const data = new Float32Array(target.width * target.height).fill(NaN);
  const n = await pasteTiff(await fromArrayBuffer(buf), data);
  console.log(`    ${n} cellen`);
  const abstract = caps.match(/<ows:Abstract>([^<]+)<\/ows:Abstract>/)?.[1] ?? '';
  return { data, urls: [url], abstract };
}

async function fetchAhn() {
  const result: Record<string, any> = {};
  let versie = '';
  let peildatum = '';
  const notes: string[] = [];
  for (const kind of ['dtm', 'dsm'] as const) {
    let got: { data: Float32Array; urls: string[] } | null = null;
    if (ahnMode === 'auto' || ahnMode === 'ahn5') {
      try {
        got = await ahn5(kind);
        versie = 'AHN5';
        peildatum = (got.urls[0].match(/\/(\d{4})_[A-Z]/)?.[1]) ?? '';
      } catch (e) {
        const m = `AHN5 ${kind} niet beschikbaar: ${(e as Error).message.split('\n')[0]}`;
        console.warn(`  ! ${m}`);
        notes.push(m);
        if (ahnMode === 'ahn5') throw e;
      }
    }
    if (!got) {
      const w = await ahn4Wcs(kind);
      got = w;
      versie = /versie 4/i.test(w.abstract) ? 'AHN4 (PDOK WCS)' : 'AHN (PDOK WCS, versie volgens capabilities)';
      peildatum = w.abstract.match(/ingewonnen over de jaren ([^.]+)/)?.[1] ?? '';
    }
    save(`ahn/${kind}.f32`, got.data);
    result[kind] = { urls: got.urls };
  }
  save('ahn/header.json', { ...target, versie, peildatum });
  return { endpoint: [...result.dtm.urls, ...result.dsm.urls].join(' | '), versie, peildatum, details: { opmerkingen: notes } };
}

// --- Luchtfoto ------------------------------------------------------------------

async function fetchLuchtfoto() {
  let wms = '';
  for (const v of ['v2_0', 'v1_1', 'v1_0']) {
    const u = `https://service.pdok.nl/hwh/luchtfotorgb/wms/${v}`;
    if (await exists(`${u}?request=GetCapabilities&service=WMS`, (b) => b.includes('Capabilities'))) { wms = u; break; }
  }
  if (!wms) throw new Error('Luchtfoto-WMS bij PDOK niet gevonden');
  const caps = await getText(`${wms}?request=GetCapabilities&service=WMS`);
  const layers = [...caps.matchAll(/<Name>([^<]+)<\/Name>\s*<Title>([^<]*)<\/Title>/g)].map((m) => ({ name: m[1], title: m[2] }));
  const maxW = Number(caps.match(/<MaxWidth>(\d+)<\/MaxWidth>/)?.[1] ?? 2000);
  // Kies de nieuwste jaargang met hoogste resolutie die hier beeld heeft.
  const yearHR = layers.filter((l) => /^\d{4}_orthoHR$/i.test(l.name)).sort((a, b) => b.name.localeCompare(a.name));
  const candidates = [...yearHR, ...layers.filter((l) => /^Actueel_orthoHR$/i.test(l.name)), ...layers.filter((l) => /ortho25$/i.test(l.name))];
  const c = { x: (bbox.xmin + bbox.xmax) / 2, y: (bbox.ymin + bbox.ymax) / 2 };
  const getMap = (layer: string, b: BBox, w: number, h: number) =>
    `${wms}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:28992` +
    `&BBOX=${b.xmin},${b.ymin},${b.xmax},${b.ymax}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/jpeg`;
  let chosen: { name: string; title: string } | null = null;
  for (const l of candidates) {
    const { buf, type } = await getBuffer(getMap(l.name, { xmin: c.x - 20, ymin: c.y - 20, xmax: c.x + 20, ymax: c.y + 20 }, 256, 256));
    if (type.includes('image') && buf.byteLength > 8000) { chosen = l; break; }
    console.log(`  laag ${l.name} heeft hier geen beeld, volgende…`);
  }
  if (!chosen) throw new Error('Geen luchtfotolaag met beeld gevonden');
  console.log(`  laag: ${chosen.name} – ${chosen.title}`);
  fs.rmSync(path.join(RAW, 'luchtfoto'), { recursive: true, force: true });
  const tiles = [];
  for (let row = 0; row < layout.ny; row++)
    for (let col = 0; col < layout.nx; col++) {
      const b = tileBBox(bbox, layout.nx, layout.ny, row, col);
      const w = Math.min(maxW, Math.round((b.xmax - b.xmin) / orthoRes));
      const h = Math.min(maxW, Math.round((b.ymax - b.ymin) / orthoRes));
      const { buf, type } = await getBuffer(getMap(chosen.name, b, w, h));
      if (!type.includes('image')) throw new Error(`Geen afbeelding voor tegel ${row},${col}: ${Buffer.from(buf).toString('utf8', 0, 200)}`);
      const file = `r${row}_c${col}.jpg`;
      save(`luchtfoto/${file}`, buf);
      tiles.push({ file, bbox: b, row, col, w, h });
      process.stdout.write(`  tegel ${tiles.length}/${layout.nx * layout.ny}\r`);
    }
  console.log('');
  const jaar = chosen.name.match(/^(\d{4})/)?.[1];
  save('luchtfoto/index.json', { laag: chosen.name, titel: chosen.title, jaar, res: orthoRes, tiles, wms });
  return { endpoint: `${wms} (laag ${chosen.name})`, versie: chosen.title, peildatum: jaar, aantal: tiles.length };
}

// ---------------------------------------------------------------------------

console.log(`Projectgebied: x ${bbox.xmin}–${bbox.xmax}, y ${bbox.ymin}–${bbox.ymax} (marge ${marge} m, ${bbox.xmax - bbox.xmin} × ${bbox.ymax - bbox.ymin} m)`);
await step('bgt', fetchBgt);
await step('brk', fetchBrk);
await step('3dbag', fetch3dbag);
await step('ahn', fetchAhn);
await step('luchtfoto', fetchLuchtfoto);

const fouten = Object.values(log.bronnen).filter((b) => b.status === 'fout');
console.log(`\nKlaar. Ruwe data in ${path.relative(ROOT, RAW)}. ${fouten.length ? `LET OP: ${fouten.length} bron(nen) mislukt: ${fouten.map((f) => f.id).join(', ')}` : 'Alle bronnen OK.'}`);
console.log('Volgende stap: npm run data:build (gebeurt automatisch bij npm run data).');

