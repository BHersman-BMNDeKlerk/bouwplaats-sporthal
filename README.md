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

> `data/ontwerp/` staat in `.gitignore`: het model is eigendom van de architect en de GitHub-repository is
> openbaar. Op een andere computer het commando hierboven opnieuw draaien met het IFC-bestand.

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
| Bovenaanzicht / 3D / sporthal | `T` / `P` / `Z` |
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
BGT-classificatie, boomdetectie en undo/redo. In latere fases komen swept path en lasttabel-interpolatie erbij.

## Fasering

| Fase | Inhoud | Status |
|---|---|---|
| 1 | Ondergrond en omgeving: BGT, 3D BAG, AHN, BRK, luchtfoto, bomen, obstakels, lagenpaneel | **gereed – ter beoordeling** |
| 2 | Eigen inmeting (CSV), KLIC-import, handmatige obstakels, DXF-onderlegger | gepland |
| 3 | Bouwplaatselementen (keten, hekken, containers, steigers, …), botsingscontrole, maatvoering | gepland |
| 4 | Draai- en steekbewegingen (swept path) met kinematisch model + verplichte tests | gepland |
| 5 | Kraanopstellingen (toren- en mobiele kraan), lasttabellen, overdraai | gepland |
| 6 | Output: 2D op schaal, PDF A3/A1 met titelblok, DXF/GeoJSON, PNG, bouwfases | gepland |

## Disclaimer

Indicatief hulpmiddel voor de werkvoorbereiding. De ondergrond komt uit openbare registraties die fouten
of verouderingen kunnen bevatten; de kadastrale grens (BRK) is indicatief. Controleer kritische maten ter
plaatse. Zie `docs/DATABRONNEN.md` en het venster *Bronnen* in de app.
