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
  <h2>Handleiding – fase 1 en 2: ondergrond, inmeting, KLIC en obstakels</h2>
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
  <h3>2D en 3D</h3>
  <p><b>2D</b> (<kbd>T</kbd>) toont de kaart recht van boven zonder perspectief: daken liggen precies boven hun footprint
  en een schaalbalk geeft de maat. In <b>3D</b> (<kbd>P</kbd>) hellen hoge gebouwen door het perspectief weg van het
  beeldmidden; vergelijk daar dus geen randen met de luchtfoto. Ook de luchtfoto zelf is geen true-ortho: daken van
  hoge panden liggen op de foto 1–3 m verschoven. De gele lijnen (laag <i>Contouren op maaiveld</i>) tonen de echte footprints.</p>
  <h3>Informatie opvragen</h3>
  <ul>
    <li><b>Muis over een gebouw</b>: goot- en nokhoogte in m NAP en t.o.v. maaiveld, met de peildatum van de bron.</li>
    <li><b>Klik</b> op een gebouw, boom, paal/bord/kast of de grond voor alle details in het paneel rechts.</li>
    <li><b>Hoogtes overschrijven</b>: vul in het paneel de waarden uit tekening in (m NAP) en klik <i>Toepassen</i>.
      Het 3D-model past zich aan; overschreven gebouwen krijgen een <span style="color:#ff8f00;font-weight:600">oranje rand</span>.
      Ook boomhoogte, kroonstraal en onderkant kroon en de hoogte van palen en borden zijn aan te passen.</li>
  </ul>
  <h3>Importeren (menu Importeren)</h3>
  <ul>
    <li><b>Ingemeten perceelgrens (CSV)</b>: puntnummer, X, Y, Z in RD/NAP (scheidingsteken ; , tab of spatie; decimale komma of punt;
      kopregel optioneel). De punten worden in volgorde verbonden. <b>De ingemeten grens heeft voorrang</b> op de BRK-grens bij alle
      controles; zonder inmeting wordt het BRK-perceel gebruikt met de waarschuwing "indicatieve grens".</li>
    <li><b>Ingemeten punten (CSV)</b>: puntnummer, X, Y, Z, code. Per code kies je hoe het punt getoond wordt (paal, putdeksel, boom,
      hoogtemaat, grenspunt, overig of niet tonen). Aanpassen kan later via <i>codes</i> in het lagenpaneel.</li>
    <li><b>KLIC-levering (zip)</b>: de leverings-zip van het Kadaster (IMKL 2.0). Thema's in KLIC-kleuren, per thema aan/uit, met
      diepte-aanduidingen, EV-vlakken, annotaties en maatvoering. Klik op een leiding voor beheerder, status, diameter en diepte.
      Diepten zijn indicatief: graaf altijd proefsleuven.</li>
    <li><b>DXF-onderlegger</b>: 2D-lijnen op maaiveld. Plaatsing: coördinaten in RD, hetzelfde nulpunt als het IFC-model, of handmatig.
      Lagen, kleur en teksten zijn in te stellen.</li>
  </ul>
  <h3>Eigen obstakels tekenen (menu Tekenen)</h3>
  <p>Vrije doorrijhoogte (lijn of vlak), paaltjes, hekwerk en niet-berijdbare vlakken. <b>Klik</b> = punt toevoegen (slepen blijft de
  kaart verschuiven), <b>dubbelklik</b> of <kbd>Enter</kbd> = klaar, <kbd>Backspace</kbd> = laatste punt weg, <kbd>Esc</kbd> = annuleren.
  Daarna kun je naam en hoogte aanpassen of het obstakel verwijderen. Tip: teken in de 2D-weergave (<kbd>T</kbd>).</p>
  <p><b>Bouwhekken</b> zijn hele hekken van 3,50 × 2,00 m: zijden springen naar een veelvoud van 3,50 m (<kbd>Shift</kbd> = vrij).
  Zijden die geen hele hekken zijn, worden rood; <i>Hele hekken maken</i> herstelt dat. Een <b>poort</b> voeg je toe in het paneel
  rechts (standaard 2 hekken = 7,00 m) en verschuif je met het oranje blokje.</p>
  <p><b>Bewerken:</b> selecteer een object en sleep de blauwe bolletjes (hoekpunten), een wit tussenpunt (nieuw hoekpunt) of het
  object zelf (verplaatsen). Dubbelklik op een hoekpunt verwijdert het. Alles is ongedaan te maken met <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p>
  <h3>Bouwplaatselementen (menu ＋ Element)</h3>
  <p>Kies een element (keet, toilet, container 20'/40', afvalcontainer, opslagvlak, laad-/losvak, parkeervak, steiger,
  bouwlift, bouwstroomkast, waterpunt, bord, verkeersregelaar, blok, auto, bestelbus) en klik op de kaart om het te plaatsen
  (<kbd>R</kbd> = draaien vóór plaatsen, <kbd>Esc</kbd> = annuleren). Een steiger springt naar de dichtstbijzijnde gevel.</p>
  <p><b>Bewerken:</b> sleep het element om te verplaatsen, de blauwe blokjes om lengte/breedte te wijzigen en de oranje bol om te
  draaien (stap 5°/15°/90°, <kbd>Shift</kbd> = vrij). Sneltoetsen: <kbd>R</kbd>/<kbd>Shift</kbd>+<kbd>R</kbd> draaien,
  <kbd>Ctrl</kbd>+<kbd>D</kbd> dupliceren, <kbd>Delete</kbd> verwijderen, pijltjes 0,1 m schuiven (met <kbd>Shift</kbd> 1 m).
  In het paneel rechts: naam, label, soort, laag, kleur, maten, stapelen (keten en containers).</p>
  <p><b>Botsingscontrole:</b> een element wordt rood als het een ander element, een gebouw of het nieuwe pand overlapt, over de
  perceelgrens steekt of buiten het eigen perceel valt – tenzij het in een <b>vergunde zone</b> ligt (menu Tekenen). De ingemeten
  grens heeft voorrang op de BRK-grens. Vlakken (opslag, vakken) botsen niet met elementen erop; geparkeerde voertuigen alleen met
  bouwplaatselementen.</p>
  <p><b>Parkeervakken bezet</b> (menu ＋ Element): teken een zone; in alle BGT-parkeervakken erin komt een auto (worst case voor
  draaibewegingen). Wissen via het lagenpaneel.</p>
  <p><b>Routes en vlakken</b> (menu Tekenen): looproute, vluchtroute (stippellijn met pijlen), vrij vlak en vrije lijn met label.</p>
  <h3>Draai- en steekbewegingen (menu 🚚 Route)</h3>
  <ul>
    <li>Kies een voertuig en teken de lijn van de <b>vooras</b> (klik punten, dubbelklik of Enter = klaar). Een nieuw deel
      (<b>+ Vooruit</b> / <b>+ Achteruit</b>) begint waar het voertuig staat. Achteruit volgt de achteras, bij een oplegger de as van de oplegger.</li>
    <li>De app rekent met een kinematisch model (fietsmodel, oplegger met koppelpunt) met begrensde stuurhoek, stuursnelheid en knikhoek.
      Wijkt het voertuig meer dan 0,50 m af van de lijn of schaart de oplegger, dan staat er <b>Niet uitvoerbaar</b>.</li>
    <li>Getoond: omhullende (swept path), wielsporen, spookbeelden en botsingen met gebouwen, het nieuwe pand, elementen, bomen
      (kroon alleen als die lager is dan het voertuig), palen, paaltjes, bouwhekken (poorten zijn vrij), doorrijhoogtes, niet-berijdbare vlakken
      en wielen over trottoir/groen. Klik een melding om erheen te springen.</li>
    <li>Afspelen met de schuif of ▶; <i>Debug</i> toont stuurhoek, draaipool en knikhoek. Alle voertuigmaten zijn te bewerken;
      een opgegeven draaicirkel (stoep-stoep) van de fabrikant gaat voor de maximale stuurhoek.</li>
    <li><b>Indicatief</b> – geen vervanging van gecertificeerde software zoals AutoTURN.</li>
  </ul>
  <h3>Kranen (menu 🏗 Kraan)</h3>
  <ul>
    <li><b>Torenkraan</b> of <b>mobiele kraan</b> plaatsen: klik het hart van de kraan op de kaart. In het paneel stel je haakhoogte,
      giek, contragiek, voet, stempelbasis, giekhoek enz. in, en plak je de <b>lasttabel</b> (per regel: radius; last in t).</li>
    <li>Getoond: zwenkcirkel van giek en contragiek (of staart), draagvermogen-ringen met de max. last, stempelplaten en werkgebied.</li>
    <li>Controles: overdraai over de perceelgrens (ingemeten grens heeft voorrang), openbare weg en buurpanden; hoogteconflict met
      gebouwen, het nieuwe pand, eigen elementen en bomen; overlappende zwenkgebieden van meerdere kranen.</li>
    <li><b>Kan last X op positie Y?</b> Vul de last in, klik een punt: OK of NIET OK op basis van radius en lasttabel (lineair
      geïnterpoleerd, buiten de tabel altijd NIET OK – er wordt nooit geëxtrapoleerd). Esc stopt.</li>
    <li><b>Slepen:</b> pak een kraan (mast, onderwagen of stempelvlak) en sleep hem naar een andere plek; de controles lopen direct mee. Ctrl+Z zet hem terug.</li>
    <li><b>Liebherr MK 88 Plus</b> (mobiele torenkraan 45 m) staat in het menu met het lastblad van de verhuurder: kies in het paneel de
      configuratie (giek 0°, 0° Plus, 15°, 30°, 45° × afstempeling 7,30 × 7,00 of 7,30 × 5,75 m).</li>
    <li>De meegeleverde lasttabellen van de algemene toren- en mobiele kraan zijn voorbeelden: gebruik altijd de tabel van de fabrikant voor de gekozen configuratie.</li>
  </ul>
  <h3>Meten en maatlijnen</h3>
  <p><b>📏 Meten</b> (<kbd>M</kbd>): klik punten op de kaart of op gebouwen. Per stuk zie je de horizontale afstand, het
  hoogteverschil (ΔH) en de 3D-afstand, plus het totaal. Punten springen naar hoeken van gebouwen, het nieuwe pand,
  perceelgrenzen, meetpunten en eigen objecten (roze ring); <kbd>Shift</kbd> = niet springen. Dubbelklik/<kbd>Enter</kbd> = klaar,
  <kbd>Backspace</kbd> = punt terug, <kbd>Esc</kbd> = stoppen. Met <i>Als maatlijn plaatsen</i> bewaar je de meting.</p>
  <p><b>Maatlijn</b> (menu Tekenen): maatlijn of kettingmaat zoals op tekening. De afstand tot de punten stel je in het
  paneel rechts in; hoekpunten zijn te verslepen.</p>
  <h3>Lagenpaneel</h3>
  <p>Klap het paneel in met <b>☰ Lagen</b> (<kbd>L</kbd>) of klap losse secties in door op de kop te klikken.</p>
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
    <tr><td>${k('Ctrl')} + ${k('Z')}</td><td>Ongedaan maken</td><td>${k('T')}</td><td>2D-bovenaanzicht (orthografisch, noord boven, met schaalbalk)</td></tr>
    <tr><td>${k('Ctrl')} + ${k('Y')}</td><td>Opnieuw</td><td>${k('P')}</td><td>3D-aanzicht</td></tr>
    <tr><td>${k('Ctrl')} + ${k('S')}</td><td>Project opslaan</td><td>${k('Z')}</td><td>Zoom naar de sporthal</td></tr>
    <tr><td>${k('Ctrl')} + ${k('O')}</td><td>Project openen</td><td>${k('N')}</td><td>Noord boven</td></tr>
    <tr><td>${k('Esc')}</td><td>Selectie / venster sluiten</td><td>${k('S')}</td><td>Sporthal: normaal → transparant → verborgen</td></tr>
    <tr><td>${k('F1')} of ${k('?')}</td><td>Deze handleiding</td><td>${k('B')}</td><td>Bronnen en nauwkeurigheid</td></tr>
    <tr><td>${k('L')}</td><td>Lagenpaneel in-/uitklappen</td><td>${k('M')}</td><td>Meten</td></tr>
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
