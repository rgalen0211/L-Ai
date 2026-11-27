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
                check(p.locator('#pc-map circle.pc-place').count() == 14, 'the 14 mock business points are drawn')
                check('Click the map' in p.inner_text('#pc-results'), 'before a spot: the page asks for one')
                p.screenshot(path=str(out / f'1-start-{name}.png'), full_page=True)
                box = p.locator('svg.pc-svg').bounding_box()
                p.locator('svg.pc-svg').click(position={'x': box['width'] * 0.55, 'y': box['height'] * 0.5}, timeout=5000)
                p.wait_for_selector('#pc-rings', timeout=5000)
                t = p.inner_text('#pc-results')
                check('observed, 2020 Census' in t and 'calculated' in t and 'estimated' in t, 'every number in the results carries its label')
                check(p.locator('#pc-nearest li').count() == 5, 'the five nearest places are listed')
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
                # a typed spot (keyboard path): Xenia's middle
                p.fill('#pc-lat', '39.6848'); p.fill('#pc-lon', '-83.9297'); p.click('#pc-go')
                p.wait_for_selector('#pc-rings', timeout=5000)
                check('Census block group 39057' in p.inner_text('#pc-results'), 'a typed spot lands in a Greene County block group')
                p.screenshot(path=str(out / f'4-greene-typed-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
                # 2. places not loaded: the page still works and says why
                ctx, p, errors = page('&perfectcity&noplaces')
                p.wait_for_selector('#pc-map svg.pc-svg path', timeout=20000)
                check('not loaded on this account yet' in p.inner_text('#pc-status'), 'no places: the page says the points are not loaded')
                check(p.locator('#pc-map circle.pc-place').count() == 0, 'no places: no points drawn')
                box = p.locator('svg.pc-svg').bounding_box()
                p.locator('svg.pc-svg').click(position={'x': box['width'] * 0.55, 'y': box['height'] * 0.5}, timeout=5000)
                p.wait_for_selector('#pc-rings', timeout=5000)
                check(p.locator('#pc-nearest').count() == 0 and 'People (estimated)' in p.inner_text('#pc-rings'), 'no places: people within the rings only, no made-up distances')
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
