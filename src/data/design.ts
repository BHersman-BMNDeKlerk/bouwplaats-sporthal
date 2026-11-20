import type { DesignModelFile, SourceInfo } from './types';

/** Categorieën van een ontwerpmodel met label en kleur. */
export const DESIGN_CATEGORIES: Record<string, { label: string; kleur: string; standaardAan: boolean }> = {
  wanden: { label: 'Wanden', kleur: '#d9c7a7', standaardAan: true },
  vloeren: { label: 'Vloeren, daken, afwerking', kleur: '#b9b2a6', standaardAan: true },
  constructie: { label: 'Kolommen en liggers', kleur: '#8c8f96', standaardAan: true },
  kozijnen: { label: 'Kozijnen (ramen, deuren)', kleur: '#6fa3c7', standaardAan: true },
  onderdelen: { label: 'Samengestelde onderdelen', kleur: '#cdbb98', standaardAan: true },
  overig: { label: 'Overige elementen', kleur: '#a59a8a', standaardAan: true },
  installaties: { label: 'Installaties / PV-panelen', kleur: '#3d4f7a', standaardAan: true },
  fundering: { label: 'Fundering', kleur: '#7d7466', standaardAan: false },
};

/** Bronvermelding voor het manifest. */
export function designSource(j: DesignModelFile): SourceInfo {
  return {
    id: 'ontwerp',
    naam: `Ontwerpmodel (IFC) – ${j.project || j.bestand}`,
    herkomst: `${j.auteur || 'onbekend'} · ${j.applicatie} · ${j.schema}`,
    endpoint: j.bestand,
    opgehaald: j.geimporteerd,
    versie: `modeldatum ${j.datum}`,
    nauwkeurigheid: `Geometrie zoals gemodelleerd door de ontwerper. Plaatsing: ${j.plaatsingMethode}${
      j.plaatsingKwaliteit ? ` (gem. afwijking contour ↔ bestaand pand ${(j.plaatsingKwaliteit.gemAfwijking * 100).toFixed(0)} cm)` : ''
    }. De plaatsing is in de app aan te passen; controleer met de maatvoering op tekening.`,
    licentie: 'Eigendom ontwerper – niet openbaar verspreiden',
    status: 'ok',
  };
}
