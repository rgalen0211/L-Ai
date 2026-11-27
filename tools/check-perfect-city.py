"""Perfect City page check (GEO 11-27): the working path a signed-in account with the switch perfectCity walks, in real
headless Chrome against the mock (?mock), at desktop and phone widths, and the Coming soon page for an account without it.
The business points in the mock are INVENTED (tests/fake-supabase.js perfect_city_places), never OpenStreetMap data.
Local only: a server on 127.0.0.1 with its own port, nothing sent anywhere. Screenshots go to --out (outside the repo).
  py -I -B tools/check-perfect-city.py --out D:/Ryagram-scratch/GEO/pc-shots
"""
import argparse
import http.server
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    out = pathlib.Path(ap.parse_args().out).resolve()
    if ROOT in out.parents or out == ROOT:
        sys.exit('REFUSED: screenshots go outside the repo')
    out.mkdir(parents=True, exist_ok=True)
    srv, base = serve()
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)

                def page(q):
                    ctx = b.new_context(**opts)
                    p = ctx.new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                    p.goto(f'{base}/app/?mock&aiconnected{q}#/d/geo_intelligence', wait_until='load')
                    return ctx, p, errors

                # 1. with the switch: the working page, the map, a spot, the results
                ctx, p, errors = page('&perfectcity')
                p.wait_for_selector('#pc-map svg.pc-svg path', timeout=20000)
                check(p.locator('h1', has_text='Perfect City').count() == 1, 'the working page: heading Perfect City')
                check(p.locator('.soon-tag-big').count() == 0, 'not the Coming soon page')
                check(p.locator('#pc-map svg.pc-svg path').count() == 422, 'Montgomery County: 422 block groups drawn')
                check(p.locator('#pc-map circle.pc-place').count() == 0, 'before a spot: no business points are asked for or drawn (never a whole county)')
                check('Click the map' in p.inner_text('#pc-results'), 'before a spot: the page asks for one')
                p.screenshot(path=str(out / f'1-start-{name}.png'), full_page=True)
                box = p.locator('svg.pc-svg').bounding_box()
                p.locator('svg.pc-svg').click(position={'x': box['width'] * 0.55, 'y': box['height'] * 0.5}, timeout=5000)
                p.wait_for_selector('#pc-rings', timeout=5000)
                t = p.inner_text('#pc-results')
                check('observed, 2020 Census' in t and 'calculated' in t and 'estimated' in t, 'every number in the results carries its label')
                check(p.locator('#pc-nearest li').count() == 5, 'the five nearest places are listed')
                n_dots = p.locator('#pc-map circle.pc-place').count()
                check(5 <= n_dots <= 14, f'after a spot: only the places near it are drawn ({n_dots})')
                check(p.locator('#pc-rings tbody tr').count() == 3 and 'about' in p.inner_text('#pc-rings'), 'three rings, people said as about N')
                check(p.locator('#pc-spot').count() == 1 and p.locator('circle.pc-ring').count() == 3, 'the spot and its three rings are on the map')
                check(p.input_value('#pc-lat') != '' and p.input_value('#pc-lon') != '', 'the spot is written into the typed fields')
                nk = p.inner_text('#pc-not-known')
                check('straight lines' in nk and 'OpenStreetMap' in nk and 'no success score' in nk, 'what it does not know is said')
                cr = p.inner_text('#pc-credits')
                check('OpenStreetMap contributors' in cr and 'Census' in cr and 'not endorsed or certified' in cr, 'the credits name the Census, its API notice and OpenStreetMap')
                scroll = p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                check(scroll, 'no sideways scroll')
                p.screenshot(path=str(out / f'2-spot-{name}.png'), full_page=True)
                # compare two spots: A stays, B is put by a map click, then moved by the typed form (keyboard path), then removed
                check(p.locator('#pc-compare-add').count() == 1, 'after a spot: the Compare with a second spot button is offered')
                p.click('#pc-compare-add')
                check('spot B' in p.inner_text('#pc-status') and p.locator('#pc-compare-remove').count() == 1, 'compare: the page asks for spot B, the Remove button is there')
                check(p.evaluate("document.activeElement && document.activeElement.id") == 'pc-compare-remove', 'compare: focus moves to the Remove button')
                p.locator('svg.pc-svg').click(position={'x': box['width'] * 0.42, 'y': box['height'] * 0.58}, timeout=5000)
                p.wait_for_selector('#pc-compare', timeout=5000)
                heads = [x.inner_text().strip() for x in p.locator('#pc-compare thead th').all()]
                check(heads == ['Figure', 'Spot A', 'Spot B'], f'compare: the table has two spot columns ({heads})')
                check(p.locator('#pc-compare tbody tr').count() == 12 and p.locator('#pc-compare tbody tr').first.locator('td').count() == 2, 'compare: twelve figures, one cell per spot')
                ct = p.inner_text('#pc-compare')
                check('observed, 2020 Census' in ct and 'calculated' in ct and 'estimated' in ct and 'plus or minus' in ct, 'compare: every figure carries its label, income with its margin')
                check('not placed yet' not in ct and 'not loaded' not in ct and 'about' in ct, 'compare: both spots have their figures')
                low = ct.lower()
                check(not any(w in low for w in ('better', 'winner', 'score', 'best')), 'compare: no better, winner or score in the table')
                check(p.locator('#pc-spot').count() == 1 and p.locator('#pc-spot-b').count() == 1 and p.locator('circle.pc-ring').count() == 6, 'compare: both spots and both ring sets are on the map')
                st = p.inner_text('#pc-status')
                check('Spot A:' in st and 'Spot B:' in st and 'within 5 km' in st, 'compare: the status line names both spots')
                check(p.locator('#pc-marks').count() == 1 and 'blue square' in p.inner_text('#pc-marks'), 'compare: the marks are said in words')
                a_before = p.locator('#pc-compare tbody tr').first.locator('td').first.inner_text()
                p.select_option('#pc-target', 'B')
                p.fill('#pc-lat', '39.7589'); p.fill('#pc-lon', '-84.1916'); p.press('#pc-lon', 'Enter')
                for _ in range(50):
                    if '39.75890' in p.locator('#pc-compare tbody tr').first.locator('td').nth(1).inner_text(): break
                    p.wait_for_timeout(100)
                first = p.locator('#pc-compare tbody tr').first.locator('td')
                check('39.75890, -84.19160' in first.nth(1).inner_text() and first.first.inner_text() == a_before, 'compare: a typed spot B moves B only, A stays')
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'compare: no sideways scroll')
                p.screenshot(path=str(out / f'2b-compare-{name}.png'), full_page=True)
                p.click('#pc-compare-remove')
                check(p.locator('#pc-compare').count() == 0 and p.locator('#pc-rings').count() == 1 and p.locator('#pc-spot-b').count() == 0
                      and p.locator('circle.pc-ring').count() == 3 and p.locator('#pc-compare-add').count() == 1, 'remove the second spot: back to one spot, its results and rings')
                check(p.locator('#pc-target').count() == 0 and 'Spot B' not in p.inner_text('#pc-status'), 'remove: the Spot A/B choice and spot B are gone')
                # the shading switch and the other county; grocery is offered only where the data has it
                p.select_option('#pc-shade', 'income')
                check('Median household income (estimated)' in p.inner_text('#pc-map'), 'shade by income: the legend says estimated')
                p.screenshot(path=str(out / f'3-income-{name}.png'), full_page=True)
                check('grocery' in [o.get_attribute('value') for o in p.locator('#pc-kind option').all()], 'Montgomery offers supermarkets')
                p.select_option('#pc-county', 'greene_oh')
                for _ in range(100):
                    if p.locator('#pc-map svg.pc-svg path').count() == 124: break
                    p.wait_for_timeout(100)
                check(p.locator('#pc-map svg.pc-svg path').count() == 124, 'Greene County: 124 block groups drawn')
                check('grocery' not in [o.get_attribute('value') for o in p.locator('#pc-kind option').all()], 'Greene offers no supermarkets (no data downloaded), so none are shown')
                # bad typed input is refused in words, never moved to 0, 0 (a11y walk HIGH 2)
                p.fill('#pc-lat', ''); p.fill('#pc-lon', ''); p.click('#pc-go')
                check('as numbers' in p.inner_text('#pc-status') and p.input_value('#pc-lat') == '', 'empty typed spot: refused in words, the box not rewritten')
                p.fill('#pc-lat', 'abc'); p.fill('#pc-lon', '-83.9'); p.click('#pc-go')
                check('as numbers' in p.inner_text('#pc-status'), 'non-number typed spot: refused in words')
                # keyboard focus stays on Business when it is changed (a11y walk HIGH 1)
                p.focus('#pc-kind'); p.keyboard.press('ArrowDown')
                p.wait_for_timeout(500)
                check(p.evaluate("document.activeElement && document.activeElement.id") == 'pc-kind', 'changing Business with the keyboard keeps focus on it')
                p.select_option('#pc-kind', 'fast_food')
                # a typed spot (keyboard path): Xenia's middle
                p.fill('#pc-lat', '39.6848'); p.fill('#pc-lon', '-83.9297'); p.click('#pc-go')
                p.wait_for_selector('#pc-rings', timeout=5000)
                check('Census block group 39057' in p.inner_text('#pc-results'), 'a typed spot lands in a Greene County block group')
                p.screenshot(path=str(out / f'4-greene-typed-{name}.png'), full_page=True)
                # a food sub-kind (the Ryagram engine's chicken rule): offered in both counties, and picking it shows results for the same spot
                labels = [o.inner_text() for o in p.locator('#pc-kind option').all()]
                check(all(x in labels for x in ('Chicken places', 'Burger places', 'Pizza places')), 'chicken, burger and pizza places are offered')
                p.select_option('#pc-kind', label='Chicken places')
                for _ in range(100):
                    if 'Nearest chicken places' in p.inner_text('#pc-results'): break
                    p.wait_for_timeout(100)
                check('Nearest chicken places' in p.inner_text('#pc-results') and p.locator('#pc-nearest li').count() == 5,
                      'Chicken places: the five nearest are listed for the spot')
                check('Chicken places (calculated)' in p.inner_text('#pc-rings'), 'Chicken places: the rings count them, labelled calculated')
                p.screenshot(path=str(out / f'4b-greene-chicken-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
                # 2. places not loaded: the page still works and says why
                ctx, p, errors = page('&perfectcity&noplaces')
                p.wait_for_selector('#pc-map svg.pc-svg path', timeout=20000)
                check(p.locator('#pc-map circle.pc-place').count() == 0, 'no places: no points drawn')
                box = p.locator('svg.pc-svg').bounding_box()
                p.locator('svg.pc-svg').click(position={'x': box['width'] * 0.55, 'y': box['height'] * 0.5}, timeout=5000)
                p.wait_for_selector('#pc-rings', timeout=5000)
                check(p.locator('#pc-nearest').count() == 0 and 'People (estimated)' in p.inner_text('#pc-rings'), 'no places: people within the rings only, no made-up distances')
                check('not loaded on this account yet' in p.inner_text('#pc-status'), 'no places: after a spot, the page says the points are not loaded')
                p.screenshot(path=str(out / f'5-no-places-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
                # 3. without the switch: the Coming soon page, unchanged
                ctx, p, errors = page('')
                try:
                    p.wait_for_selector('.soon-tag-big, #pc-map', timeout=20000)
                except Exception:
                    p.screenshot(path=str(out / f'6-no-switch-FAILED-{name}.png'), full_page=True)
                    print('  main text:', ' | '.join(p.inner_text('main')[:300].splitlines()))
                check(p.locator('#pc-map').count() == 0 and p.locator('.soon-tag-big').count() == 1, 'no switch: the Coming soon page, no map')
                p.screenshot(path=str(out / f'6-no-switch-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
