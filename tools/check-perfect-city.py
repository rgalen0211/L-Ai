"""Perfect City page check (GEO 11-27): the working path a signed-in account with the switch perfectCity walks, in real
headless Chrome against the mock (?mock), at desktop and phone widths, and the Coming soon page for an account without it.
The business points in the mock are INVENTED (tests/fake-supabase.js perfect_city_places), never OpenStreetMap data.
Local only: a server on 127.0.0.1 with its own port, nothing sent anywhere. Screenshots go to --out (outside the repo).
  py -I -B tools/check-perfect-city.py --out D:/Ryagram-scratch/GEO/pc-shots
"""
import argparse
import http.server
import pathlib
import re
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
                check('Tap or click the map' in p.inner_text('#pc-results'), 'before a spot: the page asks for one (tap or click)')
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
                official_fast_food = p.inner_text('#pc-official') if p.locator('#pc-official').count() == 1 else ''
                check(p.input_value('#pc-lat') != '' and p.input_value('#pc-lon') != '', 'the spot is written into the typed fields')
                nk = p.inner_text('#pc-not-known')
                check('straight lines' in nk and 'OpenStreetMap' in nk and 'no success score' in nk, 'what it does not know is said')
                cr = p.inner_text('#pc-credits')
                check('OpenStreetMap contributors' in cr and 'Census' in cr and 'not endorsed or certified' in cr, 'the credits name the Census, its API notice and OpenStreetMap')
                check(not re.search(r'NAICS|\b\d{6}\b|cb_20\d\d|B19013|\bP1\b|cbp\d\dco', cr + p.inner_text('#pc-results')), 'no source or industry codes in the credits or the results (plain words)')
                check('American Community Survey 2019 to 2023' in t + cr, f'the survey years from the data ({[x for x in (t + cr).split(chr(10)) if "Survey" in x][:2]})')
                stray = [w for w in ('null', 'undefined', 'NaN') if w in t]
                check(not stray, f'no null, undefined or NaN printed ({stray})')
                check('observed, from OpenStreetMap' in t, 'the nearest places carry their source word')
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
                fw = p.locator('#pc-compare tbody th').first.bounding_box()['width']
                check(fw >= 120, f'compare: the Figure column is readable, not one word a line ({fw:.0f} px)')
                low = ct.lower()
                check(not any(w in low for w in ('better', 'winner', 'score', 'best')), 'compare: no better, winner or score in the table')
                check(p.locator('#pc-spot').count() == 1 and p.locator('#pc-spot-b').count() == 1 and p.locator('circle.pc-ring').count() == 6, 'compare: both spots and both ring sets are on the map')
                st = p.inner_text('#pc-status')
                check('Spot A:' in st and 'Spot B:' in st and 'within 5 km' in st, 'compare: the status line names both spots')
                check(p.locator('#pc-marks').count() == 1 and 'cyan square' in p.inner_text('#pc-marks'), 'compare: the marks are said in words')
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
                # GEO gallery 11-27: the county change clears the typed boxes; the longest county name shows whole in its select
                check(p.input_value('#pc-lat') == '' and p.input_value('#pc-lon') == '', 'county change: the typed boxes are cleared (no old spot left in them)')
                fit = p.evaluate("""() => { const s = document.getElementById('pc-county'), cs = getComputedStyle(s), c = document.createElement('canvas').getContext('2d');
                  c.font = cs.font; return c.measureText(s.options[s.selectedIndex].text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 20 <= s.clientWidth; }""")
                check(fit, 'Greene County, Ohio (Beavercreek, Xenia) fits in the County select (text, padding and arrow)')
                # a spot outside the county: said once, nothing drawn, no Compare offered
                p.fill('#pc-lat', '40.5'); p.fill('#pc-lon', '-82.5'); p.click('#pc-go')
                p.wait_for_timeout(300)
                check(p.inner_text('main').count('That spot is outside the county.') == 1 and p.locator('#pc-spot').count() == 0
                      and p.locator('circle.pc-ring').count() == 0 and p.locator('#pc-compare-add').count() == 0,
                      'a spot outside the county: the sentence once, no dot or rings, no Compare offered')
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
                check(all(x in labels for x in ('Chicken places', 'Burger places', 'Pizza places', 'Sandwich places', 'Mexican places', 'Asian places')),
                      'chicken, burger, pizza, sandwich, Mexican and Asian places are offered in Greene')
                p.select_option('#pc-kind', label='Chicken places')
                for _ in range(100):
                    if 'Nearest chicken places' in p.inner_text('#pc-results'): break
                    p.wait_for_timeout(100)
                check('Nearest chicken places' in p.inner_text('#pc-results') and p.locator('#pc-nearest li').count() == 5,
                      'Chicken places: the five nearest are listed for the spot')
                check('Chicken places (calculated)' in p.inner_text('#pc-rings'), 'Chicken places: the rings count them, labelled calculated')
                official_chicken = p.inner_text('#pc-official') if p.locator('#pc-official').count() == 1 else ''
                check("The Census Bureau's count of limited-service restaurants (fast food) in this county (County Business Patterns 2023, observed): 515. The map data has 14 of this kind loaded." == official_fast_food
                      and official_chicken == 'The Census does not count chicken, burger, pizza, sandwich, Mexican or Asian places separately.',
                      f'the official Census count is said beside the loaded count (Montgomery fast food), and chicken says the Census does not count it ({official_fast_food!r}, {official_chicken!r})')
                p.screenshot(path=str(out / f'4b-greene-chicken-{name}.png'), full_page=True)
                # a new food sub-kind (2026-11-27): Asian places, with its limits sentence (independents often untagged, so undercounted)
                p.select_option('#pc-kind', label='Asian places')
                for _ in range(100):
                    if 'Nearest Asian places' in p.inner_text('#pc-results'): break
                    p.wait_for_timeout(100)
                check('Nearest Asian places' in p.inner_text('#pc-results') and p.locator('#pc-nearest li').count() == 5
                      and 'Asian places (calculated)' in p.inner_text('#pc-rings'), 'Asian places: the five nearest are listed and the rings count them, labelled calculated')
                limits_asian = p.inner_text('#pc-kind-limits') if p.locator('#pc-kind-limits').count() == 1 else ''
                official_asian = p.inner_text('#pc-official') if p.locator('#pc-official').count() == 1 else ''
                check('Independent places are often not tagged with a cuisine, so Asian places are undercounted.' in limits_asian
                      and official_asian == 'The Census does not count chicken, burger, pizza, sandwich, Mexican or Asian places separately.',
                      f'Asian places: the limits sentence says they are undercounted, and the Census does not count them ({limits_asian!r}, {official_asian!r})')
                # bank branches (2026-11-27): FDIC Summary of Deposits, not OpenStreetMap; the credit, the not-known line and the official line follow the kind
                check('Bank branches' in [o.inner_text() for o in p.locator('#pc-kind option').all()], 'Bank branches are offered in Greene')
                p.select_option('#pc-kind', label='Bank branches')
                for _ in range(100):
                    if 'Nearest bank branches' in p.inner_text('#pc-results') and 'FDIC' in p.inner_text('#pc-credits'): break
                    p.wait_for_timeout(100)
                check('Nearest bank branches' in p.inner_text('#pc-results') and p.locator('#pc-nearest li').count() == 5
                      and 'Bank branches (calculated)' in p.inner_text('#pc-rings') and 'Test Bank Branch' in p.inner_text('#pc-nearest'),
                      'Bank branches: the five nearest (invented) branches are listed and the rings count them, labelled calculated')
                limits_bank = p.inner_text('#pc-kind-limits') if p.locator('#pc-kind-limits').count() == 1 else ''
                official_bank = p.inner_text('#pc-official') if p.locator('#pc-official').count() == 1 else ''
                check(limits_bank == 'FDIC-insured bank branches only. Credit unions are not included.', f'Bank branches: the limits line ({limits_bank!r})')
                check(official_bank == "The Census Bureau's count of bank offices in this county is 36 (observed, County Business Patterns 2023); the FDIC branch list has 14 loaded."
                      and 'NAICS' not in official_bank and '522110' not in official_bank, f'Bank branches: the official line in plain words, no code ({official_bank!r})')
                cr_bank, nk_bank = p.inner_text('#pc-credits'), p.inner_text('#pc-not-known')
                check('Bank branches: FDIC Summary of Deposits, June 30, 2026' in cr_bank and 'OpenStreetMap' not in cr_bank
                      and p.locator('#pc-credits a[href*="openstreetmap"]').count() == 0, f'Bank branches: the credit is FDIC, with no OpenStreetMap credit or link ({cr_bank[-160:]!r})')
                check('FDIC Summary of Deposits' in nk_bank and 'OpenStreetMap' not in nk_bank, 'Bank branches: what it does not know names the FDIC list, not OpenStreetMap')
                p.screenshot(path=str(out / f'4d-greene-bank-{name}.png'), full_page=True)
                p.select_option('#pc-kind', 'fast_food')
                for _ in range(100):
                    if 'OpenStreetMap' in p.inner_text('#pc-credits'): break
                    p.wait_for_timeout(100)
                cr_food = p.inner_text('#pc-credits')
                check('OpenStreetMap contributors' in cr_food and 'FDIC' not in cr_food and p.locator('#pc-credits a[href*="openstreetmap"]').count() == 1
                      and 'OpenStreetMap' in p.inner_text('#pc-not-known'), 'back to fast food: the OpenStreetMap credit, its link and its not-known line return')
                p.wait_for_timeout(300)
                check(p.locator('#pc-kind-limits').count() == 0, 'a base kind (fast food) has no food sub-kind limits sentence')
                check('null' not in p.inner_text('#pc-results').split(), 'no bare "null" is written into the results (below 60 places there is no cap note)')
                p.screenshot(path=str(out / f'4c-greene-asian-{name}.png'), full_page=True)
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
                check('points are not loaded yet' in p.inner_text('#pc-status'), 'no places: after a spot, the page says the points are not loaded')
                p.screenshot(path=str(out / f'5-no-places-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
                # 2b. a dense cluster (RENDERER 09:12): 80 invented places within 2 km of the county's middle, more than the 60 one answer carries.
                # With the server's true counts ('within') the page prints them; without them (an older server) it says 'at least'.
                for q, true_counts in (('&perfectcity&denseplaces', True), ('&perfectcity&denseplaces&nowithin', False)):
                    ctx, p, errors = page(q)
                    p.wait_for_selector('#pc-map svg.pc-svg path', timeout=20000)
                    p.fill('#pc-lat', '39.7600'); p.fill('#pc-lon', '-84.2000'); p.click('#pc-go')
                    p.wait_for_selector('#pc-rings', timeout=5000)
                    cells = [x.inner_text().strip() for x in p.locator('#pc-rings tbody tr td:nth-child(2)').all()]
                    dots = p.locator('#pc-map circle.pc-place').count()
                    if true_counts:
                        check(len(cells) == 3 and cells[1].isdigit() and int(cells[1]) >= 80 and not any('at least' in c for c in cells),
                              f'dense cluster: the 2 km ring shows the true count, 80 or more, not the 60 sent ({cells})')
                        check(p.locator('#pc-map-capped').count() == 1 and 'nearest 60' in p.inner_text('#pc-map-capped') and p.locator('#pc-capped').count() == 0,
                              'dense cluster: the page says the map shows only the nearest 60')
                    else:
                        check(len(cells) == 3 and cells[1].startswith('at least') and cells[2].startswith('at least'),
                              f'dense cluster, older server (no within): the 2 and 5 km rings say at least ({cells})')
                        check(p.locator('#pc-capped').count() == 1 and p.locator('#pc-map-capped').count() == 0, 'dense cluster, older server: the at-least note is shown')
                    check(dots == 60, f'dense cluster: the map draws the 60 places sent ({dots})')
                    p.screenshot(path=str(out / f'5b-dense-{"within" if true_counts else "old-server"}-{name}.png'), full_page=True)
                    check(not errors, f'no page errors ({errors[:2]})')
                    ctx.close()
                # 2c. places fail (?placeserr): a real Try again button, a 44 px target, that asks again
                ctx, p, errors = page('&perfectcity&placeserr')
                p.wait_for_selector('#pc-map svg.pc-svg path', timeout=20000)
                rb = p.locator('#pc-retry').bounding_box() if p.locator('#pc-retry').count() == 1 else None
                check(rb is not None and rb['height'] >= 44 and rb['width'] >= 44, f'places fail: a Try again button, at least 44 px ({rb and (round(rb["width"]), round(rb["height"]))})')
                if rb:
                    p.click('#pc-retry')
                    p.wait_for_timeout(500)
                check(p.locator('#pc-retry').count() == 1 and 'Still not working. Try again in a few minutes.' in p.inner_text('#pc-status'), 'places fail: Try again, still failing, keeps the button and says so')
                p.screenshot(path=str(out / f'5b-places-error-{name}.png'), full_page=True)
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
                gap = -1
                if p.locator('.soon-tag-big').count() == 1 and p.locator('main a.back').count() >= 1:
                    tg, bk = p.locator('.soon-tag-big').bounding_box(), p.locator('main a.back').first.bounding_box()
                    gap = bk['x'] - (tg['x'] + tg['width']) if bk['y'] < tg['y'] + tg['height'] and tg['y'] < bk['y'] + bk['height'] else bk['y'] - (tg['y'] + tg['height'])
                check(gap >= 8, f'no switch: the COMING SOON tag and All projects keep a gap ({gap:.0f} px)')
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
