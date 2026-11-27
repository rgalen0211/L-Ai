"""Zoom map prototype page check (GEO 11-27): the path a signed-in account with the switch zoomMap walks on #/labs/map, in real
headless Chrome against the mock (?mock&zoommap), at desktop (1280) and phone (390) widths: the states, click a state and see its
counties (loaded only then), click a county, back out (focus to the state list), the same by keyboard (the selects), the Year list
(default 2024; the numbers, caption, map label and legend year follow it, the band edges do not move), a county file that
fails to load (a clean whole map, then a click, the list and Try again each reload it), DC winning its own tap, and the page staying shut
without the switch (one plain line). Also: every legend as plain ranges (Ohio, Rhode Island, Connecticut; DC one colour and one line), a state
switched mid-load (the old one gone at once), and no orange outline left after Back.
Local only: a server on 127.0.0.1 with its own port, nothing sent anywhere. Screenshots go to --out (outside the repo).
  py -I -B tools/check-zoom-map.py --out D:/Ryagram-scratch/GEO/zoom-shots
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
                keys_of = lambda: [x.strip() for x in p.locator('#zm-legend .zm-keys li').all_inner_texts()]
                plain = lambda k: bool(re.fullmatch(r'under [\d,]+|[\d,]+ to [\d,]+|[\d,]+ and over', k))
                # no path keeps an orange outline (the hover or picked stroke), by the computed stroke, not by class names
                orange = lambda: p.evaluate("[...document.querySelectorAll('#zm-svg path')].filter((x) => getComputedStyle(x).stroke === 'rgb(255, 209, 102)').map((x) => x.getAttribute('data-id'))")
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
                check(p.input_value('#zm-year') == '2024' and 'July 1, 2024' in p.inner_text('#zm-caption') and '2024' in p.get_attribute('#zm-svg', 'aria-label'),
                      'the Year list starts on 2024; the caption and the map label say 2024')
                b24 = p.inner_text('#zm-legend .zm-keys')
                check('over all 5 years (2020 to 2024) at once' in p.inner_text('#zm-bands') and 'a change of colour means a change in people' in p.inner_text('#zm-bands'),
                      'the legend says the bands are computed over all five years')
                ohio_tip = lambda: p.evaluate("document.querySelector('#zm-svg path.zm-state[data-id=\"39\"] title').textContent")
                check(ohio_tip() == 'Ohio, 2024: 11,883,304 people (estimated)', f'Ohio on the map, 2024: {ohio_tip()}')
                fills = lambda: p.evaluate("[...document.querySelectorAll('#zm-svg path')].map((x) => x.getAttribute('fill')).join(',')")
                f24 = fills()
                p.select_option('#zm-year', '2020')
                check('July 1, 2020' in p.inner_text('#zm-legend-year') and 'July 1, 2020' in p.inner_text('#zm-caption') and '2020' in p.get_attribute('#zm-svg', 'aria-label'),
                      'year 2020: the legend, the caption and the map label say 2020')
                check(p.inner_text('#zm-legend .zm-keys') == b24, 'year 2020: the band edges did not move')
                check(ohio_tip() == 'Ohio, 2020: 11,798,905 people (estimated)', f'Ohio on the map, 2020 (POPESTIMATE2020 in the CSV): {ohio_tip()}')
                print(f'       ({sum(a != b for a, b in zip(f24.split(","), fills().split(",")))} of 49 states change colour from 2024 to 2020)')
                p.screenshot(path=str(out / f'1b-states-2020-{name}.png'), full_page=True)
                p.select_option('#zm-year', '2024')
                check(fills() == f24 and ohio_tip().startswith('Ohio, 2024'), 'back to 2024: the same colours as at the start')
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
                keys = keys_of()
                check(len(keys) == 5 and keys[0].startswith('under ') and keys[-1].endswith(' and over') and all(' to ' in k for k in keys[1:4])
                      and 'to under' not in lg and 'or more' not in lg and 'one fifth' in lg, f'the legend as plain ranges: under X, X to Y, ..., Z and over ({keys})')
                check(no_scroll(), 'no sideways scroll (Ohio)')
                p.screenshot(path=str(out / f'2-ohio-{name}.png'), full_page=True)

                # 3. click a county: Franklin County (39049), Columbus
                p.locator('#zm-svg path.zm-county[data-id="39049"]').click(timeout=5000)
                f = p.inner_text('#zm-county-facts') if p.locator('#zm-county-facts').count() else ''
                check('Franklin County' in p.inner_text('#zm-detail') and 'estimated' in f and 'calculated' in f, 'click a county: its people (estimated) and share of the state (calculated)')
                check(p.locator('path.zm-county.zm-picked').count() == 1 and p.input_value('#zm-county') == '39049', 'the county is marked on the map and in the list')
                p.screenshot(path=str(out / f'3-county-{name}.png'), full_page=True)
                fc = lambda: p.inner_text('#zm-county-facts')
                check('People in 2024: 1,356,303' in fc() and '+31,798 (+2.4%)' in p.inner_text('#zm-county-change') and 'calculated' in p.inner_text('#zm-county-change'),
                      'Franklin County 2024: 1,356,303 people, change since 2020 +31,798 (+2.4%), calculated')
                check('+84,399 (+0.7%)' in p.inner_text('#zm-state-change'), 'Ohio: change since 2020 +84,399 (+0.7%)')
                k24 = p.inner_text('#zm-legend .zm-keys')

                # 3b. the Year list by keyboard: up to 2020, then down to 2022
                p.focus('#zm-year')
                p.keyboard.press('ArrowUp', delay=20)
                for _ in range(3):
                    p.keyboard.press('ArrowUp')
                check(p.input_value('#zm-year') == '2020' and 'People in 2020: 1,324,505' in fc(), 'keyboard: Year 2020, Franklin County 1,324,505 people')
                check('pick a later year' in p.inner_text('#zm-county-change') and p.locator('#zm-2020').count() == 1, 'year 2020: no change line, and the July 1, 2020 note')
                check(p.inner_text('#zm-legend .zm-keys') == k24 and 'July 1, 2020' in p.inner_text('#zm-legend-year'), 'year 2020: the county band edges did not move; the legend says 2020')
                check('Ohio, 2020' in p.get_attribute('#zm-svg', 'aria-label') and 'Ohio, counties: population on July 1, 2020' in p.inner_text('#zm-caption'), 'year 2020: the map label and caption')
                p.screenshot(path=str(out / f'3b-county-2020-{name}.png'), full_page=True)
                p.keyboard.press('ArrowDown')
                p.keyboard.press('ArrowDown')
                check(p.input_value('#zm-year') == '2022' and 'People in 2022: 1,327,687' in fc() and '+3,182 (+0.2%)' in p.inner_text('#zm-county-change'),
                      'keyboard: Year 2022, Franklin County 1,327,687 people, +3,182 (+0.2%) since 2020')
                check(p.evaluate('document.activeElement && document.activeElement.id') == 'zm-year', 'the Year list keeps the focus')
                p.select_option('#zm-year', '2024')

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
                check('over all 5 years' in p.inner_text('#zm-bands') and '25 figures' in p.inner_text('#zm-bands'), 'Rhode Island legend: its 5 counties over 5 years, 25 figures')
                keys = keys_of()
                check(len(keys) == 5 and all(plain(k) for k in keys) and keys[0].startswith('under ') and keys[-1].endswith(' and over'),
                      f'Rhode Island legend: plain ranges, no bare numbers ({keys})')
                p.screenshot(path=str(out / f'5-rhode-island-{name}.png'), full_page=True)
                p.locator('#zm-legend').screenshot(path=str(out / f'5-rhode-island-legend-{name}.png'))
                p.select_option('#zm-state', '09')
                check(counties(9), 'Connecticut: its 9 planning regions drawn')
                check(p.inner_text('#zm-ct').strip() == "Connecticut's nine planning regions (the Census Bureau's county equivalents since 2022).",
                      'Connecticut: the planning regions line')
                keys = keys_of()
                check(len(keys) == 5 and all(plain(k) for k in keys), f'Connecticut legend: plain ranges ({keys})')
                check('45 figures' in p.inner_text('#zm-bands'), 'Connecticut legend: 45 figures')
                p.screenshot(path=str(out / f'5b-connecticut-{name}.png'), full_page=True)
                p.locator('#zm-legend').screenshot(path=str(out / f'5b-connecticut-legend-{name}.png'))
                p.select_option('#zm-state', '44')
                check(counties(5), 'Rhode Island again from the list')
                nd = p.inner_text('#zm-not-done')
                check('Five years only' in nd and 'no animation' in nd and 'One value only' in nd and 'Alaska and Hawaii' in nd, 'what the prototype does not do is said (five years)')
                check('Census Bureau' in p.inner_text('#zm-sources') and 'public domain' in p.inner_text('#zm-sources'), 'the source line')
                p.click('#zm-back')
                check(p.inner_text('#zm-small').strip() == 'Small states and counties: pick them from the lists.', 'the small-states line under the map')
                p.locator('#zm-svg path.zm-state[data-id="11"]').click(timeout=5000)     # times out if Virginia or Maryland lies on top of DC
                check(counties(1) and p.input_value('#zm-state') == '11', 'a tap on DC opens DC, not Virginia')
                keys = keys_of()
                check(keys == ['One county equivalent: see its numbers below.'] and 'all' not in keys and p.locator('#zm-legend .zm-swatch').count() == 1,
                      f'DC legend: one colour and the one-place line ({keys})')
                dc_fill = p.evaluate("[...new Set([...document.querySelectorAll('#zm-svg path.zm-county')].map((x) => x.getAttribute('fill')))]")
                swatch = p.evaluate("document.querySelector('#zm-legend .zm-swatch').getAttribute('data-fill')")
                p.select_option('#zm-year', '2020')
                dc_fill20 = p.evaluate("document.querySelector('#zm-svg path.zm-county').getAttribute('fill')")
                p.select_option('#zm-year', '2024')
                check(dc_fill == [swatch] and dc_fill20 == swatch, f'DC: the map uses the legend\'s one colour in every year ({dc_fill}, {dc_fill20}, {swatch})')
                p.screenshot(path=str(out / f'5c-dc-{name}.png'), full_page=True)
                p.locator('#zm-legend').screenshot(path=str(out / f'5c-dc-legend-{name}.png'))
                p.click('#zm-back')

                # 5d. after Back nothing keeps an outline: Arizona tapped (phone) or hovered and clicked (desktop), then Back
                az = p.locator('#zm-svg path.zm-state[data-id="04"]')
                if name == 'phone':      # a phone has no mouse: Playwright's click() moves an emulated mouse, which can rest over a state after the map moves; taps only here
                    p.mouse.move(0, 0)
                    az.tap(timeout=5000)
                    check(counties(15), 'Arizona: its 15 counties drawn')
                    p.locator('#zm-svg path.zm-county[data-id="04013"]').tap(timeout=5000)
                    p.locator('#zm-back').tap(timeout=5000)
                else:
                    az.hover(timeout=5000)
                    check(p.locator('path.zm-hover').count() == 1, 'desktop: a mouse over Arizona outlines it')
                    az.click(timeout=5000)
                    check(counties(15), 'Arizona: its 15 counties drawn')
                    p.locator('#zm-svg path.zm-county[data-id="04013"]').click(timeout=5000)
                    p.click('#zm-back')
                check(p.locator('path.zm-hover, path.zm-picked').count() == 0 and orange() == [], f'after Back: no state or county keeps an orange outline ({orange()})')
                check(view_box() == US_BOX and p.locator('path.zm-dim').count() == 0, 'after Back: the whole map, nothing dimmed')
                p.screenshot(path=str(out / f'5d-after-back-{name}.png'), full_page=True)
                check(not errors, f'no page errors ({errors[:2]})')
                ctx.close()

                # 6. a county file that fails to load: a clean whole map, and each way back in reloads it
                ctx, p, errors, asked = page('&zoommap')
                p.wait_for_selector('#zm-svg path.zm-state', timeout=20000)
                p.select_option('#zm-state', '48')
                check(counties(254), 'failure: Texas first, its counties drawn')
                # 5e. a switch mid-load: California is held at the server while Texas is zoomed; at once nothing of Texas is left
                held = []
                hold = lambda r: held.append(r)
                p.route('**/assets/zoom-map/st-06.js*', hold)
                p.select_option('#zm-state', '06')
                for _ in range(100):
                    if held:
                        break
                    p.wait_for_timeout(50)
                check(len(held) == 1 and p.locator('#zm-svg path.zm-county').count() == 0, 'mid-load: California asked for; Texas\'s counties are gone')
                check(view_box() == US_BOX and p.locator('path.zm-dim').count() == 0 and not p.evaluate("document.getElementById('zm-svg').classList.contains('zm-zoomed')"),
                      f'mid-load: the whole-map view, nothing dimmed ({view_box()})')
                check('states on this map' in p.inner_text('#zm-bands') and 'Texas' not in p.inner_text('#zm-legend'), 'mid-load: the states legend, nothing of Texas')
                check(p.inner_text('#zm-caption').startswith('The contiguous states') and 'Texas' not in p.get_attribute('#zm-svg', 'aria-label'),
                      'mid-load: the caption and map label are the whole map\'s')
                check(p.inner_text('#zm-place') == 'California' and 'Loading the counties' in p.inner_text('#zm-status'), 'mid-load: the panel names California, the loading line')
                p.screenshot(path=str(out / f'5e-mid-load-{name}.png'), full_page=True)
                if held:
                    held[0].continue_()
                check(counties(58) and view_box() != US_BOX and 'counties of California' in p.inner_text('#zm-legend'), 'mid-load: California arrives, 58 counties, zoomed, its legend')
                p.unroute('**/assets/zoom-map/st-06.js*', hold)
                p.select_option('#zm-state', '48')
                check(counties(254), 'failure: Texas again, its counties drawn')
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
