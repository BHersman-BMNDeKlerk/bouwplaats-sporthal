/** Laden van de verwerkte data (map data/ naast de app) in de browser. */
import { designSource } from './design';
import type { Grid } from './terrain';
import type {
  BgtCollectionFile, BuildingsFile, DesignModelFile, Manifest, OrthoIndex, TerrainHeader, TreesFile,
} from './types';

export const DATA_BASE = 'data/';

export interface LoadedData {
  manifest: Manifest;
  terrain: (Grid & { header: TerrainHeader; mask: Uint8Array }) | null;
  ortho: { index: OrthoIndex; images: Map<string, HTMLImageElement> } | null;
  buildings: BuildingsFile | null;
  bgt: Map<string, BgtCollectionFile>;
  percelen: GeoJSON | null;
  grenzen: GeoJSON | null;
  trees: TreesFile | null;
  design: { model: DesignModelFile; bin: ArrayBuffer } | null;
}

export interface GeoJSON {
  type: 'FeatureCollection';
  features: { id: string; properties: Record<string, any>; geometry: { type: string; coordinates: any } }[];
}

async function json<T>(file: string): Promise<T> {
  const r = await fetch(DATA_BASE + file);
  if (!r.ok) throw new Error(`Kan ${file} niet laden (HTTP ${r.status})`);
  return r.json() as Promise<T>;
}

async function bin(file: string): Promise<ArrayBuffer> {
  const r = await fetch(DATA_BASE + file);
  if (!r.ok) throw new Error(`Kan ${file} niet laden (HTTP ${r.status})`);
  return r.arrayBuffer();
}

function img(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(`Kan afbeelding ${src} niet laden`));
    i.src = DATA_BASE + src;
  });
}

export async function loadAll(progress: (msg: string) => void): Promise<LoadedData> {
  progress('Manifest laden…');
  let manifest: Manifest;
  try {
    manifest = await json<Manifest>('manifest.json');
  } catch {
    throw new Error(
      'Geen data gevonden (data/manifest.json ontbreekt). Haal eerst de brondata op met: npm run data',
    );
  }
  const f = manifest.bestanden;
  const out: LoadedData = {
    manifest, terrain: null, ortho: null, buildings: null, bgt: new Map(), percelen: null, grenzen: null, trees: null, design: null,
  };
  const tasks: Promise<void>[] = [];
  if (f.terrein)
    tasks.push((async () => {
      progress('Terrein (AHN) laden…');
      const h = await json<TerrainHeader>(f.terrein!);
      const [vals, mask] = await Promise.all([bin(h.data), bin(h.mask)]);
      out.terrain = { header: h, width: h.width, height: h.height, x0: h.x0, y0: h.y0, res: h.res, values: new Float32Array(vals), mask: new Uint8Array(mask) };
    })());
  if (f.luchtfoto)
    tasks.push((async () => {
      progress('Luchtfoto laden…');
      const index = await json<OrthoIndex>(f.luchtfoto!);
      const images = new Map<string, HTMLImageElement>();
      await Promise.all(index.tiles.map(async (t) => images.set(t.file, await img(t.file))));
      out.ortho = { index, images };
    })());
  if (f.gebouwen) tasks.push(json<BuildingsFile>(f.gebouwen).then((d) => { out.buildings = d; }));
  if (f.bgt) for (const b of f.bgt) tasks.push(json<BgtCollectionFile>(b).then((d) => { out.bgt.set(d.collectie, d); }));
  if (f.percelen) tasks.push(json<GeoJSON>(f.percelen).then((d) => { out.percelen = d; }));
  if (f.perceelgrenzen) tasks.push(json<GeoJSON>(f.perceelgrenzen).then((d) => { out.grenzen = d; }));
  if (f.bomen) tasks.push(json<TreesFile>(f.bomen).then((d) => { out.trees = d; }));
  // Ontwerpmodel (IFC): lokaal geïmporteerd met `npm run ifc`, staat los van het manifest en niet in git.
  tasks.push((async () => {
    let model: DesignModelFile;
    try { model = await json<DesignModelFile>('ontwerp/model.json'); } catch { return; }
    progress('Ontwerpmodel (IFC) laden…');
    out.design = { model, bin: await bin(model.bin) };
    manifest.bronnen = [...manifest.bronnen.filter((b) => b.id !== 'ontwerp'), designSource(model)];
  })());
  const res = await Promise.allSettled(tasks);
  const errs = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (errs.length) console.warn('Niet alle data kon geladen worden', errs.map((e) => e.reason));
  return out;
}
