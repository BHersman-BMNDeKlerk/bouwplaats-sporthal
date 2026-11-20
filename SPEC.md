# Opdracht: 3D-bouwplaatsinrichtingstool voor verbouw sporthal

## Werkwijze
- Sla deze volledige opdracht eerst op als SPEC.md in de projectmap. Dit is de leidraad voor alle fases.
- Stel me je vragen als iets onduidelijk is. Maak daarna een kort plan en bouw in fases.
- Na elke fase moet er een werkende versie zijn die ik kan testen. Stop na elke fase en wacht op mijn
  akkoord voordat je verder gaat.
- Als ik in een nieuwe sessie zeg "ga verder met fase X", lees je eerst SPEC.md en de bestaande code.

## Context
Ik ben werkvoorbereider bij een bouwbedrijf. We gaan een sporthal verbouwen op een krappe locatie:
Latourpad 16 in Dordrecht houd het originele pand uit 1969 aan. id nummer: 0505100000019476
Ik wil een interactieve 3D-kaart van de locatie en de directe omgeving. ongeveer tussen deze 4 RD-coördinaten.
x 105664 y 424622
x 105652 y 424750
x 105546 y 424738
x 105571 y 424613
Op die kaart wil ik de bouwplaatsinrichting maken en controleren. Het resultaat gebruik ik voor
de bouwplaatstekening (BPT), het overleg met de gemeente en de uitvoering.

## Techniek
- Webapp: Vite + TypeScript + Three.js. Draait lokaal via npm run dev, met een statische build
  voor collega's.
- Coördinatenstelsel: RD New (EPSG:28992) met hoogtes in NAP. Werk intern met een lokale origin
  rond de projectlocatie om float-precisieproblemen te voorkomen.
- Een apart datascript (Python of Node) haalt voor een bounding box alle brondata op en slaat die
  lokaal op in /data. De app werkt daarna ook offline.
- Projectbestand: één JSON met alle geplaatste elementen, routes, kraanopstellingen en
  handmatige overschrijvingen (opslaan/laden).

## Fase 1 – Ondergrond en omgeving (publieke bronnen)
Zoek zelf de actuele endpoints op via pdok.nl en 3dbag.nl en hardcode geen verouderde URL's.
Bij voorkeur OGC API, anders WFS/WMS/WCS.
- BGT: wegvlakken, voetpaden, fietspaden, parkeervakken, groen, water, erven, scheidingen,
  inclusief functie-attributen (rijbaan, voetpad, enz.) als gekleurde vlakken.
- BAG + 3D BAG (LoD 2.2): gebouwen in 3D op hun werkelijke hoogte met dakvorm. De sporthal zelf
  moet aan/uit te zetten of transparant te maken zijn.
- Hoogtes in 3D: bij klikken of hoveren op een gebouw toon je goothoogte en nokhoogte, zowel in
  m+NAP als ten opzichte van maaiveld, plus de peildatum van de bron. Optioneel: gebouwen
  inkleuren op hoogte. Hoogtes moeten per gebouw handmatig te overschrijven zijn (bv. de sporthal
  met waarden uit tekening). Overschreven waarden worden zichtbaar gemarkeerd.
- AHN (nieuwste beschikbare versie), DTM 0.5 m: maaiveld als terrein-mesh. Hoogteverschillen zijn
  belangrijk voor steken en kraanopstelling.
- BRK kadastrale percelen: perceelgrenzen als lijnen met perceelnummer. Dit is alleen een
  indicatieve onderlegger, toon dat duidelijk (zie fase 2 voor de ingemeten grens).
- Luchtfoto PDOK (hoogste resolutie): als textuur op het terrein, aan/uit te zetten.
- Bomen: BGT-vegetatieobjecten en/of het gemeentelijk bomenregister als dat open beschikbaar is.
  Plaats ze als eenvoudige 3D-bomen met kroonstraal en hoogte (als bekend, anders bewerkbaar).
- Bovengrondse obstakels zoals lantaarnpalen, borden en bovenleiding, voor zover in BGT/IMGeo
  (plus-laag) aanwezig.
- Lagenpaneel met aan/uit per laag.

## Fase 2 – Eigen inmeting en import
- Ingemeten perceelgrens: we meten de grens op locatie in en importeren die als CSV
  (puntnummer, X, Y, Z in RD/NAP). De ingemeten grens heeft voorrang: alle controles (overdraai,
  hekwerk, overlap) gebruiken de ingemeten grens als die er is, anders BRK met een zichtbare
  waarschuwing "indicatieve grens".
- Overige ingemeten punten: CSV-import (puntnummer, X, Y, Z, code). Codes koppelen aan symbolen of
  objecten, bijvoorbeeld een paal, putdeksel, boom of hoogteverschil.
- KLIC: de levering is binnen. Importeren van de KLIC-zip (IMKL/GML) is verplicht. Toon de thema's
  met de officiële KLIC-kleuren, plus diepte als die in de levering staat. Per thema aan/uit.
- Handmatig obstakels toevoegen: vrije doorrijhoogte (viaduct, takken, kabels), paaltjes,
  hekwerk, en "niet berijdbaar"-vlakken.
- Import van een DXF-onderlegger (bijvoorbeeld de nieuwe situatie van de architect) als 2D-lijnen
  op maaiveld.

## Fase 3 – Bouwplaatsinrichting en eigen objecten (versleepbare elementen)
Een bibliotheek met parametrische elementen die je kunt slepen, draaien (snap 5°/15°/90°, vrij met
Shift), schalen in maat en dupliceren. Elk element heeft een naam, maten, kleur en een eigen laag:
- Schaftketen/kantoorunits (standaard 6,0 × 2,4 m, stapelbaar), toiletunit, magazijncontainer
  (20'/40').
- Bouwhekken (Heras) als polylijn met poorten. Toon de lengte live.
- Afvalcontainers, opslagvlakken (materiaal, wapening, steigermateriaal), laad-/losvak,
  parkeervakken.
- Steigers langs de gevel (hoogte en breedte instelbaar), bouwlift, bouwstroomkast, waterpunt.
- Looproutes en vluchtroutes (stippellijn), verkeersmaatregelen en borden, verkeersregelaar-
  positie.
- Vrije vlakken en lijnen met label.
- Eigen objecten die niet in BAG/BRK staan: een element "blok" met instelbare lengte, breedte,
  hoogte, kleur en label, voor schuurtjes, bergingen, overkappingen, containers van derden e.d.
- Geparkeerde voertuigen als obstakel: personenauto (ca. 4,5 × 1,8 × 1,5 m) en bestelbus
  (ca. 6,0 × 2,0 × 2,5 m) als simpele blokken, maten bewerkbaar.
- Optie "parkeervakken bezet": vult alle BGT-parkeervakken in een gekozen zone met auto-blokken,
  om het worst-case scenario voor draaibewegingen te testen.
- Botsingscontrole: waarschuw (rood) als elementen elkaar, gebouwen, eigen blokken of de
  perceelgrens overlappen, of buiten de eigen kavel of de vergunde zone komen.
- Maatvoering: afstandsmeting tussen twee punten en een "maatlijn plaatsen".

## Fase 4 – Draai- en steekbewegingen vrachtwagens (swept path)
- Voertuigbibliotheek met bewerkbare afmetingen. Standaard: trekker-oplegger (16,5 m), bakwagen
  (10–12 m), 4-assige kipper/betonmixer, vrachtwagen met kraan, mobiele kraan (2-, 3- en
  5-assig), bestelbus. Parameters: wielbasis, overhang voor/achter, breedte, hoogte, koppelpunt
  (kingpin), oplegger-wielbasis, max. stuurhoek, max. stuurhoeksnelheid, max. knikhoek
  (standaard ca. 90°) en minimale draaicirkel.
- Route tekenen door een pad te klikken. Het voertuig volgt het pad met een kinematisch model
  (bicycle model, met trailer-volgmodel voor opleggers). Vooruit én achteruit (steken) moeten
  kunnen.
- Realistisch sturen: geen sprongen in stuurhoek, de stuurhoeksnelheid is begrensd. Manoeuvres
  die de grenzen overschrijden worden als "niet uitvoerbaar" gemarkeerd.
- Achteruit steken met oplegger: laat de gebruiker het pad van de achteras van de oplegger
  tekenen en reken de trekker daaruit terug.
- Toon de swept path: het buitencontour van carrosserie en wielsporen, als arcering op de kaart.
  Toon ook de voertuigpositie op meerdere momenten (ghosting).
- Animatie/afspelen met een schuifbalk.
- Debug-weergave (aan/uit): toon per positie de stuurhoek, momentane draaipool, wielsporen per as
  en de knikhoek tussen trekker en oplegger.
- Conflictcontrole met gebouwen, eigen blokken, geparkeerde voertuigen, bomen (kroonhoogte vs.
  voertuighoogte), vrije doorrijhoogtes, paaltjes, stoepranden en bouwplaatselementen. Rode
  markering op het conflictpunt.
- Verplichte geautomatiseerde tests:
  1. EU-ringtest: de trekker-oplegger rijdt een volle cirkel binnen een ring met buitenstraal
     12,50 m en binnenstraal 5,30 m.
  2. Analytische controle: bij een constante cirkel geldt
     straal achteras oplegger = √(R_kingpin² − L²), met L = afstand kingpin–achteras.
     Simulatie en formule moeten binnen ±0,10 m overeenkomen.
  3. Voertuigen met ingevoerde fabrikantgegevens reproduceren de opgegeven draaicirkel
     (muur-muur en stoep-stoep) binnen ±0,10 m.
- Vermeld in de app dat dit indicatief is en geen vervanging van gecertificeerde software zoals
  AutoTURN.

## Fase 5 – Kraanopstellingen
- Torenkraan: positie, ondergronds/voetstuk-afmeting, haakhoogte, gieklengte, contragiek-lengte
  en -hoogte. Invoerbare lasttabel (radius → max. last). Toon:
  - de zwenkcirkel van giek en contragiek in 3D en 2D;
  - de draagvermogen-ringen (bv. elke 5 m, met de max. last als label);
  - waarschuwing bij overdraai over de perceelgrens (ingemeten grens heeft voorrang), openbare
    weg of buurpanden (uit BGT/BAG);
  - hoogteconflict met gebouwen, eigen blokken en bomen.
- Mobiele kraan: positie, stempelbasis (rechthoek van stempelplaten), giekhoek/lengte, radius.
  Invoerbare lasttabel. Toon het werkgebied en de stempelplaten.
- Controle "kan last X op positie Y": klik op een punt, geef het gewicht in en krijg OK of NIET OK
  op basis van radius en lasttabel (lineaire interpolatie, nooit extrapoleren).
- Meerdere kranen moeten kunnen, met een waarschuwing bij overlappende zwenkgebieden.

## Fase 6 – Output voor de bouwplaatstekening
- 2D-bovenaanzicht in orthografische projectie met een vaste schaal (1:100 / 1:200 / 1:250 /
  1:500).
- Export naar PDF in A3/A1 liggend met titelblok (project, nummer, datum, getekend door, schaal,
  fase), legenda (automatisch op basis van gebruikte elementen), noordpijl, schaalbalk en een
  disclaimer over de databronnen.
- Export als DXF (lagen per elementtype) en GeoJSON, zodat het in AutoCAD/BricsCAD en GIS verder
  kan.
- Screenshot-export van 3D-standpunten (PNG).
- Meerdere varianten of bouwfases binnen één project (bv. fase sloop / ruwbouw / afbouw) met
  aan/uit-zetten.

## Eisen
- Nederlandstalige interface.
- Eenvoudig te bedienen voor niet-programmeurs: duidelijke knoppen, undo/redo, sneltoetsen en een
  korte handleiding in de app (README + helpscherm).
- Code netjes opgedeeld (data, scène, elementen, voertuigen, kranen, export) met tests voor de
  rekenlogica: swept path, lasttabel-interpolatie en coördinaattransformatie.
- Documenteer per databron de herkomst, de datum van ophalen en de nauwkeurigheid.

Begin met fase 1 en laat het resultaat zien voordat je verder gaat.
