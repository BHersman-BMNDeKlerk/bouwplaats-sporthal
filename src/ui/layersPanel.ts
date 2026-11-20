/** Lagenpaneel: aan/uit per laag en weergave-instellingen. */
import { OBSTACLE_CATEGORIES, type LayerState, type SporthalMode } from '../core/layers';
import { CLASS_STYLES } from '../data/bgt';
import type { LoadedData } from '../data/loader';
import { HEIGHT_STOPS } from '../scene/buildingsLayer';
import { HYPSO_STOPS } from '../scene/terrainLayer';
import { TREE_COLORS } from '../scene/treesLayer';
import { h } from './dom';
import type { ProjectData } from '../core/project';
import type { ActiveBoundary } from '../core/boundary';
import { PUNT_SOORTEN, type PuntSoort } from '../data/csvPoints';
import { KLIC_KLEUREN_GEVERIFIEERD, themaStyle, type KlicData } from '../data/klic';
import { MANUAL_STYLE, soortVan } from '../scene/overlays';

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
  /** Fase 2 */
  project: ProjectData;
  boundary: ActiveBoundary;
  onRefVisible: (kind: 'klic' | 'dxf', id: string, v: boolean) => void;
  onPlattegrond?: (on: boolean) => void;
  onOpen: (what: { kind: 'klicRef' | 'dxf'; id: string } | { kind: 'grens' } | { kind: 'codes' }) => void;
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
    root.append(check('Nieuw pand (grijs blok)', () => L.ontwerp, (v) => (L.ontwerp = v), 'scene', { swatch: swatch('#a9a9a9') }));
    root.append(check('Buitencontour op maaiveld', () => L.ontwerpContour, (v) => (L.ontwerpContour = v), 'terrain', { swatch: swatch(undefined, '#7b1fa2') }));
    root.append(check('Transparant', () => L.ontwerpTransparant, (v) => (L.ontwerpTransparant = v), 'scene', { sub: true }));
    root.append(h('div', { class: 'note' }, `${dm.project || dm.bestand} · ${dm.auteur} · ${dm.datum.slice(0, 10)}`));
    root.append(h('div', { class: 'note' },
      o.designPlacementIsAuto ? 'Ligging automatisch uitgelijnd op het bestaande pand; peil 0 P volgens opgave. ' : 'Plaatsing handmatig ingesteld. ',
      h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); o.onDesignPlacement?.(); } }, 'Plaatsing bekijken / aanpassen')));
  }

  // --- Plattegrond
  root.append(h('h2', {}, 'Weergave'));
  const segP = h('div', { class: 'seg', style: { marginLeft: 0 } });
  for (const [v, label] of [[false, 'Luchtfoto / 3D'], [true, 'Plattegrond (kadaster)']] as [boolean, string][])
    segP.append(h('button', { class: L.plattegrond === v ? 'on' : '', onclick: () => { L.plattegrond = v; o.onPlattegrond?.(v); changed('all')(); } }, label));
  root.append(segP);
  if (L.plattegrond) root.append(h('div', { class: 'note', style: { marginLeft: 0 } }, 'Plattegrond op basis van de kadasterkaart: perceelgrenzen met perceelnummers, gebouwomtrekken, straatnamen en huisnummers (sneltoets K). Eigen invoer, KLIC en het nieuwe pand blijven zichtbaar.'));

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
    if (!o.presentClasses.has(k) || k === 'pand_bgt') continue;
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
  root.append(check('Contouren op maaiveld (BGT/BAG)', () => L.bgtKlassen.pand_bgt, (v) => (L.bgtKlassen.pand_bgt = v), 'terrain', { sub: true, swatch: swatch(undefined, '#ffd600') }));
  root.append(h('div', { class: 'note' }, 'De luchtfoto is geen true-ortho: daken van hoge panden staan op de foto 1–3 m verschoven t.o.v. de gele contour. Gebruik 2D (T) om modellen zonder perspectief te bekijken.'));
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

  // --- Perceelgrens en inmeting
  const P = o.project;
  const link = (txt: string, fn: () => void) => h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); fn(); } }, txt);
  root.append(h('h2', {}, 'Perceelgrens en inmeting'));
  root.append(h('div', { class: o.boundary.bron === 'ingemeten' ? 'note' : 'note warn', style: o.boundary.bron === 'ingemeten' ? { marginLeft: 0, color: '#1b5e20' } : {} },
    o.boundary.bron === 'ingemeten' ? `✔ ${o.boundary.omschrijving} – heeft voorrang bij alle controles. ` : `⚠ ${o.boundary.waarschuwing} Gebruikt: ${o.boundary.omschrijving}. `,
    link(o.boundary.bron === 'ingemeten' ? 'Beheren' : 'Uitleg', () => o.onOpen({ kind: 'grens' }))));
  if (P.inmeting.grens) {
    root.append(check(`Ingemeten grens (${P.inmeting.grens.punten.length} punten)`, () => L.grens, (v) => (L.grens = v), 'all', { swatch: swatch(undefined, '#e65100') }));
    root.append(check('Maten langs de grens', () => L.grensMaten, (v) => (L.grensMaten = v), 'terrain', { sub: true }));
  } else {
    root.append(check('Eigen perceel (BRK) markeren', () => L.eigenPerceel, (v) => (L.eigenPerceel = v), 'terrain', { swatch: swatch(undefined, '#c2185b') }));
  }
  const mp = P.inmeting.punten;
  if (mp) {
    const counts: Partial<Record<PuntSoort, number>> = {};
    for (const pt of mp.punten) { const so = soortVan(P, pt); counts[so] = (counts[so] ?? 0) + 1; }
    root.append(h('div', { class: 'note', style: { marginLeft: 0 } }, `Meetpunten: ${mp.bestand} (${mp.punten.length}) · `, link('codes', () => o.onOpen({ kind: 'codes' }))));
    for (const so of Object.keys(PUNT_SOORTEN) as PuntSoort[]) {
      if (so === 'negeren' || !counts[so]) continue;
      root.append(check(`${PUNT_SOORTEN[so].label} (${counts[so]})`, () => L.meetpunten[so] !== false, (v) => (L.meetpunten[so] = v), 'all', { sub: true, swatch: swatch(PUNT_SOORTEN[so].kleur) }));
    }
    root.append(check('Puntnummers en codes', () => L.meetpuntLabels, (v) => (L.meetpuntLabels = v), 'terrain', { sub: true }));
  }

  // --- KLIC
  if (P.klic.length) {
    root.append(h('h2', {}, 'Kabels en leidingen (KLIC)'));
    const themaCount = new Map<string, number>();
    for (const ref of P.klic) {
      root.append(h('div', { class: 'lrow' },
        h('input', { type: 'checkbox', checked: ref.zichtbaar, onchange: (e: Event) => o.onRefVisible('klic', ref.id, (e.target as HTMLInputElement).checked) }),
        h('span', {}, `Melding ${ref.meldnummer || ref.bestand} `, link('details', () => o.onOpen({ kind: 'klicRef', id: ref.id })))));
      const k = P.bijlagen[ref.id] as KlicData | undefined;
      if (k && ref.zichtbaar) for (const [t, n] of Object.entries(k.themas)) themaCount.set(t, (themaCount.get(t) ?? 0) + n);
    }
    for (const [t, n] of [...themaCount].sort((a, b) => b[1] - a[1])) {
      const st = themaStyle(t);
      root.append(check(`${st.label} (${n})`, () => L.klicThemas[t] !== false, (v) => (L.klicThemas[t] = v), 'terrain', { sub: true, swatch: h('span', { class: 'swatch line', style: { background: st.kleur, height: '5px' } }) }));
    }
    root.append(check('Diepte-aanduidingen', () => L.klicDiepte, (v) => (L.klicDiepte = v), 'terrain', { sub: true }));
    root.append(check('EV-vlakken (eis voorzorgsmaatregel)', () => L.klicEv, (v) => (L.klicEv = v), 'terrain', { sub: true }));
    root.append(check('Annotaties', () => L.klicAnnotatie, (v) => (L.klicAnnotatie = v), 'terrain', { sub: true }));
    root.append(check('Maatvoering', () => L.klicMaatvoering, (v) => (L.klicMaatvoering = v), 'terrain', { sub: true }));
    root.append(check('Appendages (moffen, kasten, …)', () => L.klicPunten, (v) => (L.klicPunten = v), 'terrain', { sub: true }));
    root.append(check('Graafpolygoon', () => L.klicGraafpolygoon, (v) => (L.klicGraafpolygoon = v), 'terrain', { sub: true }));
    if (!KLIC_KLEUREN_GEVERIFIEERD) root.append(h('div', { class: 'note' }, 'Kleuren volgens de KLIC-kleurconventie; nog niet alle RGB-waarden gecontroleerd tegen de officiële handreiking.'));
  }

  // --- Onderleggers
  if (P.onderleggers.length) {
    root.append(h('h2', {}, 'Onderleggers (DXF)'));
    for (const ref of P.onderleggers)
      root.append(h('div', { class: 'lrow' },
        h('input', { type: 'checkbox', checked: ref.zichtbaar, onchange: (e: Event) => o.onRefVisible('dxf', ref.id, (e.target as HTMLInputElement).checked) }),
        h('span', { class: 'swatch line', style: { background: ref.kleur, height: '4px' } }),
        h('span', {}, `${ref.naam} `, link('instellingen', () => o.onOpen({ kind: 'dxf', id: ref.id })))));
  }

  // --- Eigen obstakels
  if (P.handmatig.length) {
    root.append(h('h2', {}, 'Eigen obstakels'));
    const cnt: Record<string, number> = {};
    for (const m of P.handmatig) cnt[m.soort] = (cnt[m.soort] ?? 0) + 1;
    for (const [k, st] of Object.entries(MANUAL_STYLE))
      if (cnt[k]) root.append(check(`${st.label} (${cnt[k]})`, () => L.handmatig[k] !== false, (v) => (L.handmatig[k] = v), 'all', { swatch: swatch(st.kleur) }));
  }

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
  makeCollapsible(root);
}

const COLLAPSE_KEY = 'bouwplaats-sporthal:lagen-dicht';

/** Kopjes (h2) klikbaar maken: secties in- en uitklappen; de stand wordt onthouden. */
function makeCollapsible(root: HTMLElement) {
  let closed: string[] = [];
  try { closed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'); } catch { /* */ }
  const kids = [...root.children];
  let body: HTMLElement | null = null;
  for (const el of kids) {
    if (el.tagName === 'H2') {
      const title = el.textContent ?? '';
      const h2 = el as HTMLElement;
      body = h('div', { class: 'lsec' });
      h2.after(body);
      h2.classList.add('collapsible');
      const isClosed = closed.includes(title);
      body.hidden = isClosed;
      h2.classList.toggle('closed', isClosed);
      const b = body;
      h2.onclick = () => {
        b.hidden = !b.hidden;
        h2.classList.toggle('closed', b.hidden);
        closed = b.hidden ? [...new Set([...closed, title])] : closed.filter((t) => t !== title);
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(closed)); } catch { /* */ }
      };
    } else if (body) body.append(el);
  }
  root.prepend(h('div', { class: 'lsec-tools' },
    h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); setAll(true); } }, 'alles inklappen'), ' · ',
    h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); setAll(false); } }, 'alles uitklappen')));
  function setAll(dicht: boolean) {
    const titles: string[] = [];
    for (const h2 of root.querySelectorAll('h2.collapsible')) {
      titles.push(h2.textContent ?? '');
      (h2.nextElementSibling as HTMLElement).hidden = dicht;
      h2.classList.toggle('closed', dicht);
    }
    closed = dicht ? titles : [];
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(closed)); } catch { /* */ }
  }
}
