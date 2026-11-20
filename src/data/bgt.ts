/**
 * BGT/IMGeo: classificatie van objecten naar weergaveklassen, kleuren en
 * aangenomen hoogtes voor bovengrondse obstakels.
 * Gebaseerd op de attributen van de PDOK BGT OGC API (functie, fysiek_voorkomen,
 * type, plus_type, plus_fysiek_voorkomen).
 */

type Props = Record<string, any>;

/** Collecties die het datascript níet ophaalt (bestuurlijke vlakken / historisch). */
export const BGT_SKIP = new Set([
  'buurt', 'wijk', 'stadsdeel', 'waterschap', 'openbareruimte', 'ongeclassificeerdobject', 'overigescheiding',
  'functioneelgebied',
]);

/** Is het object actueel (niet beëindigd)? */
export function isCurrent(p: Props): boolean {
  return p.eind_registratie == null && p.termination_date == null && (p.status == null || p.status === 'bestaand');
}

export interface ClassStyle {
  label: string;
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: number[];
  /** Volgorde van tekenen (laag eerst). */
  order: number;
  groep: 'Verharding & wegen' | 'Groen & water' | 'Terrein' | 'Lijnen' | 'Overig';
  standaardAan: boolean;
}

export const CLASS_STYLES: Record<string, ClassStyle> = {
  rijbaan: { label: 'Rijbaan', fill: '#7a7a7d', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  woonerf: { label: 'Woonerf', fill: '#a39b93', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  parkeervak: { label: 'Parkeervak', fill: '#8e94b8', stroke: '#ffffff', width: 0.08, order: 21, groep: 'Verharding & wegen', standaardAan: true },
  fietspad: { label: 'Fietspad', fill: '#c4675c', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  voetpad: { label: 'Voetpad / trottoir', fill: '#dcd0b6', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  inrit: { label: 'Inrit', fill: '#b9ad9c', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  ovbaan: { label: 'OV-baan / spoorbaan', fill: '#8a6f8f', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  weg_overig: { label: 'Overige weg', fill: '#9a9a9a', order: 20, groep: 'Verharding & wegen', standaardAan: true },
  verkeerseiland: { label: 'Verkeerseiland / berm', fill: '#b8c39b', order: 21, groep: 'Verharding & wegen', standaardAan: true },
  erf: { label: 'Erf', fill: '#ece4d2', order: 10, groep: 'Terrein', standaardAan: true },
  verhard: { label: 'Verhard terrein', fill: '#cfc9bd', order: 10, groep: 'Terrein', standaardAan: true },
  onverhard: { label: 'Onverhard / zand', fill: '#e3d4ac', order: 10, groep: 'Terrein', standaardAan: true },
  groen: { label: 'Groen (gras, beplanting)', fill: '#9cc77a', order: 10, groep: 'Groen & water', standaardAan: true },
  struiken: { label: 'Struiken / heesters', fill: '#6fa356', order: 10, groep: 'Groen & water', standaardAan: true },
  bos: { label: 'Bos', fill: '#4f8a3c', order: 10, groep: 'Groen & water', standaardAan: true },
  haag: { label: 'Haag', fill: '#3f7a32', stroke: '#2f5e25', width: 0.3, order: 30, groep: 'Groen & water', standaardAan: true },
  water: { label: 'Water', fill: '#7fb2e0', order: 10, groep: 'Groen & water', standaardAan: true },
  oever: { label: 'Oever / slootkant', fill: '#b5d3c2', order: 11, groep: 'Groen & water', standaardAan: true },
  bouwwerk: { label: 'Overig bouwwerk / overkapping', fill: '#b8a48c', stroke: '#6d5c48', width: 0.15, order: 40, groep: 'Overig', standaardAan: true },
  kunstwerk: { label: 'Kunstwerk / brug', fill: '#a0a0a0', stroke: '#555555', width: 0.15, order: 40, groep: 'Overig', standaardAan: true },
  weginrichting: { label: 'Weginrichting (vlak)', fill: '#c0b8a8', order: 30, groep: 'Overig', standaardAan: true },
  scheiding: { label: 'Scheiding (vlak)', fill: '#5a5a5a', order: 41, groep: 'Overig', standaardAan: true },
  pand_bgt: { label: 'Pand (BGT-omtrek)', stroke: '#6b4f3a', width: 0.12, order: 45, groep: 'Overig', standaardAan: false },
  // lijnen
  muur: { label: 'Muur', stroke: '#3a3a3a', width: 0.3, order: 50, groep: 'Lijnen', standaardAan: true },
  hek: { label: 'Hek', stroke: '#2b2b2b', width: 0.12, dash: [0.6, 0.3], order: 50, groep: 'Lijnen', standaardAan: true },
  geluidsscherm: { label: 'Geluidsscherm', stroke: '#244b7a', width: 0.3, order: 50, groep: 'Lijnen', standaardAan: true },
  scheiding_overig: { label: 'Overige scheiding', stroke: '#444444', width: 0.15, order: 50, groep: 'Lijnen', standaardAan: true },
  wegmarkering: { label: 'Wegmarkering', stroke: '#ffffff', width: 0.12, order: 49, groep: 'Lijnen', standaardAan: true },
  kruinlijn: { label: 'Kruinlijn (talud)', stroke: '#8b5a2b', width: 0.12, dash: [0.5, 0.25], order: 48, groep: 'Lijnen', standaardAan: true },
  lijn_overig: { label: 'Overige lijnen', stroke: '#555555', width: 0.1, order: 48, groep: 'Lijnen', standaardAan: true },
  spoor: { label: 'Spoor', stroke: '#333333', width: 0.2, dash: [1, 0.5], order: 50, groep: 'Lijnen', standaardAan: true },
  // punten (2D)
  put: { label: 'Putten / kolken (2D)', stroke: '#1f3f73', width: 0.06, order: 60, groep: 'Overig', standaardAan: true },
  huisnummer: { label: 'Huisnummers', order: 70, groep: 'Overig', standaardAan: false },
  straatnaam: { label: 'Straatnamen', order: 71, groep: 'Overig', standaardAan: true },
};

const s = (v: any) => (typeof v === 'string' ? v.toLowerCase() : '');

/**
 * Bepaal de weergaveklasse van een BGT-object. Retourneert null voor
 * objecten die apart worden behandeld (bomen, 3D-obstakels) of niet getekend worden.
 */
export function classify(collection: string, p: Props): string | null {
  const functie = s(p.functie);
  const fysiek = s(p.fysiek_voorkomen);
  const type = s(p.plus_type) || s(p.type);
  switch (collection) {
    case 'wegdeel':
      if (functie.startsWith('rijbaan')) return 'rijbaan';
      if (functie === 'woonerf') return 'woonerf';
      if (functie === 'parkeervlak') return 'parkeervak';
      if (functie === 'fietspad') return 'fietspad';
      if (functie.startsWith('voetpad') || functie === 'voetgangersgebied' || functie === 'ruiterpad') return 'voetpad';
      if (functie === 'inrit') return 'inrit';
      if (functie === 'ov-baan' || functie === 'spoorbaan' || functie === 'overweg') return 'ovbaan';
      return 'weg_overig';
    case 'ondersteunendwegdeel':
      return 'verkeerseiland';
    case 'begroeidterreindeel':
      if (fysiek.includes('bos')) return 'bos';
      if (fysiek === 'struiken' || fysiek === 'houtwal') return 'struiken';
      return 'groen';
    case 'onbegroeidterreindeel':
      if (fysiek === 'erf') return 'erf';
      if (fysiek.includes('onverhard') || fysiek === 'zand') return 'onverhard';
      return 'verhard';
    case 'waterdeel':
      return 'water';
    case 'ondersteunendwaterdeel':
      return 'oever';
    case 'overigbouwwerk':
      return 'bouwwerk';
    case 'kunstwerkdeel_vlak':
    case 'overbruggingsdeel':
    case 'tunneldeel':
      return 'kunstwerk';
    case 'weginrichtingselement_vlak':
      return 'weginrichting';
    case 'scheiding_vlak':
      return 'scheiding';
    case 'vegetatieobject_vlak':
    case 'vegetatieobject_lijn':
      return 'haag';
    case 'pand':
      return 'pand_bgt';
    case 'scheiding_lijn':
      if (type === 'muur' || type === 'kademuur' || type === 'damwand') return 'muur';
      if (type === 'hek') return 'hek';
      if (type === 'geluidsscherm') return 'geluidsscherm';
      return 'scheiding_overig';
    case 'weginrichtingselement_lijn':
      return type === 'wegmarkering' ? 'wegmarkering' : 'lijn_overig';
    case 'spoor':
      return 'spoor';
    case 'put':
      return 'put';
    case 'pand_nummeraanduiding':
      return 'huisnummer';
    case 'openbareruimtelabel':
      return 'straatnaam';
    default:
      if (collection.endsWith('_kruinlijn')) return 'kruinlijn';
      if (collection.endsWith('_lijn')) return 'lijn_overig';
      return null;
  }
}

// ---------------------------------------------------------------------------
// Bovengrondse obstakels (3D-symbolen). Hoogtes zijn aannames tenzij handmatig
// aangepast; de BGT bevat geen hoogtes van deze objecten.
// ---------------------------------------------------------------------------

export const OBSTACLE_COLLECTIONS = new Set([
  'paal', 'bord', 'mast', 'kast', 'straatmeubilair', 'sensor_punt', 'installatie', 'gebouwinstallatie',
  'weginrichtingselement_punt', 'waterinrichtingselement_punt', 'kunstwerkdeel_punt', 'bak',
]);

export type ObstacleShape = 'paal' | 'mast' | 'bord' | 'kast' | 'blok';

export interface ObstacleSpec {
  categorie: 'Palen & masten' | 'Borden' | 'Kasten' | 'Straatmeubilair' | 'Overig';
  omschrijving: string;
  vorm: ObstacleShape;
  hoogte: number;
  /** Footprint (m) voor kast/blok, diameter voor paal. */
  breedte: number;
  diepte: number;
  kleur: string;
}

export function obstacleSpec(collection: string, p: Props): ObstacleSpec {
  const type = s(p.plus_type) || (s(p.type) === 'niet-bgt' ? '' : s(p.type));
  const oms = type || collection;
  switch (collection) {
    case 'paal':
      if (type === 'lichtmast') return { categorie: 'Palen & masten', omschrijving: 'Lichtmast', vorm: 'mast', hoogte: 6, breedte: 0.16, diepte: 0.16, kleur: '#5c6670' };
      if (type.includes('verkeersregel')) return { categorie: 'Palen & masten', omschrijving: 'VRI-paal (verkeerslicht)', vorm: 'mast', hoogte: 4.5, breedte: 0.14, diepte: 0.14, kleur: '#3d3d3d' };
      if (type.includes('portaal') || type.includes('bovenleiding')) return { categorie: 'Palen & masten', omschrijving: type, vorm: 'mast', hoogte: 7.5, breedte: 0.3, diepte: 0.3, kleur: '#555b60' };
      if (type.includes('afsluit') || type === 'dijkpaal') return { categorie: 'Palen & masten', omschrijving: 'Afsluitpaal / paaltje', vorm: 'paal', hoogte: 0.9, breedte: 0.12, diepte: 0.12, kleur: '#8a2b2b' };
      return { categorie: 'Palen & masten', omschrijving: type ? `Paal (${type})` : 'Paal (type onbekend)', vorm: 'paal', hoogte: 1.2, breedte: 0.12, diepte: 0.12, kleur: '#6a6a6a' };
    case 'mast':
      return { categorie: 'Palen & masten', omschrijving: `Mast${type ? ` (${type})` : ''}`, vorm: 'mast', hoogte: 10, breedte: 0.4, diepte: 0.4, kleur: '#5c6670' };
    case 'bord':
      if (type === 'straatnaambord') return { categorie: 'Borden', omschrijving: 'Straatnaambord', vorm: 'bord', hoogte: 2.5, breedte: 0.8, diepte: 0.05, kleur: '#2a4f9c' };
      if (type === 'verkeersbord') return { categorie: 'Borden', omschrijving: 'Verkeersbord', vorm: 'bord', hoogte: 2.8, breedte: 0.6, diepte: 0.05, kleur: '#c33b2e' };
      return { categorie: 'Borden', omschrijving: type ? `Bord (${type})` : 'Bord', vorm: 'bord', hoogte: 2.5, breedte: 0.6, diepte: 0.05, kleur: '#c38a2e' };
    case 'kast':
      return { categorie: 'Kasten', omschrijving: type ? `Kast (${type})` : 'Kast (type onbekend)', vorm: 'kast', hoogte: 1.3, breedte: 0.9, diepte: 0.4, kleur: '#7c8a6e' };
    case 'straatmeubilair': {
      const sm: Record<string, [number, number, number]> = {
        betaalautomaat: [1.7, 0.5, 0.4], fietsenrek: [0.8, 2.0, 0.6], speelvoorziening: [2.5, 2.5, 2.5],
        brievenbus: [1.3, 0.5, 0.5], bank: [0.8, 1.8, 0.6], afvalbak: [1.0, 0.6, 0.6], reclamezuil: [3.0, 1.2, 1.2],
        abri: [2.6, 4.0, 1.5], container: [1.6, 1.5, 1.5], picknicktafel: [0.8, 2.0, 1.6], bolder: [0.8, 0.25, 0.25],
        plantenbak: [0.8, 1.5, 1.5], fietsklem: [0.8, 2.0, 0.6], lichtpunt: [1.0, 0.3, 0.3],
      };
      const d = sm[type] ?? [1.2, 0.8, 0.8];
      return { categorie: 'Straatmeubilair', omschrijving: type ? type[0].toUpperCase() + type.slice(1) : 'Straatmeubilair', vorm: type === 'bolder' ? 'paal' : 'blok', hoogte: d[0], breedte: d[1], diepte: d[2], kleur: '#8a7a5c' };
    }
    case 'sensor_punt':
      if (type === 'camera') return { categorie: 'Palen & masten', omschrijving: 'Camera(mast)', vorm: 'mast', hoogte: 5, breedte: 0.15, diepte: 0.15, kleur: '#444' };
      return { categorie: 'Overig', omschrijving: type ? `Sensor (${type})` : 'Sensor', vorm: 'blok', hoogte: 0.3, breedte: 0.3, diepte: 0.3, kleur: '#6c7d91' };
    default:
      return { categorie: 'Overig', omschrijving: oms, vorm: 'blok', hoogte: 1.0, breedte: 0.6, diepte: 0.6, kleur: '#7d7d7d' };
  }
}

/** Kleur van een put (2D-symbool). */
export function putColor(p: Props): string {
  const t = s(p.plus_type);
  if (t.includes('brandkraan')) return '#d22d2d';
  if (t.includes('gas')) return '#d9a400';
  if (t.includes('water')) return '#2d6fd2';
  if (t === 'kolk') return '#3a3a3a';
  return '#1f3f73';
}

/** Leesbare samenvatting van een BGT-object voor het infopaneel. */
export function describe(collection: string, p: Props): { titel: string; regels: [string, string][] } {
  const regels: [string, string][] = [];
  const add = (k: string, v: any) => { if (v != null && v !== '' && v !== 'niet-bgt') regels.push([k, String(v)]); };
  add('Functie', p.functie);
  add('Fysiek voorkomen', p.fysiek_voorkomen);
  add('Plus-functie', p.plus_functie);
  add('Plus fysiek voorkomen', p.plus_fysiek_voorkomen);
  add('Type', p.type);
  add('Plus-type', p.plus_type);
  add('Relatieve hoogteligging', p.relatieve_hoogteligging);
  add('Bronhouder', p.bronhouder);
  add('In registratie sinds', typeof p.tijdstip_registratie === 'string' ? p.tijdstip_registratie.slice(0, 10) : null);
  add('Lokaal ID', p.lokaal_id);
  const cls = classify(collection, p);
  const titel = cls && CLASS_STYLES[cls] ? CLASS_STYLES[cls].label : collection;
  return { titel: `BGT – ${titel}`, regels };
}

/** Eigenschappen die we bewaren in de verwerkte BGT-bestanden. */
export const BGT_KEEP_PROPS = [
  'lokaal_id', 'bronhouder', 'functie', 'fysiek_voorkomen', 'plus_functie', 'plus_fysiek_voorkomen', 'type',
  'plus_type', 'relatieve_hoogteligging', 'tijdstip_registratie', 'openbareruimtenaam', 'openbareruimtetype', 'hoek',
  'tekst', 'huisnummer', 'identificatie_bag_vbo_laagste_huisnummer', 'bag_pnd', 'hectometeraanduiding', 'op_talud',
];
