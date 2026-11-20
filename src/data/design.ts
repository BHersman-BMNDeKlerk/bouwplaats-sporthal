import type { DesignModelFile, SourceInfo } from './types';

/** Bronvermelding voor het manifest. */
export function designSource(j: DesignModelFile): SourceInfo {
  return {
    id: 'ontwerp',
    naam: `Ontwerpmodel (IFC) – ${j.project || j.bestand}`,
    herkomst: `${j.auteur || 'onbekend'} · ${j.applicatie} · ${j.schema}`,
    endpoint: j.bestand,
    opgehaald: j.geimporteerd,
    versie: `modeldatum ${j.datum}`,
    nauwkeurigheid: `Alleen de buitenwerkse contour per hoogtezone (grijze blokken tot de hoogste dakrand, excl. installaties/PV). Plaatsing: ${j.plaatsingMethode}${
      j.plaatsingKwaliteit ? ` (gem. afwijking contour ↔ bestaand pand ${(j.plaatsingKwaliteit.gemAfwijking * 100).toFixed(0)} cm)` : ''
    }. De plaatsing is in de app aan te passen; controleer met de maatvoering op tekening.`,
    licentie: 'Afgeleid van het ontwerpmodel (eigendom ontwerper); alleen contour en hoogtes opgenomen',
    status: 'ok',
  };
}
