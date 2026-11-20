/**
 * KLIC-levering (WIBON, IMKL 2.0) inlezen: GI_gebiedsinformatielevering_*.xml
 * uit de leverings-zip.
 *
 * IMKL-structuur (kort):
 *  - Utiliteitsnet: het net met het thema (bv. laagspanning, rioolVrijverval)
 *    en de standaarddieptelegging.
 *  - Kabels/leidingen (Elektriciteitskabel, OlieGasChemicalienPijpleiding,
 *    Rioolleiding, Waterleiding, Telecommunicatiekabel, Thermischepijpleiding,
 *    Kabelbed, Duct, Mantelbuis, Overig, …) verwijzen met net:link naar een
 *    UtilityLink met de lijngeometrie, en met net:inNetwork naar het net.
 *  - Punten: Appurtenance, Kast, Mast, Toren, Put, TechnischGebouw.
 *  - DiepteTovMaaiveld / DiepteNAP: diepte-aanduidingen (punt + waarde).
 *  - AanduidingEisVoorzorgsmaatregel: EV-vlak.
 *  - Annotatie, Maatvoering, EigenTopografie, ExtraGeometrie, Graafpolygoon.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export type Coord = [number, number];

export interface KlicLine {
  id: string;
  type: string;
  thema: string;
  beheerder: string;
  status: 'in gebruik' | 'gepland' | 'buiten gebruik' | 'onbekend';
  lines: Coord[][];
  props: Record<string, string | number>;
  /** Breedte voor kabelbed/duct/mantelbuis (m), anders 0. */
  breedte: number;
}

export interface KlicPoint {
  id: string;
  type: string;
  thema: string;
  beheerder: string;
  x: number;
  y: number;
  rotatie: number;
  props: Record<string, string | number>;
}

export interface KlicDepth {
  x: number;
  y: number;
  /** Waarde in m: diepte t.o.v. maaiveld (positief = onder maaiveld) of NAP-hoogte. */
  waarde: number;
  soort: 'tovMaaiveld' | 'NAP';
  aangrijping: string;
  nauwkeurigheid: string;
  thema: string;
  beheerder: string;
}

export interface KlicEv {
  id: string;
  thema: string;
  beheerder: string;
  eis: string;
  omschrijving: string;
  rings: Coord[][];
}

export interface KlicLabel {
  soort: 'annotatie' | 'maatvoering';
  type: string;
  thema: string;
  label: string;
  lines: Coord[][];
  punt: Coord | null;
  rotatie: number;
}

export interface KlicData {
  formaat: 1;
  /** KLIC-meldnummer, bv. 22G003174. */
  meldnummer: string;
  ordernummer: string;
  referentie: string;
  datumLevering: string;
  soortWerkzaamheden: string[];
  graafpolygoon: Coord[][];
  beheerders: { code: string; naam: string }[];
  lijnen: KlicLine[];
  punten: KlicPoint[];
  diepten: KlicDepth[];
  ev: KlicEv[];
  labels: KlicLabel[];
  extraGeometrie: { thema: string; rings: Coord[][] }[];
  eigenTopografie: { lines: Coord[][]; type: string }[];
  /** Aantal objecten per thema (lijnen). */
  themas: Record<string, number>;
  waarschuwingen: string[];
}

const LINE_TYPES = new Set([
  'Elektriciteitskabel', 'OlieGasChemicalienPijpleiding', 'Rioolleiding', 'Waterleiding', 'Telecommunicatiekabel',
  'Thermischepijpleiding', 'Kabelbed', 'Duct', 'Mantelbuis', 'Overig', 'Kabelspecifiek', 'Leidingelement',
]);
const POINT_TYPES = new Set(['Appurtenance', 'Kast', 'Mast', 'Toren', 'Put', 'TechnischGebouw', 'Leidingelement']);

const tail = (s: string | undefined) => (s ? s.substring(s.lastIndexOf('/') + 1) : '');
const local = (k: string) => k.substring(k.indexOf(':') + 1);
const href = (o: any): string | undefined => (o && typeof o === 'object' ? o['@_xlink:href'] : undefined);
const txt = (o: any): string | undefined => {
  if (o == null) return undefined;
  if (typeof o === 'object') return o['@_xsi:nil'] === 'true' ? undefined : o['#text'] != null ? String(o['#text']) : undefined;
  return String(o);
};
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Zoek een kindelement op lokale naam (ongeacht namespace-prefix). */
function child(o: any, name: string): any {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of Object.keys(o)) if (!k.startsWith('@_') && local(k) === name) return o[k];
  return undefined;
}

function parsePosList(s: string, dim: number): Coord[] {
  const v = s.trim().split(/\s+/).map(Number);
  const out: Coord[] = [];
  for (let i = 0; i + 1 < v.length; i += dim) out.push([v[i], v[i + 1]]);
  return out;
}

function dimOf(g: any, fallback = 2): number {
  const d = Number(g?.['@_srsDimension']);
  return d === 3 ? 3 : fallback;
}

/** Verzamel alle geometrie (lijnen, punten, ringen) recursief uit een element. */
function collectGeom(o: any, out: { lines: Coord[][]; points: Coord[]; polys: Coord[][][] }, dim = 2) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) collectGeom(x, out, dim); return; }
  for (const k of Object.keys(o)) {
    if (k.startsWith('@_') || k === '#text') continue;
    const v = o[k];
    const n = local(k);
    for (const g of arr(v)) {
      if (!g || typeof g !== 'object') continue;
      const d = dimOf(g, dim);
      if (n === 'LineString' || n === 'LineStringSegment') {
        const pl = txt(child(g, 'posList'));
        if (pl) out.lines.push(parsePosList(pl, dimOf(child(g, 'posList'), d)));
        else { const ps = arr(child(g, 'pos')).map((p) => parsePosList(txt(p) ?? '', d)[0]).filter(Boolean); if (ps.length > 1) out.lines.push(ps); }
      } else if (n === 'Point') {
        const p = txt(child(g, 'pos'));
        if (p) { const c = parsePosList(p, dimOf(child(g, 'pos'), d))[0]; if (c) out.points.push(c); }
      } else if (n === 'Polygon' || n === 'PolygonPatch') {
        const rings: Coord[][] = [];
        for (const part of ['exterior', 'interior'])
          for (const r of arr(child(g, part))) {
            const lr = child(r, 'LinearRing');
            const pl = txt(child(lr, 'posList'));
            if (pl) rings.push(parsePosList(pl, dimOf(child(lr, 'posList'), d)));
          }
        if (rings.length) out.polys.push(rings);
      } else collectGeom(g, out, d);
    }
  }
}

function geomOf(o: any) {
  const out = { lines: [] as Coord[][], points: [] as Coord[], polys: [] as Coord[][][] };
  collectGeom(o, out);
  return out;
}

const STATUS: Record<string, KlicLine['status']> = {
  functional: 'in gebruik', projected: 'gepland', underConstruction: 'gepland', disused: 'buiten gebruik',
  decommissioned: 'buiten gebruik', abandoned: 'buiten gebruik',
};

function value(v: any): string | number | undefined {
  const h = href(v);
  if (h) return tail(h);
  const t = txt(v);
  if (t == null || t === '') return undefined;
  const uom = v && typeof v === 'object' ? tail(v['@_uom'])?.replace('urn:ogc:def:uom:OGC::', '') : undefined;
  const n = Number(t);
  return Number.isFinite(n) && uom ? `${n} ${uom.split(':').pop()}` : t;
}

/** Interessante eigenschappen (lokale naam → Nederlandse omschrijving). */
const PROP_LABELS: Record<string, string> = {
  operatingVoltage: 'Bedrijfsspanning', nominalVoltage: 'Nominale spanning', pipeDiameter: 'Diameter', kabelDiameter: 'Kabeldiameter',
  pressure: 'Druk', buismateriaalType: 'Materiaal', sewerWaterType: 'Soort afvalwater', telecommunicationsCableMaterialType: 'Kabeltype',
  ductWidth: 'Breedte', aantalKabelsLeidingen: 'Aantal kabels/leidingen', geoNauwkeurigheidXY: 'Nauwkeurigheid ligging',
  verticalPosition: 'Ligging (verticaal)', toelichting: 'Toelichting', omschrijving: 'Omschrijving', label: 'Label',
  appurtenanceType: 'Soort', validFrom: 'In gebruik sinds', warningType: 'Waarschuwing', utilityDeliveryType: 'Functie',
  oilGasChemicalsProductType: 'Product', waterType: 'Soort water', thermalProductType: 'Product', bovengrondsZichtbaar: 'Bovengronds zichtbaar',
};

function props(o: any): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  for (const k of Object.keys(o)) {
    const n = local(k);
    const lab = PROP_LABELS[n];
    if (!lab) continue;
    const v = value(Array.isArray(o[k]) ? o[k][0] : o[k]);
    if (v != null && v !== '') p[lab] = n === 'validFrom' ? String(v).slice(0, 10) : v;
  }
  return p;
}

/** Bronhoudercode uit een IMKL-id: "nl.imkl-KL1040.UNET_…" → "KL1040". */
export function bronhouderOf(id: string): string {
  const m = id.match(/nl\.imkl-([A-Z]{2}\d{4})/);
  return m ? m[1] : '';
}

export function parseKlicXml(xml: string): KlicData {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml);
  const fc = doc['gml:FeatureCollection'] ?? doc[Object.keys(doc).find((k) => local(k) === 'FeatureCollection') ?? ''];
  if (!fc) throw new Error('Geen GML FeatureCollection gevonden – is dit een KLIC-levering (IMKL)?');
  const members: [string, any][] = [];
  for (const fm of arr(child(fc, 'featureMember')))
    for (const k of Object.keys(fm)) if (!k.startsWith('@_')) for (const o of arr(fm[k])) members.push([local(k), o]);

  const waarschuwingen: string[] = [];
  const nets = new Map<string, { thema: string; standaardDiepte?: number }>();
  const links = new Map<string, Coord[][]>();
  const beheerders = new Map<string, string>();
  const out: KlicData = {
    formaat: 1, meldnummer: '', ordernummer: '', referentie: '', datumLevering: '', soortWerkzaamheden: [], graafpolygoon: [], beheerders: [],
    lijnen: [], punten: [], diepten: [], ev: [], labels: [], extraGeometrie: [], eigenTopografie: [], themas: {}, waarschuwingen,
  };

  // pass 1: netten, links, beheerders, metadata
  for (const [t, o] of members) {
    const id = o['@_gml:id'] ?? '';
    if (t === 'Utiliteitsnet') {
      const d = Number(txt(child(o, 'standaardDieptelegging')));
      nets.set(id, { thema: tail(href(child(o, 'thema'))) || 'onbekend', standaardDiepte: Number.isFinite(d) ? d : undefined });
    } else if (t === 'UtilityLink') {
      links.set(id, geomOf(child(o, 'centrelineGeometry') ?? o).lines);
    } else if (t === 'Beheerder') {
      const code = txt(child(o, 'bronhoudercode')) ?? bronhouderOf(id);
      const naam = txt(child(child(child(o, 'organisatie'), 'Organisatie'), 'naam')) ?? code;
      beheerders.set(code, naam);
    } else if (t === 'GebiedsinformatieAanvraag') {
      out.ordernummer = txt(child(o, 'ordernummer')) ?? out.ordernummer;
      out.meldnummer = txt(child(o, 'klicMeldnummer')) ?? out.meldnummer;
      out.referentie = txt(child(o, 'referentie')) ?? out.referentie;
      out.soortWerkzaamheden = arr(child(o, 'soortWerkzaamheden')).map((s) => tail(href(s))).filter(Boolean);
      if (!out.meldnummer) out.meldnummer = (id.match(/_(\d{2}[A-Z]\d{6})/) ?? [])[1] ?? '';
    } else if (t === 'GebiedsinformatieLevering') {
      out.datumLevering = txt(child(o, 'datumLeveringSamengesteld')) ?? '';
      if (!out.meldnummer) out.meldnummer = (id.match(/_(\d{2}[A-Z]\d{6})/) ?? [])[1] ?? '';
    } else if (t === 'Graafpolygoon') {
      for (const p of geomOf(o).polys) out.graafpolygoon.push(...p);
    }
  }
  const netOf = (o: any) => nets.get(href(child(o, 'inNetwork')) ?? '');
  const themaOf = (o: any) => netOf(o)?.thema ?? 'onbekend';
  const beheerderOf = (id: string) => { const c = bronhouderOf(id); return beheerders.get(c) ?? c; };

  // pass 2: objecten
  let missingLinks = 0;
  for (const [t, o] of members) {
    const id = o['@_gml:id'] ?? '';
    if (LINE_TYPES.has(t) && child(o, 'link')) {
      const ls: Coord[][] = [];
      for (const l of arr(child(o, 'link'))) { const g = links.get(href(l) ?? ''); if (g) ls.push(...g); else missingLinks++; }
      if (!ls.length) continue;
      const thema = themaOf(o);
      const p = props(o);
      const net = netOf(o);
      if (net?.standaardDiepte != null) p['Standaard dieptelegging'] = `${net.standaardDiepte} m`;
      const w = Number(txt(child(o, 'ductWidth')));
      const unit = tail(child(o, 'ductWidth')?.['@_uom']);
      out.lijnen.push({
        id, type: t, thema, beheerder: beheerderOf(id), status: STATUS[tail(href(child(o, 'currentStatus')))] ?? 'onbekend', lines: ls, props: p,
        breedte: Number.isFinite(w) ? (unit.endsWith('cm') ? w / 100 : unit.endsWith('mm') ? w / 1000 : w) : 0,
      });
      out.themas[thema] = (out.themas[thema] ?? 0) + 1;
    } else if (POINT_TYPES.has(t)) {
      const g = geomOf(o);
      const pt = g.points[0] ?? (g.polys[0]?.[0]?.[0] ?? null);
      if (!pt) continue;
      out.punten.push({ id, type: t, thema: themaOf(o), beheerder: beheerderOf(id), x: pt[0], y: pt[1], rotatie: Number(txt(child(o, 'rotatiehoekSymbool'))) || 0, props: props(o) });
    } else if (t === 'DiepteTovMaaiveld' || t === 'DiepteNAP') {
      const g = geomOf(child(o, 'ligging') ?? o);
      const v = Number(txt(child(o, 'dieptePeil')) ?? txt(child(o, 'diepteTovMaaiveld')) ?? txt(child(o, 'diepteNAP')));
      const pt = g.points[0];
      if (!pt || !Number.isFinite(v)) continue;
      out.diepten.push({
        x: pt[0], y: pt[1], waarde: v, soort: t === 'DiepteNAP' ? 'NAP' : 'tovMaaiveld',
        aangrijping: tail(href(child(o, 'diepteAangrijpingspunt'))), nauwkeurigheid: tail(href(child(o, 'diepteNauwkeurigheid'))),
        thema: themaOf(o), beheerder: beheerderOf(id),
      });
    } else if (t === 'AanduidingEisVoorzorgsmaatregel') {
      const g = geomOf(child(o, 'geometrie') ?? o);
      for (const rings of g.polys)
        out.ev.push({
          id, thema: themaOf(o), beheerder: beheerderOf(id), eis: txt(child(o, 'eisVoorzorgsmaatregel')) ?? '',
          omschrijving: txt(child(o, 'netbeheerderNetOmschrijving')) ?? '', rings,
        });
    } else if (t === 'Annotatie' || t === 'Maatvoering') {
      const g = geomOf(child(o, 'ligging') ?? o);
      out.labels.push({
        soort: t === 'Annotatie' ? 'annotatie' : 'maatvoering',
        type: tail(href(child(o, t === 'Annotatie' ? 'annotatieType' : 'maatvoeringsType'))),
        thema: themaOf(o), label: txt(child(o, 'label')) ?? '', lines: g.lines, punt: g.points[0] ?? null,
        rotatie: Number(txt(child(o, 'rotatiehoek'))) || 0,
      });
    } else if (t === 'ExtraGeometrie') {
      const g = geomOf(o);
      for (const rings of g.polys) out.extraGeometrie.push({ thema: themaOf(o), rings });
    } else if (t === 'EigenTopografie') {
      const g = geomOf(child(o, 'ligging') ?? o);
      if (g.lines.length) out.eigenTopografie.push({ lines: g.lines, type: tail(href(child(o, 'typeTopografischObject'))) });
    }
  }
  if (missingLinks) waarschuwingen.push(`${missingLinks} verwijzing(en) naar lijngeometrie (UtilityLink) niet gevonden.`);
  out.beheerders = [...beheerders.entries()].map(([code, naam]) => ({ code, naam }));
  if (!out.lijnen.length && !out.punten.length) waarschuwingen.push('Geen kabels of leidingen in deze levering.');
  return out;
}

/** Lees een KLIC-leverings-zip (of een losse GI_*.xml). Neemt alle GI_*.xml-bestanden samen. */
export function parseKlicFile(bytes: Uint8Array, naam: string): KlicData {
  if (/\.xml$/i.test(naam) || bytes[0] === 0x3c) return parseKlicXml(strFromU8(bytes));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /GI_gebiedsinformatielevering.*\.xml$/i.test(f.name) || /\.zip$/i.test(f.name) });
  } catch {
    throw new Error('Kan het bestand niet uitpakken. Kies de KLIC-leverings-zip (Levering_…zip) of het GI_gebiedsinformatielevering…xml-bestand.');
  }
  // soms zit de levering nog in een zip in de zip
  for (const [n, b] of Object.entries(files)) if (/\.zip$/i.test(n)) Object.assign(files, unzipSync(b, { filter: (f) => /GI_gebiedsinformatielevering.*\.xml$/i.test(f.name) }));
  const xmls = Object.entries(files).filter(([n]) => /\.xml$/i.test(n));
  if (!xmls.length) throw new Error('Geen GI_gebiedsinformatielevering…xml gevonden in de zip. Is dit een KLIC-levering in IMKL 2.0?');
  const parts = xmls.map(([, b]) => parseKlicXml(strFromU8(b)));
  if (parts.length === 1) return parts[0];
  const m = parts[0];
  for (const p of parts.slice(1)) {
    m.lijnen.push(...p.lijnen); m.punten.push(...p.punten); m.diepten.push(...p.diepten); m.ev.push(...p.ev); m.labels.push(...p.labels);
    m.extraGeometrie.push(...p.extraGeometrie); m.eigenTopografie.push(...p.eigenTopografie); m.beheerders.push(...p.beheerders);
    for (const [k, n] of Object.entries(p.themas)) m.themas[k] = (m.themas[k] ?? 0) + n;
    m.waarschuwingen.push(...p.waarschuwingen);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Thema's: labels en kleuren
// ---------------------------------------------------------------------------

/**
 * Kleuren per thema volgens de KLIC/IMKL-kleurconventie (rood = elektriciteit,
 * geel = gas, groen = datatransport, paars = riool, blauw = water, enz.).
 * LET OP: datatransport (#00ff00) en rioolVrijverval (#ba38a8) komen uit de
 * IMKL 2.0-handreiking; de overige RGB-waarden zijn nog te verifiëren met de
 * "Handreiking visualisatie IMKL 2.0" (Geonovum) – zie KLIC_KLEUREN_GEVERIFIEERD.
 */
export const KLIC_THEMAS: Record<string, { label: string; kleur: string }> = {
  hoogspanning: { label: 'Hoogspanning', kleur: '#ff0000' },
  landelijkHoogspanningsnet: { label: 'Landelijk hoogspanningsnet', kleur: '#ff0000' },
  middenspanning: { label: 'Middenspanning', kleur: '#c80000' },
  laagspanning: { label: 'Laagspanning', kleur: '#960000' },
  gasHogeDruk: { label: 'Gas hoge druk', kleur: '#ffaa00' },
  gasLageDruk: { label: 'Gas lage druk', kleur: '#e6c800' },
  buisleidingGevaarlijkeInhoud: { label: 'Buisleiding gevaarlijke inhoud', kleur: '#ff7f00' },
  petrochemie: { label: 'Petrochemie', kleur: '#ff7f00' },
  datatransport: { label: 'Datatransport', kleur: '#00ff00' },
  rioolVrijverval: { label: 'Riool vrij verval', kleur: '#ba38a8' },
  rioolOnderOverOfOnderdruk: { label: 'Riool onder over- of onderdruk', kleur: '#800080' },
  water: { label: 'Water', kleur: '#0000ff' },
  warmte: { label: 'Warmte', kleur: '#008080' },
  wees: { label: 'Weesleiding', kleur: '#d2b48c' },
  overig: { label: 'Overig', kleur: '#808000' },
  onbekend: { label: 'Onbekend thema', kleur: '#555555' },
};
/** Zijn alle kleuren gecontroleerd tegen de officiële handreiking? */
export const KLIC_KLEUREN_GEVERIFIEERD = false;

export function themaStyle(thema: string): { label: string; kleur: string } {
  return KLIC_THEMAS[thema] ?? { label: thema, kleur: '#555555' };
}

/** Dichtstbijzijnde diepte-aanduiding (zelfde thema) binnen `max` m. */
export function nearestDepth(d: KlicDepth[], x: number, y: number, thema: string, max = 5): KlicDepth | null {
  let best: KlicDepth | null = null, bd = max;
  for (const p of d) {
    if (p.thema !== thema) continue;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < bd) { bd = dist; best = p; }
  }
  return best;
}
