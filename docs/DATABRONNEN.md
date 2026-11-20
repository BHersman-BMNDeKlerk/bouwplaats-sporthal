# Databronnen

Per bron: herkomst, hoe het datascript de endpoint vindt, wat er wordt opgeslagen en de nauwkeurigheid.
De **ophaaldatum, gebruikte versie en peildatum** van de laatst opgehaalde data staan in
`data/manifest.json` en in de app onder **Bronnen**.

Projectgebied: de 4 opgegeven RD-punten + 100 m marge, afgerond op 10 m →
RD x 105440–105770, y 424510–424850 (330 × 340 m). Aan te passen met `npm run data:fetch -- --marge=150` gevolgd door `npm run data:build`.

## Ontdekken in plaats van hardcoden

- **OGC API's (BGT, BRK):** het script zoekt de hoogste beschikbare versie (`…/ogc/v8` → `v1`) en leest de
  collecties uit `/collections`. Let op: PDOK geeft voor niet-bestaande paden soms HTTP 200 met de tekst
  "not found"; het script controleert daarom de inhoud.
- **WCS/WMS (AHN, luchtfoto):** coverages en lagen komen uit `GetCapabilities`; de nieuwste luchtfotojaargang
  met beeld op de locatie wordt automatisch gekozen.
- **3D BAG:** collectie en items-link uit `https://api.3dbag.nl/collections`.

## Overzicht

| Bron | Endpoint (gevonden nov. 2026) | Formaat | Licentie |
|---|---|---|---|
| BGT / IMGeo | `https://api.pdok.nl/lv/bgt/ogc/v1` (OGC API Features) | GeoJSON, RD | CC0 |
| BRK Kadastrale kaart | `https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1` | GeoJSON, RD | CC BY 4.0 |
| 3D BAG | `https://api.3dbag.nl/collections/pand/items` | CityJSON 2.0 (EPSG:7415) | CC BY 4.0 |
| AHN5 DTM/DSM 0,5 m (**in gebruik, 2024**) | `https://basisdata.nl/hwh-ahn/AHN5/…` (kaartblad 44AN2, via `scripts/ahn-bladindex.json`; stuurt door naar `fsn1.your-objectstorage.com`) | Cloud-optimized GeoTIFF | CC0 |
| AHN4 DTM/DSM 0,5 m (terugval) | `https://service.pdok.nl/rws/ahn/wcs/v1_0` (coverages `dtm_05m`, `dsm_05m`) | GeoTIFF | CC0 |
| Luchtfoto | `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0` (laag `2026_orthoHR`) | JPEG-tegels | CC BY 4.0 |

## Details en nauwkeurigheid

### BGT / IMGeo
- Alle collecties behalve bestuurlijke vlakken en historische collecties. Alleen actuele objecten
  (`eind_registratie` leeg, status *bestaand*).
- Vlakken worden op functie ingekleurd: rijbaan, woonerf, parkeervak, fietspad, voetpad, inrit, OV-baan,
  verkeerseiland, erf, (on)verhard terrein, groen, struiken, water, overkapping, enz. (`src/data/bgt.ts`).
- Plus-objecten: bomen (`vegetatieobject_punt`), lichtmasten/palen, borden, kasten, straatmeubilair,
  putten, sensoren, wegmarkering, straatnamen, huisnummers.
- **Nauwkeurigheid:** planimetrisch ca. 0,2–0,3 m. Geen hoogtes. Plus-objecten zijn niet verplicht en
  kunnen onvolledig zijn. **Bovenleiding staat niet in de BGT**: in het gebied ligt spoor (trein).

### BRK – Kadastrale kaart
- Percelen (`perceel`) met aanduiding, grootte en labelpositie; grenzen (`kadastralegrens`).
- **Indicatief.** Grafische weergave: afwijkingen van decimeters tot meer dan een meter zijn mogelijk.
  Niet gebruiken voor uitzetten of grenscontrole. In fase 2 komt de ingemeten grens, die voorrang krijgt.

### 3D BAG
- 384 panden in het gebied, LoD 2.2-geometrie (dakvormen), plus kentallen `b3_h_maaiveld`,
  `b3_h_dak_min/50p/70p/max`, daktype en inwinjaar van de puntenwolk (`b3_pw_bron`, `b3_pw_datum`).
- **Goothoogte** in de app = laagste punt van de dakvlakken (laagste dakrand); **nokhoogte** = hoogste
  dakpunt. Beide in m NAP en t.o.v. `b3_h_maaiveld`.
- **Peildatum:** per gebouw het inwinjaar van de AHN-puntenwolk (vrijwel alle panden: AHN5, 2024).
- **Nauwkeurigheid:** footprint volgens BAG (ca. 0,3 m), dakvorm automatisch gereconstrueerd, RMSE meestal
  < 0,3 m. Kleine opbouwen (installaties, schoorstenen, liftopbouwen) ontbreken → hoogtes per gebouw
  handmatig te overschrijven.

### AHN – maaiveld (DTM) en oppervlak (DSM), 0,5 m
- Het script probeert eerst **AHN5** (2024 voor dit kaartblad) via de AHN-downloads op `basisdata.nl`,
  met HTTP range requests zodat alleen het projectgebied wordt gelezen. Lukt dat niet, dan **AHN4** via de
  PDOK-WCS (inwinning 2020–2022). De gebruikte versie staat in het manifest.
- De kaartbladindex (`scripts/ahn-bladindex.json`) is afgeleid van de AHN-dataroom (via het open-source
  pakket nlmod). Bij een nieuwe AHN-versie deze index vervangen.
- Onder gebouwen en water meet het DTM niet: die cellen zijn opgevuld met een gladde interpolatie
  (push-pull-piramide, `src/data/terrain.ts`) en in de app als *geïnterpoleerd* gemarkeerd.
- **Nauwkeurigheid:** per punt ≤ 5 cm systematisch en ≤ 5 cm stochastisch (68%).
- Controle bij overstap AHN4 → AHN5: op gemeten cellen ligt AHN5 gemiddeld 3 cm lager (10–90%: −7 tot 0 cm),
  dus de rasters zijn goed uitgelijnd.
- Netwerk: het datascript heeft toegang nodig tot `basisdata.nl` én `fsn1.your-objectstorage.com`.

### Luchtfoto
- Nieuwste jaargang met de hoogste resolutie (nu 2026, 8 cm), 16 tegels van ca. 1030 × 1060 px.
- Geen true-ortho: hoge objecten staan schuin en kunnen de grond afdekken.

### Bomen (afgeleid)
- Er is **geen open bomenregister van Dordrecht** gevonden (alleen de bomenlijst als PDF).
- Basis: BGT-plus `vegetatieobject_punt` (type *boom*). Hoogte = hoogste nDSM-punt (DSM − DTM) binnen 3 m;
  kroonstraal uit het hoogteprofiel, minimaal 0,2 × de hoogte. Het AHN wordt in de winter ingewonnen,
  zonder blad, dus kronen lijken in het AHN kleiner.
- Extra bomen die niet in de BGT staan (bv. tuinen) worden als lokale maxima > 4 m in het nDSM gevonden,
  buiten gebouwen en overkappingen en niet bij lantaarnpalen.
- **Onderkant kroon is altijd een aanname** (35% van de hoogte, 2–5 m) en is per boom aan te passen.
  Foute detecties kun je per boom verbergen.

### Obstakels (palen, borden, kasten, straatmeubilair)
- Locatie en type uit BGT-plus. **Hoogtes zijn aannames** per type (bv. lichtmast 6 m, verkeersbord 2,8 m,
  kast 1,3 m) en zijn per object aan te passen.

### Ontwerpmodel (IFC, eigen invoer)
- Huidig model: *240284 l 07-10-2026 l Gymzaal Latourpad.ifc* (VAN ES ARCHITECTEN, Archicad 28, IFC2X3),
  ingelezen met web-ifc via `npm run ifc`. Bouwlagen: fundering −0,80, BG 0, 1e verdieping 3,63, dak 6,64 m (t.o.v. 0 P).
- **Alleen de buitenwerkse contour** wordt gebruikt (projectie van alle bouwdelen boven vloerpeil, 5 cm raster),
  opgedeeld in hoogtezones en in de app getoond als grijze blokken tot de hoogste dakrand per zone. PV-panelen,
  installaties en fundering tellen niet mee. Resultaat: laag deel 202 m² tot 4,21 m boven peil, zaal 298 m² tot
  7,41 m boven peil (= +4,13 en +7,33 m NAP).
- **Peil 0 P = −0,08 m NAP** (opgave werkvoorbereiding, november 2026).
- Het model staat in een lokaal assenstelsel (mm). De IfcSite-coördinaat (51°49′32,8″ N, 4°47′43,9″ O) ligt
  ca. 9 km van de locatie en is dus niet bruikbaar.
- **Ligging:** de contour is automatisch uitgelijnd op de 3D BAG-footprint van pand 0505100000019476
  (rotatie ≈ 5,0°, nulpunt RD x ≈ 105653,59 / y ≈ 424646,81). Gemiddelde afwijking 37 cm (75% binnen 0,5 m);
  de verschillen zitten in het ontwerp zelf (afgeronde hoeken, gevelopbouw). Controleren met de maatvoering
  op tekening; aanpassen kan in de app.
- `data/ontwerp/` staat niet in git (afgeleid van het model van de architect; de repository is openbaar).
