/** Fase 5: paneel van een kraan (maten, lasttabel, controles, lastcontrole). */
import { h, parseNum } from './dom';
import type { ProjectStore } from '../core/project';
import { maxLoadAt, mobileRadius, mobileTipHeight, parseTable, reach, tableToText, type Crane, type CraneWarning, type LiftCheck } from '../cranes/cranes';

const f = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

export interface CranePanelActions {
  move: () => void;
  duplicate: () => void;
  remove: () => void;
  startLift: (last: number) => void;
  liftResult: LiftCheck | null;
  liftLast: number;
}

type Field = [key: string, label: string, hint?: string];
const TOREN: Field[] = [
  ['haakhoogte', 'Haakhoogte (m boven maaiveld)'],
  ['giekLengte', 'Gieklengte / max. radius (m)'],
  ['giekHoogte', 'Hoogte giekconstructie (m)', 'boven de haakhoogte'],
  ['contragiekLengte', 'Contragieklengte (m)'],
  ['contragiekHoogte', 'Hoogte onderkant contragiek (m)', 'boven maaiveld'],
  ['voetLengte', 'Voet / fundatie lengte (m)'],
  ['voetBreedte', 'Voet / fundatie breedte (m)'],
];
const MOBIEL: Field[] = [
  ['giekLengte', 'Gieklengte (m)'],
  ['giekHoek', 'Giekhoek (° t.o.v. horizontaal)'],
  ['scharnierHoogte', 'Hoogte giekscharnier (m)'],
  ['scharnierOffset', 'Scharnier t.o.v. draaipunt (m)', 'negatief = achter het draaipunt'],
  ['staartStraal', 'Staartdraaistraal (m)'],
  ['rotatie', 'Stand onderwagen (°)'],
  ['stempelLengte', 'Stempelbasis lengte (m, h.o.h.)'],
  ['stempelBreedte', 'Stempelbasis breedte (m, h.o.h.)'],
  ['plaat', 'Stempelplaat (m, vierkant)'],
  ['onderwagenLengte', 'Onderwagen lengte (m)'],
  ['onderwagenBreedte', 'Onderwagen breedte (m)'],
];

export function cranePanel(store: ProjectStore, k: Crane, warnings: CraneWarning[], overlap: string[], act: CranePanelActions): (Node | null)[] {
  const inputs = new Map<string, HTMLInputElement>();
  const inp = (key: string, val: number | string) => {
    const i = h('input', { type: 'text', value: typeof val === 'number' ? String(Math.round(val * 1000) / 1000).replace('.', ',') : val });
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    inputs.set(key, i);
    return i;
  };
  const msg = h('div', { class: 'note', style: { marginLeft: 0 } });
  const fields: Field[] = [['x', 'X (RD, m)'], ['y', 'Y (RD, m)'], ['richting', 'Giekrichting in tekening (°)'], ...(k.type === 'toren' ? TOREN : MOBIEL), ['ringInterval', 'Ringen elke … m']];
  const rows = fields.map(([key, label, hint]) => h('div', { class: 'frow' }, label, inp(key, (k as any)[key]), hint ? h('div', { class: 'hint' }, hint) : null));
  const iNaam = h('input', { type: 'text', value: k.naam });
  iNaam.addEventListener('keydown', (ev) => ev.stopPropagation());
  const ta = h('textarea', { rows: 9, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' } }, tableToText(k.lasttabel)) as HTMLTextAreaElement;
  ta.addEventListener('keydown', (ev) => ev.stopPropagation());
  const iBron = h('input', { type: 'text', value: k.tabelBron ?? '', placeholder: 'bv. Liebherr 172 EC-B, 50 m giek, 2-strengs' });
  iBron.addEventListener('keydown', (ev) => ev.stopPropagation());
  const save = () => {
    const vals: Record<string, number> = {};
    for (const [key, i] of inputs) {
      const n = parseNum(i.value);
      if (n == null || Number.isNaN(n)) { msg.textContent = `Ongeldige waarde: ${fields.find((q) => q[0] === key)?.[1]}`; return; }
      vals[key] = n;
    }
    for (const key of ['giekLengte', 'haakhoogte', 'stempelLengte', 'stempelBreedte', 'plaat', 'ringInterval'] as const)
      if (key in vals && vals[key] <= 0) { msg.textContent = 'Maten moeten groter dan 0 zijn.'; return; }
    if (k.type === 'mobiel' && (vals.giekHoek < 0 || vals.giekHoek > 89)) { msg.textContent = 'Giekhoek tussen 0 en 89°.'; return; }
    const t = parseTable(ta.value);
    if (t.fouten.length) { msg.textContent = `Lasttabel: ${t.fouten.slice(0, 3).join(', ')} niet gelezen.`; return; }
    if (t.tabel.length < 2) { msg.textContent = 'Lasttabel: minimaal twee regels (radius; last).'; return; }
    store.change(`${k.naam} aangepast`, (d) => {
      const x = d.kranen.find((q) => q.id === k.id);
      if (!x) return;
      Object.assign(x, vals, { naam: iNaam.value.trim() || x.naam, lasttabel: t.tabel, tabelBron: iBron.value.trim() || undefined });
      x.richting = ((x.richting % 360) + 360) % 360;
    });
  };

  const conflicts = warnings.filter((w) => w.ernst === 'conflict');
  const letop = warnings.filter((w) => w.ernst !== 'conflict');
  const r = reach(k);
  const info = k.type === 'toren'
    ? `Zwenkstraal ${f(k.giekLengte, 1)} m · contragiek ${f(k.contragiekLengte, 1)} m · lasttabel ${f(r.min, 1)}–${f(r.max, 1)} m`
    : `Radius bij ${f(k.giekHoek, 0)}°: ${f(mobileRadius(k), 1)} m (max. last ${(() => { const m = maxLoadAt(k.lasttabel, mobileRadius(k)); return m == null ? 'buiten tabel' : f(m) + ' t'; })()}) · giekkop ${f(mobileTipHeight(k), 1)} m · werkgebied tot ${f(r.max, 1)} m`;

  const iLast = h('input', { type: 'text', value: String(act.liftLast).replace('.', ','), style: { width: '80px' } });
  iLast.addEventListener('keydown', (ev) => ev.stopPropagation());
  const lr = act.liftResult;

  return [
    conflicts.length ? h('div', { class: 'note warn', style: { marginLeft: 0, background: '#fdecea', color: '#b71c1c' } }, h('b', {}, '⚠ Conflict'), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, ...conflicts.map((w) => h('li', {}, w.tekst)))) : null,
    letop.length || overlap.length ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, h('b', {}, 'Let op'), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, ...letop.map((w) => h('li', {}, w.tekst)), ...overlap.map((t) => h('li', {}, t)))) : null,
    !warnings.length && !overlap.length ? h('div', { class: 'note', style: { marginLeft: 0, color: '#1b5e20' } }, '✔ Geen overdraai of hoogteconflicten gevonden') : null,
    h('div', { class: 'note', style: { marginLeft: 0 } }, info),
    h('fieldset', {}, h('legend', {}, 'Kan last X op positie Y?'),
      h('div', { class: 'frow' }, 'Last (t, incl. hijsmiddelen)', iLast),
      h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => { const n = parseNum(iLast.value); if (n != null && !Number.isNaN(n) && n > 0) act.startLift(n); } }, '⌖ Klik een punt op de kaart')),
      lr ? h('div', { class: 'note', style: { marginLeft: 0, fontWeight: 600, color: lr.ok ? '#1b5e20' : '#b71c1c' } }, `${lr.ok ? '✔ OK' : '✖ NIET OK'} – ${lr.reden}`) : null),
    h('fieldset', {}, h('legend', {}, k.type === 'toren' ? 'Torenkraan' : 'Mobiele kraan'),
      h('div', { class: 'frow' }, 'Naam', iNaam), ...rows),
    h('fieldset', {}, h('legend', {}, 'Lasttabel (radius m ; last t)'),
      ta, h('div', { class: 'frow' }, 'Bron tabel', iBron),
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Eén regel per radius, bv. "25; 3,6". Plakken uit Excel kan ook. Tussen de punten wordt lineair geïnterpoleerd; buiten de tabel is het altijd NIET OK.'),
      /voorbeeld/i.test(k.tabelBron ?? '') ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, '⚠ Voorbeeldtabel – vervang door de lasttabel van de fabrikant voor de gekozen configuratie (giek, contragewicht, inscheren).') : null),
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: save }, 'Toepassen'),
      h('button', { onclick: act.move }, 'Verplaatsen'),
      h('button', { onclick: act.duplicate }, 'Dupliceren'),
      h('button', { onclick: () => { if (confirm(`${k.naam} verwijderen?`)) act.remove(); } }, 'Verwijderen')),
    msg,
    h('div', { class: 'note', style: { marginLeft: 0, fontStyle: 'italic' } }, 'Indicatief. De kraanopstelling, ondergrond (stempeldruk) en hijsplan altijd laten controleren door de kraanleverancier.'),
  ];
}
