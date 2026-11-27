"""Zoom map prototype page check (GEO 11-27): the path a signed-in account with the switch zoomMap walks on #/labs/map, in real
headless Chrome against the mock (?mock&zoommap), at desktop (1280) and phone (390) widths: the states, click a state and see its
counties (loaded only then), click a county, back out (focus to the state list), the same by keyboard (the selects), a county file that
fails to load (a clean whole map, then a click, the list and Try again each reload it), DC winning its own tap, and the page staying shut
without the switch (one plain line).
Local only: a server on 127.0.0.1 with its own port, nothing sent anywhere. Screenshots go to --out (outside the repo).
  py -I -B tools/check-zoom-map.py --out D:/Ryagram-scratch/GEO/zoom-shots
"""
import argparse
import http.server
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
US_BOX = '0 0 960 600'


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
                    errors, asked = [], []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
                    p.on('request', lambda r: asked.append(r.url) if '/assets/zoom-map/' in r.url else None)
                    p.goto(f'{base}/app/?mock&aiconnected{q}#/labs/map', wait_until='load')
                    return ctx, p, errors, asked

                def counties(n):
                    for _ in range(100):
                        if p.locator('#zm-svg path.zm-county').count() == n:
                            return True
                        p.wait_for_timeout(100)
                    return False
                no_scroll = lambda: p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                view_box = lambda: p.get_attribute('#zm-svg', 'viewBox')

                # 1. with the switch: the whole map
                ctx, p, errors, asked = page('&zoommap')
                p.wait_for_selector('#zm-svg path.zm-state', timeout=20000)
                check(p.locator('h1', has_text='Zoom map (prototype)').count() == 1, 'the page: heading Zoom map (prototype)')
                check(p.locator('#zm-svg path.zm-state').count() == 49, '49 states drawn (48 contiguous and DC)')
                check(p.locator('#zm-svg path.zm-county').count() == 0 and view_box() == US_BOX, 'no counties yet; the whole-map view')
                check(not [u for u in asked if '/st-' in u], 'no county file asked for before a state is chosen')
                check(p.locator('#zm-back').is_hidden(), 'no Back button on the whole map')
                check('estimated' in p.inner_text('#zm-legend'), 'the legend says estimated')
                check(no_scroll(), 'no sideways scroll (whole map)')
                p.screenshot(path=str(out / f'1-states-{name}.png'), full_page=True)

                # 2. click Ohio: its 88 counties, zoomed
                p.locator('#zm-svg path.zm-state[data-id="39"]').click(timeout=5000)
                check(counties(88), 'click Ohio: its 88 counties drawn')
                check(view_box() != US_BOX, f'the map zoomed in (viewBox {view_box()})')
                check([u.split('/assets/zoom-map/')[1].split('?')[0] for u in asked if '/st-' in u] == ['st-39.js'], 'only Ohio\'s county file was loaded')
                check(p.locator('#zm-back').is_visible() and p.input_value('#zm-state') == '39', 'Back is shown; the list says Ohio')
                t = p.inner_text('#zm-detail')
                check('Ohio' in t and 'estimated' in t and 'observed' in t, 'the state panel: people (estimated), counties (observed)')
                check('counties of Ohio' in p.inner_text('#zm-legend'), 'the legend bands are this state\'s counties')
                lg = p.inner_text('#zm-legend')
                check(' to under ' in lg and 'or more' in lg and 'one fifth' in lg, 'the legend band edges: under X, X to under Y, Y or more')
                check(no_scroll(), 'no sideways scroll (Ohio)')
                p.screenshot(path=str(out / f'2-ohio-{name}.png'), full_page=True)

                # 3. click a county: Franklin County (39049), Columbus
                p.locator('#zm-svg path.zm-county[data-id="39049"]').click(timeout=5000)
                f = p.inner_text('#zm-county-facts') if p.locator('#zm-county-facts').count() else ''
                check('Franklin County' in p.inner_text('#zm-detail') and 'estimated' in f and 'calculated' in f, 'click a county: its people (estimated) and share of the state (calculated)')
                check(p.locator('path.zm-county.zm-picked').count() == 1 and p.input_value('#zm-county') == '39049', 'the county is marked on the map and in the list')
                p.screenshot(path=str(out / f'3-county-{name}.png'), full_page=True)

                # 4. back out
                p.click('#zm-back')
                check(p.evaluate('document.activeElement && document.activeElement.id') == 'zm-state', 'Back: focus moves to the state list, not the page body')
                check(p.locator('#zm-svg path.zm-county').count() == 0 and view_box() == US_BOX and p.input_value('#zm-state') == '', 'Back: the whole map again, no counties')
                check(p.locator('#zm-back').is_hidden() and p.locator('path.zm-dim').count() == 0, 'Back: the button hides, no state dimmed')

                # 5. keyboard only: the state list, then the county list
                p.focus('#zm-state')
                p.select_option('#zm-state', '48')
                check(counties(254), 'keyboard: Texas from the list, its 254 counties drawn')
                if name == 'phone':
                    check(p.evaluate("(() => { const r = document.getElementById('zm-svg').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()"), 'after a pick from the list the map is in view')
                p.focus('#zm-county')
                p.keyboard.press('ArrowDown')
                check(p.locator('#zm-county-facts').count() == 1 and p.locator('path.zm-county.zm-picked').count() == 1, 'keyboard: a county from the county list')
                check(no_scroll(), 'no sideways scroll (Texas)')
                p.screenshot(path=str(out / f'4-texas-keyboard-{name}.png'), full_page=True)
                p.focus('#zm-back')
                p.keyboard.press('Enter')
                check(view_box() == US_BOX and p.locator('#zm-svg path.zm-county').count() == 0, 'keyboard: Enter on Back zooms out')
                p.select_option('#zm-state', '44')
                check(counties(5), 'Rhode Island: 5 counties (a small state zooms in too)')
                check('one band per county' in p.inner_text('#zm-bands') and 'one fifth' not in p.inner_text('#zm-bands'), 'Rhode Island legend: one band per county, not one fifth in each')
                p.screenshot(path=str(out / f'5-rhode-island-{name}.png'), full_page=True)
                nd = p.inner_text('#zm-not-done')
                check('No animation over time' in nd and 'One value only' in nd and 'Alaska and Hawaii' in nd, 'what the prototype does not do is said')
                check('Census Bureau' in p.inner_text('#zm-sources') and 'public domain' in p.inner_text('#zm-sources'), 'the source line')
                p.click('#zm-back')
                check('Small states: pick them from the State list.' in p.inner_text('#zm-small'), 'the small-states line under the map')
                p.locator('#zm-svg path.zm-state[data-id="11"]').click(timeout=5000)     # times out if Virginia or Maryland lies on top of DC
                check(counties(1) and p.input_value('#zm-state') == '11', 'a tap on DC opens DC, not Virginia')
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()

                # 6. a county file that fails to load: a clean whole map, and each way back in reloads it
                ctx, p, errors, asked = page('&zoommap')
                p.wait_for_selector('#zm-svg path.zm-state', timeout=20000)
                p.select_option('#zm-state', '48')
                check(counties(254), 'failure: Texas first, its counties drawn')
                pattern = '**/assets/zoom-map/st-39.js*'
                block = lambda r: r.abort()
                p.route(pattern, block)
                ohio_asks = lambda: len([u for u in asked if '/st-39.js' in u])

                def clean(n, how):
                    for _ in range(100):
                        if 'could not be loaded' in p.inner_text('#zm-status') and ohio_asks() == n:
                            break
                        p.wait_for_timeout(100)
                    check('Ohio could not be loaded' in p.inner_text('#zm-status') and ohio_asks() == n, f'failure ({how}): the could-not-load line, Ohio asked for {n} time(s)')
                    check(p.locator('#zm-svg path.zm-county').count() == 0 and view_box() == US_BOX and p.input_value('#zm-state') == '',
                          f'failure ({how}): the whole map, no counties, the list on All states')
                    check(p.locator('#zm-county').count() == 0 and p.locator('#zm-place').count() == 0 and 'states on this map' in p.inner_text('#zm-legend'),
                          f'failure ({how}): no county list, no state panel, the states legend (nothing of Texas left)')
                    check(p.locator('#zm-back').is_hidden() and p.locator('path.zm-dim').count() == 0 and p.locator('#zm-retry').is_visible(),
                          f'failure ({how}): no Back, nothing dimmed, Try again shown')
                p.select_option('#zm-state', '39')                                      # Texas is on screen, so Ohio comes from the list
                clean(1, 'Ohio from the list while Texas is shown')
                p.screenshot(path=str(out / f'6-load-failure-{name}.png'), full_page=True)
                p.locator('#zm-svg path.zm-state[data-id="39"]').click(timeout=5000)
                clean(2, 'the same state clicked on the map')
                p.select_option('#zm-state', '39')
                clean(3, 'the same state picked from the list again')
                p.unroute(pattern, block)
                p.click('#zm-retry')
                check(counties(88) and ohio_asks() == 4, 'Try again: Ohio loads, its 88 counties drawn')
                check(p.locator('#zm-retry').is_hidden() and p.inner_text('#zm-status').strip() == '' and p.input_value('#zm-state') == '39',
                      'Try again: the error line and the button go; the list says Ohio')
                check(p.evaluate('document.activeElement && document.activeElement.id') == 'zm-state', 'Try again: focus moves to the state list')
                errors[:] = [e for e in errors if 'st-39.js' not in e]
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()

                # 7. without the switch: the address does not open the map, and says so in one line
                ctx, p, errors, asked = page('')
                p.wait_for_selector('#zoom-map-off', timeout=20000)
                p.wait_for_timeout(500)
                check(p.locator('#zm-svg').count() == 0 and not asked, 'no switch: no map and no map data asked for')
                check(p.inner_text('#zoom-map-off').strip() == 'This page is not switched on for this account.' and p.locator('#zoom-map-off-home').count() == 1,
                      'no switch: the one plain line and a way back')
                p.screenshot(path=str(out / f'7-no-switch-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
