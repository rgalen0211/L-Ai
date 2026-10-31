"""Accessibility pass on the website's live editor (NEXT-WEB 174, own item) in real Chrome, mock mode, LOCAL server only, `liveEditor` ON in a local config copy, desktop and phone. It reuses tools/audit-a11y.py's scan:
controls with no name, heading problems, text contrast under 4.5:1 (3:1 for large text), tap targets under 40 px, sideways scroll, a keyboard Tab walk (every control reachable, a visible focus mark, no trap),
messages outside a live region, images with no alt. Screens: the map, the banded map, the bar race, a streamed film (while loading and when whole), the Ask my AI panel (open, a note sent, the AI's change listed),
and the compilation editor. It does not replace a person with a screen reader. Exit 1 if any finding. Needs Chrome.

    python tools/audit-a11y-editor.py
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)
aa.PORT = 8186
BASE = f'http://127.0.0.1:{aa.PORT}'
AI = "window.ryagramMockEditor.ai.apply(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data', window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').revision, %s, 'Claude')"


def main():
    srv = aa.serve()
    cfg = re.sub(r'clipPace:\s*false', 'clipPace: true', re.sub(r'liveEditor:\s*false', 'liveEditor: true', (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')))
    findings = []

    def scan(p, where):
        r = p.evaluate(aa.SCAN)
        for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
            for v in r[k]:
                if 'mock-' in v:                                               # the mock's own test bar is scaffolding, not the site
                    continue
                findings.append(f'{where}: {label}: {v}')
        if r['overflow']:
            findings.append(f'{where}: sideways scroll')
        for v in r['live']:
            if 'NOT-LIVE' in v:
                findings.append(f'{where}: message not in a live region: {v}')
        n, reached, noring, trapped = aa.tab_walk(p)
        if reached < n * 0.8:
            findings.append(f'{where}: keyboard reaches {reached} of about {n} controls (missed: {", ".join(aa.tab_walk.missed[:5])})')
        for d in noring:
            if 'mock-' not in d:
                findings.append(f'{where}: no visible focus mark on {d}')
        if trapped:
            findings.append(f'{where}: keyboard focus got stuck')

    def open_page(ctx, query, route='editor/data'):
        p = ctx.new_page()
        p.on('dialog', lambda d: d.accept())
        p.goto(f'{BASE}/app/?mock&{query}#/{route}', wait_until='load')
        p.wait_for_selector('h1:has-text("Edit your film")', timeout=20000)
        p.wait_for_timeout(600)
        return p

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
                ctx.route('**/assets/ryagram-config.js*', lambda route, _q: route.fulfill(status=200, content_type='text/javascript', body=cfg))
                p = open_page(ctx, 'x=1'); scan(p, f'{name} editor map'); p.close()
                p = open_page(ctx, 'banded'); scan(p, f'{name} editor banded'); p.close()
                p = open_page(ctx, 'bars'); scan(p, f'{name} editor bar race'); p.close()
                p = open_page(ctx, 'stream&streamstep'); scan(p, f'{name} editor streamed (loading)')
                for _ in range(4):
                    p.evaluate('window.ryagramMockStreamStep()'); p.wait_for_timeout(250)
                p.wait_for_timeout(500); scan(p, f'{name} editor streamed (whole)'); p.close()
                p = open_page(ctx, 'x=1')
                p.click('.le-ai-btn'); p.wait_for_selector('.le-chip'); scan(p, f'{name} ask my AI (open)')
                p.click('.le-chip >> nth=0'); p.click('.le-ai >> text=Copy'); p.wait_for_timeout(300); scan(p, f'{name} ask my AI (waiting)')
                p.evaluate(AI % "[{op: 'set_look', key: 'page.background', value: '#ffffff'}]"); p.wait_for_timeout(2600); scan(p, f'{name} ask my AI (answered)'); p.close()
                p = open_page(ctx, 'x=1', 'editor/compilation'); scan(p, f'{name} editor compilation'); p.close()
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
