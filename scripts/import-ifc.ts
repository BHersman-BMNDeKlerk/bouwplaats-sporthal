/**
 * Importeer een IFC-ontwerpmodel (bv. van de architect) voor weergave in de app.
 *
 *   npm run ifc -- "pad/naar/model.ifc"
 *
 * Schrijft data/ontwerp/model.json: metadata, bouwlagen, de buitenwerkse
 * contour en hoogtezones (het pand wordt in de app als grijze blokken getoond,
 * zonder detailgeometrie) en de plaatsing. Het IFC-bestand zelf wordt niet gekopieerd.
 *
 * Plaatsing: IFC-modellen staan meestal in een lokaal assenstelsel. Als het
 * model geen bruikbare georeferentie heeft, wordt de buitencontour automatisch
 * uitgelijnd op de 3D BAG-footprint van de sporthal (verbouw op dezelfde plek).
 * De plaatsing is in de app te controleren en aan te passen.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as WebIFC from 'web-ifc';
import { PROJECT } from '../src/core/projectConfig';
import { fitToFootprint, footprintFromTriangles, heightZones, signedArea, type Placement } from '../src/data/ifcGeom';
import type { BuildingsFile } from '../src/data/types';
import type { DesignModelFile } from '../src/data/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'ontwerp');
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !fs.existsSync(file)) {
  console.error('Gebruik: npm run ifc -- "pad/naar/model.ifc"');
  process.exit(1);
}

/** Categorie per IFC-type (weergave en aan/uit in de app). */
function category(t: string): string {
  const u = t.toUpperCase();
  if (u.startsWith('IFCWALL') || u === 'IFCCURTAINWALL' || u === 'IFCPLATE') return 'wanden';
  if (u === 'IFCSLAB' || u === 'IFCROOF' || u === 'IFCCOVERING') return 'vloeren';
  if (u === 'IFCCOLUMN' || u === 'IFCBEAM' || u === 'IFCMEMBER') return 'constructie';
  if (u === 'IFCWINDOW' || u === 'IFCDOOR') return 'kozijnen';
  if (u === 'IFCBUILDINGELEMENTPART') return 'onderdelen';
  if (u === 'IFCFOOTING' || u === 'IFCPILE') return 'fundering';
  if (u.startsWith('IFCFLOW') || u.startsWith('IFCDISTRIBUTION') || u === 'IFCENERGYCONVERSIONDEVICE') return 'installaties';
  if (u === 'IFCSPACE' || u === 'IFCOPENINGELEMENT') return '';
  return 'overig';
}

const txt = fs.readFileSync(file, 'latin1');
const header = {
  bestand: path.basename(file).replace(/^[0-9a-f]{8}-/, ''), // eventueel upload-voorvoegsel weglaten
  datum: txt.match(/FILE_NAME\('[^']*','([^']+)'/)?.[1] ?? '',
  auteur: txt.match(/FILE_NAME\('[^']*','[^']*',\('([^']*)'\)/)?.[1] ?? '',
  schema: txt.match(/FILE_SCHEMA\(\('([^']+)'/)?.[1] ?? '',
  applicatie: txt.match(/IFCAPPLICATION\([^,]+,'[^']*','([^']+)'/)?.[1] ?? '',
  project: txt.match(/IFCPROJECT\('[^']*',[^,]*,'([^']*)'/)?.[1] ?? '',
};
const storeys = [...txt.matchAll(/IFCBUILDINGSTOREY\('[^']*',[^,]*,'([^']*)',(?:[^,]*,){6}([-\d.E]+)\)/g)]
  .map((m) => ({ naam: m[1], hoogte: Number(m[2]) }));
const unitMilli = /IFCSIUNIT\(\*,\.LENGTHUNIT\.,\.MILLI\.,\.METRE\.\)/.test(txt);
for (const s of storeys) if (unitMilli) s.hoogte /= 1000;
storeys.sort((a, b) => a.hoogte - b.hoogte);

console.log(`IFC: ${header.bestand} (${header.schema}, ${header.applicatie}, ${header.auteur}, ${header.datum})`);
const api = new WebIFC.IfcAPI();
await api.Init();
const modelID = api.OpenModel(new Uint8Array(fs.readFileSync(file)), { COORDINATE_TO_ORIGIN: false });

let nObjecten = 0;
const proj: number[] = []; // 2D-driehoeken voor de contour
const proj3: number[] = []; // 3D-driehoeken (x,y,z) voor de hoogtezones
let zmax = -Infinity;
api.StreamAllMeshes(modelID, (mesh) => {
  const cat = category(api.GetNameFromTypeCode(api.GetLineType(modelID, mesh.expressID)));
  // alleen het bouwwerk zelf: geen fundering (onder maaiveld), installaties/PV-panelen of ruimtes
  if (!cat || cat === 'fundering' || cat === 'installaties') return;
  nObjecten++;
  const geoms = mesh.geometries;
  for (let i = 0; i < geoms.size(); i++) {
    const pg = geoms.get(i);
    const g = api.GetGeometry(modelID, pg.geometryExpressID);
    const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
    const ix = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
    const m = pg.flatTransformation;
    const loc: number[] = [];
    for (let k = 0; k < v.length; k += 6) {
      const x = v[k], y = v[k + 1], z = v[k + 2];
      // web-ifc levert Y-omhoog; terug naar IFC (Z-omhoog): X = x', Y = −z', Z = y'
      const X = m[0] * x + m[4] * y + m[8] * z + m[12];
      const Yup = m[1] * x + m[5] * y + m[9] * z + m[13];
      const Zw = m[2] * x + m[6] * y + m[10] * z + m[14];
      loc.push(X, -Zw, Yup);
      zmax = Math.max(zmax, Yup);
    }
    for (let k = 0; k < ix.length; k += 3) {
      const a = ix[k] * 3, b = ix[k + 1] * 3, c = ix[k + 2] * 3;
      if (Math.max(loc[a + 2], loc[b + 2], loc[c + 2]) < 0.05) continue; // onder vloerpeil
      proj.push(loc[a], loc[a + 1], loc[b], loc[b + 1], loc[c], loc[c + 1]);
      proj3.push(loc[a], loc[a + 1], loc[a + 2], loc[b], loc[b + 1], loc[b + 2], loc[c], loc[c + 1], loc[c + 2]);
    }
  }
});
api.CloseModel(modelID);

// --- buitencontour en hoogtezones (grijze blokken)
console.log(`  ${nObjecten} bouwdelen, ${proj.length / 6} driehoeken; contour en hoogtezones bepalen…`);
const contour = footprintFromTriangles(proj, 0.05, 4, 2);
const outer = contour.filter((r) => signedArea(r) > 0);
console.log(`  buitencontour: ${outer.length} ring(en), ${outer.reduce((s, r) => s + signedArea(r), 0).toFixed(1)} m²`);
const zones = heightZones(proj3, 0.1);
for (const z of zones) console.log(`  zone: ${z.oppervlakte} m², hoogste punt ${z.top.toFixed(2)} m boven peil`);

// --- plaatsing: uitlijnen op bestaande footprint, peil uit projectgegevens
const peil = PROJECT.peilNAP;
let plaatsing: Placement | null = null;
let methode = '';
let kwaliteit: { gemAfwijking: number; dekking: number } | null = null;
const gebFile = path.join(ROOT, 'data', 'gebouwen.json');
if (fs.existsSync(gebFile)) {
  const g = JSON.parse(fs.readFileSync(gebFile, 'utf8')) as BuildingsFile;
  const sh = g.gebouwen.find((b) => b.bagId === PROJECT.bagPandId);
  if (sh && sh.footprint.length) {
    const fit = fitToFootprint(outer.length ? outer : contour, sh.footprint);
    plaatsing = { ...fit.plaatsing, peil };
    kwaliteit = { gemAfwijking: fit.gemAfwijking, dekking: fit.dekking };
    methode = `ligging automatisch uitgelijnd op de 3D BAG-footprint van pand ${PROJECT.bagPandId}; peil 0 P = ${peil} m NAP (opgave werkvoorbereiding)`;
    console.log(`  plaatsing: x ${fit.plaatsing.x.toFixed(2)}, y ${fit.plaatsing.y.toFixed(2)}, rotatie ${fit.plaatsing.rotatie.toFixed(2)}°, peil ${peil} m NAP`);
    console.log(`  gem. afwijking contour ↔ bestaand: ${(fit.gemAfwijking * 100).toFixed(0)} cm; ${(fit.dekking * 100).toFixed(0)}% binnen 0,5 m`);
  }
}
if (!plaatsing) {
  plaatsing = { x: 0, y: 0, rotatie: 0, peil };
  methode = 'geen automatische plaatsing mogelijk – stel de plaatsing in de app in';
}

// --- wegschrijven (alleen contour en blokken; geen detailgeometrie)
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const ringR = (r: number[][]) => r.map(([x, y]) => [r3(x), r3(y)]);
const json: DesignModelFile = {
  ...header,
  geimporteerd: new Date().toISOString(),
  bouwlagen: storeys,
  zmax: r3(zmax),
  contour: contour.map(ringR),
  zones: zones.map((z) => ({ rings: z.rings.map(ringR), top: z.top, oppervlakte: z.oppervlakte })),
  plaatsingAuto: { x: r3(plaatsing.x), y: r3(plaatsing.y), rotatie: r3(plaatsing.rotatie), peil: r3(plaatsing.peil) },
  plaatsingMethode: methode,
  plaatsingKwaliteit: kwaliteit,
};
fs.writeFileSync(path.join(OUT, 'model.json'), JSON.stringify(json));
console.log(`  → data/ontwerp/model.json (${(fs.statSync(path.join(OUT, 'model.json')).size / 1024).toFixed(0)} kB)`);
console.log('  Klaar. Herlaad de app.');
