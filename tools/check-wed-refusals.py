"""The two Tuesday refusals on the pages, rendered (BUILDER 11-23; migrations 20261123000200 queue cap and 20261123000300 blocked views).
Real Chrome, mock mode, LOCAL server only on a free port (every request to any other host is aborted), at 390 and 1280:
  - ?queuefull, version page: Make contact sheet shows the server's words plus 'Your waiting films are listed under Jobs on each film's page.', and
    the button is usable again;
  - ?viewnotready, version page: 'This film is not available yet. Please choose another film.' (never the word 'view');
  - ?queuefull, the step-by-step builder from a ready-made start: after the refused Make the film exists, 'Open the film' is offered, the Make button is
    hidden, and the home page has exactly ONE more film (no second project on a second press);
  - PLANTED FAULT: without ?queuefull the same builder press succeeds and leaves the builder (so the refusal checks are not blind).
Not part of the node suite (needs Chrome). Writes screenshots.

    python tools/check-wed-refusals.py [outdir]        (default: a new folder under the system temp)
"""
import functools
import http.server
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='wed-refusals-'))
CAP = 'You have 2 films waiting. You can start another when one is done. Your waiting films are listed under Jobs on each film’s page.'
VIEW = 'This film is not available yet. Please choose another film.'


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True
    outside = []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for width, height in ((390, 844), (1280, 800)):
                ctx = b.new_context(viewport={'width': width, 'height': height}, has_touch=width < 500)

                def route(r):
                    if r.request.url.startswith(base):
                        r.continue_()
                    else:
                        outside.append(r.request.url)
                        r.abort()
                ctx.route('**/*', route)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))

                def version_page(query):
                    page.goto(f'{base}/app/?mock&noinvite{query}#/', wait_until='load')
                    page.wait_for_selector('.film-grid h3 a', timeout=20000)
                    page.locator('.film-grid h3 a').first.click()
                    v = page.locator('main a[href^="#/v/"]').first
                    v.wait_for(timeout=20000)
                    v.click()
                    btn = page.get_by_role('button', name='Make contact sheet').first
                    btn.wait_for(timeout=20000)
                    page.wait_for_timeout(400)
                    return btn

                for query, want, tag in (('&queuefull', CAP, 'queuefull'), ('&viewnotready', VIEW, 'viewnotready')):
                    btn = version_page(query)
                    btn.click()
                    page.wait_for_function("w => document.body.innerText.includes(w)", arg=want, timeout=20000)
                    body = page.inner_text('main')
                    page.screenshot(path=str(OUT / f'version-{tag}-{width}.png'), full_page=True)
                    check(want in body, f'[{width}] {tag}: the version page shows "{want[:60]}..."')
                    check(' view' not in want and 'Please pick another view' not in body, f'[{width}] {tag}: never the word "view"')
                    check(btn.is_enabled(), f'[{width}] {tag}: Make contact sheet is usable again')

                def films_on_home(query):
                    page.goto(f'{base}/app/?mock&noinvite{query}#/', wait_until='load')
                    page.wait_for_selector('.film-grid', timeout=20000)
                    page.wait_for_timeout(400)
                    return page.locator('.film-grid > li').count()

                def builder_make(query):
                    page.goto(f'{base}/app/?mock&noinvite{query}#/build', wait_until='load')
                    start = page.locator('button.builder-start').first
                    start.wait_for(timeout=20000)
                    start.click()
                    make = page.get_by_role('button', name='Make the film and a free contact sheet')
                    make.wait_for(timeout=20000)
                    page.wait_for_function("() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Make the film and a free contact sheet'); return b && !b.disabled; }", timeout=30000)
                    make.click()
                    return make

                # the mock keeps its data per page load, so count and act within one page: open the builder, refuse, then read the home list in-app
                make = builder_make('&queuefull')
                page.wait_for_function("w => document.body.innerText.includes(w)", arg=CAP, timeout=20000)
                page.wait_for_timeout(400)
                page.screenshot(path=str(OUT / f'builder-queuefull-{width}.png'), full_page=True)
                check(page.locator('main a', has_text='Open the film').count() == 1, f'[{width}] builder: "Open the film" is offered after the refusal')
                check('and make its contact sheet there.' in page.inner_text('main'), f'[{width}] builder: it says to make the contact sheet there')
                check(make.is_hidden(), f'[{width}] builder: Make is hidden, so a second press cannot make a second project')
                page.evaluate("location.hash = '#/'")
                page.wait_for_selector('.film-grid', timeout=20000)
                page.wait_for_timeout(500)
                titles = page.locator('.film-grid > li').count()
                before = films_on_home('')
                check(titles == before + 1, f'[{width}] builder: exactly one new film after the refusal ({titles} vs {before} on a fresh mock)')

                # PLANTED FAULT: the same press without the refusal leaves the builder for the film, so the checks above are not blind
                builder_make('')
                page.wait_for_function("() => /^#\\/v\\//.test(location.hash)", timeout=20000)
                check(True, f'[{width}] PLANTED FAULT: without ?queuefull the builder goes on to the film (the refusal path above is real)')
                check(not errors, f'[{width}] no page errors {errors[:2]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print(f'  note every other host was aborted: {len(outside)} requests ({sorted(set(u.split("/")[2] for u in outside))[:5]})')
    print(f'shots: {OUT}')
    print('RESULT', 'ALL PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
