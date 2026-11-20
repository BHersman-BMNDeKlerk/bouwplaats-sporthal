/** Fase 4: paneel van een route (voertuig, routedelen, afspelen, botsingen). */
import { h, parseNum } from './dom';
import type { ProjectStore } from '../core/project';
import { VEHICLES, turningCircles, totalLength, type VehicleSpec } from '../vehicles/vehicles';
import { DISCLAIMER, type Route, type RouteResult } from '../vehicles/routes';
import type { Sample } from '../vehicles/kinematics';
import { MAX_AFWIJKING } from '../vehicles/kinematics';

const f = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const degS = (r: number) => `${f((r * 180) / Math.PI, 1)}°`;

export interface RoutePanelActions {
  addLeg: (richting: 'vooruit' | 'achteruit') => void;
  removeLastLeg: () => void;
  remove: () => void;
  setPos: (s: number) => void;
  togglePlay: () => boolean;
  playing: () => boolean;
  debug: boolean;
  setDebug: (on: boolean) => void;
  focus: (x: number, y: number) => void;
  replan: (marge: number, achteruit: boolean, kronen?: boolean) => void;
}

type NumKey = Exclude<{ [K in keyof VehicleSpec]-?: NonNullable<VehicleSpec[K]> extends number ? K : never }[keyof VehicleSpec], undefined>;
const FIELDS: { k: NumKey; label: string; oplegger?: boolean; hint?: string }[] = [
  { k: 'wielbasis', label: 'Wielbasis (m)', hint: 'vooras – (midden) achteras' },
  { k: 'overhangVoor', label: 'Overhang voor (m)' },
  { k: 'overhangAchter', label: 'Overhang achter (m)' },
  { k: 'breedte', label: 'Breedte (m)' },
  { k: 'hoogte', label: 'Hoogte (m)' },
  { k: 'spoorbreedte', label: 'Spoorbreedte voor (m)' },
  { k: 'maxStuurhoek', label: 'Max. stuurhoek (°)' },
  { k: 'draaicirkelStoep', label: 'Draaicirkel stoep-stoep (m, ⌀)', hint: 'fabrikantopgave; overschrijft de max. stuurhoek' },
  { k: 'maxStuursnelheid', label: 'Stuursnelheid (°/s)' },
  { k: 'snelheid', label: 'Manoeuvresnelheid (km/h)' },
  { k: 'koppelpunt', label: 'Koppelpunt vóór achteras (m)', oplegger: true },
  { k: 'opleggerWielbasis', label: 'Wielbasis oplegger (m)', oplegger: true, hint: 'kingpin – midden asgroep' },
  { k: 'opleggerOverhangVoor', label: 'Oplegger voor kingpin (m)', oplegger: true },
  { k: 'opleggerOverhangAchter', label: 'Oplegger overhang achter (m)', oplegger: true },
  { k: 'opleggerBreedte', label: 'Breedte oplegger (m)', oplegger: true },
  { k: 'maxKnikhoek', label: 'Max. knikhoek (°)', oplegger: true },
];

export function routePanel(store: ProjectStore, r: Route, res: RouteResult, pos: number, act: RoutePanelActions): { nodes: (Node | null)[]; update: (s: Sample | null, pos: number) => void } {
  const v = r.voertuig;
  const sim = res.sim;
  const flags = sim.flags.filter((q) => q.soort !== 'stuursnelheid' || !sim.flags.some((z) => z.soort === 'afwijking'));
  const status = !r.legs.length
    ? h('div', { class: 'note', style: { marginLeft: 0 } }, 'Nog geen route: voeg een deel toe.')
    : !sim.uitvoerbaar
      ? h('div', { class: 'note warn', style: { marginLeft: 0, background: '#fdecea', color: '#b71c1c' } }, h('b', {}, '✖ Niet uitvoerbaar'),
        ` – max. afwijking ${f(sim.maxAfwijking)} m (grens ${f(MAX_AFWIJKING)} m)${v.soort === 'oplegger' ? `, max. knikhoek ${degS(sim.maxKnik)}` : ''}.`)
      : h('div', { class: 'note', style: { marginLeft: 0, color: '#1b5e20' } }, `✔ Uitvoerbaar – afwijking max. ${f(sim.maxAfwijking)} m${v.soort === 'oplegger' ? `, knikhoek max. ${degS(sim.maxKnik)}` : ''}.`);

  const jump = (s: number, x: number, y: number) => h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); act.setPos(s); act.focus(x, y); } }, `bij ${f(s, 1)} m`);
  const meldingen = flags.length ? h('ul', { class: 'conflictlist' }, ...flags.map((q) => h('li', { style: { color: q.soort === 'stuurhoek' || q.soort === 'stuursnelheid' ? '#b45309' : '#b71c1c' } }, `${q.tekst} (deel ${q.leg + 1}) `, jump(q.s, q.x, q.y)))) : null;
  const kinds: Record<string, string> = { gebouw: 'gebouw', 'nieuw pand': 'nieuw pand', element: 'element', boom: 'boom', paal: 'paal/obstakel', paaltjes: 'paaltjes', hekwerk: 'bouwhek', doorrijhoogte: 'te lage doorrijhoogte', 'niet berijdbaar': 'wiel in niet-berijdbaar vlak', stoep: 'wiel over' };
  const botsingen = res.conflicts.length
    ? h('div', { class: 'note warn', style: { marginLeft: 0, background: '#fdecea', color: '#b71c1c' } }, h('b', {}, `⚠ ${res.conflicts.length} botsing(en) / aandachtspunt(en)`),
      h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, ...res.conflicts.map((c) => h('li', {}, `${kinds[c.soort] ?? c.soort}: ${c.naam} `, jump(c.s, c.x, c.y)))))
    : r.legs.length ? h('div', { class: 'note', style: { marginLeft: 0, color: '#1b5e20' } }, '✔ Geen botsingen met gebouwen, elementen, bomen, obstakels of hekken') : null;

  // voertuig
  const sel = h('select', {}, ...VEHICLES.map((q) => h('option', { value: q.id, selected: q.id === v.id }, q.naam)), v.id && !VEHICLES.some((q) => q.id === v.id) ? h('option', { value: v.id, selected: true }, v.naam) : null);
  sel.onchange = () => {
    const nv = VEHICLES.find((q) => q.id === sel.value);
    if (nv) {
      store.change('Voertuig gewijzigd', (d) => { const x = d.routes.find((q) => q.id === r.id); if (x) { x.voertuig = { ...nv }; if (x.naam.startsWith(v.naam)) x.naam = x.naam.replace(v.naam, nv.naam); if (x.plan) x.pad = undefined; } });
      if (r.plan) act.replan(r.plan.marge, r.plan.achteruit);
    }
  };
  const iNaam = h('input', { type: 'text', value: r.naam });
  const inputs = new Map<NumKey, HTMLInputElement>();
  const rows = FIELDS.filter((q) => !q.oplegger || v.soort === 'oplegger').map((q) => {
    const val = v[q.k] as number | undefined;
    const i = h('input', { type: 'text', value: val == null ? '' : String(val).replace('.', ','), placeholder: q.k === 'draaicirkelStoep' ? 'n.v.t.' : '' });
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    inputs.set(q.k, i);
    return h('div', { class: 'frow' }, q.label, i, q.hint ? h('div', { class: 'hint' }, q.hint) : null);
  });
  const msg = h('div', { class: 'note', style: { marginLeft: 0 } });
  const save = () => {
    const nv: VehicleSpec = { ...v };
    for (const [k, i] of inputs) {
      const n = parseNum(i.value);
      if (n == null && k === 'draaicirkelStoep') { delete nv.draaicirkelStoep; continue; }
      if (n == null || Number.isNaN(n) || n < 0) { msg.textContent = 'Ongeldige waarde bij ' + FIELDS.find((q) => q.k === k)!.label; return; }
      (nv as any)[k] = n;
    }
    if (nv.wielbasis <= 0.5 || nv.maxStuurhoek <= 1 || nv.maxStuurhoek >= 80) { msg.textContent = 'Wielbasis of stuurhoek buiten bereik.'; return; }
    store.change('Voertuig aangepast', (d) => { const x = d.routes.find((q) => q.id === r.id); if (x) { x.voertuig = nv; x.naam = iNaam.value.trim() || x.naam; if (x.plan) x.pad = undefined; } });
    if (r.plan) act.replan(r.plan.marge, r.plan.achteruit);
  };
  const tc = turningCircles(v);
  const spec = h('div', { class: 'note', style: { marginLeft: 0 } },
    `Lengte ${f(totalLength(v))} m · draaicirkel stoep-stoep ⌀ ${f(tc.stoep)} m · muur-muur ⌀ ${f(tc.muur)} m · stuurhoek ${f(tc.stuurhoek, 1)}°`,
    v.draaicirkelMuur ? ` (opgave muur-muur ⌀ ${f(v.draaicirkelMuur)} m${Math.abs(v.draaicirkelMuur - tc.muur) > 0.3 ? ' – wijkt af, controleer de maten' : ''})` : '',
    v.opmerking ? h('div', {}, v.opmerking) : null);

  // routedelen
  const legs = h('table', {},
    h('tr', {}, h('th', {}, 'Deel'), h('th', {}, 'Richting'), h('th', { style: { textAlign: 'right' } }, 'lengte')),
    ...r.legs.map((l, i) => {
      let len = 0;
      for (let k = 1; k < l.punten.length; k++) len += Math.hypot(l.punten[k][0] - l.punten[k - 1][0], l.punten[k][1] - l.punten[k - 1][1]);
      return h('tr', {}, h('td', {}, String(i + 1)), h('td', { style: { color: l.richting === 'vooruit' ? '#1565c0' : '#7b1fa2' } }, l.richting === 'vooruit' ? '▶ vooruit' : '◀ achteruit'), h('td', { class: 'num' }, `${f(len, 1)} m`));
    }));

  // afspelen
  const total = sim.lengte;
  const slider = h('input', { type: 'range', min: '0', max: String(Math.max(0.01, total)), step: '0.05', value: String(pos), style: { width: '100%' } }) as HTMLInputElement;
  slider.oninput = () => act.setPos(Number(slider.value));
  const readout = h('div', { class: 'kv', style: { fontVariantNumeric: 'tabular-nums' } });
  const play = h('button', { onclick: () => { play.textContent = act.togglePlay() ? '⏸ Pauze' : '▶ Afspelen'; } }, act.playing() ? '⏸ Pauze' : '▶ Afspelen');
  const spook = h('select', {}, ...[0, 2, 5, 10].map((n) => h('option', { value: String(n), selected: n === r.spook }, n ? `elke ${n} m` : 'uit')));
  spook.onchange = () => store.change('Spookbeelden', (d) => { const x = d.routes.find((q) => q.id === r.id); if (x) x.spook = Number(spook.value); });
  const dbg = h('input', { type: 'checkbox', checked: act.debug, onchange: () => act.setDebug(dbg.checked) }) as HTMLInputElement;

  const update = (s: Sample | null, p: number) => {
    slider.value = String(p);
    if (!s) { readout.textContent = ''; return; }
    const knik = v.soort === 'oplegger' ? ` · knik ${degS(Math.atan2(Math.sin(s.theta - s.phi), Math.cos(s.theta - s.phi)))}` : '';
    readout.textContent = `${f(p, 1)} / ${f(total, 1)} m · deel ${s.leg + 1} · stuurhoek ${degS(s.delta)}${knik} · afwijking ${f(s.afwijking)} m${s.stuurGrens ? ' · max. uitslag' : ''}`;
  };

  let planBox: Node | null = null;
  if (r.plan) {
    const iM = h('input', { type: 'text', value: String(r.plan.marge).replace('.', ','), style: { width: '70px' } }) as HTMLInputElement;
    iM.addEventListener('keydown', (ev) => ev.stopPropagation());
    const cA = h('input', { type: 'checkbox', checked: r.plan.achteruit }) as HTMLInputElement;
    const cK = h('input', { type: 'checkbox', checked: r.plan.kronen !== false }) as HTMLInputElement;
    planBox = h('fieldset', {}, h('legend', {}, '⚡ Automatisch gepland'),
      h('div', { class: 'note', style: { marginLeft: 0 } }, r.plan.info ?? ''),
      h('div', { class: 'frow' }, 'Vrije ruimte rondom (m)', iM),
      h('label', { class: 'lrow' }, cA, 'Achteruitrijden (steken) toestaan'),
      h('label', { class: 'lrow' }, cK, 'Lage boomkronen als obstakel (uit = alleen stammen, snoeien)'),
      h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => { const m = parseNum(iM.value); act.replan(m != null && !Number.isNaN(m) && m >= 0 ? m : r.plan!.marge, cA.checked, cK.checked); } }, '⚡ Opnieuw plannen')),
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Start (S) en eind (E) staan op de kaart. Na het verplaatsen van elementen, hekken of kranen: opnieuw plannen. Zelf een deel toevoegen maakt er een getekende route van.'));
  }
  const nodes = [
    status, meldingen, botsingen, planBox,
    h('fieldset', {}, h('legend', {}, 'Route'),
      legs,
      h('div', { class: 'btnrow' },
        h('button', { class: 'primary', onclick: () => act.addLeg('vooruit'), title: 'Teken een deel vooruit; de vooras volgt de lijn' }, '+ Vooruit'),
        h('button', { class: 'primary', onclick: () => act.addLeg('achteruit'), title: 'Teken een deel achteruit; de achteras (bij oplegger: de opleggeras) volgt de lijn' }, '+ Achteruit'),
        r.legs.length ? h('button', { onclick: act.removeLastLeg }, 'Laatste deel weg') : null),
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Vooruit volgt de vooras de lijn (zoals de chauffeur stuurt); achteruit volgt de achteras, bij een oplegger de as van de oplegger. Een nieuw deel begint waar het voertuig nu staat.')),
    h('fieldset', {}, h('legend', {}, 'Afspelen'),
      slider, readout,
      h('div', { class: 'btnrow' }, play),
      h('div', { class: 'frow' }, 'Spookbeelden', spook),
      h('label', { class: 'lrow' }, dbg, 'Debug: stuurhoek, draaipool, knikhoek')),
    h('fieldset', {}, h('legend', {}, 'Voertuig'),
      h('div', { class: 'frow' }, 'Naam route', iNaam),
      h('div', { class: 'frow' }, 'Type', sel),
      spec,
      h('details', {}, h('summary', { style: { cursor: 'pointer', fontSize: '13px' } }, 'Afmetingen en besturing bewerken'),
        ...rows,
        h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: save }, 'Toepassen')), msg)),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { if (confirm(`Route "${r.naam}" verwijderen?`)) act.remove(); } }, 'Route verwijderen')),
    h('div', { class: 'note', style: { marginLeft: 0, fontStyle: 'italic' } }, DISCLAIMER),
  ];
  return { nodes, update };
}
