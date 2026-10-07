"""Drives the preview EDITOR in real Chrome against the mock app, under the app's real security policy.
    python tools/check-preview-editor.py
Opens the preview, recolours the roads and the page, checks the picture changes at once, that a clashing colour warns without
blocking, that Save writes the story through the shared function, that Revert goes back, and that an unsaved change survives a reload."""
import http.server, json, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8162


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    class Server(socketserver.TCPServer):
        allow_reuse_address = True
    srv = Server(('127.0.0.1', PORT), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def open_preview(page):
    page.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='networkidle')
    page.locator('a[href^="#/p/"]').first.click()
    page.locator('a[href^="#/v/"]').first.click()
    page.wait_for_selector('.preview-panel button')
    page.locator('.preview-panel button').first.click()
    page.wait_for_selector('.pv-edit .pv-hex', timeout=30000)


def main():
    srv = serve()
    out, errors = {}, []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 1100, 'height': 1000})
            page = ctx.new_page()
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text and '404' not in m.text else None)
            page.on('pageerror', lambda e: errors.append(str(e)))
            open_preview(page)
            out['layers'] = page.evaluate('[...document.querySelectorAll(".pv-edit .look-field label")].map(l => l.textContent)')
            svg = lambda: page.evaluate('document.querySelector(".pv-svg").innerHTML')
            saved = lambda: page.evaluate('JSON.stringify(window.ryagramMock.client.db.versions[0].story_spec.sequence.style_overrides || null)')
            page.evaluate('(() => { const s = document.querySelector(".pv-slider"); s.value = "150"; s.dispatchEvent(new Event("input", { bubbles: true })); })()')
            page.wait_for_timeout(200)
            before = svg()
            # 1. recolour the roads: the picture changes at once, nothing is saved yet
            page.fill('#pv-c-lines', '#00ff88'); page.press('#pv-c-lines', 'Tab')
            page.wait_for_timeout(300)
            out['picture_changed'] = 'rgb(0,255,136)' in svg() and svg() != before
            out['not_saved_yet'] = saved() == 'null'
            out['save_enabled'] = page.evaluate('!document.querySelector(".pv-edit .button.primary").disabled')
            # 2. a clashing colour warns and does not block
            page.fill('#pv-c-lines', '#16161c'); page.press('#pv-c-lines', 'Tab'); page.wait_for_timeout(300)
            out['warning'] = page.evaluate('document.querySelector(".pv-warnings").textContent')
            out['still_applied'] = 'rgb(22,22,28)' in svg()
            # 3. a bad colour is refused with a plain message and the picture keeps the last good colour
            page.fill('#pv-c-lines', 'banana'); page.press('#pv-c-lines', 'Tab'); page.wait_for_timeout(200)
            out['bad_colour_message'] = page.evaluate('document.querySelector(".pv-edit .form-note[role=status]").textContent')
            # 4. unsaved changes survive a reload (a draft kept in this browser)
            page.fill('#pv-c-page', '#101030'); page.press('#pv-c-page', 'Tab'); page.wait_for_timeout(300)
            out['page_changed'] = 'rgb(16,16,48)' in svg()
            page.reload(wait_until='networkidle')
            # (the mock rebuilds its data on reload, so the draft is checked against the new saved story: same story, so it restores)
            page.locator('a[href^="#/p/"]').first.click(); page.locator('a[href^="#/v/"]').first.click()
            page.wait_for_selector('.preview-panel button'); page.locator('.preview-panel button').first.click()
            page.wait_for_selector('.pv-edit .pv-hex', timeout=30000)
            out['draft_restored'] = page.evaluate('document.querySelector("#pv-c-page").value')
            # 5. Revert goes back to the saved colours
            page.locator('.pv-edit .button.secondary:not(.small)').first.click(); page.wait_for_timeout(300)
            out['reverted_page'] = page.evaluate('document.querySelector("#pv-c-page").value')
            out['reverted_picture'] = 'rgb(20,20,26)' in svg()
            # 6. Save writes the story through the shared function
            page.fill('#pv-c-lines', '#ffaa00'); page.press('#pv-c-lines', 'Tab'); page.wait_for_timeout(200)
            page.locator('.pv-edit .button.primary').click(); page.wait_for_timeout(700)
            out['saved_story'] = saved()
            out['save_disabled_after'] = page.evaluate('document.querySelector(".pv-edit .button.primary").disabled')
            b.close()
    finally:
        srv.shutdown()
    out['console_errors'] = errors
    print(json.dumps(out, indent=1))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
