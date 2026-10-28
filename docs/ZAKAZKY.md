# FVSOL – zakázky z webu

Web zůstává statický na GitHub Pages. Zakázky, soubory a postup běží v Supabase projektu **zakazky-crm** (stejný jako CRM, stejný účet), e-maily přes **Brevo**.

```
fvsol.cz (GitHub Pages)                        Supabase „zakazky-crm“ (EU, Frankfurt)
├─ /            úvodní stránka                 ├─ Edge funkce fvsol-intake  ← formulář (bez účtu, tajný odkaz)
├─ /zadani/     formulář + stránka zakázky ──► │    ├─ ČÚZK (RÚIAN, výškopis) – adresa, parcela, budova
└─ /admin/      administrace (přihlášení) ───► ├─ Edge funkce fvsol-staff   ← administrace (jen tabulka staff)
                                                │    ├─ Brevo – e-maily
                                                │    └─ CRM: tabulka jobs (prostor „FVE a LPS“)
                                                ├─ Postgres: orders, order_files, order_events, … (RLS)
                                                └─ Storage: fvsol-orders, fvsol-templates (soukromé)
```

## Co kde je

| Část | Soubor |
|---|---|
| Služby, otázky, kontrola úplnosti, postup, převod do CRM a do dat TZ | `assets/zakazky/core.js` (sdílí web, administrace i server) |
| Formulář a stránka zakázky | `zadani/index.html`, `assets/zakazky/wizard.js` |
| Administrace | `admin/index.html`, `assets/admin/` |
| Serverové funkce | `supabase/functions/fvsol-intake`, `fvsol-staff` (sdílený kód `_shared/`) |
| Databáze | `supabase/migrations/20261027120000_fvsol_web_orders.sql` |
| Univerzální vzor titulního listu | `vzory/univerzalni-titulni-list.docx` |

Po změně `core.js` nebo `_shared/` spusťte `node scripts/sync-functions.mjs` (zkopíruje sdílený kód do obou funkcí).

## Zakázka krok za krokem

**Zákazník** vybere službu → odpoví na otázky (u každé technické je „Nevím“) → najde stavbu v mapě → nahraje podklady → kontakt → přehled → odeslat.
Rozpracované zadání se průběžně ukládá. Pokračovat jde přes odkaz v adrese (`/zadani/#t=…`), v tomtéž prohlížeči i bez odkazu, nebo přes odkaz poslaný e-mailem.

Rozlišují se tři fáze:

| Fáze | Význam |
|---|---|
| Rozpracované zadání | neodesláno, není to poptávka; po 30 dnech se smaže (tlačítko v Nastavení) |
| Přijatá poptávka | zákazník odeslal; vznikne číslo `Z26-0001`, zakázka v CRM a e-mail |
| Potvrzená objednávka | až po vašem kroku „Nabídka přijata – potvrdit zpracování“ |

**Interní postup** (jen administrace a CRM, na webu se nezobrazuje):
kontrola zadání → cenová nabídka → potvrzení zpracování → zpracování → vaše kontrola a úpravy → odeslání klientovi → schválení / doúpravy → faktura.
Každý krok je úkol v CRM (`fv-z26-0001`). První úkol má termín další pracovní den a v kalendáři CRM je událost „Zkontrolovat zadání …“. Chybějící podklady jsou v CRM jako úkoly „Doplnit od klienta: …“ a odškrtnou se, jakmile je zákazník dodá. Stav v CRM: Poptávka → Nabídka → Objednáno → Hotovo.

**Automatické zpracování** jde spustit až po potvrzení zakázky. Analýza podkladů a načtení údajů z katastru jdou spustit kdykoli.

## Kontrola úplnosti

`core.evaluate()` pro každou zakázku vrací:

- **zadáno**: odpovědi zákazníka,
- **převzato automaticky**: údaje z RÚIAN se štítkem `převzato` nebo `odhad`. Rozměry z obrysu a výšku z výškopisu systém nikdy neuvádí jako zaměřené,
- **k potvrzení**: kdo potvrzuje (zákazník / projektant),
- **chybí**: úroveň `povinné` (nelze odeslat) / `ke zpracování` (blokuje zpracování) / `později` (vyžádat později),
- **posoudí projektant**: všechna „Nevím“ u technických údajů, statika, třída LPS, počet panelů. Počet panelů ani komponenty se automaticky nenavrhují,
- **ruční posouzení**: individuální zakázka, hořlavá krytina, sken bez měřítka, neobvyklý objekt.

Vyplněný formulář není totéž co technicky úplná zakázka. Výstup je vždy potřeba ověřit. Databáze nedovolí předat neověřený výstup ani označit zakázku jako dokončenou bez ověřeného a předaného výstupu.

## Vzory

- **Univerzální vzory** (bez firmy) a **firemní vzory** (firemní profil: název, IČO, adresa, poznámky ke standardům).
- Každé nahrání vytvoří novou verzi. Starší verze zůstávají a výstup si pamatuje, z které verze vznikl.
- K zakázce lze vybrat jen univerzální vzor nebo vzor firmy přiřazené k zakázce. Hlídá to databáze, ne jen formulář.
- Ve vzoru DOCX se použijí značky `{{misto.adresa}}`, `{{investor.nazev}}` … (seznam je v administraci). Co v zakázce není, zůstane ve výstupu **žlutě jako „DOPLNIT – …“**. Struktura dokumentu (razítko, záhlaví, styly) zůstává.
- Technické zprávy s žlutými proměnnými generuje váš nástroj **TZ**: v administraci je „Data pro TZ (JSON)“, výstup odpovídá `docs/project-data.schema.json` z repa TZ. Neznámé hodnoty jsou `null` a vypsané v `_unknown`.
- Obsah chybějících vzorů se nevymýšlí: univerzální titulní list obsahuje jen strukturu a značky.

## Automatizace v systému

| Úloha | Výstup | Poznámka |
|---|---|---|
| Analýza podkladů | štítek u souboru | PDF vektorové / rastrové / smíšené, počet stran, formát listu; verze DWG/DXF; rozlišení a DPI fotek |
| Načíst znovu z RÚIAN | údaje o stavbě | adresa, parcela, k. ú., obrys, odhad rozměrů a výšky |
| Situace DXF z katastru | `Z26-0001_situace_KN_v1.dxf` | DXF R12, S-JTSK (EPSG:5514), metry, hladiny KN_PARCELY, KN_CISLA_PARCEL, KN_BUDOVY, OBJEKT, INFO; skutečné polyčáry, žádný obrázek |
| Data pro TZ | `…_project-data.json` | vstup pro nástroj TZ |
| Vyplnit vzor DOCX | `…_<vzor>_v1.docx` | značky `{{…}}`, neznámé žlutě |
| Do fronty pro TZ / agenta | záznam v `automation_runs` (`runner = external`, `status = queued`) | pro místní nástroj nebo pracovního agenta |

**Externí zpracovatel** (nástroj TZ, agent na PC) čte frontu se service role klíčem: `automation_runs` kde `runner='external' and status='queued'` → nastaví `running` → stáhne podklady z `fvsol-orders/<order_id>/in/…` → nahraje výsledek do `fvsol-orders/<order_id>/out/…` + řádek `order_files` (`direction='out'`, `source='external:<nástroj>'`) → `status='done'` / `failed` s chybou. Výstup zůstane „neověřený“, dokud ho neověříte v administraci.

## Data o stavbě (ČÚZK)

Bezplatné služby ČÚZK (ArcGIS REST, bez klíče, licence CC BY 4.0, atribuce „© ČÚZK“ je v mapě i v DXF). Endpointy jsou převzaté z ARONLINE, kde byly ověřené 20. 10. 2026.
Dotazy jdou přes server s mezipamětí (`geo_cache`, 30 dní, našeptávač 1 den) a limitem 300 dotazů za 10 minut na IP. ČÚZK nezveřejňuje limity zatížení. Když neodpovídá, formulář nabídne ruční zadání a zakázka jde odeslat i tak.
Omezení: obrys budovy je jen u digitalizované katastrální mapy a výška z digitálního modelu povrchu může zachytit stromy nebo být starší než stavba. Oboje je proto jen odhad.

## Bezpečnost

- Anon role nemá k tabulkám přístup. Zákazník pracuje jen přes `fvsol-intake` a tajný odkaz (32 náhodných bajtů, v databázi jen SHA-256 otisk). Každý e-mail nese nový odkaz a staré platí dál.
- Administrace: přihlášení Supabase Auth a e-mail v tabulce `staff`. Účty z CRM bez záznamu ve `staff` do administrace nepustí. Přidání kolegy: `insert into staff(email, name) values ('kolega@firma.cz', 'Jméno');`.
- Soubory jsou v soukromých bucketech, stahuje se přes podepsané odkazy platné 5–10 minut. Zákazník stáhne jen své podklady a uvolněné ověřené výstupy.
- Nahrávání: povolené typy (PDF, DWG, DXF, obrázky, Office, ZIP), nejvýše 50 MB na soubor, 40 souborů a 150 MB na zakázku. Server ověří skutečnou velikost v úložišti.
- Proti spamu: limity na IP (IP se neukládá, jen otisk se solí), past na roboty, minimální doba vyplnění 4 s, úklid starých rozpracovaných zadání.
- Klíče (service role, Brevo) jsou jen v proměnných Edge funkcí. Ve webu je jen publishable key, stejně jako u CRM.
- Historie zakázky (`order_events`) je jen pro zápis.

## Provoz, limity a náklady

| Služba | Tarif | Limity | Cena |
|---|---|---|---|
| GitHub Pages | zdarma | statický web | 0 Kč |
| Supabase (stávající projekt) | Free | DB 500 MB, úložiště 1 GB, přenos 5 GB/měs., soubor max. 50 MB, 500 000 volání funkcí/měs., 2 projekty; **projekt se po týdnu nečinnosti uspí**; bez automatických záloh | 0 Kč; Pro od 25 USD/měs. |
| Brevo | Free | 300 e-mailů/den, v patičce „Sent with Brevo“ | 0 Kč |
| ČÚZK | veřejné služby | nezveřejněné | 0 Kč |

Podmínky jsem ověřil 27. 10. 2026 na supabase.com/pricing a v recenzi Brevo z 1. 10. 2026. Před ostrým provozem je zkontrolujte.

- **Úložiště 1 GB je hlavní limit.** Obsazení ukazuje administrace (Nastavení). Hotové zakázky archivujte k sobě a staré podklady mažte, nebo přejděte na Pro (100 GB).
- **Zálohy:** free tarif je nemá. Doporučuji jednou týdně `pg_dump` (Supabase CLI `supabase db dump`) a stažení bucketů, nebo Pro tarif s denními zálohami.
- **Uspání:** CRM i formulář projekt běžně udrží v provozu. Pro jistotu se hodí monitor (např. UptimeRobot zdarma), který jednou denně zavolá funkci a pošle upozornění při výpadku.

## Nasazení

Nic z toho se neprovede samo. Každý krok potvrzujete vy.

1. **Databáze:** spustit migraci `supabase/migrations/20261027120000_fvsol_web_orders.sql` (SQL editor v Supabase nebo `supabase db push`). Pouze přidává tabulky a buckety, CRM nemění.
2. **Serverové funkce:** nasadit `fvsol-intake` a `fvsol-staff`, obě s **verify_jwt = false** (ověření dělají samy):
   `supabase functions deploy fvsol-intake --no-verify-jwt` a `supabase functions deploy fvsol-staff --no-verify-jwt`.
3. **Proměnné funkcí** (Supabase → Edge Functions → Secrets):
   - `BREVO_API_KEY`: klíč z Brevo (SMTP & API → API keys),
   - `MAIL_FROM=projekce@fvsol.cz`, `MAIL_FROM_NAME=FVSOL – Filip Holesz`, `NOTIFY_EMAIL`: kam chodí upozornění na nové zakázky,
   - `IP_SALT`: libovolný náhodný řetězec,
   - volitelně `SITE_URL` (výchozí https://fvsol.cz), `FVSOL_ORIGINS` (výchozí fvsol.cz, www.fvsol.cz, fholesz-666.github.io), `CRM_WORKSPACE_ID`.
4. **Brevo:** ověřit doménu fvsol.cz (Senders & Domains → DKIM + DMARC záznamy v DNS), jinak e-maily z projekce@fvsol.cz skončí ve spamu.
5. **Web:** sloučit větev `redesign-zakazky` do `main` (pull request). GitHub Pages ji do pár minut zveřejní.
6. **Ověření v ostrém provozu:** odeslat zkušební zakázku → zkontrolovat e-mail, CRM a administraci → v Nastavení poslat zkušební e-mail → v detailu spustit „Situace DXF“ (po potvrzení) a otevřít DXF v CADu.

Návrat k původnímu webu: větev a tag `zaloha-pred-redesignem-2026-10-27`.

## Testy

```bash
npm test                                         # jádro + chráněný obsah webu (node)
deno test --no-config -A supabase/functions/_shared/modules.test.ts   # DXF, DOCX, analýza PDF
python3 -m http.server 8812 &                    # web
node tests/e2e/mock-intake.mjs 8813 &            # zkušební server formuláře
GEO_DOWN=1 node tests/e2e/mock-intake.mjs 8814 & # výpadek ČÚZK
python3 tests/e2e/wizard_e2e.py http://127.0.0.1:8812 http://127.0.0.1:8813 <fixtures> <screenshoty>
python3 tests/e2e/admin_e2e.py  http://127.0.0.1:8812 <fixtures> <screenshoty>
```

`tests/content.test.mjs` porovnává portfolio, text o mně, služby, ARONLINE, FAQ a kontakty se snímkem původní stránky. Pokud chráněný obsah změníte záměrně, aktualizujte i `tests/fixtures/protected-content.json`.
