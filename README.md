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
