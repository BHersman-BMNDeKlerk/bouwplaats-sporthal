/** Infopaneel rechts: details van het geselecteerde object, met bewerkbare overschrijvingen. */
import { fmtM, fmtNAP, fmtRD, rdToWgs84 } from '../core/coords';
import type { ProjectStore } from '../core/project';
import { describe } from '../data/bgt';
import type { Placement } from '../data/ifcGeom';
import type { DesignModelFile } from '../data/types';
import { effectiveHeights, relative, type HeightOverride } from '../data/heights';
import type { BuildingObj } from '../scene/buildingsLayer';
import type { Obstacle } from '../scene/obstaclesLayer';
import type { Parcel } from '../scene/terrainLayer';
import { effectiveTree } from '../scene/treesLayer';
import type { TreeRecord } from '../data/types';
import { h, parseNum } from './dom';
import type { ManualObject } from '../core/project';
import type { MeetPunt } from '../data/csvPoints';
import { PUNT_SOORTEN } from '../data/csvPoints';
import { nearestDepth, themaStyle, type KlicData, type KlicLine } from '../data/klic';
import type { DxfData } from '../data/dxf';
import { MANUAL_STYLE, soortVan } from '../scene/overlays';
import { polylineLength, activeBoundary, type ActiveBoundary } from '../core/boundary';
import { ringArea } from '../data/geom';
import { BOUWHEK, clampGate, panels, totalLength, wholePanels, type Pt } from '../core/polyline';

export class InfoPanel {
  constructor(private readonly root: HTMLElement, private readonly store: ProjectStore, private readonly onClose: () => void) {}

  hide() {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  open(title: string, sub: string, ...content: (Node | null)[]) {
    this.root.hidden = false;
    this.root.innerHTML = '';
    this.root.append(
      h('button', { class: 'close', title: 'Sluiten (Esc)', onclick: () => this.onClose() }, '✕'),
      h('h3', {}, title),
      h('div', { class: 'sub' }, sub),
      ...content.filter(Boolean) as Node[],
    );
  }

  // ------------------------------------------------------------------ gebouw
  showBuilding(b: BuildingObj) {
    const r = b.rec;
    const ov = this.store.data.overschrijvingen.gebouwen[r.id];
    const e = effectiveHeights(r, ov);
    const any = e.overschreven.goot || e.overschreven.nok || e.overschreven.maaiveld;
    const val = (v: number | null, isOv: boolean) => h('span', { class: isOv ? 'ovval' : '' }, fmtNAP(v));
    const rel = (v: number | null, isOv: boolean) => h('span', { class: isOv ? 'ovval' : '' }, fmtM(relative(v, e.maaiveld)));
    const src = (v: number | null, cur: number | null) => (v != null && cur != null && Math.abs(v - cur) > 0.001 ? h('div', { class: 'hint', style: { fontSize: '11px', color: '#777' } }, `bron: ${fmtNAP(v)}`) : null);
    const table = h('table', {},
      h('tr', {}, h('th', {}, ''), h('th', { style: { textAlign: 'right' } }, 'm NAP'), h('th', { style: { textAlign: 'right' } }, 't.o.v. maaiveld')),
      h('tr', {}, h('td', {}, 'Maaiveld', src(r.maaiveld, e.maaiveld)), h('td', { class: 'num' }, val(e.maaiveld, e.overschreven.maaiveld)), h('td', { class: 'num' }, '0,00 m')),
      h('tr', {}, h('td', {}, 'Goothoogte', h('div', { style: { fontSize: '11px', color: '#777' } }, 'laagste dakrand'), src(r.goot, e.goot)), h('td', { class: 'num' }, val(e.goot, e.overschreven.goot)), h('td', { class: 'num' }, rel(e.goot, e.overschreven.goot || e.overschreven.maaiveld))),
      h('tr', {}, h('td', {}, 'Nokhoogte', h('div', { style: { fontSize: '11px', color: '#777' } }, 'hoogste punt dak'), src(r.nok, e.nok)), h('td', { class: 'num' }, val(e.nok, e.overschreven.nok)), h('td', { class: 'num' }, rel(e.nok, e.overschreven.nok || e.overschreven.maaiveld))),
    );
    const levels = r.dakniveaus.length > 1
      ? h('div', { class: 'kv' }, h('b', {}, 'Dakniveaus (platte delen): '), r.dakniveaus.map((z) => `${fmtNAP(z)} (${fmtM(relative(z, r.maaiveld))})`).join(' · '))
      : null;
    const peil = h('div', { class: 'kv' }, h('b', {}, 'Peildatum hoogtes: '),
      `${(r.pwBron ?? 'onbekend').toUpperCase()}${r.pwDatum ? `, ingewonnen ${r.pwDatum}` : ''}`,
      h('span', { class: 'badge' }, `3D BAG LoD ${r.lod}`));
    const kentallen = h('details', {}, h('summary', { style: { cursor: 'pointer', fontSize: '13px', color: '#5f6670' } }, '3D BAG-kentallen dakhoogte'),
      h('table', {},
        h('tr', {}, h('td', {}, 'Laagste dakpunt (b3_h_dak_min)'), h('td', { class: 'num' }, fmtNAP(r.dak.min))),
        h('tr', {}, h('td', {}, 'Mediaan (50%)'), h('td', { class: 'num' }, fmtNAP(r.dak.p50))),
        h('tr', {}, h('td', {}, '70%-hoogte (representatief)'), h('td', { class: 'num' }, fmtNAP(r.dak.p70))),
        h('tr', {}, h('td', {}, 'Hoogste dakpunt (b3_h_dak_max)'), h('td', { class: 'num' }, fmtNAP(r.dak.max))),
      ));

    // formulier
    const inp = (v: number | undefined) => h('input', { type: 'text', inputmode: 'decimal', placeholder: 'bronwaarde', value: v != null ? String(v).replace('.', ',') : '' });
    const iM = inp(ov?.maaiveld), iG = inp(ov?.goot), iN = inp(ov?.nok);
    const iNote = h('input', { type: 'text', placeholder: 'bv. tekening A-201 rev. C', value: ov?.opmerking ?? '' });
    const msg = h('div', { class: 'note', style: { marginLeft: 0 } });
    const save = () => {
      const vals = { maaiveld: parseNum(iM.value), goot: parseNum(iG.value), nok: parseNum(iN.value) };
      if (Object.values(vals).some((v) => Number.isNaN(v))) { msg.textContent = 'Ongeldige invoer: gebruik getallen, bv. 7,45'; return; }
      const m = vals.maaiveld ?? r.maaiveld, g = vals.goot ?? r.goot, n = vals.nok ?? r.nok;
      if (m != null && g != null && g < m) { msg.textContent = 'Goothoogte ligt onder het maaiveld.'; return; }
      if (g != null && n != null && n < g) { msg.textContent = 'Nokhoogte moet ≥ goothoogte zijn.'; return; }
      const o: HeightOverride = {};
      if (vals.maaiveld != null) o.maaiveld = vals.maaiveld;
      if (vals.goot != null) o.goot = vals.goot;
      if (vals.nok != null) o.nok = vals.nok;
      if (iNote.value.trim()) o.opmerking = iNote.value.trim();
      this.store.change(`Hoogte ${b.isSporthal ? 'sporthal' : 'pand ' + r.bagId} aangepast`, (d) => {
        if (Object.keys(o).length) d.overschrijvingen.gebouwen[r.id] = o;
        else delete d.overschrijvingen.gebouwen[r.id];
      });
    };
    const reset = () => this.store.change(`Hoogte pand ${r.bagId} hersteld`, (d) => { delete d.overschrijvingen.gebouwen[r.id]; });
    const form = h('fieldset', {},
      h('legend', {}, 'Hoogtes overschrijven (m NAP)'),
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Bijvoorbeeld met waarden uit tekening. Leeg = bronwaarde. Het 3D-model wordt verticaal aangepast.'),
      h('div', { class: 'frow' }, 'Maaiveld / peil', iM),
      h('div', { class: 'frow' }, 'Goothoogte', iG),
      h('div', { class: 'frow' }, 'Nokhoogte', iN),
      h('div', { class: 'frow', style: { gridTemplateColumns: '1fr' } }, iNote),
      h('div', { class: 'btnrow' },
        h('button', { class: 'primary', onclick: save }, 'Toepassen'),
        any || ov ? h('button', { onclick: reset }, 'Herstel bronwaarden') : null),
      msg,
    );
    for (const i of [iM, iG, iN, iNote]) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });

    const titel = b.isSporthal ? 'Sporthal Latourpad 16' : 'Pand';
    this.open(
      titel,
      `BAG ${r.bagId} · bouwjaar ${r.bouwjaar ?? '?'} · ${r.status ?? ''}`,
      r.bron === 'bgt-ahn'
        ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, 'Niet in de 3D BAG (vaak nieuwbouw). Getoond als blok: BGT-footprint met dakhoogte uit het AHN (90e percentiel). Goot = nok = indicatieve dakhoogte.')
        : r.bron === 'bgt-aanname'
          ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, 'Niet in de 3D BAG en geen gebouw zichtbaar in het AHN (waarschijnlijk gebouwd na de inwinning). Getoond als blok met een AANGENOMEN hoogte van 3 m – vul de werkelijke hoogte hieronder in.')
          : null,
      any ? h('div', { class: 'kv' }, h('span', { class: 'badge ov' }, '✎ handmatig overschreven'), ov?.opmerking ? h('span', { style: { fontSize: '12px', marginLeft: '6px' } }, ov.opmerking) : null) : null,
      table,
      levels,
      peil,
      h('div', { class: 'kv' }, h('b', {}, 'Daktype: '), dakTypeNL(r.dakType), r.oppGrond ? ` · grondopp. ${Math.round(r.oppGrond)} m²` : ''),
      kentallen,
      form,
      h('div', { class: 'kv', style: { marginTop: '10px' } },
        h('a', { href: `https://bagviewer.kadaster.nl/lvbag/bag-viewer/?objectId=${r.bagId}`, target: '_blank', rel: 'noopener' }, 'Bekijk in BAG-viewer ↗')),
    );
  }

  // ------------------------------------------------------------------ boom
  showTree(t0: TreeRecord) {
    const ov = this.store.data.overschrijvingen.bomen[t0.id];
    const t = effectiveTree(t0, ov);
    const bronTxt = t.bron === 'BGT+AHN' ? 'BGT-boom, hoogte en kroon uit AHN' : t.bron === 'AHN' ? 'Alleen in AHN gevonden (niet in BGT)' : 'BGT-boom, geen AHN-signaal: standaardwaarden';
    const inp = (v: number | undefined) => h('input', { type: 'text', inputmode: 'decimal', placeholder: 'bron', value: v != null ? String(v).replace('.', ',') : '' });
    const iH = inp(ov?.hoogte), iR = inp(ov?.kroonstraal), iK = inp(ov?.kroonOnderkant);
    const msg = h('div', { class: 'note', style: { marginLeft: 0 } });
    const save = () => {
      const v = { hoogte: parseNum(iH.value), kroonstraal: parseNum(iR.value), kroonOnderkant: parseNum(iK.value) };
      if (Object.values(v).some((x) => Number.isNaN(x) || (x != null && x < 0))) { msg.textContent = 'Ongeldige invoer.'; return; }
      this.store.change('Boom aangepast', (d) => {
        const o = { ...(d.overschrijvingen.bomen[t0.id] ?? {}) };
        for (const k of ['hoogte', 'kroonstraal', 'kroonOnderkant'] as const) { if (v[k] != null) o[k] = v[k]!; else delete o[k]; }
        if (Object.keys(o).length) d.overschrijvingen.bomen[t0.id] = o; else delete d.overschrijvingen.bomen[t0.id];
      });
    };
    for (const i of [iH, iR, iK]) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    this.open('Boom', bronTxt,
      t.overschreven ? h('div', { class: 'kv' }, h('span', { class: 'badge ov' }, '✎ handmatig aangepast')) : null,
      h('table', {},
        h('tr', {}, h('td', {}, 'Hoogte boven maaiveld'), h('td', { class: 'num' }, fmtM(t.hoogte, 1), t.aanname && !ov?.hoogte ? h('span', { class: 'badge aanname' }, 'aanname') : null)),
        h('tr', {}, h('td', {}, 'Kroonstraal'), h('td', { class: 'num' }, fmtM(t.kroonstraal, 1), t.aanname && !ov?.kroonstraal ? h('span', { class: 'badge aanname' }, 'aanname') : null)),
        h('tr', {}, h('td', {}, 'Onderkant kroon (vrije hoogte)'), h('td', { class: 'num' }, fmtM(t.kroonOnderkant, 1), ov?.kroonOnderkant == null ? h('span', { class: 'badge aanname' }, 'aanname') : null)),
        h('tr', {}, h('td', {}, 'Top boom'), h('td', { class: 'num' }, fmtNAP(t.maaiveld + t.hoogte))),
        h('tr', {}, h('td', {}, 'Maaiveld bij stam'), h('td', { class: 'num' }, fmtNAP(t.maaiveld))),
      ),
      h('div', { class: 'kv' }, h('b', {}, 'Positie: '), fmtRD(t.x, t.y)),
      t.bgtId ? h('div', { class: 'kv' }, h('b', {}, 'BGT-id: '), t.bgtId) : null,
      h('fieldset', {},
        h('legend', {}, 'Aanpassen (m)'),
        h('div', { class: 'frow' }, 'Hoogte', iH),
        h('div', { class: 'frow' }, 'Kroonstraal', iR),
        h('div', { class: 'frow' }, 'Onderkant kroon', iK),
        h('div', { class: 'btnrow' },
          h('button', { class: 'primary', onclick: save }, 'Toepassen'),
          h('button', { title: 'Bijvoorbeeld bij een foutieve detectie of een gekapte boom', onclick: () => this.store.change('Boom verborgen', (d) => { d.overschrijvingen.bomen[t0.id] = { ...(d.overschrijvingen.bomen[t0.id] ?? {}), verborgen: true }; }) }, 'Verbergen'),
          ov ? h('button', { onclick: () => this.store.change('Boom hersteld', (d) => { delete d.overschrijvingen.bomen[t0.id]; }) }, 'Herstel') : null),
        msg),
    );
  }

  // ------------------------------------------------------------------ obstakel
  showObstacle(o: Obstacle) {
    const ov = this.store.data.overschrijvingen.obstakels[o.id];
    const hgt = ov?.hoogte ?? o.spec.hoogte;
    const iH = h('input', { type: 'text', inputmode: 'decimal', value: ov?.hoogte != null ? String(ov.hoogte).replace('.', ',') : '', placeholder: String(o.spec.hoogte).replace('.', ',') });
    const save = () => {
      const v = parseNum(iH.value);
      if (Number.isNaN(v) || (v != null && v <= 0)) return;
      this.store.change(`Hoogte ${o.spec.omschrijving.toLowerCase()} aangepast`, (d) => {
        const x = { ...(d.overschrijvingen.obstakels[o.id] ?? {}) };
        if (v != null) x.hoogte = v; else delete x.hoogte;
        if (Object.keys(x).length) d.overschrijvingen.obstakels[o.id] = x; else delete d.overschrijvingen.obstakels[o.id];
      });
    };
    iH.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    const d = describe(o.collection, o.props);
    this.open(o.spec.omschrijving, `BGT/IMGeo – ${o.collection}`,
      h('table', {},
        h('tr', {}, h('td', {}, 'Hoogte'), h('td', { class: 'num' }, fmtM(hgt, 1), ov?.hoogte == null ? h('span', { class: 'badge aanname' }, 'aanname') : h('span', { class: 'badge ov' }, 'handmatig'))),
        h('tr', {}, h('td', {}, 'Top'), h('td', { class: 'num' }, fmtNAP(o.maaiveld + hgt))),
        h('tr', {}, h('td', {}, 'Maaiveld'), h('td', { class: 'num' }, fmtNAP(o.maaiveld))),
        ...d.regels.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))),
      ),
      h('div', { class: 'kv' }, h('b', {}, 'Positie: '), fmtRD(o.x, o.y)),
      h('fieldset', {}, h('legend', {}, 'Hoogte aanpassen (m)'), h('div', { class: 'frow' }, 'Hoogte boven maaiveld', iH),
        h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: save }, 'Toepassen'),
          ov ? h('button', { onclick: () => this.store.change('Obstakel hersteld', (dd) => { delete dd.overschrijvingen.obstakels[o.id]; }) }, 'Herstel') : null)),
    );
  }

  // ------------------------------------------------------------------ ontwerp (IFC)
  showDesign(m: DesignModelFile, zone: number | null, maaiveld: number | null) {
    const cur = this.store.data.ontwerpPlaatsing;
    const p: Placement = cur ?? m.plaatsingAuto;
    const isAuto = !cur;
    const fmt = (v: number, d = 3) => v.toFixed(d).replace('.', ',');
    const inp = (v: number, d = 3) => h('input', { type: 'text', inputmode: 'decimal', value: fmt(v, d) });
    const iX = inp(p.x), iY = inp(p.y), iR = inp(p.rotatie, 3), iP = inp(p.peil, 3);
    const msg = h('div', { class: 'note', style: { marginLeft: 0 } });
    const save = () => {
      const v = [iX, iY, iR, iP].map((i) => parseNum(i.value));
      if (v.some((x) => x == null || Number.isNaN(x))) { msg.textContent = 'Vul vier geldige getallen in.'; return; }
      const [x, y, rotatie, peil] = v as number[];
      if (Math.hypot(x - m.plaatsingAuto.x, y - m.plaatsingAuto.y) > 1000) { msg.textContent = 'Positie ligt meer dan 1 km van de locatie – controleer de RD-coördinaten.'; return; }
      this.store.change('Plaatsing ontwerpmodel aangepast', (d) => { d.ontwerpPlaatsing = { x, y, rotatie, peil }; });
    };
    for (const i of [iX, iY, iR, iP]) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    const k = m.plaatsingKwaliteit;
    this.open('Nieuw pand (ontwerp IFC)', `${m.project || m.bestand} · ${m.auteur} · modeldatum ${m.datum.slice(0, 10)}`,
      h('table', {},
        h('tr', {}, h('th', {}, ''), h('th', { style: { textAlign: 'right' } }, 'm NAP'), h('th', { style: { textAlign: 'right' } }, 't.o.v. maaiveld')),
        h('tr', {}, h('td', {}, 'Peil 0 P'), h('td', { class: 'num' }, fmtNAP(p.peil)), h('td', { class: 'num' }, fmtM(relative(p.peil, maaiveld)))),
        ...m.zones.map((z, i) => h('tr', { style: i === zone ? { background: '#fff4d6' } : {} },
          h('td', {}, `Bovenkant ${m.zones.length > 1 ? (i === m.zones.length - 1 ? 'hoog deel' : i === 0 ? 'laag deel' : `deel ${i + 1}`) : 'pand'}`, h('div', { style: { fontSize: '11px', color: '#777' } }, `${z.oppervlakte.toLocaleString('nl-NL')} m² · ${fmtM(z.top)} boven peil`)),
          h('td', { class: 'num' }, fmtNAP(p.peil + z.top)), h('td', { class: 'num' }, fmtM(relative(p.peil + z.top, maaiveld))))),
        h('tr', {}, h('td', { colspan: 3, style: { fontSize: '12px', color: '#5f6670', paddingTop: '8px' } }, 'Bouwlagen uit het model:')),
        ...m.bouwlagen.map((b) => h('tr', {}, h('td', {}, b.naam), h('td', { class: 'num' }, fmtNAP(p.peil + b.hoogte)), h('td', { class: 'num' }, fmtM(relative(p.peil + b.hoogte, maaiveld))))),
      ),
      h('div', { class: 'kv' }, h('b', {}, 'Maaiveld ter plaatse (AHN): '), fmtNAP(maaiveld)),
      h('fieldset', {},
        h('legend', {}, 'Plaatsing in RD / NAP'),
        h('div', { class: 'note', style: { marginLeft: 0 } },
          isAuto
            ? `Ligging automatisch: buitencontour uitgelijnd op het bestaande pand (gem. afwijking ${k ? Math.round(k.gemAfwijking * 100) : '?'} cm). Peil 0 P = ${fmtNAP(m.plaatsingAuto.peil)} volgens opgave. Controleer de ligging met de maatvoering op tekening.`
            : 'Handmatig ingestelde plaatsing.'),
        h('div', { class: 'frow' }, 'X nulpunt IFC (RD, m)', iX),
        h('div', { class: 'frow' }, 'Y nulpunt IFC (RD, m)', iY),
        h('div', { class: 'frow' }, 'Rotatie (°, linksom)', iR),
        h('div', { class: 'frow' }, 'Peil 0 P (m NAP)', iP),
        h('div', { class: 'btnrow' },
          h('button', { class: 'primary', onclick: save }, 'Toepassen'),
          !isAuto ? h('button', { onclick: () => this.store.change('Plaatsing ontwerp automatisch', (d) => { delete d.ontwerpPlaatsing; }) }, 'Terug naar automatisch') : null),
        msg),
      h('div', { class: 'note', style: { marginLeft: 0 } }, `Weergave: alleen de buitenwerkse contour als grijze blokken tot de hoogste dakrand per deel (zonder PV-panelen en installaties). Bron: ${m.bestand} (${m.schema}, ${m.applicatie}).`),
    );
  }

  // ------------------------------------------------------------------ terrein
  showTerrain(x: number, y: number, z: number | null, measured: boolean | null, bgt: { collection: string; props: Record<string, any> } | null, parcel: Parcel | null) {
    const w = rdToWgs84(x, y);
    const items: (Node | null)[] = [
      h('table', {},
        h('tr', {}, h('td', {}, 'RD-coördinaat'), h('td', { class: 'num' }, fmtRD(x, y))),
        h('tr', {}, h('td', {}, 'Maaiveld (AHN)'), h('td', { class: 'num' }, fmtNAP(z), measured === false ? h('span', { class: 'badge warn' }, 'geïnterpoleerd') : null)),
        h('tr', {}, h('td', {}, 'WGS84 (±1 m)'), h('td', { class: 'num' }, `${w.lat.toFixed(6)}, ${w.lon.toFixed(6)}`)),
      ),
    ];
    if (bgt) {
      const d = describe(bgt.collection, bgt.props);
      items.push(h('h3', { style: { fontSize: '14px', marginTop: '12px' } }, d.titel), h('table', {}, ...d.regels.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))));
    }
    if (parcel) {
      const p = parcel.props;
      items.push(
        h('h3', { style: { fontSize: '14px', marginTop: '12px' } }, 'Kadastraal perceel ', h('span', { class: 'badge warn' }, 'indicatief')),
        h('table', {},
          h('tr', {}, h('td', {}, 'Aanduiding'), h('td', {}, `${p.akr_kadastrale_gemeente_code_waarde ?? ''} ${p.sectie ?? ''} ${p.perceelnummer ?? ''}`)),
          h('tr', {}, h('td', {}, 'Kadastrale gemeente'), h('td', {}, p.kadastrale_gemeente_waarde ?? '–')),
          h('tr', {}, h('td', {}, 'Grootte'), h('td', {}, p.kadastrale_grootte_waarde != null ? `${p.kadastrale_grootte_waarde} m² (${(p.soort_grootte_waarde ?? '').toLowerCase()})` : '–')),
        ),
        h('div', { class: 'note warn' }, 'BRK-grens is een indicatieve onderlegger. De ingemeten grens (fase 2) heeft voorrang.'),
      );
    }
    this.open('Locatie', 'Klik op een gebouw, boom of obstakel voor details', ...items);
  }

  // ------------------------------------------------------------------ KLIC
  showKlic(refId: string, line: KlicLine, x: number, y: number) {
    const ref = this.store.data.klic.find((k) => k.id === refId);
    const k = this.store.data.bijlagen[refId] as KlicData | undefined;
    const st = themaStyle(line.thema);
    const d = k ? nearestDepth(k.diepten, x, y, line.thema, 5) : null;
    const typeNL: Record<string, string> = {
      Elektriciteitskabel: 'Elektriciteitskabel', OlieGasChemicalienPijpleiding: 'Gas-/olieleiding', Rioolleiding: 'Rioolleiding', Waterleiding: 'Waterleiding',
      Telecommunicatiekabel: 'Telecomkabel', Thermischepijpleiding: 'Warmteleiding', Kabelbed: 'Kabelbed', Duct: 'Kabelgoot/duct', Mantelbuis: 'Mantelbuis', Overig: 'Overige leiding',
    };
    this.open(`${typeNL[line.type] ?? line.type}`, `KLIC ${ref?.meldnummer ?? ''} · ${line.beheerder}`,
      h('div', { class: 'kv' }, h('span', { class: 'swatch', style: { display: 'inline-block', width: '26px', height: '5px', background: st.kleur, verticalAlign: 'middle', marginRight: '6px' } }), h('b', {}, st.label), ` · ${line.status}`),
      h('table', {},
        ...Object.entries(line.props).map(([kk, v]) => h('tr', {}, h('td', {}, kk), h('td', {}, String(v)))),
        h('tr', {}, h('td', {}, 'Diepte (dichtstbij, ≤ 5 m)'), h('td', {}, d ? `${d.soort === 'NAP' ? `${d.waarde.toLocaleString('nl-NL')} m NAP` : `${d.waarde.toLocaleString('nl-NL')} m onder maaiveld`}${d.aangrijping ? ` (${d.aangrijping})` : ''}${d.nauwkeurigheid ? `, nauwkeurigheid ${d.nauwkeurigheid}` : ''}` : 'niet opgegeven')),
      ),
      h('div', { class: 'note warn', style: { marginLeft: 0 } }, 'Ligging en diepte zijn indicatief. Volgens de WIBON: proefsleuven graven en bij twijfel de netbeheerder raadplegen.'),
    );
  }

  showKlicRef(refId: string, onRemove: () => void) {
    const ref = this.store.data.klic.find((k) => k.id === refId);
    const k = this.store.data.bijlagen[refId] as KlicData | undefined;
    if (!ref || !k) return this.hide();
    this.open(`KLIC-levering ${ref.meldnummer}`, `${ref.referentie} · geïmporteerd ${new Date(ref.geimporteerd).toLocaleDateString('nl-NL')}`,
      h('table', {},
        h('tr', {}, h('td', {}, 'Bestand'), h('td', {}, ref.bestand)),
        h('tr', {}, h('td', {}, 'Levering samengesteld'), h('td', {}, ref.datumLevering ? new Date(ref.datumLevering).toLocaleString('nl-NL') : '–')),
        h('tr', {}, h('td', {}, 'Netbeheerders'), h('td', {}, k.beheerders.map((b) => b.naam).join(', '))),
        h('tr', {}, h('td', {}, 'Kabels/leidingen'), h('td', {}, String(k.lijnen.length))),
        h('tr', {}, h('td', {}, 'Diepte-aanduidingen'), h('td', {}, String(k.diepten.length))),
        h('tr', {}, h('td', {}, 'EV-vlakken'), h('td', {}, String(k.ev.length))),
      ),
      h('div', { class: 'btnrow' }, h('button', { onclick: () => { if (confirm(`KLIC-levering ${ref.meldnummer} uit het project verwijderen?`)) onRemove(); } }, 'Levering verwijderen')),
    );
  }

  // ------------------------------------------------------------------ inmeting
  showMeetpunt(pt: MeetPunt, isGrens: boolean, maaiveld: number | null) {
    const soort = isGrens ? null : soortVan(this.store.data, pt);
    const dz = pt.z != null && maaiveld != null ? pt.z - maaiveld : null;
    this.open(`${isGrens ? 'Grenspunt' : 'Meetpunt'} ${pt.nr}`, isGrens ? 'Ingemeten perceelgrens' : `${soort ? PUNT_SOORTEN[soort].label : ''}${pt.code ? ` · code ${pt.code}` : ''}`,
      h('table', {},
        h('tr', {}, h('td', {}, 'RD'), h('td', { class: 'num' }, fmtRD(pt.x, pt.y, 3))),
        h('tr', {}, h('td', {}, 'Z ingemeten'), h('td', { class: 'num' }, pt.z != null ? fmtNAP(pt.z, 3) : '–')),
        h('tr', {}, h('td', {}, 'AHN-maaiveld'), h('td', { class: 'num' }, fmtNAP(maaiveld))),
        h('tr', {}, h('td', {}, 'Verschil Z − AHN'), h('td', { class: 'num' }, dz != null ? `${dz >= 0 ? '+' : ''}${dz.toLocaleString('nl-NL', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} m` : '–')),
      ),
    );
  }

  showGrens(onRemove: () => void, onToggleClosed: () => void, brkLines: number[][][], own: { props: Record<string, any>; polys: number[][][][] }[]) {
    const g = this.store.data.inmeting.grens;
    const ab: ActiveBoundary = activeBoundary(g, own);
    if (!g) {
      return this.open('Perceelgrens', ab.omschrijving,
        h('div', { class: 'note warn', style: { marginLeft: 0 } }, ab.waarschuwing ?? ''),
        h('p', {}, 'Importeer de ingemeten grens via Importeren → Ingemeten perceelgrens (CSV). Die heeft daarna voorrang bij alle controles.'));
    }
    const ring = ab.lijnen[0] ?? [];
    void brkLines;
    this.open('Ingemeten perceelgrens', `${g.bestand} · ${g.punten.length} punten · ${new Date(g.geimporteerd).toLocaleDateString('nl-NL')}`,
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Actief: deze grens heeft voorrang op de BRK-grens bij alle controles (overdraai, hekwerk, overlap).'),
      h('table', {},
        h('tr', {}, h('td', {}, 'Lengte'), h('td', { class: 'num' }, `${polylineLength(ring).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} m`)),
        g.gesloten ? h('tr', {}, h('td', {}, 'Oppervlakte'), h('td', { class: 'num' }, `${ringArea(ring).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} m²`)) : null,
        h('tr', {}, h('td', {}, 'Gesloten'), h('td', {}, g.gesloten ? 'ja' : 'nee')),
      ),
      h('div', { class: 'btnrow' },
        h('button', { onclick: onToggleClosed }, g.gesloten ? 'Open lijn maken' : 'Sluiten (laatste → eerste punt)'),
        h('button', { onclick: () => { if (confirm('Ingemeten perceelgrens verwijderen? De BRK-grens wordt dan weer (indicatief) gebruikt.')) onRemove(); } }, 'Verwijderen')),
    );
  }

  // ------------------------------------------------------------------ eigen obstakels
  showManual(o: ManualObject, onDelete: () => void) {
    const st = MANUAL_STYLE[o.soort];
    const iNaam = h('input', { type: 'text', value: o.naam });
    const needsH = o.soort === 'paaltjes';
    const iH = h('input', { type: 'text', inputmode: 'decimal', value: String((o.soort === 'doorrijhoogte' ? o.vrijeHoogte : o.hoogte) ?? '').replace('.', ',') });
    const iNote = h('input', { type: 'text', value: o.opmerking ?? '', placeholder: 'opmerking' });
    const save = () => {
      const v = parseNum(iH.value);
      if ((o.soort === 'doorrijhoogte' || needsH) && (v == null || Number.isNaN(v) || v <= 0)) { alert('Vul een geldige hoogte in (m).'); return; }
      this.store.change(`${st.label} aangepast`, (d) => {
        const x = d.handmatig.find((q) => q.id === o.id);
        if (!x) return;
        x.naam = iNaam.value.trim();
        x.opmerking = iNote.value.trim() || undefined;
        if (o.soort === 'doorrijhoogte') x.vrijeHoogte = v!;
        else if (needsH) x.hoogte = v!;
      });
    };
    for (const i of [iNaam, iH, iNote]) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); ev.stopPropagation(); });
    const len = o.geom !== 'punten' ? polylineLength(o.geom === 'vlak' ? [...o.coords, o.coords[0]] : o.coords) : 0;
    this.open(st.label, `Eigen obstakel · ${o.geom === 'punten' ? `${o.coords.length} punt(en)` : o.geom === 'lijn' ? `lijn ${len.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} m` : `vlak ${ringArea([...o.coords, o.coords[0]]).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} m²`}`,
      h('fieldset', {},
        h('legend', {}, 'Eigenschappen'),
        h('div', { class: 'frow' }, 'Naam', iNaam),
        o.soort === 'doorrijhoogte' || o.soort === 'paaltjes' ? h('div', { class: 'frow' }, o.soort === 'doorrijhoogte' ? 'Vrije hoogte boven maaiveld (m)' : 'Hoogte (m)', iH) : null,
        h('div', { class: 'frow', style: { gridTemplateColumns: '1fr' } }, iNote),
        h('div', { class: 'btnrow' },
          h('button', { class: 'primary', onclick: save }, 'Toepassen'),
          h('button', { onclick: () => { if (confirm(`${st.label} verwijderen?`)) onDelete(); } }, 'Verwijderen')),
      ),
      o.soort === 'hekwerk' ? this.fenceSection(o) : null,
      h('div', { class: 'note', style: { marginLeft: 0 } }, o.geom === 'punten' ? 'Sleep een punt om het te verplaatsen; dubbelklik op een punt om het te verwijderen.' : 'Sleep de blauwe bolletjes om hoekpunten te verplaatsen, sleep een wit tussenpunt om een hoekpunt toe te voegen, dubbelklik op een hoekpunt om het te verwijderen. Sleep het object zelf om het geheel te verplaatsen. Ongedaan maken: Ctrl+Z.'),
      o.soort === 'doorrijhoogte' ? h('div', { class: 'note', style: { marginLeft: 0 } }, 'Wordt in fase 4 gebruikt voor de conflictcontrole met de voertuighoogte.') : null,
      o.soort === 'nietBerijdbaar' ? h('div', { class: 'note', style: { marginLeft: 0 } }, 'Vlak waar voertuigen niet mogen of kunnen rijden (fase 4).') : null,
    );
  }

  /** Hekwerk: telling bouwhekken, ingekorte hekken en poorten. */
  private fenceSection(o: ManualObject): Node {
    const ps = panels(o.coords as Pt[]);
    const ing = ps.filter((p) => !p.heel);
    const gates = o.poorten ?? [];
    const fmt = (v: number) => v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const upd = (label: string, fn: (x: ManualObject) => void) => this.store.change(label, (d) => { const x = d.handmatig.find((q) => q.id === o.id); if (x) fn(x); });
    const gateRows = gates.map((g0, i) => {
      const g = clampGate(g0, ps.length);
      const naam = h('input', { type: 'text', value: g.naam ?? '', placeholder: `poort ${i + 1}`, style: { width: '110px' } });
      naam.addEventListener('change', () => upd('Poort hernoemd', (x) => { const q = x.poorten!.find((y) => y.id === g.id); if (q) q.naam = naam.value.trim() || undefined; }));
      naam.addEventListener('keydown', (ev) => ev.stopPropagation());
      const sel = h('select', { onchange: (e: Event) => upd('Poortbreedte aangepast', (x) => { const q = x.poorten!.find((y) => y.id === g.id); if (q) Object.assign(q, clampGate({ ...q, aantal: Number((e.target as HTMLSelectElement).value) }, ps.length)); }) },
        ...[1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === g.aantal }, `${n} hek${n > 1 ? 'ken' : ''} (${fmt(n * BOUWHEK.lengte)} m)`)));
      return h('tr', {}, h('td', {}, naam), h('td', {}, sel), h('td', {}, `hek ${g.start + 1}–${g.start + g.aantal}`),
        h('td', {}, h('button', { title: 'Poort verwijderen', onclick: () => upd('Poort verwijderd', (x) => { x.poorten = (x.poorten ?? []).filter((y) => y.id !== g.id); }) }, '✕')));
    });
    const addGate = () => upd('Poort toegevoegd', (x) => {
      const n = panels(x.coords as Pt[]).length;
      const aantal = Math.min(2, n);
      x.poorten = [...(x.poorten ?? []), clampGate({ id: `g-${Date.now().toString(36)}`, start: Math.floor((n - aantal) / 2), aantal }, n)];
    });
    return h('fieldset', {},
      h('legend', {}, `Bouwhekken ${BOUWHEK.lengte.toLocaleString('nl-NL')} × ${BOUWHEK.hoogte.toLocaleString('nl-NL')} m`),
      h('table', {},
        h('tr', {}, h('td', {}, 'Lengte'), h('td', { class: 'num' }, `${fmt(totalLength(o.coords as Pt[]))} m`)),
        h('tr', {}, h('td', {}, 'Aantal bouwhekken'), h('td', { class: 'num' }, String(ps.length))),
        h('tr', {}, h('td', {}, 'Waarvan in poorten'), h('td', { class: 'num' }, String(gates.reduce((n, g) => n + clampGate(g, ps.length).aantal, 0)))),
        h('tr', {}, h('td', {}, 'Betonvoeten'), h('td', { class: 'num' }, String(ps.length ? ps.length + 1 : 0))),
        ing.length ? h('tr', {}, h('td', {}, h('span', { class: 'badge warn' }, 'ingekort')), h('td', { class: 'num' }, ing.map((p) => `${fmt(p.lengte)} m`).join(', '))) : null,
      ),
      ing.length ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, `${ing.length} zijde(n) bestaan niet uit hele hekken (rood). `,
        h('button', { onclick: () => upd('Hele hekken gemaakt', (x) => { x.coords = wholePanels(x.coords as Pt[]); }) }, 'Hele hekken maken')) : null,
      h('div', { class: 'kv', style: { marginTop: '8px' } }, h('b', {}, 'Poorten')),
      gates.length ? h('table', {}, ...gateRows) : h('div', { class: 'note', style: { marginLeft: 0 } }, 'Nog geen poort.'),
      h('div', { class: 'btnrow' }, h('button', { onclick: addGate }, '＋ Poort toevoegen')),
      h('div', { class: 'note', style: { marginLeft: 0 } }, 'Sleep het oranje blokje boven de poort om hem langs het hek te verschuiven (per heel hek).'),
    );
  }

  // ------------------------------------------------------------------ DXF
  showDxf(refId: string, ifcAvailable: boolean, onRemove: () => void) {
    const ref = this.store.data.onderleggers.find((o) => o.id === refId);
    const d = this.store.data.bijlagen[refId] as DxfData | undefined;
    if (!ref || !d) return this.hide();
    const p = ref.plaatsing;
    let mode = p.modus;
    const radio = (m: typeof mode, label: string, dis = false) => h('label', { class: 'lrow' }, h('input', { type: 'radio', name: 'dxfm', checked: m === mode, disabled: dis, onchange: () => (mode = m) }), label);
    const iX = h('input', { type: 'text', value: String(p.x).replace('.', ',') }), iY = h('input', { type: 'text', value: String(p.y).replace('.', ',') }), iR = h('input', { type: 'text', value: String(p.rotatie).replace('.', ',') });
    const unit = h('select', {}, ...[[0.001, 'millimeter'], [0.01, 'centimeter'], [1, 'meter']].map(([v, l]) => h('option', { value: String(v), selected: Math.abs((v as number) - p.eenheidM) < 1e-9 }, l as string)));
    const color = h('input', { type: 'color', value: ref.kleur, style: { width: '60px', padding: 0 } });
    const lagen = h('div', { style: { maxHeight: '220px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '6px', padding: '4px 8px' } },
      ...d.lagen.map((l) => h('label', { class: 'lrow', style: { fontSize: '12px' } },
        h('input', { type: 'checkbox', checked: !ref.verborgenLagen.includes(l.naam), 'data-laag': l.naam }),
        h('span', { class: 'swatch', style: { background: l.kleur } }), `${l.naam} (${l.aantal})`)));
    const laagkleur = h('input', { type: 'checkbox', checked: ref.laagkleuren });
    const teksten = h('input', { type: 'checkbox', checked: ref.teksten });
    const apply = () => {
      const hidden = [...lagen.querySelectorAll('input')].filter((i) => !(i as HTMLInputElement).checked).map((i) => (i as HTMLElement).dataset.laag!);
      this.store.change(`Onderlegger ${ref.naam} aangepast`, (dd) => {
        const r = dd.onderleggers.find((o) => o.id === refId)!;
        r.plaatsing = { modus: mode, x: parseNum(iX.value) ?? p.x, y: parseNum(iY.value) ?? p.y, rotatie: parseNum(iR.value) ?? p.rotatie, eenheidM: Number(unit.value) };
        r.kleur = color.value;
        r.laagkleuren = laagkleur.checked;
        r.teksten = teksten.checked;
        r.verborgenLagen = hidden;
      });
    };
    this.open(`Onderlegger ${ref.naam}`, `${ref.bestand} · ${d.lijnen.length.toLocaleString('nl-NL')} lijnen`,
      h('fieldset', {}, h('legend', {}, 'Plaatsing'),
        radio('rd', 'Coördinaten zijn RD'), radio('ifc', 'Nulpunt van het IFC-model', !ifcAvailable), radio('handmatig', 'Handmatig'),
        h('div', { class: 'frow' }, 'X (RD)', iX), h('div', { class: 'frow' }, 'Y (RD)', iY), h('div', { class: 'frow' }, 'Rotatie (°)', iR),
        h('div', { class: 'frow' }, 'Eenheid', unit)),
      h('fieldset', {}, h('legend', {}, 'Weergave'),
        h('div', { class: 'frow' }, 'Kleur', color),
        h('label', { class: 'lrow' }, laagkleur, 'Laagkleuren uit de DXF gebruiken'),
        h('label', { class: 'lrow' }, teksten, 'Teksten tonen'),
        h('div', { class: 'note', style: { marginLeft: 0 } }, 'Lagen:'), lagen),
      d.waarschuwingen.length ? h('div', { class: 'note warn', style: { marginLeft: 0 } }, d.waarschuwingen.join(' ')) : null,
      h('div', { class: 'btnrow' },
        h('button', { class: 'primary', onclick: apply }, 'Toepassen'),
        h('button', { onclick: () => { if (confirm(`Onderlegger ${ref.naam} verwijderen?`)) onRemove(); } }, 'Verwijderen')),
    );
  }

}

function dakTypeNL(t: string | null): string {
  const m: Record<string, string> = {
    horizontal: 'plat', 'multiple horizontal': 'plat, meerdere niveaus', slanted: 'hellend', 'no points': 'onbekend (geen punten)', 'could not detect': 'onbekend',
  };
  return t ? m[t] ?? t : 'onbekend';
}
