/** Importvensters fase 2: ingemeten grens, meetpunten, KLIC, DXF. */
import { compareWithBrk, polylineLength } from '../core/boundary';
import type { CodeRule, DxfRef, KlicRef, ProjectStore } from '../core/project';
import { distanceWarning, guessSoort, parsePointsCsv, PUNT_SOORTEN, type CsvResult, type PuntSoort } from '../data/csvPoints';
import { looksLikeRD, parseDxf, type DxfData, type DxfPlacementMode } from '../data/dxf';
import type { Placement } from '../data/ifcGeom';
import { KLIC_KLEUREN_GEVERIFIEERD, parseKlicFile, themaStyle } from '../data/klic';
import { closeModal, openModal } from './dialogs';
import { h, parseNum } from './dom';

export interface ImportContext {
  store: ProjectStore;
  heightAt: (x: number, y: number) => number | null;
  /** Grenslijnen van het eigen BRK-perceel (voor vergelijking). */
  brkLines: () => number[][][];
  center: { x: number; y: number };
  ifcPlacement: () => Placement | null;
  status: (msg: string) => void;
}

const fmt = (v: number, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function warnList(w: string[]): Node | null {
  return w.length ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, h('ul', { style: { margin: 0, paddingLeft: '18px' } }, ...w.map((x) => h('li', {}, x)))) : null;
}

function pointsTable(r: CsvResult, max = 8): Node {
  return h('table', {},
    h('tr', {}, h('th', {}, 'Punt'), h('th', {}, 'X'), h('th', {}, 'Y'), h('th', {}, 'Z (NAP)'), h('th', {}, 'Code')),
    ...r.punten.slice(0, max).map((p) => h('tr', {}, h('td', {}, p.nr), h('td', {}, fmt(p.x, 3)), h('td', {}, fmt(p.y, 3)), h('td', {}, p.z != null ? fmt(p.z, 3) : '–'), h('td', {}, p.code ?? ''))),
    r.punten.length > max ? h('tr', {}, h('td', { colspan: 5 }, `… en nog ${r.punten.length - max} punten`)) : null,
  );
}

/** Gemiddeld verschil tussen ingemeten Z en AHN-maaiveld. */
function zCheck(ctx: ImportContext, r: CsvResult): string | null {
  const d = r.punten.filter((p) => p.z != null).map((p) => p.z! - (ctx.heightAt(p.x, p.y) ?? NaN)).filter(Number.isFinite);
  if (!d.length) return null;
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  return `Z t.o.v. AHN-maaiveld: gemiddeld ${mean >= 0 ? '+' : ''}${fmt(mean)} m (${d.length} punten).${Math.abs(mean) > 0.5 ? ' Let op: groot verschil – staan de hoogtes in NAP?' : ''}`;
}

// ---------------------------------------------------------------------------

export async function importBoundary(file: File, ctx: ImportContext) {
  let r: CsvResult;
  try { r = parsePointsCsv(await file.text()); } catch (e) { alert((e as Error).message); return; }
  const w = [...r.waarschuwingen];
  const far = distanceWarning(r.punten, ctx.center.x, ctx.center.y);
  if (far) w.push(far);
  const cmp = compareWithBrk(r.punten, ctx.brkLines());
  const closedDefault = r.punten.length >= 3;
  const cb = h('input', { type: 'checkbox', checked: closedDefault });
  const len = polylineLength(r.punten.map((p) => [p.x, p.y]));
  const z = zCheck(ctx, r);
  openModal(h('div', {},
    h('h2', {}, 'Ingemeten perceelgrens importeren'),
    h('p', {}, `${file.name}: ${r.punten.length} punten · kolommen: ${r.kolommen.join(', ')} · scheidingsteken: ${r.scheidingsteken} · lengte ${fmt(len)} m`),
    warnList(w),
    pointsTable(r),
    cmp ? h('p', {}, `Vergelijking met de BRK-grens van het eigen perceel: gemiddeld ${fmt(cmp.gemiddeld)} m, maximaal ${fmt(cmp.max)} m (punt ${cmp.maxNr}).`) : null,
    z ? h('p', {}, z) : null,
    h('label', { class: 'lrow' }, cb, 'Gesloten grens (laatste punt verbinden met het eerste)'),
    h('p', { class: 'note', style: { marginLeft: 0 } }, 'De punten worden verbonden in de volgorde van het bestand. Na import heeft deze grens voorrang op de BRK-grens bij alle controles.'),
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => {
        ctx.store.change('Ingemeten perceelgrens geïmporteerd', (d) => {
          d.inmeting.grens = { bestand: file.name, geimporteerd: now(), punten: r.punten, gesloten: (cb as HTMLInputElement).checked };
        });
        closeModal();
        ctx.status(`Ingemeten perceelgrens actief (${r.punten.length} punten)`);
      } }, 'Importeren'),
      h('button', { onclick: closeModal }, 'Annuleren')),
  ));
}

// ---------------------------------------------------------------------------

export async function importPoints(file: File, ctx: ImportContext) {
  let r: CsvResult;
  try { r = parsePointsCsv(await file.text()); } catch (e) { alert((e as Error).message); return; }
  const w = [...r.waarschuwingen];
  const far = distanceWarning(r.punten, ctx.center.x, ctx.center.y);
  if (far) w.push(far);
  const counts = new Map<string, number>();
  for (const p of r.punten) counts.set(p.code ?? '', (counts.get(p.code ?? '') ?? 0) + 1);
  const existing = ctx.store.data.inmeting.codes;
  const rows: { code: string; sel: HTMLSelectElement; hgt: HTMLInputElement }[] = [];
  const table = h('table', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Aantal'), h('th', {}, 'Tonen als'), h('th', {}, 'Hoogte (m)')));
  for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const cur = existing[code]?.soort ?? guessSoort(code);
    const sel = h('select', {}, ...(Object.keys(PUNT_SOORTEN) as PuntSoort[]).map((s) => h('option', { value: s, selected: s === cur }, PUNT_SOORTEN[s].label)));
    const hd = existing[code]?.hoogte ?? PUNT_SOORTEN[cur].standaardHoogte;
    const hgt = h('input', { type: 'text', inputmode: 'decimal', value: hd != null ? String(hd).replace('.', ',') : '', placeholder: '–', style: { width: '70px' } });
    rows.push({ code, sel, hgt });
    table.append(h('tr', {}, h('td', {}, code || '(geen code)'), h('td', {}, String(n)), h('td', {}, sel), h('td', {}, hgt)));
  }
  const z = zCheck(ctx, r);
  openModal(h('div', {},
    h('h2', {}, 'Ingemeten punten importeren'),
    h('p', {}, `${file.name}: ${r.punten.length} punten · kolommen: ${r.kolommen.join(', ')} · scheidingsteken: ${r.scheidingsteken}`),
    warnList(w),
    z ? h('p', {}, z) : null,
    h('h3', {}, 'Codes koppelen'),
    h('p', { class: 'note', style: { marginLeft: 0 } }, 'Kies per meetcode hoe het punt getoond wordt. Palen en bomen worden in 3D geplaatst op de ingemeten hoogte. De koppeling wordt in het project bewaard en is later aan te passen.'),
    table,
    h('details', {}, h('summary', {}, 'Voorbeeld van de punten'), pointsTable(r)),
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => {
        const codes: Record<string, CodeRule> = {};
        for (const row of rows) {
          const v = parseNum(row.hgt.value);
          codes[row.code] = { soort: row.sel.value as PuntSoort, ...(v != null && !Number.isNaN(v) ? { hoogte: v } : {}) };
        }
        ctx.store.change('Meetpunten geïmporteerd', (d) => {
          d.inmeting.punten = { bestand: file.name, geimporteerd: now(), punten: r.punten };
          d.inmeting.codes = { ...d.inmeting.codes, ...codes };
        });
        closeModal();
        ctx.status(`${r.punten.length} meetpunten geïmporteerd`);
      } }, 'Importeren'),
      h('button', { onclick: closeModal }, 'Annuleren')),
  ));
}

/** Codetabel achteraf aanpassen. */
export function editCodes(ctx: ImportContext) {
  const pts = ctx.store.data.inmeting.punten;
  if (!pts) return;
  const counts = new Map<string, number>();
  for (const p of pts.punten) counts.set(p.code ?? '', (counts.get(p.code ?? '') ?? 0) + 1);
  const codes = ctx.store.data.inmeting.codes;
  const rows: { code: string; sel: HTMLSelectElement; hgt: HTMLInputElement }[] = [];
  const table = h('table', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Aantal'), h('th', {}, 'Tonen als'), h('th', {}, 'Hoogte (m)')));
  for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const cur = codes[code]?.soort ?? 'overig';
    const sel = h('select', {}, ...(Object.keys(PUNT_SOORTEN) as PuntSoort[]).map((s) => h('option', { value: s, selected: s === cur }, PUNT_SOORTEN[s].label)));
    const hgt = h('input', { type: 'text', inputmode: 'decimal', value: codes[code]?.hoogte != null ? String(codes[code].hoogte).replace('.', ',') : '', style: { width: '70px' } });
    rows.push({ code, sel, hgt });
    table.append(h('tr', {}, h('td', {}, code || '(geen code)'), h('td', {}, String(n)), h('td', {}, sel), h('td', {}, hgt)));
  }
  openModal(h('div', {}, h('h2', {}, 'Codes van meetpunten'), table,
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => {
        ctx.store.change('Codetabel aangepast', (d) => {
          for (const row of rows) {
            const v = parseNum(row.hgt.value);
            d.inmeting.codes[row.code] = { soort: row.sel.value as PuntSoort, ...(v != null && !Number.isNaN(v) ? { hoogte: v } : {}) };
          }
        });
        closeModal();
      } }, 'Opslaan'),
      h('button', { onclick: closeModal }, 'Annuleren'))));
}

// ---------------------------------------------------------------------------

export async function importKlic(file: File, ctx: ImportContext) {
  ctx.status(`KLIC-levering ${file.name} inlezen…`);
  await new Promise((r) => setTimeout(r, 30));
  let k;
  try { k = parseKlicFile(new Uint8Array(await file.arrayBuffer()), file.name); } catch (e) { alert((e as Error).message); return; }
  const w = [...k.waarschuwingen];
  // ligt de levering bij het project?
  const xs = k.lijnen.flatMap((l) => l.lines.flat().map((p) => p[0])), ys = k.lijnen.flatMap((l) => l.lines.flat().map((p) => p[1]));
  if (xs.length) {
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const d = Math.hypot(mx - ctx.center.x, my - ctx.center.y);
    if (d > 1000) w.push(`Deze levering ligt ${fmt(d / 1000, 1)} km van de projectlocatie – is dit de juiste KLIC-melding?`);
  }
  if (!KLIC_KLEUREN_GEVERIFIEERD) w.push('De themakleuren volgen de KLIC-kleurconventie, maar zijn nog niet allemaal gecontroleerd tegen de officiële Handreiking visualisatie IMKL 2.0.');
  openModal(h('div', {},
    h('h2', {}, `KLIC-levering ${k.meldnummer || file.name}`),
    h('table', {},
      h('tr', {}, h('th', {}, 'Meldnummer'), h('td', {}, k.meldnummer || '–')),
      h('tr', {}, h('th', {}, 'Referentie'), h('td', {}, k.referentie || '–')),
      h('tr', {}, h('th', {}, 'Levering samengesteld'), h('td', {}, k.datumLevering ? new Date(k.datumLevering).toLocaleString('nl-NL') : '–')),
      h('tr', {}, h('th', {}, 'Netbeheerders'), h('td', {}, k.beheerders.map((b) => b.naam).join(', ') || '–')),
      h('tr', {}, h('th', {}, 'Objecten'), h('td', {}, `${k.lijnen.length} kabels/leidingen, ${k.punten.length} punten, ${k.diepten.length} diepte-aanduidingen, ${k.ev.length} EV-vlakken`)),
    ),
    h('h3', {}, 'Thema’s'),
    h('table', {}, ...Object.entries(k.themas).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
      h('tr', {}, h('td', {}, h('span', { class: 'swatch line', style: { display: 'inline-block', width: '28px', height: '4px', background: themaStyle(t).kleur, verticalAlign: 'middle', marginRight: '8px' } }), themaStyle(t).label), h('td', {}, String(n))))),
    warnList(w),
    h('p', { class: 'note', style: { marginLeft: 0 } }, 'De KLIC-gegevens worden in het projectbestand opgeslagen. Diepte-aanduidingen zijn alleen indicatief: graaf altijd proefsleuven (WIBON).'),
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => {
        const id = uid('klic');
        ctx.store.addBijlage(id, k);
        const ref: KlicRef = { id, meldnummer: k.meldnummer, referentie: k.referentie, bestand: file.name, geimporteerd: now(), datumLevering: k.datumLevering, zichtbaar: true };
        ctx.store.change(`KLIC-levering ${k.meldnummer} geïmporteerd`, (d) => { d.klic.push(ref); });
        closeModal();
      } }, 'Importeren'),
      h('button', { onclick: closeModal }, 'Annuleren')),
  ));
}

// ---------------------------------------------------------------------------

export async function importDxf(file: File, ctx: ImportContext) {
  let d: DxfData;
  try { d = parseDxf(await file.text()); } catch (e) { alert((e as Error).message); return; }
  const ifc = ctx.ifcPlacement();
  const unitSel = h('select', {},
    ...[[0.001, 'millimeter'], [0.01, 'centimeter'], [1, 'meter']].map(([v, l]) => h('option', { value: String(v), selected: Math.abs((v as number) - d.eenheidM) < 1e-9 }, l as string)));
  const isRD = looksLikeRD(d, d.eenheidM, ctx.center.x, ctx.center.y);
  let mode: DxfPlacementMode = isRD ? 'rd' : ifc ? 'ifc' : 'handmatig';
  const radio = (m: DxfPlacementMode, label: string, disabled = false) =>
    h('label', { class: 'lrow' }, h('input', { type: 'radio', name: 'dxfmode', value: m, checked: m === mode, disabled, onchange: () => (mode = m) }), label);
  const iX = h('input', { type: 'text', value: String(ctx.center.x) }), iY = h('input', { type: 'text', value: String(ctx.center.y) }), iR = h('input', { type: 'text', value: '0' });
  const w = [...d.waarschuwingen];
  openModal(h('div', {},
    h('h2', {}, 'DXF-onderlegger importeren'),
    h('p', {}, `${file.name}: ${d.lijnen.length.toLocaleString('nl-NL')} lijnen, ${d.teksten.length} teksten, ${d.lagen.length} lagen. Eenheid in bestand: ${d.eenheidNaam}.`),
    warnList(w),
    h('div', { class: 'frow' }, 'Eenheid van de tekening', unitSel),
    h('h3', {}, 'Plaatsing'),
    radio('rd', `Coördinaten zijn RD${isRD ? ' (herkend)' : ''}`),
    radio('ifc', `Zelfde nulpunt als het IFC-ontwerpmodel${ifc ? '' : ' (geen IFC-model geladen)'}`, !ifc),
    radio('handmatig', 'Handmatig: nulpunt van de tekening op RD-positie'),
    h('div', { class: 'frow' }, 'X (RD)', iX), h('div', { class: 'frow' }, 'Y (RD)', iY), h('div', { class: 'frow' }, 'Rotatie (° linksom)', iR),
    h('p', { class: 'note', style: { marginLeft: 0 } }, 'Tip: tekeningen uit hetzelfde Archicad-project als het IFC-model gebruiken vaak hetzelfde nulpunt. De plaatsing is na import aan te passen.'),
    h('div', { class: 'btnrow' },
      h('button', { class: 'primary', onclick: () => {
        const id = uid('dxf');
        ctx.store.addBijlage(id, d);
        const ref: DxfRef = {
          id, naam: file.name.replace(/\.dxf$/i, ''), bestand: file.name, geimporteerd: now(),
          plaatsing: { modus: mode, x: parseNum(iX.value) ?? ctx.center.x, y: parseNum(iY.value) ?? ctx.center.y, rotatie: parseNum(iR.value) ?? 0, eenheidM: Number(unitSel.value) },
          kleur: '#00838f', laagkleuren: false, verborgenLagen: [], teksten: false, zichtbaar: true,
        };
        ctx.store.change(`DXF-onderlegger ${ref.naam} geïmporteerd`, (dd) => { dd.onderleggers.push(ref); });
        closeModal();
      } }, 'Importeren'),
      h('button', { onclick: closeModal }, 'Annuleren')),
  ));
}
