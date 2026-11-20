/** Modale vensters: handleiding en bronnen. */
import type { Manifest } from '../data/types';
import { $, fmtDate, h } from './dom';

export function openModal(content: Node) {
  const m = $('modal');
  const c = m.querySelector('.modal-content')!;
  c.innerHTML = '';
  c.append(content);
  m.hidden = false;
  (m.querySelector('.close') as HTMLButtonElement).onclick = closeModal;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
}

export function closeModal() {
  $('modal').hidden = true;
}

export function modalOpen() {
  return !$('modal').hidden;
}

export function helpContent(): Node {
  const k = (s: string) => h('kbd', {}, s);
  const div = h('div');
  div.innerHTML = `
  <h2>Handleiding – fase 1: ondergrond en omgeving</h2>
  <p>Deze tool toont de projectlocatie <b>Latourpad 16, Dordrecht</b> in 3D met openbare brondata
  (BGT, 3D BAG, AHN, BRK, luchtfoto). In latere fases komen de bouwplaatsinrichting, draaicirkels van
  vrachtwagens, kranen en de export naar de bouwplaatstekening erbij.</p>
  <h3>Navigeren</h3>
  <table>
    <tr><td>Linkermuisknop slepen</td><td>Kaart verschuiven</td></tr>
    <tr><td>Rechtermuisknop slepen (of Ctrl + links)</td><td>Draaien en kantelen</td></tr>
    <tr><td>Scrollwiel</td><td>In- en uitzoomen (naar de muis toe)</td></tr>
    <tr><td>Kompas rechtsboven</td><td>Noord weer boven zetten</td></tr>
  </table>
  <h3>Informatie opvragen</h3>
  <ul>
    <li><b>Muis over een gebouw</b>: goot- en nokhoogte in m NAP en t.o.v. maaiveld, met de peildatum van de bron.</li>
    <li><b>Klik</b> op een gebouw, boom, paal/bord/kast of de grond voor alle details in het paneel rechts.</li>
    <li><b>Hoogtes overschrijven</b>: vul in het paneel de waarden uit tekening in (m NAP) en klik <i>Toepassen</i>.
      Het 3D-model past zich aan; overschreven gebouwen krijgen een <span style="color:#ff8f00;font-weight:600">oranje rand</span>.
      Ook boomhoogte, kroonstraal en onderkant kroon en de hoogte van palen en borden zijn aan te passen.</li>
  </ul>
  <h3>Ontwerpmodel (IFC)</h3>
  <p>Het nieuwe pand staat onder <b>Ontwerp (IFC)</b> als grijze blokken (buitenwerkse contour, per deel tot de
  hoogste dakrand) en als paarse buitencontour op het maaiveld. Klik op het pand voor peil (0 P = −0,08 m NAP),
  bovenkanten en bouwlagen in m NAP. De ligging (RD-positie van het IFC-nulpunt en rotatie) is automatisch bepaald
  door de contour uit te lijnen op het bestaande pand; controleer die met de maatvoering op tekening. Een nieuw model inlezen:
  <code>npm run ifc -- "model.ifc"</code>.</p>
  <h3>Lagen</h3>
  <p>Links zet je lagen aan of uit: luchtfoto, BGT-vlakken per functie (rijbaan, voetpad, parkeervak, …), reliëf,
  hoogtekleuren, gebouwen (de sporthal normaal / transparant / verborgen), perceelgrenzen, bomen en obstakels.</p>
  <h3>Opslaan</h3>
  <p>Alle eigen invoer (overschrijvingen, en later elementen, routes en kranen) staat in één projectbestand (.json).
  Gebruik <i>Opslaan</i> en <i>Openen</i>. De browser onthoudt de laatste stand ook automatisch.</p>
  <h3>Sneltoetsen</h3>
  <table>
    <tr><td>${k('Ctrl')} + ${k('Z')}</td><td>Ongedaan maken</td><td>${k('T')}</td><td>Bovenaanzicht (noord boven)</td></tr>
    <tr><td>${k('Ctrl')} + ${k('Y')}</td><td>Opnieuw</td><td>${k('P')}</td><td>Schuin 3D-aanzicht</td></tr>
    <tr><td>${k('Ctrl')} + ${k('S')}</td><td>Project opslaan</td><td>${k('Z')}</td><td>Zoom naar de sporthal</td></tr>
    <tr><td>${k('Ctrl')} + ${k('O')}</td><td>Project openen</td><td>${k('N')}</td><td>Noord boven</td></tr>
    <tr><td>${k('Esc')}</td><td>Selectie / venster sluiten</td><td>${k('S')}</td><td>Sporthal: normaal → transparant → verborgen</td></tr>
    <tr><td>${k('F1')} of ${k('?')}</td><td>Deze handleiding</td><td>${k('B')}</td><td>Bronnen en nauwkeurigheid</td></tr>
    <tr><td>${k('L')}</td><td>Lagenpaneel in-/uitklappen</td><td></td><td></td></tr>
  </table>
  <h3>Let op</h3>
  <ul>
    <li>De <b>kadastrale grens (BRK) is indicatief</b>. In fase 2 importeer je de ingemeten grens; die heeft dan voorrang.</li>
    <li>Hoogtes van palen, borden en kasten en de onderkant van boomkronen zijn <b>aannames</b> (gemarkeerd). Controleer ter plaatse.</li>
    <li>Het maaiveld onder gebouwen is geïnterpoleerd (het AHN meet daar niet).</li>
    <li>De luchtfoto is geen true-ortho: hoge gebouwen en bomen staan schuin op de foto.</li>
  </ul>
  <h3>Brondata bijwerken</h3>
  <p>In de projectmap: <code>npm run data</code>. Dit haalt alle bronnen opnieuw op (internet nodig) en verwerkt ze in <code>data/</code>.
  Daarna werkt de app weer volledig offline.</p>`;
  return div;
}

export function sourcesContent(m: Manifest): Node {
  const div = h('div', {},
    h('h2', {}, 'Bronnen, herkomst en nauwkeurigheid'),
    h('p', {}, `Projectgebied: RD x ${m.bbox.xmin}–${m.bbox.xmax}, y ${m.bbox.ymin}–${m.bbox.ymax} (${m.bbox.xmax - m.bbox.xmin} × ${m.bbox.ymax - m.bbox.ymin} m; ${m.marge} m marge rond de opgegeven hoekpunten). Coördinatenstelsel RD New (EPSG:28992), hoogtes in m NAP. Data verwerkt op ${fmtDate(m.gegenereerd)}.`),
  );
  for (const b of m.bronnen) {
    div.append(h('div', { class: 'src' },
      h('h3', {}, b.naam, b.status !== 'ok' ? h('span', { class: 'status-fout' }, ` – ${b.status === 'fout' ? 'OPHALEN MISLUKT' : 'niet opgehaald'}`) : null),
      h('table', {},
        h('tr', {}, h('th', { style: { width: '150px' } }, 'Herkomst'), h('td', {}, b.herkomst)),
        h('tr', {}, h('th', {}, 'Opgehaald'), h('td', {}, fmtDate(b.opgehaald))),
        b.versie ? h('tr', {}, h('th', {}, 'Versie'), h('td', {}, b.versie)) : null,
        b.peildatum ? h('tr', {}, h('th', {}, 'Peildatum / inwinning'), h('td', {}, b.peildatum)) : null,
        b.aantal != null ? h('tr', {}, h('th', {}, 'Aantal objecten'), h('td', {}, String(b.aantal))) : null,
        h('tr', {}, h('th', {}, 'Nauwkeurigheid'), h('td', {}, b.nauwkeurigheid)),
        h('tr', {}, h('th', {}, 'Licentie'), h('td', {}, b.licentie)),
        h('tr', {}, h('th', {}, 'Endpoint'), h('td', {}, h('code', {}, b.endpoint))),
        b.opmerkingen?.length ? h('tr', {}, h('th', {}, 'Opmerkingen'), h('td', {}, h('ul', { style: { margin: 0, paddingLeft: '18px' } }, ...b.opmerkingen.map((o) => h('li', {}, o))))) : null,
      )));
  }
  div.append(h('p', { style: { fontSize: '12px', color: '#666' } },
    'Deze tool is een indicatief hulpmiddel voor de werkvoorbereiding. De ondergrond is samengesteld uit openbare registraties die fouten en verouderingen kunnen bevatten. Controleer kritische maten ter plaatse.'));
  return div;
}
