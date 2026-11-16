"""
E2E test zadání smart home (Playwright) proti tests/e2e/mock-intake.mjs.
Spuštění: python3 tests/e2e/smarthome_e2e.py <url webu> <url mock API> <složka fixtures> <složka screenshotů>
"""
import sys
from playwright.sync_api import expect, sync_playwright

SITE, MOCK, FIX, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "FAIL ") + name)


def pick(pg, q, v):
    pg.locator(f'label.choice:has(input[name="{q}"][value="{v}"])').click()


def cont(pg):
    pg.get_by_role("button", name="Pokračovat").click()


with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1280, 900, "desktop"), (390, 844, "mobil")]:
        ctx = b.new_context(viewport={"width": w, "height": h})
        ctx.add_init_script(f"window.FVSOL_CONFIG = {{ functionsUrl: '{MOCK}/functions/v1' }};")
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/ags.cuzk.gov.cz/**", lambda r: r.abort())
        pg.goto(f"{SITE}/zadani/?sluzba=smarthome")
        check(f"{tag}: dlaždice Smart home předvybraná", pg.locator('[data-service="smarthome"]').get_attribute("aria-pressed") == "true")
        pg.screenshot(path=f"{OUT}/sh-{tag}-start.png", full_page=True)
        pg.locator('[data-service="smarthome"]').click()
        expect(pg.get_by_role("heading", name="Co potřebujete")).to_be_visible()
        cont(pg)
        check(f"{tag}: rozsah je povinný", pg.locator(".error").count() >= 1)
        pick(pg, "sh_rozsah", "nova")
        pick(pg, "sh_faze", "hruba")
        pick(pg, "sh_system", "loxone")
        pick(pg, "sh_vystupy", "pudorysy")
        pg.screenshot(path=f"{OUT}/sh-{tag}-1.png", full_page=True)
        cont(pg)
        expect(pg.get_by_role("heading", name="Dům")).to_be_visible()
        pg.locator("#site-q").fill("Polní 10 Jablonec")
        pg.locator("#site-sug li").first.wait_for()
        pg.locator("#site-q").press("ArrowDown")
        pg.locator("#site-q").press("Enter")
        pg.locator(".site-facts").wait_for()
        pick(pg, "objekt_typ", "rd")
        pick(pg, "sh_podlazi", "1")
        pick(pg, "sh_mistnosti", "10")
        pick(pg, "sh_dalsi", "garaz")
        cont(pg)
        check(f"{tag}: půdorysy – povinná otázka", pg.locator('[data-q="sh_vykresy"] .error').count() == 1)
        pick(pg, "sh_vykresy", "dwg")
        cont(pg)
        expect(pg.get_by_role("heading", name="Technika domu")).to_be_visible()
        pick(pg, "sh_vytapeni", "tc")
        pick(pg, "sh_otopna", "podlahove")
        pick(pg, "sh_vzt", "ano")
        pick(pg, "sh_fve", "fve_baterie")
        pick(pg, "sh_stineni", "zaluzie")
        pg.fill("#q-sh_typy", "TČ Nibe S2125, rekuperace Atrea")
        pg.screenshot(path=f"{OUT}/sh-{tag}-3.png", full_page=True)
        cont(pg)
        expect(pg.get_by_role("heading", name="Funkce")).to_be_visible()
        cont(pg)
        check(f"{tag}: funkce jsou povinné", pg.locator('[data-q="sh_funkce"] .error').count() == 1)
        check(f"{tag}: bez osvětlení se na světla neptám", pg.locator('.q[data-q="sh_osvetleni"]').count() == 0)
        for v in ["osvetleni", "stineni", "vytapeni", "audio", "zabezpeceni"]:
            pick(pg, "sh_funkce", v)
        check(f"{tag}: s osvětlením otázka na světla", pg.locator('.q[data-q="sh_osvetleni"]').count() == 1)
        check(f"{tag}: s audiem otázka na zóny", pg.locator('.q[data-q="sh_audio"]').count() == 1)
        pick(pg, "sh_osvetleni", "stmivani")
        pick(pg, "sh_audio", "6")
        pick(pg, "sh_ovladani", "app")
        pick(pg, "sh_data", "ano")
        pg.fill("#q-sh_mistnosti_popis", "Obývák: stmívání, audio.")
        pg.screenshot(path=f"{OUT}/sh-{tag}-4.png", full_page=True)
        cont(pg)
        expect(pg.get_by_role("heading", name="Rozpočet a termín")).to_be_visible()
        pick(pg, "sh_rozpocet", "strop")
        check(f"{tag}: pevný rozpočet → pole částky", pg.locator("#q-sh_rozpocet_castka").count() == 1)
        pg.fill("#q-sh_rozpocet_castka", "400 000 Kč")
        pick(pg, "sh_montaz", "hledam")
        pick(pg, "termin", "bezny")
        cont(pg)
        expect(pg.get_by_role("heading", name="Podklady")).to_be_visible()
        check(f"{tag}: nabídnuté podklady smart home", all(pg.locator(f'.files-cat[data-cat="{c}"]').count() == 1 for c in ["pudorysy", "okna", "technika", "svetla"]))
        check(f"{tag}: u novostavby se nechce stávající elektro", pg.locator('.files-cat[data-cat="elektro"]').count() == 0)
        pg.set_input_files("#file-pudorysy", [f"{FIX}/vektor.pdf"])
        pg.wait_for_function("document.querySelectorAll('.file-list li').length >= 1 && !document.querySelector('.file-list .bar')")
        pg.screenshot(path=f"{OUT}/sh-{tag}-5.png", full_page=True)
        cont(pg)
        expect(pg.get_by_role("heading", name="Kontakt")).to_be_visible()
        pg.fill("#q-kontakt_jmeno", "Jan Novák")
        pg.fill("#q-kontakt_email", "jan@example.cz")
        pick(pg, "role", "investor")
        pg.check("#q-souhlas")
        cont(pg)
        expect(pg.get_by_role("heading", name="Přehled")).to_be_visible()
        txt = pg.locator("#app").inner_text()
        check(f"{tag}: přehled obsahuje odpovědi", "Tepelné čerpadlo" in txt and "400 000 Kč" in txt)
        check(f"{tag}: přehled ukazuje chybějící výpis oken", "Výpis oken" in txt)
        pg.screenshot(path=f"{OUT}/sh-{tag}-6.png", full_page=True)
        pg.get_by_role("button", name="Odeslat zadání").click()
        pg.wait_for_timeout(800)
        pg.screenshot(path=f"{OUT}/sh-{tag}-7.png", full_page=True)
        check(f"{tag}: zadání odesláno", "SH" in pg.locator("#app").inner_text() or "přijal" in pg.locator("#app").inner_text().lower() or "odesl" in pg.locator("#app").inner_text().lower())
        sw = pg.evaluate("document.documentElement.scrollWidth")
        check(f"{tag}: bez vodorovného posunu", sw <= w)
        check(f"{tag}: bez chyb JS {errs}", not errs)
        ctx.close()

    # hlavní stránka – služby a portfolio
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.route("**/calconic.com/**", lambda r: r.abort())
    pg.goto(f"{SITE}/")
    check("web: služba smart home", pg.locator('a[href="zadani/?sluzba=smarthome"]').count() >= 2)
    check("web: dvě ukázky smart home v portfoliu", pg.locator("#posts .item.smarthome").count() == 2)
    for f in ["smarthome-rd-osvetleni", "smarthome-rozvadec-loxone"]:
        ok = pg.evaluate(f"""fetch('images/portfolio/thumbs/{f}.webp').then(r=>r.ok)""") and pg.evaluate(f"""fetch('images/portfolio/{f}.webp').then(r=>r.ok)""")
        check(f"web: obrázek {f}", ok)
    pg.locator("#services-section").scroll_into_view_if_needed()
    pg.wait_for_timeout(1500)
    pg.locator("#services-section").screenshot(path=f"{OUT}/web-sluzby.png")
    pg.locator('#filters a[data-filter=".smarthome"]').click()
    pg.wait_for_timeout(1500)
    pg.locator("#portfolio-section").screenshot(path=f"{OUT}/web-portfolio.png")
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} OK")
sys.exit(1 if failed else 0)
