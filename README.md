# Comparative Politics Seminar – hemsida

Webbsida: https://comparative-politics-seminar.github.io

Sidan byggs helt från seminariets **Google-kalender**. Varje morgon läser GitHub kalendern,
uppdaterar programmet och publicerar sidan. Sidan avgör själv utifrån dagens datum vad som är
*Current program*, *Upcoming program* och *Previous programs*. Ingenting behöver flyttas när en termin tar slut.

## Lägga in ett seminarium

Skapa en händelse i kalendern "Comparative Politics Seminar":

**Rubrik:** `Namn (Affiliering)`, med affilieringen utskriven i sin helhet.

```
Edmund Kelly (University of Oxford)
```

**Beskrivning:** en rad per uppgift. Alla rader är valfria; skriv bara de som behövs.

```
Title: How does education affect political trust? Evidence from compulsory schooling reforms
Co-authors: Johannes Lindvall
Note: Book presentation
```

**Plats:** lämna tomt (eller skriv F702). Fyll bara i om seminariet är någon annanstans, eller `Online (Zoom)`.

**Tid och dag:** som vanligt i kalendern. Sidan räknar ut vilken dag och tid som gäller för varje termin
(det de flesta seminarierna har) och markerar bara undantagen, så du behöver inte skriva "Note: Wednesday".
Flyttas seminariet permanent, till exempel till måndagar 11–12, behöver du alltså inte ändra något. Det som står
under `standard` i `site/settings.json` används bara för terminer med färre än tre seminarier eller utan tydlig majoritet.

| Situation | Så skriver du | Så visas det |
|---|---|---|
| Titeln är inte klar | `Title: TBA` | *Title TBA* (för seminarier som redan har varit visas ingen titel alls) |
| Flera presentatörer, samma affiliering | Rubrik: `Annekatrin Deglow & Hanne Fjelde (Uppsala University)` | Båda namnen, en affiliering |
| Flera presentatörer, olika affiliering | Rubrik: `Ann Andersson (Stockholm University), Bo Berg (Uppsala University)` | Var och en med sin affiliering |
| Samkört med Allmänna seminariet | `Note: Joint with the Higher Research Seminar` | Etikett: *Joint with the Higher Research Seminar* |
| Digitalt | Plats: `Online (Zoom)` | Etikett: *Online* |
| Inställt | Rubrik: `CANCELLED: David Coen (University College London)` | Etikett: *Cancelled* |
| Platshållare för en ny termin | En återkommande händelse med rubriken `TBA` | *Speaker TBA*. Platshållare som passerat utan att fyllas i visas inte. |

Skulle någon ändå skriva en förkortning (`SU`, `UU`, `GU`, `SSE` …) skrivs den ut på sidan. Listan finns under
`affiliations` i `site/settings.json`.

## Få ändringar att synas direkt

Sidan uppdateras automatiskt en gång per dygn (tidig morgon). För att uppdatera på en gång:
GitHub → repot → **Actions** → **Update program and publish** → **Run workflow**.

## Ändra texterna på sidan

All fast text finns i `site/settings.json`: namn, institution, arrangörer, kontaktadress,
"About"-texten, standardtid och standardlokal, samt listan med förkortningar.
Ändringarna syns på webben när de har pushats, eftersom uppdateringen då körs automatiskt.
Lokalt behöver du köra `node scripts/fetch-calendar.mjs` för att se dem.

## Förhandsgranska lokalt (valfritt)

```
node scripts/fetch-calendar.mjs --report    # hämtar kalendern och visar hur varje händelse tolkades
```

Öppna sedan `site/index.html` genom att dubbelklicka på filen.

Lägg till `?today=2027-08-15` i adressen för att se hur sidan ser ut ett annat datum.

## Filer

- `site/` – själva webbsidan (`index.html`, `app.js`, `style.css`, `settings.json`) och `data/seminars.js`, som skrivs automatiskt. Redigera aldrig den filen för hand.
- `scripts/fetch-calendar.mjs` – läser kalendern och skriver `site/data/seminars.js`.
- `.github/workflows/update.yml` – den dagliga uppdateringen och publiceringen.
