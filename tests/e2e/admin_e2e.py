"""
E2E test administrace (Playwright) s náhradní datovou vrstvou tests/e2e/admin_fake.js.
Spuštění: python3 tests/e2e/admin_e2e.py <url webu> <složka fixtures> <složka screenshotů>
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE, FIX, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FAKE = (Path(__file__).parent / "admin_fake.js").read_text(encoding="utf-8")
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "FAIL ") + name)


def calls(pg, name):
    return pg.evaluate(f"window.__calls.filter(c => c[0] === '{name}' || c[1] === '{name}')")


with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1366, 900, "d"), (390, 844, "m")]:
        ctx = b.new_context(viewport={"width": w, "height": h})
        ctx.add_init_script(FAKE)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.route("**/ags.cuzk.gov.cz/**", lambda r: r.abort())
        pg.goto(f"{SITE}/admin/")
        pg.locator("#login-form").wait_for()
        if tag == "d":
            pg.fill("#l-email", "fholesz@gmail.com")
            pg.fill("#l-pass", "spatne")
            pg.get_by_role("button", name="Přihlásit").click()
            pg.get_by_text("Špatný e-mail nebo heslo.").wait_for()
            check("admin: špatné heslo odmítnuto", True)
            pg.fill("#l-email", "cizi@example.cz")
            pg.fill("#l-pass", "heslo123")
            pg.get_by_role("button", name="Přihlásit").click()
            pg.get_by_text("Bez přístupu").wait_for()
            check("admin: účet mimo personál nemá přístup", True)
            pg.get_by_role("button", name="Odhlásit").first.click()
            pg.locator("#login-form").wait_for()
        pg.fill("#l-email", "fholesz@gmail.com")
        pg.fill("#l-pass", "heslo123")
        pg.get_by_role("button", name="Přihlásit").click()
        pg.locator("table.tbl").wait_for()
        rows = pg.locator("tr.row")
        check(f"[{tag}] seznam: odeslané zakázky bez rozpracovaných", rows.count() == 2)
        pg.screenshot(path=f"{OUT}/a-list-{tag}.png", full_page=True)
        pg.select_option("#f-service", "lps")
        check(f"[{tag}] filtr služby", pg.locator("tr.row").count() == 1 and "Z26-0002" in pg.locator("tr.row").inner_text())
        pg.select_option("#f-service", "")
        pg.select_option("#f-status", "ceka_na_podklady")
        check(f"[{tag}] filtr stavu", pg.locator("tr.row").count() == 1)
        pg.select_option("#f-status", "")
        pg.fill("#f-q", "solar")
        check(f"[{tag}] hledání", pg.locator("tr.row").count() == 1)
        pg.fill("#f-q", "")
        pg.check("[data-f=drafts]")
        pg.locator("tr.row").nth(2).wait_for()
        check(f"[{tag}] i neodeslaná zadání", pg.locator("tr.row").count() == 3)
        pg.uncheck("[data-f=drafts]")
        pg.locator("tr.row").filter(has_text="Z26-0001").click()
        pg.get_by_role("heading", name="Z26-0001").wait_for()
        body = pg.locator("#app").inner_text()
        check(f"[{tag}] detail: úplnost, zadání, stavba, podklady", all(x in body for x in ["Úplnost zakázky", "Zadání", "Stavba", "pudorys.pdf", "Vektorové PDF"]))
        check(f"[{tag}] detail: rozměry označené jako odhad", "(odhad)" in body)
        check(f"[{tag}] detail: zpracování zablokované před potvrzením", pg.get_by_role("button", name="Situace DXF z katastru").is_disabled())
        pg.screenshot(path=f"{OUT}/a-detail-{tag}.png", full_page=True)
        if tag == "m":
            sw = pg.evaluate("document.documentElement.scrollWidth")
            check(f"[m] detail bez vodorovného posunu ({sw})", sw <= 390)
        # postup
        pg.fill("#wf-note", "podklady OK")
        pg.get_by_role("button", name="Hotovo").click()
        pg.get_by_text("Poslat cenovou nabídku").locator("xpath=ancestor::li").get_by_role("button", name="Hotovo").wait_for()
        c = calls(pg, "workflow")
        check(f"[{tag}] postup: krok kontroly odeslán na server s poznámkou", c and c[-1][2]["step"] == "kontrola_zadani" and c[-1][2]["note"] == "podklady OK")
        pg.get_by_role("button", name="Hotovo").click()
        pg.get_by_role("button", name="Potvrdit – zpracovat").wait_for()
        pg.check("#wf-notify")
        pg.get_by_role("button", name="Potvrdit – zpracovat").click()
        pg.get_by_role("button", name="Situace DXF z katastru").wait_for()
        pg.wait_for_function("!document.querySelector('[data-run=situace_dxf]').disabled")
        c = calls(pg, "workflow")
        check(f"[{tag}] postup: potvrzení s informováním zákazníka", c[-1][2]["step"] == "potvrzeni" and c[-1][2]["notify"] is True)
        check(f"[{tag}] postup: po potvrzení lze zpracovat", not pg.get_by_role("button", name="Situace DXF z katastru").is_disabled())
        pg.get_by_role("button", name="Situace DXF z katastru").click()
        pg.wait_for_function("window.__calls.some(c => c[1] === 'run' && c[2].task === 'situace_dxf')")
        check(f"[{tag}] zpracování: spuštěna situace DXF", True)
        # analýza podkladu
        pg.get_by_role("button", name="Znovu analyzovat").first.click()
        pg.wait_for_function("window.__calls.some(c => c[1] === 'run' && c[2].task === 'analyza_podkladu' && c[2].file_id === 'f1')")
        check(f"[{tag}] analýza konkrétního podkladu", True)
        # výzva k doplnění
        pg.fill("#req-msg", "Pošlete prosím vzor.")
        pg.get_by_role("button", name="Odeslat výzvu").click()
        pg.get_by_text("E-mail neodešel").wait_for()
        c = calls(pg, "info_request")
        check(f"[{tag}] výzva: vybrané chybějící podklady + zpráva", c and "Firemní vzor" in " ".join(c[-1][2]["items"]) and c[-1][2]["message"] == "Pošlete prosím vzor.")
        check(f"[{tag}] výzva: bez e-mailové služby jasné hlášení", True)
        # stav – dokončení bez výstupu zablokováno
        pg.select_option("#st-sel", "dokoncena")
        pg.get_by_role("button", name="Uložit", exact=True).click()
        pg.get_by_text("chybí ověřený a předaný výstup").wait_for()
        check(f"[{tag}] stav: dokončení bez ověřeného výstupu odmítnuto", True)
        # vzory – výběr firmy a vzoru
        pg.select_option("#comp-sel", "c1")
        pg.get_by_role("button", name="Uložit výběr").click()
        pg.get_by_text("Firma změněna").wait_for()
        pg.select_option("[data-tpl-kind=razitko]", "v2")
        pg.get_by_role("button", name="Uložit výběr").click()
        pg.get_by_text("Výběr vzorů uložen").wait_for()
        check(f"[{tag}] vzory: firemní vzor vybrán k zakázce firmy", pg.locator("#tpl-run option").count() >= 1)
        # nový odkaz pro zákazníka
        pg.get_by_role("button", name="Nový odkaz pro zákazníka").click()
        pg.locator("#cust-link").wait_for()
        check(f"[{tag}] odkaz pro zákazníka vytvořen", "#t=" in pg.locator("#cust-link").input_value())
        # poznámka
        pg.fill("#note", "Volal jsem zákazníkovi.")
        pg.get_by_role("button", name="Přidat poznámku").click()
        pg.get_by_text("Volal jsem zákazníkovi.").last.wait_for()
        check(f"[{tag}] poznámka v historii", True)
        # výstup: nahrát, ověřit, předat
        pg.set_input_files("#out-file", [f"{FIX}/sablona.docx"])
        pg.select_option("#out-kind", "technicka_zprava")
        pg.get_by_role("button", name="Nahrát výstup").click()
        pg.locator(".files .nm", has_text="sablona.docx").first.wait_for()
        check(f"[{tag}] výstup nahrán ručně (jednou)", len(calls(pg, "uploadOutput")) == 1 and calls(pg, "uploadOutput")[-1][3] == "technicka_zprava")
        check(f"[{tag}] výstup v seznamu jednou", pg.locator(".files .nm", has_text="sablona.docx").count() == 1)
        check(f"[{tag}] neověřený výstup nelze předat (tlačítko chybí)", pg.get_by_role("button", name="Předat zákazníkovi").count() == 0)
        pg.get_by_role("button", name="Ověřeno").first.click()
        pg.get_by_role("button", name="Předat zákazníkovi").wait_for()
        pg.get_by_role("button", name="Předat zákazníkovi").click()
        pg.get_by_role("button", name="Stáhnout z předání").wait_for()
        c = calls(pg, "release")
        check(f"[{tag}] předání ověřeného výstupu s e-mailem", c[-1][2]["released"] is True and c[-1][2]["notify"] is True)
        pg.screenshot(path=f"{OUT}/a-detail2-{tag}.png", full_page=True)
        narrow = pg.evaluate("[...document.querySelectorAll('.files .nm, .kv dd')].filter(e => e.textContent.trim() && e.getBoundingClientRect().width < 40).length")
        check(f"[{tag}] žádný text nezúžený na nulu (názvy souborů, hodnoty)", narrow == 0)
        # vzory a firmy
        pg.goto(f"{SITE}/admin/#vzory")
        pg.get_by_role("heading", name="Vzory a firmy").wait_for()
        check(f"[{tag}] vzory: univerzální a firemní odděleně", "Univerzální vzory" in pg.locator("#app").inner_text() and "SIMPLY s.r.o." in pg.locator("#app").inner_text())
        pg.fill("#c-name", "Jiskra s.r.o.")
        pg.fill("#c-ico", "12345678")
        pg.get_by_role("button", name="Uložit firmu").click()
        pg.get_by_text("IČO nemá platný tvar").wait_for()
        check(f"[{tag}] firma: neplatné IČO odmítnuto", True)
        pg.fill("#c-ico", "")
        pg.get_by_role("button", name="Uložit firmu").click()
        pg.get_by_text("Firma uložena").wait_for()
        pg.fill("#nt-name", "Technická zpráva FVE – vzor")
        pg.select_option("#nt-kind", "technicka_zprava")
        pg.set_input_files("#nt-file", [f"{FIX}/sablona.docx"])
        pg.get_by_role("button", name="Přidat vzor").click()
        pg.get_by_text("Technická zpráva FVE – vzor").wait_for()
        check(f"[{tag}] nový univerzální vzor s první verzí", calls(pg, "uploadTemplateVersion") != [])
        pg.screenshot(path=f"{OUT}/a-templates-{tag}.png", full_page=True)
        # nastavení
        pg.goto(f"{SITE}/admin/#nastaveni")
        pg.get_by_role("button", name="Poslat zkušební e-mail").click()
        pg.get_by_text("Neodesláno").wait_for()
        check(f"[{tag}] nastavení: test e-mailu hlásí chybějící klíč", True)
        pg.get_by_role("button", name="Zjistit obsazení").click()
        pg.get_by_text("bezplatný tarif").wait_for()
        check(f"[{tag}] nastavení: obsazení úložiště", True)
        check(f"[{tag}] žádné chyby JS", not errs)
        if errs:
            print(errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} kontrol prošlo")
sys.exit(1 if failed else 0)
