# Bouwplaatsinrichting – verbouw sporthal Latourpad 16, Dordrecht

Interactieve 3D-kaart van de projectlocatie en directe omgeving, voor het maken en controleren van de
bouwplaatsinrichting (BPT, overleg met de gemeente, uitvoering).
Leidraad voor alle fases: [`SPEC.md`](SPEC.md). Stand van zaken per fase: zie [Fasering](#fasering).

## Snel starten

Benodigd: [Node.js](https://nodejs.org) 20 of nieuwer.

```bash
npm install
```

```bash
npm run dev
```

Open daarna de adresregel die verschijnt (meestal http://localhost:5173).

De brondata staat al in `data/`. Opnieuw ophalen of bijwerken (internet nodig, ±1 minuut):

```bash
npm run data
```

### Ontwerpmodel (IFC) inladen

```bash
npm run ifc -- "pad/naar/model.ifc"
```

Van het model wordt alleen de buitenwerkse contour gebruikt: per hoogtezone een grijs blok tot de hoogste
dakrand (zonder PV-panelen en installaties), opgeslagen in `data/ontwerp/model.json`. Het verschijnt in de
app onder **Ontwerp (IFC)**. Peil 0 P = −0,08 m NAP (instelbaar in `src/core/projectConfig.ts` en in de app). Heeft het model geen bruikbare georeferentie (zoals de huidige Archicad-export),
dan wordt de buitencontour automatisch uitgelijnd op de 3D BAG-footprint van de sporthal. Controleer en
corrigeer de ligging in de app (X/Y van het IFC-nulpunt in RD, rotatie, peil 0 P in m NAP); de
correctie wordt in het projectbestand bewaard.

> `data/ontwerp/model.json` staat in git (alleen contour, hoogtes en plaatsing – geen detailgeometrie), zodat
> collega's het nieuwe pand direct zien. Bij een nieuwe modelversie het commando hierboven opnieuw draaien en committen.

### Online via GitHub Pages

Bij elke push naar `main` bouwt GitHub de app (inclusief data) en publiceert hem op
https://bhersman-bmndeklerk.github.io/bouwplaats-sporthal/ (workflow `.github/workflows/pages.yml`).
Eenmalig aanzetten: repository → *Settings* → *Pages* → *Build and deployment* → *Source*: **GitHub Actions**.
Let op: de pagina is openbaar, net als de repository.

### Versie voor collega's (statisch, offline)

```bash
npm run build
```

De map `dist/` bevat dan de complete app **inclusief data** (±9 MB). Zet die map op een webserver of
netwerkshare met webserver. Lokaal bekijken kan met:

```bash
npm run preview
```

> Dubbelklikken op `dist/index.html` werkt niet: browsers blokkeren het laden van data vanaf `file://`.

## Fase 2: inmeting, KLIC, obstakels en onderleggers

Alles via de knoppen **Importeren** en **Tekenen** in de app (geen commando's nodig):

| Import | Formaat |
|---|---|
| Ingemeten perceelgrens | CSV: puntnummer, X, Y, Z (RD/NAP). Heeft voorrang op de BRK-grens. |
| Ingemeten punten | CSV: puntnummer, X, Y, Z, code. Codes koppel je aan paal, putdeksel, boom, hoogtemaat, grenspunt of overig. |
| KLIC-levering | De leverings-zip (IMKL 2.0, `GI_gebiedsinformatielevering_*.xml`). |
| DXF-onderlegger | ASCII-DXF; plaatsing in RD, via het IFC-nulpunt of handmatig. |

**Bouwhekken:** getekend als hele hekken van 3,50 × 2,00 m (zijden springen naar veelvouden van 3,50 m, Shift = vrij),
met betonvoeten en poorten (standaard 2 hekken = 7,00 m). Hoekpunten, tussenpunten, poorten en het hele object zijn
versleepbaar; dubbelklik op een hoekpunt verwijdert het.

CSV: scheidingsteken `;` `,` tab of spatie, decimale komma of punt, kopregel optioneel; verwisselde X/Y worden herkend.
Geïmporteerde gegevens worden in het projectbestand bewaard (en automatisch in de browser, IndexedDB).

## Fase 4: draai- en steekbewegingen

Menu **🚚 Route**: kies een voertuig en teken de lijn van de vooras; daarna delen vooruit/achteruit toevoegen.
Model: fietsmodel op de achteras, oplegger via koppelpunt (`src/vehicles/kinematics.ts`), vooruit Stanley-regelaar op de
vooras, achteruit pure pursuit op de achteras (bij oplegger: op de opleggeras met knikhoekregeling). Stuurhoek,
stuursnelheid en knikhoek zijn begrensd; > 0,50 m afwijking of scharen = *niet uitvoerbaar*.
Voertuigbibliotheek met bewerkbare maten in `src/vehicles/vehicles.ts`.

Verplichte tests (`tests/sweptpath.test.ts`):

1. EU-ringtest: trekker-oplegger 16,5 m blijft binnen een ring van 12,50 m buiten / 5,30 m binnen;
2. opleggerstraal in stationaire bocht = √(R<sub>kingpin</sub>² − L<sub>t</sub>²), binnen ±0,10 m;
3. draaicirkel van de fabrikant (stoep-stoep) en muur-muur gereproduceerd binnen ±0,10 m.

> Indicatief hulpmiddel – geen vervanging van gecertificeerde software zoals AutoTURN of Vehicle Tracking.

## Fase 5: kraanopstellingen

Menu **🏗 Kraan**: torenkraan of mobiele kraan plaatsen, lasttabel invoeren (radius; last – plakken uit Excel kan),
controles op overdraai (perceelgrens, openbare weg, buurpanden), hoogteconflicten (gebouwen, nieuw pand, elementen, bomen)
en overlappende zwenkgebieden. *Kan last X op positie Y?* geeft OK / NIET OK via lineaire interpolatie in de lasttabel;
buiten de tabel wordt nooit geëxtrapoleerd. Rekenlogica: `src/cranes/cranes.ts`, tests: `tests/cranes.test.ts`.
De standaard lasttabellen zijn voorbeelden – vervang ze door de tabel van de fabrikant.

## Bediening (kort)

| Actie | Hoe |
|---|---|
| Verschuiven | linkermuisknop slepen |
| Draaien / kantelen | rechtermuisknop slepen |
| Zoomen | scrollwiel (zoomt naar de muis) |
| Info opvragen | muis over gebouw (goot/nok) of klikken op gebouw, boom, paal, grond |
| Hoogte overschrijven | klik gebouw → paneel rechts → waarden in m NAP → *Toepassen* |
| Ongedaan / opnieuw | `Ctrl+Z` / `Ctrl+Y` |
| Opslaan / openen | `Ctrl+S` / `Ctrl+O` (één projectbestand `.json`) |
| 2D-bovenaanzicht (zonder perspectief) / 3D / sporthal | `T` / `P` / `Z` |
| Plaatsing ontwerpmodel | klik op het nieuwe pand → paneel rechts |
| Sporthal normaal → transparant → verborgen | `S` |
| Handleiding / bronnen | `F1` / `B` |

De volledige handleiding staat in de app onder **? Help**.

## Projectbestand

Alle eigen invoer staat in één JSON-bestand (`Opslaan`/`Openen`), met o.a.:

```jsonc
{
  "app": "bouwplaats-sporthal", "versie": 1,
  "project": { "naam": "…", "nummer": "…", "getekendDoor": "…" },
  "overschrijvingen": {
    "gebouwen":  { "NL.IMBAG.Pand.0505100000019476": { "nok": 8.4, "opmerking": "tekening A-201" } },
    "bomen":     { "bgt:G0505.…": { "hoogte": 9, "kroonOnderkant": 4.5 } },
    "obstakels": { "paal:G0505.…": { "hoogte": 7 } }
  },
  "ontwerpPlaatsing": { "x": 105653.595, "y": 424646.852, "rotatie": 5.062, "peil": -0.08 },
  "weergave": { "lagen": { … } },
  "elementen": [], "routes": [], "kranen": []   // fase 3–5
}
```

De browser bewaart de laatste stand ook automatisch (per computer/browser).

## Techniek

- Vite + TypeScript + Three.js, volledig offline na het ophalen van de data.
- Coördinaten: RD New (EPSG:28992), hoogtes in m NAP. De 3D-scène werkt met een lokale origin
  (midden van het projectgebied, afgerond op 10 m) tegen float-precisieproblemen. Zie `src/core/coords.ts`.
- Datascript in Node (`scripts/`): `fetch-data.ts` haalt de bronnen op naar `data/raw/` (niet in git),
  `build-data.ts` verwerkt ze tot compacte bestanden in `data/` plus `data/manifest.json` met herkomst,
  ophaaldatum en nauwkeurigheid per bron.

### Mappen

```
scripts/            datascript (ophalen + verwerken)
src/core/           coördinaten, projectbestand + undo/redo, lagen, tegelindeling
src/data/           verwerking & formaten: CityJSON, terrein, BGT-classificatie, bomen, hoogtes
src/scene/          3D: viewer, terrein, gebouwen, bomen, obstakels
src/ui/             panelen, dialogen
tests/              rekenlogica-tests (vitest)
docs/DATABRONNEN.md herkomst, endpoints en nauwkeurigheid per bron
data/               verwerkte brondata (in git, zodat de app direct werkt)
```

### Tests

```bash
npm test
```

Dekt o.a. coördinaattransformatie, IFC-contour en automatisch uitlijnen, (RD ⇄ lokaal, RD ⇄ WGS84), tegelindeling, terrein-interpolatie en
-bemonstering, 3D BAG-verwerking (met een echte 3D BAG-respons van de sporthal), hoogte-overschrijving,
BGT-classificatie, boomdetectie en undo/redo. Ook de swept path-berekening (zie fase 4); en lasttabel-interpolatie en kraancontroles (fase 5).

## Fasering

| Fase | Inhoud | Status |
|---|---|---|
| 1 | Ondergrond en omgeving: BGT, 3D BAG, AHN, BRK, luchtfoto, bomen, obstakels, lagenpaneel | gereed |
| 2 | Eigen inmeting (CSV), KLIC-import, handmatige obstakels, DXF-onderlegger | gereed (KLIC-kleuren nog te verifiëren) |
| 3 | Bouwplaatselementen (keten, hekken, containers, steigers, …), botsingscontrole, maatvoering | gereed |
| 4 | Draai- en steekbewegingen (swept path) met kinematisch model + verplichte tests | gereed |
| 5 | Kraanopstellingen (toren- en mobiele kraan), lasttabellen, overdraai | **gereed – ter beoordeling** |
| 6 | Output: 2D op schaal, PDF A3/A1 met titelblok, DXF/GeoJSON, PNG, bouwfases | gepland |

## Disclaimer

Indicatief hulpmiddel voor de werkvoorbereiding. De ondergrond komt uit openbare registraties die fouten
of verouderingen kunnen bevatten; de kadastrale grens (BRK) is indicatief. Controleer kritische maten ter
plaatse. Zie `docs/DATABRONNEN.md` en het venster *Bronnen* in de app.
