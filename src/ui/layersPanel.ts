/** Lagenpaneel: aan/uit per laag en weergave-instellingen. */
import { OBSTACLE_CATEGORIES, type LayerState, type SporthalMode } from '../core/layers';
import { CLASS_STYLES } from '../data/bgt';
import { DESIGN_CATEGORIES } from '../data/design';
import type { LoadedData } from '../data/loader';
import { HEIGHT_STOPS } from '../scene/buildingsLayer';
import { HYPSO_STOPS } from '../scene/terrainLayer';
import { TREE_COLORS } from '../scene/treesLayer';
import { h } from './dom';

export interface LayersPanelOpts {
  root: HTMLElement;
  data: LoadedData;
  state: LayerState;
  hypsoRange: { min: number; max: number };
  /** Welke BGT-klassen komen in de data voor (alleen die tonen). */
  presentClasses: Set<string>;
  obstacleCounts: Record<string, number>;
  onChange: (s: LayerState, what: 'terrain' | 'scene' | 'all') => void;
  /** Open het plaatsingsvenster van het ontwerpmodel. */
  onDesignPlacement?: () => void;
  designPlacementIsAuto?: boolean;
}

export function renderLayersPanel(o: LayersPanelOpts) {
  const { root, state: L, data } = o;
  const changed = (what: 'terrain' | 'scene' | 'all') => () => o.onChange(L, what);
  root.innerHTML = '';
  root.className = 'panel layers';

  const check = (label: Node | string, get: () => boolean, set: (v: boolean) => void, what: 'terrain' | 'scene' | 'all', opts: { sub?: boolean; swatch?: Node; disabled?: boolean } = {}) =>
    h('label', { class: `lrow${opts.sub ? ' sub' : ''}`, title: opts.disabled ? 'Niet beschikbaar in de data' : '' },
      h('input', { type: 'checkbox', checked: get(), disabled: !!opts.disabled, onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); changed(what)(); } }),
      opts.swatch ?? null,
      label,
    );
  const swatch = (fill?: string, stroke?: string) =>
    h('span', { class: `swatch${!fill ? ' line' : ''}`, style: { background: fill ?? stroke ?? '#999' } });
  const ramp = (stops: [number, string][], min: number, max: number) => {
    const span = stops[stops.length - 1][0] - stops[0][0];
    const grad = stops.map(([s, c]) => `${c} ${(((s - stops[0][0]) / span) * 100).toFixed(0)}%`).join(', ');
    return [h('div', { class: 'legend-ramp', style: { background: `linear-gradient(90deg, ${grad})` } }),
      h('div', { class: 'legend-scale' }, h('span', {}, min.toLocaleString('nl-NL')), h('span', {}, max.toLocaleString('nl-NL')))];
  };

  // --- Ontwerp (IFC)
  const dm = data.design?.model;
  if (dm) {
    root.append(h('h2', {}, 'Ontwerp (IFC)'));
    root.append(check(`Nieuw pand in 3D`, () => L.ontwerp, (v) => (L.ontwerp = v), 'scene', { swatch: swatch('#d9c7a7') }));
    root.append(check('Buitencontour op maaiveld', () => L.ontwerpContour, (v) => (L.ontwerpContour = v), 'terrain', { swatch: swatch(undefined, '#7b1fa2') }));
    root.append(check('Transparant', () => L.ontwerpTransparant, (v) => (L.ontwerpTransparant = v), 'scene', { sub: true }));
    const det = h('details', { class: 'sub' }, h('summary', {}, 'Onderdelen'));
    for (const c of dm.categorieen) {
      const st = DESIGN_CATEGORIES[c.id];
      if (!st) continue;
      det.append(check(`${st.label} (${c.objecten})`, () => L.ontwerpCategorieen[c.id] ?? st.standaardAan, (v) => (L.ontwerpCategorieen[c.id] = v), 'scene', { sub: true, swatch: swatch(st.kleur) }));
    }
    root.append(det);
    root.append(h('div', { class: 'note' }, `${dm.project || dm.bestand} · ${dm.auteur} · ${dm.datum.slice(0, 10)}`));
    root.append(h('div', { class: o.designPlacementIsAuto ? 'note warn' : 'note' },
      o.designPlacementIsAuto ? '⚠ Plaatsing automatisch uitgelijnd op het bestaande pand; peil is een aanname. ' : 'Plaatsing handmatig ingesteld. ',
      h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); o.onDesignPlacement?.(); } }, 'Plaatsing bekijken / aanpassen')));
  }

  // --- Ondergrond
  root.append(h('h2', {}, 'Ondergrond'));
  const ortho = data.ortho?.index;
  root.append(check(`Luchtfoto${ortho?.jaar ? ` ${ortho.jaar}` : ''}${ortho ? ` (${Math.round(ortho.res * 100)} cm)` : ''}`, () => L.luchtfoto, (v) => (L.luchtfoto = v), 'terrain', { disabled: !ortho }));
  root.append(check('Reliëfschaduw (AHN)', () => L.relief, (v) => (L.relief = v), 'terrain', { disabled: !data.terrain }));
  root.append(check('Maaiveld inkleuren op hoogte', () => L.hoogtekleur, (v) => (L.hoogtekleur = v), 'terrain', { disabled: !data.terrain }));
  if (L.hoogtekleur) root.append(...ramp(HYPSO_STOPS.map(([s, c]) => [s, c]), o.hypsoRange.min, o.hypsoRange.max), h('div', { class: 'note' }, 'm NAP · lichter = onder gebouw geïnterpoleerd'));

  // --- BGT
  root.append(h('h2', {}, 'BGT (topografie)'));
  root.append(check('BGT-vlakken en -lijnen', () => L.bgt, (v) => (L.bgt = v), 'terrain'));
  if (L.luchtfoto && ortho)
    root.append(h('div', { class: 'slider' }, 'Dekking',
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: String(L.bgtDekking), oninput: (e: Event) => { L.bgtDekking = Number((e.target as HTMLInputElement).value); changed('terrain')(); } })));
  const groups = new Map<string, string[]>();
  for (const [k, s] of Object.entries(CLASS_STYLES)) {
    if (!o.presentClasses.has(k)) continue;
    if (!groups.has(s.groep)) groups.set(s.groep, []);
    groups.get(s.groep)!.push(k);
  }
  for (const [g, keys] of groups) {
    const det = h('details', { class: 'sub', open: g === 'Verharding & wegen' }, h('summary', {}, g));
    for (const k of keys) {
      const s = CLASS_STYLES[k];
      det.append(check(s.label, () => L.bgtKlassen[k], (v) => (L.bgtKlassen[k] = v), 'terrain', { sub: true, swatch: swatch(s.fill, s.stroke) }));
    }
    root.append(det);
  }
  if (o.presentClasses.has('spoor'))
    root.append(h('div', { class: 'note warn' }, '⚠ Spoor (trein) in het gebied: bovenleiding staat niet in de BGT. Vrije hoogte ter plaatse controleren.'));

  // --- Gebouwen
  root.append(h('h2', {}, 'Gebouwen (3D BAG)'));
  root.append(check('Gebouwen in 3D', () => L.gebouwen, (v) => (L.gebouwen = v), 'scene', { disabled: !data.buildings }));
  root.append(check('Inkleuren op hoogte', () => L.gebouwKleurHoogte, (v) => (L.gebouwKleurHoogte = v), 'all', { sub: true }));
  if (L.gebouwKleurHoogte) root.append(...ramp(HEIGHT_STOPS, 0, 30), h('div', { class: 'note' }, 'Nokhoogte t.o.v. maaiveld (m)'));
  root.append(h('div', { class: 'note' }, 'Sporthal:'));
  const seg = h('div', { class: 'seg' });
  for (const [mode, label] of [['normaal', 'Normaal'], ['transparant', 'Transparant'], ['verborgen', 'Verborgen']] as [SporthalMode, string][])
    seg.append(h('button', { class: L.sporthal === mode ? 'on' : '', onclick: () => { L.sporthal = mode; changed('all')(); } }, label));
  root.append(seg);
  root.append(h('div', { class: 'note' }, h('span', { class: 'swatch', style: { display: 'inline-block', background: '#ff8f00', verticalAlign: 'middle', marginRight: '4px' } }), 'oranje rand = hoogte handmatig overschreven'));

  // --- Kadaster
  root.append(h('h2', {}, 'Kadaster (BRK)'));
  root.append(check('Perceelgrenzen', () => L.percelen, (v) => (L.percelen = v), 'terrain', { disabled: !data.percelen, swatch: swatch(undefined, '#c2185b') }));
  root.append(check('Perceelnummers', () => L.perceelnummers, (v) => (L.perceelnummers = v), 'terrain', { sub: true }));
  root.append(h('div', { class: 'note warn' }, '⚠ Indicatieve grens (BRK). Niet ingemeten – niet gebruiken voor uitzetten of grenscontrole.'));

  // --- Bomen & obstakels
  root.append(h('h2', {}, 'Bomen en obstakels'));
  root.append(check(`Bomen (${data.trees?.bomen.length ?? 0})`, () => L.bomen, (v) => (L.bomen = v), 'scene', { disabled: !data.trees }));
  root.append(
    h('div', { class: 'note' },
      h('span', { class: 'swatch', style: { display: 'inline-block', background: TREE_COLORS.gemeten, verticalAlign: 'middle' } }), ' BGT + AHN-hoogte  ',
      h('span', { class: 'swatch', style: { display: 'inline-block', background: TREE_COLORS.ahn, verticalAlign: 'middle' } }), ' alleen AHN  ',
      h('span', { class: 'swatch', style: { display: 'inline-block', background: TREE_COLORS.aanname, verticalAlign: 'middle' } }), ' hoogte = aanname'),
  );
  for (const c of OBSTACLE_CATEGORIES) {
    const n = o.obstacleCounts[c] ?? 0;
    if (!n) continue;
    root.append(check(`${c} (${n})`, () => L.obstakels[c], (v) => (L.obstakels[c] = v), 'scene'));
  }
  root.append(h('div', { class: 'note' }, 'Hoogtes van palen, borden en kasten zijn aannames (niet in BGT). Klik een object om aan te passen.'));

  // --- Overig
  root.append(h('h2', {}, 'Overig'));
  root.append(check('Projectgebied (opgegeven hoekpunten)', () => L.projectgebied, (v) => (L.projectgebied = v), 'terrain', { swatch: swatch(undefined, '#1565c0') }));
}
