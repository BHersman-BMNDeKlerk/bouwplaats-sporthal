/**
 * Projectbestand (één JSON) met alle eigen invoer: handmatige overschrijvingen
 * en (in latere fases) geplaatste elementen, routes en kraanopstellingen.
 * Inclusief undo/redo op basis van snapshots.
 */
import type { MeetPunt, PuntSoort } from '../data/csvPoints';
import type { DxfData, DxfPlacement } from '../data/dxf';
import type { HeightOverride } from '../data/heights';
import type { Placement } from '../data/ifcGeom';
import type { KlicData } from '../data/klic';
import type { Gate } from './polyline';
import type { Element } from './elements';
import type { Route } from '../vehicles/routes';
import type { Crane } from '../cranes/cranes';

export interface TreeOverride {
  hoogte?: number;
  kroonstraal?: number;
  kroonOnderkant?: number;
  verborgen?: boolean;
  opmerking?: string;
}

export interface ObstacleOverride {
  hoogte?: number;
  verborgen?: boolean;
  opmerking?: string;
}

/** Ingemeten punten uit een CSV-import. */
export interface SurveyImport {
  bestand: string;
  geimporteerd: string;
  punten: MeetPunt[];
}

/** Ingemeten perceelgrens: punten in volgorde; heeft voorrang op de BRK-grens. */
export interface MeasuredBoundary extends SurveyImport {
  gesloten: boolean;
}

/** Koppeling meetcode → soort object/symbool. */
export interface CodeRule {
  soort: PuntSoort;
  /** Hoogte (m) voor 3D-objecten (paal, boom). */
  hoogte?: number;
}

/** Verwijzing naar een geïmporteerde KLIC-levering (data in `bijlagen`). */
export interface KlicRef {
  id: string;
  meldnummer: string;
  referentie: string;
  bestand: string;
  geimporteerd: string;
  datumLevering: string;
  zichtbaar: boolean;
}

/** Verwijzing naar een DXF-onderlegger (data in `bijlagen`). */
export interface DxfRef {
  id: string;
  naam: string;
  bestand: string;
  geimporteerd: string;
  plaatsing: DxfPlacement;
  kleur: string;
  laagkleuren: boolean;
  verborgenLagen: string[];
  teksten: boolean;
  zichtbaar: boolean;
}

export type ManualKind = 'doorrijhoogte' | 'paaltjes' | 'hekwerk' | 'nietBerijdbaar' | 'maatlijn' | 'looproute' | 'vluchtroute' | 'vrijvlak' | 'vrijelijn' | 'vergundeZone';

/** Handmatig getekend obstakel (RD-coördinaten). */
export interface Bouwfase { id: string; naam: string }
export const STANDAARD_FASES: Bouwfase[] = [{ id: 'sloop', naam: 'Sloop' }, { id: 'ruwbouw', naam: 'Ruwbouw' }, { id: 'afbouw', naam: 'Afbouw' }];
/** Hoort een object bij de actieve fase? (geen fase-indeling = altijd) */
export function inFase(o: { fases?: string[] }, actief: string): boolean {
  return !actief || !o.fases || o.fases.length === 0 || o.fases.includes(actief);
}

export interface ManualObject {
  id: string;
  /** Bouwfases waarin dit object bestaat (leeg = alle fases). */
  fases?: string[];
  soort: ManualKind;
  geom: 'punten' | 'lijn' | 'vlak';
  coords: [number, number][];
  naam: string;
  /** Doorrijhoogte: vrije hoogte boven maaiveld (m). */
  vrijeHoogte?: number;
  /** Paaltjes/hekwerk: hoogte boven maaiveld (m). */
  hoogte?: number;
  /** Vrij vlak / vrije lijn: eigen kleur. */
  kleur?: string;
  /** Maatlijn: afstand van de maatlijn tot de gemeten punten (m, + = links van de tekenrichting). */
  offset?: number;
  /** Hekwerk: poorten (reeksen hele bouwhekken). */
  poorten?: Gate[];
  opmerking?: string;
}

export interface ProjectData {
  app: 'bouwplaats-sporthal';
  versie: 1;
  opgeslagen?: string;
  project: { naam: string; nummer: string; getekendDoor: string };
  overschrijvingen: {
    gebouwen: Record<string, HeightOverride>;
    bomen: Record<string, TreeOverride>;
    obstakels: Record<string, ObstacleOverride>;
  };
  /** Plaatsing van het ontwerpmodel (IFC) in RD/NAP; leeg = automatische plaatsing. */
  ontwerpPlaatsing?: Placement;
  /** Eigen inmeting (fase 2). */
  inmeting: {
    grens?: MeasuredBoundary;
    punten?: SurveyImport;
    codes: Record<string, CodeRule>;
  };
  klic: KlicRef[];
  onderleggers: DxfRef[];
  handmatig: ManualObject[];
  /**
   * Grote, onveranderlijke importdata (KLIC, DXF) per id. Valt buiten de
   * undo-snapshots; alleen bijlagen waarnaar verwezen wordt, worden opgeslagen.
   */
  bijlagen: Record<string, KlicData | DxfData>;
  /** Laagzichtbaarheid en camera (geen onderdeel van undo). */
  weergave?: { lagen?: Record<string, boolean | number | string>; camera?: number[] };
  /** Gereserveerd voor latere fases. */
  elementen: Element[];
  /** Fase 6: bouwfases / varianten (bv. sloop, ruwbouw, afbouw). */
  fases?: Bouwfase[];
  /** Fase 4: voertuigroutes (swept path). */
  routes: Route[];
  /** Fase 5: kraanopstellingen. */
  kranen: Crane[];
}

export function emptyProject(naam: string): ProjectData {
  return {
    app: 'bouwplaats-sporthal',
    versie: 1,
    project: { naam, nummer: '', getekendDoor: '' },
    overschrijvingen: { gebouwen: {}, bomen: {}, obstakels: {} },
    inmeting: { codes: {} },
    klic: [],
    onderleggers: [],
    handmatig: [],
    bijlagen: {},
    elementen: [],
    routes: [],
    kranen: [],
  };
}

/** Valideer/normaliseer een ingelezen projectbestand. Gooit een fout met Nederlandse uitleg. */
export function parseProject(text: string): ProjectData {
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('Het bestand is geen geldig JSON-bestand.');
  }
  if (d?.app !== 'bouwplaats-sporthal') throw new Error('Dit is geen projectbestand van deze tool.');
  if (d.versie !== 1) throw new Error(`Onbekende projectversie: ${d.versie}`);
  const p = emptyProject(d.project?.naam ?? '');
  p.project = { ...p.project, ...(d.project ?? {}) };
  p.overschrijvingen.gebouwen = d.overschrijvingen?.gebouwen ?? {};
  p.overschrijvingen.bomen = d.overschrijvingen?.bomen ?? {};
  p.overschrijvingen.obstakels = d.overschrijvingen?.obstakels ?? {};
  p.weergave = d.weergave;
  if (d.ontwerpPlaatsing && ['x', 'y', 'rotatie', 'peil'].every((k) => Number.isFinite(d.ontwerpPlaatsing[k]))) p.ontwerpPlaatsing = d.ontwerpPlaatsing;
  p.inmeting = { codes: {}, ...(d.inmeting ?? {}) };
  p.klic = Array.isArray(d.klic) ? d.klic : [];
  p.onderleggers = Array.isArray(d.onderleggers) ? d.onderleggers : [];
  p.handmatig = Array.isArray(d.handmatig) ? d.handmatig : [];
  p.bijlagen = d.bijlagen && typeof d.bijlagen === 'object' ? d.bijlagen : {};
  for (const r of [...p.klic, ...p.onderleggers]) if (!p.bijlagen[r.id]) throw new Error(`Projectbestand onvolledig: gegevens van "${'meldnummer' in r ? r.meldnummer : r.naam}" ontbreken.`);
  p.elementen = Array.isArray(d.elementen) ? d.elementen.filter((e: any) => e && e.type && Number.isFinite(e.x) && Number.isFinite(e.y)) : [];
  p.routes = Array.isArray(d.routes) ? d.routes.filter((r: any) => r && r.voertuig && Array.isArray(r.legs)) : [];
  p.kranen = Array.isArray(d.kranen) ? d.kranen.filter((k: any) => k && (k.type === 'toren' || k.type === 'mobiel') && Number.isFinite(k.x) && Number.isFinite(k.y)) : [];
  p.fases = Array.isArray(d.fases) ? d.fases.filter((f: any) => f && typeof f.id === 'string') : undefined;
  p.opgeslagen = d.opgeslagen;
  return p;
}

type Listener = (p: ProjectData, reden: string) => void;

export class ProjectStore {
  private undoStack: { snap: string; label: string }[] = [];
  private redoStack: { snap: string; label: string }[] = [];
  private listeners: Listener[] = [];
  dirty = false;

  constructor(public data: ProjectData, private readonly maxUndo = 200) {}

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }

  private emit(reden: string) {
    for (const l of this.listeners) l(this.data, reden);
  }

  private snapshot(): string {
    const { weergave, bijlagen, ...rest } = this.data;
    return JSON.stringify(rest);
  }

  private restore(snap: string) {
    const { weergave, bijlagen } = this.data;
    this.data = { ...JSON.parse(snap), weergave, bijlagen };
  }

  /** Voeg grote importdata toe (buiten undo om); gebruik daarna change() om ernaar te verwijzen. */
  addBijlage(id: string, data: KlicData | DxfData) {
    this.data.bijlagen[id] = data;
  }

  /** Voer een wijziging uit die ongedaan gemaakt kan worden. */
  change(label: string, fn: (d: ProjectData) => void) {
    this.undoStack.push({ snap: this.snapshot(), label });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
    fn(this.data);
    this.dirty = true;
    this.emit(label);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label; }
  redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label; }

  undo(): string | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push({ snap: this.snapshot(), label: s.label });
    this.restore(s.snap);
    this.dirty = true;
    this.emit(`Ongedaan: ${s.label}`);
    return s.label;
  }

  redo(): string | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push({ snap: this.snapshot(), label: s.label });
    this.restore(s.snap);
    this.dirty = true;
    this.emit(`Opnieuw: ${s.label}`);
    return s.label;
  }

  /** Vervang het hele project (laden). Wist de undo-geschiedenis. */
  replace(p: ProjectData) {
    this.data = p;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('Project geladen');
  }

  /** Alleen bijlagen waarnaar nog verwezen wordt. */
  private usedBijlagen(): Record<string, KlicData | DxfData> {
    const ids = new Set([...this.data.klic.map((k) => k.id), ...this.data.onderleggers.map((o) => o.id)]);
    return Object.fromEntries(Object.entries(this.data.bijlagen).filter(([k]) => ids.has(k)));
  }

  serialize(pretty = true): string {
    this.data.opgeslagen = new Date().toISOString();
    return JSON.stringify({ ...this.data, bijlagen: this.usedBijlagen() }, null, pretty ? 2 : 0);
  }
}
