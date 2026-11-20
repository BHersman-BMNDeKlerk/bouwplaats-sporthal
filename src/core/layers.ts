/** Laagzichtbaarheid en weergave-instellingen (persisteert in het projectbestand). */
import { CLASS_STYLES } from '../data/bgt';

export type SporthalMode = 'normaal' | 'transparant' | 'verborgen';

export interface LayerState {
  luchtfoto: boolean;
  bgt: boolean;
  bgtDekking: number;
  bgtKlassen: Record<string, boolean>;
  relief: boolean;
  hoogtekleur: boolean;
  gebouwen: boolean;
  gebouwKleurHoogte: boolean;
  sporthal: SporthalMode;
  percelen: boolean;
  perceelnummers: boolean;
  bomen: boolean;
  obstakels: Record<string, boolean>;
  projectgebied: boolean;
}

export const OBSTACLE_CATEGORIES = ['Palen & masten', 'Borden', 'Kasten', 'Straatmeubilair', 'Overig'] as const;

export function defaultLayers(): LayerState {
  const bgtKlassen: Record<string, boolean> = {};
  for (const [k, s] of Object.entries(CLASS_STYLES)) bgtKlassen[k] = s.standaardAan;
  return {
    luchtfoto: true,
    bgt: true,
    bgtDekking: 0.45,
    bgtKlassen,
    relief: false,
    hoogtekleur: false,
    gebouwen: true,
    gebouwKleurHoogte: false,
    sporthal: 'normaal',
    percelen: true,
    perceelnummers: true,
    bomen: true,
    obstakels: Object.fromEntries(OBSTACLE_CATEGORIES.map((c) => [c, true])),
    projectgebied: true,
  };
}

/** Voeg opgeslagen instellingen samen met de standaard (nieuwe sleutels blijven standaard). */
export function mergeLayers(saved: any): LayerState {
  const d = defaultLayers();
  if (!saved || typeof saved !== 'object') return d;
  const out: any = { ...d };
  for (const k of Object.keys(d) as (keyof LayerState)[]) {
    const v = saved[k];
    if (v == null) continue;
    if (typeof d[k] === 'object') out[k] = { ...(d[k] as object), ...v };
    else if (typeof v === typeof d[k]) out[k] = v;
  }
  return out;
}
