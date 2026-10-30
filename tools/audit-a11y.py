"""Accessibility pass on the guided builder (#/build) and 'Your look' (#/looks) in real Chrome, mock mode, local server only, desktop and phone. For every screen of both walks it lists what a script can see:
controls with no name (inputs, selects, textareas, buttons, links), heading problems (not exactly one h1, a level skipped), text contrast under 4.5:1 (3:1 for large text), tap targets under 40 px,
sideways scroll, a keyboard Tab walk (every control reachable, a visible focus mark on each, no focus trap), whether errors and the status line sit in a live region, and images with no alt.
It does not replace a person with a screen reader. Writes a findings list; exit 1 if any finding. Not part of the node suite (needs Chrome).

    python tools/audit-a11y.py            (prints findings; turns the two flags on through a local copy of the config only)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8185
BASE = f'http://127.0.0.1:{PORT}'

SCAN = r"""() => {
  const out = { noname: [], headings: [], contrast: [], small: [], overflow: document.documentElement.scrollWidth > window.innerWidth + 1, noalt: [], live: [], tab: [] };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[aria-hidden=true]'); };
  const label = el => (el.getAttribute('aria-label') || '').trim() || ((el.getAttribute('aria-labelledby') || '').split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim())
    || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]') ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]').textContent.trim() : '') || (el.closest('label') ? el.closest('label').textContent.trim() : '')
    || (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) ? el.value : '') || (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) ? el.textContent.trim() : '') || (el.getAttribute('title') || '').trim();
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  const main = document.querySelector('main') || document.body;
  for (const el of main.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href],summary')) {
    if (!vis(el) && !(el.type === 'radio' || el.type === 'checkbox')) continue;
    if (!label(el)) out.noname.push(desc(el));
    const r = el.getBoundingClientRect(); const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (vis(el) && !inline && (r.height < 40 || r.width < 24) && !(el.type === 'checkbox' || el.type === 'radio')) out.small.push(desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  let last = 0;
  for (const h of main.querySelectorAll('h1,h2,h3,h4')) { if (!vis(h)) continue; const n = +h.tagName[1]; if (last && n > last + 1) out.headings.push('skips from h' + last + ' to h' + n + ': ' + h.textContent.trim().slice(0, 60)); last = n; }
  const h1 = [...main.querySelectorAll('h1')].filter(vis).length; if (h1 !== 1) out.headings.push(h1 + ' visible h1');
  const rgb = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { let c = { r: 255, g: 255, b: 255 }; const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
    for (const e of chain.reverse()) { const b = rgb(getComputedStyle(e).backgroundColor); if (b.a > 0) { c = { r: c.r * (1 - b.a) + b.r * b.a, g: c.g * (1 - b.a) + b.g * b.a, b: c.b * (1 - b.a) + b.b * b.a }; } } return c; };
  const seen = new Set();
  for (const el of main.querySelectorAll('p,li,span,label,legend,h1,h2,h3,a,button,summary,dt,dd,strong,small,td,th,code')) {
    if (!vis(el)) continue; const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    const s = getComputedStyle(el); const fg = rgb(s.color); const bg = bgOf(el);
    const fgm = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const L1 = lum(fgm), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, large = px >= 24 || (px >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) { const k = desc(el) + Math.round(ratio * 10); if (!seen.has(k)) { seen.add(k); out.contrast.push(desc(el) + ' ' + ratio.toFixed(2) + ':1 "' + el.textContent.trim().slice(0, 28) + '"'); } }
  }
  for (const im of main.querySelectorAll('img')) if (vis(im) && !im.hasAttribute('alt')) out.noalt.push(im.getAttribute('src') || 'img');
  for (const el of main.querySelectorAll('.form-error,.look-problems,.builder-problems,[role=alert],[role=status],[aria-live]')) if (vis(el)) out.live.push(desc(el) + (el.closest('[aria-live],[role=alert],[role=status]') || el.matches('[aria-live],[role=alert],[role=status]') ? ' live' : ' NOT-LIVE'));
  return out;
}"""


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def tab_walk(p):
    """Tab through the main area with the keyboard; report controls reached without a visible focus mark, and whether focus got stuck."""
    p.evaluate("(() => { const m = document.querySelector('main') || document.body; const had = m.hasAttribute('tabindex'); if (!had) m.setAttribute('tabindex', '-1'); m.focus(); window.scrollTo(0, 0); if (!had) m.removeAttribute('tabindex'); })()")   # start the Tab walk at the top of the main area
    all_ctrl = p.evaluate("""() => {
      const seen = new Set(), out = [];
      for (const e of (document.querySelector('main') || document.body).querySelectorAll('input:not([type=hidden]),select,textarea,button:not([disabled]),a[href],summary')) {
        const r = e.getBoundingClientRect(); const isRadio = e.type === 'radio';
        if (!((r.width > 0 && r.height > 0) || isRadio || e.type === 'checkbox')) continue;
        const d = e.closest('details:not([open])'); if (d && !(e.tagName === 'SUMMARY' && e.parentElement === d)) continue;     // inside a folded section: reached by opening it
        if (e.closest('[hidden]')) continue;
        const key = isRadio ? 'radio:' + e.name : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ':' + (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 60);
        if (seen.has(key)) continue; seen.add(key); out.push(key);
      }
      return out; }""")  # a radio group takes one Tab stop (arrows move inside it)
    n_ctrl = len(all_ctrl)
    ids, noring, stuck = [], [], 0
    prev = None
    for _ in range(min(n_ctrl + 12, 60)):
        p.keyboard.press('Tab')
        info = p.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const w = e.closest('label,.builder-card') || e; const ws = getComputedStyle(w);
          const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none') || (ws.outlineStyle !== 'none' && parseFloat(ws.outlineWidth) > 0 && w.matches(':focus-within')) || (ws.boxShadow && ws.boxShadow !== 'none' && w.matches(':focus-within'));
          return { d: e.type === 'radio' ? 'radio:' + e.name : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ':' + (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 60), ring: !!ring, inMain: !!e.closest('main') }; }""")
        if info is None:
            continue
        if prev == info['d']:
            stuck += 1
        prev = info['d']
        if info['inMain']:
            ids.append(info['d'])
            if not info['ring']:
                noring.append(info['d'])
    tab_walk.missed = [c for c in all_ctrl if c not in set(ids)]
    return n_ctrl, len(set(ids)), sorted(set(noring)), stuck > 3


def main():
    srv = serve()
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    flipped = re.sub(r'guidedBuilder:\s*false', 'guidedBuilder: true', re.sub(r'lookEditor:\s*false', 'lookEditor: true', cfg))
    findings = []

    def scan(p, where):
        r = p.evaluate(SCAN)
        for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
            for v in r[k]:
                findings.append(f'{where}: {label}: {v}')
        if r['overflow']:
            findings.append(f'{where}: sideways scroll')
        for v in r['live']:
            if 'NOT-LIVE' in v:
                findings.append(f'{where}: message not in a live region: {v}')
        n, reached, noring, trapped = tab_walk(p)
        if reached < n * 0.8:
            findings.append(f'{where}: keyboard reaches {reached} of about {n} controls (missed: {", ".join(tab_walk.missed[:5])})')
        for d in noring:
            findings.append(f'{where}: no visible focus mark on {d}')
        if trapped:
            findings.append(f'{where}: keyboard focus got stuck')
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                p = ctx.new_page()
                p.on('dialog', lambda d: d.accept())
                p.goto(f'{BASE}/app/?mock#/', wait_until='load')
                p.wait_for_selector('a:has-text("Make a film step by step")', timeout=20000)
                p.click('a:has-text("Make a film step by step")')
                p.wait_for_selector('h2:has-text("Which data?")', timeout=15000)
                scan(p, f'{name} builder 1 data')
                p.locator('.builder-card').filter(has=p.locator('strong:text-is("Obesity and fast food by state")')).click()
                for i, heading in enumerate(('What do you want to show?', 'Which years?', 'What kind of film?', 'Which look?', 'What is it called?'), 2):
                    p.click('button:has-text("Next")')
                    p.wait_for_selector(f'h2:has-text("{heading}")')
                    if heading == 'What do you want to show?':
                        p.locator('.builder-card').first.click()
                    if heading == 'What kind of film?':
                        p.locator('.builder-card').first.click()
                    if heading == 'Which years?':
                        p.fill('#bd-start', '1990')
                        scan(p, f'{name} builder {i} {heading}')
                        p.click('button:has-text("Next")')
                        p.wait_for_selector('h2:has-text("What kind of film?")')
                        p.locator('.builder-card').first.click()
                        p.click('button:has-text("Next")')
                        p.wait_for_selector('h2:has-text("Which look?")')
                        scan(p, f'{name} builder look')
                        p.click('button:has-text("Next")')
                        p.wait_for_selector('h2:has-text("What is it called?")')
                        scan(p, f'{name} builder title')
                        p.click('button:has-text("Next")')
                        break
                    scan(p, f'{name} builder {i} {heading}')
                p.wait_for_selector('.builder-problems', timeout=10000)
                scan(p, f'{name} builder review (refused)')
                # looks
                p.evaluate("location.hash = '#/looks'")
                p.wait_for_selector('h1:has-text("Your look")', timeout=20000)
                scan(p, f'{name} looks list')
                p.click('a:has-text("Bold social")')
                p.wait_for_selector('#look-name', timeout=10000)
                scan(p, f'{name} looks editor')
                p.fill('#look-look-page_background', '#fff')
                scan(p, f'{name} looks editor (bad colour)')
                p.fill('#look-look-page_background', '#101018')
                p.click('text=Make a sample sheet')
                p.wait_for_selector('.look-sheet', timeout=60000)
                scan(p, f'{name} looks editor (sample sheet)')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    seen = set()
    uniq = [f for f in findings if not (f.split(': ', 1)[1] in seen or seen.add(f.split(': ', 1)[1]))]
    for f in findings:
        print(f)
    print(f'FINDINGS: {len(findings)} ({len(uniq)} distinct)')
    print('RESULT:', 'PASS' if not findings else 'FAIL')
    return 0 if not findings else 1


if __name__ == '__main__':
    sys.exit(main())
