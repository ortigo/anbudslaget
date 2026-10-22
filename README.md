# Anbudsläget

Personlig bevakning av svenska offentliga upphandlingar. Öppna annonser, vinnare, antal anbud och kontraktsvärden per köpare och leverantör, plus sökprofiler med notiser.

Allt är gratis och öppen källkod:

- **Data:** EU:s TED Search API (öppet, ingen nyckel).
- **Import:** GitHub Actions kör `scripts/fetch_ted.py` varje morgon och sparar JSON i `data/`.
- **Webbplats:** GitHub Pages, ren HTML/CSS/JS utan byggsteg.
- **Notiser:** när en bevakning i `watches.json` får nya träffar skapas ett GitHub-ärende tilldelat dig, och GitHub mejlar dig om det.

## Kom igång (ca 10 minuter)

1. Skapa ett nytt repo på GitHub, t.ex. `anbudslaget`. Publikt repo krävs för gratis Pages på ett gratiskonto.
2. Ladda upp alla filer i den här mappen till repot, inklusive den dolda mappen `.github`.
3. **Settings → Pages → Build and deployment → Source:** välj **GitHub Actions**.
4. **Settings → Actions → General → Workflow permissions:** välj **Read and write permissions**.
5. **Actions → Uppdatera data → Run workflow.** Första körningen hämtar 12 månader bakåt och tar några minuter.
6. Sajten finns sedan på `https://<ditt-användarnamn>.github.io/anbudslaget/`.

Därefter uppdateras allt automatiskt varje morgon.

## Anpassa

- **Bevakningar med mejl:** redigera `watches.json`. Varje rad har `name` och `terms` (sökord), och valfritt `cpv` (CPV-prefix) och `lan`. Egna bevakningar kan också läggas till direkt på sajten, men de sparas bara i den webbläsaren och skickar inga notiser.
- **Längre historik:** kör workflowet manuellt med större `backfill_months`. Arkivet sparas i 24 månader (`KEEP_MONTHS`).
- **Notiser:** under *Settings → Notifications* på GitHub styr du om ärenden mejlas.

## Bra att veta

- TED innehåller annonser **över EU:s tröskelvärden**. Mindre upphandlingar som bara finns i svenska annonsdatabaser saknas.
- Fältnamnen i TED:s API ändras ibland. Skriptet tar automatiskt bort fält som API:et inte känner igen och loggar dem. Se `fieldsDropped` i `data/meta.json` efter första körningen. Saknas t.ex. vinnare eller antal anbud har ett fältnamn ändrats och behöver justeras i `FIELDS` i `scripts/fetch_ted.py`.
- Ett publikt repo betyder att `watches.json` syns för andra. Lägg känsliga sökprofiler bara på sajten i stället.
- Värden summeras bara i SEK. Vid flera vinnare delas kontraktsvärdet lika i leverantörsstatistiken.
