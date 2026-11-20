/**
 * Projectbestand (één JSON) met alle eigen invoer: handmatige overschrijvingen
 * en (in latere fases) geplaatste elementen, routes en kraanopstellingen.
 * Inclusief undo/redo op basis van snapshots.
 */
import type { HeightOverride } from '../data/heights';
import type { Placement } from '../data/ifcGeom';

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
  /** Laagzichtbaarheid en camera (geen onderdeel van undo). */
  weergave?: { lagen?: Record<string, boolean | number | string>; camera?: number[] };
  /** Gereserveerd voor latere fases. */
  elementen?: unknown[];
  routes?: unknown[];
  kranen?: unknown[];
}

export function emptyProject(naam: string): ProjectData {
  return {
    app: 'bouwplaats-sporthal',
    versie: 1,
    project: { naam, nummer: '', getekendDoor: '' },
    overschrijvingen: { gebouwen: {}, bomen: {}, obstakels: {} },
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
  p.elementen = d.elementen ?? [];
  p.routes = d.routes ?? [];
  p.kranen = d.kranen ?? [];
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
    const { weergave, ...rest } = this.data;
    return JSON.stringify(rest);
  }

  private restore(snap: string) {
    const weergave = this.data.weergave;
    this.data = { ...JSON.parse(snap), weergave };
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

  serialize(): string {
    this.data.opgeslagen = new Date().toISOString();
    return JSON.stringify(this.data, null, 2);
  }
}
