"""Phone pass (NEXT-WEB 130): every public page and the edit workspace at 390 x 844 (touch), LOCAL server only. For each page: sideways scroll, tap targets (the a11y scan's rule: under 40 px high or 24 wide, inline text links
exempt), controls with no name, and the real rule behind the 44 px promise: every visible button, link-as-button, field, select and summary measured at 44 px or more (inline links inside a sentence are exempt).
The workspace is also checked for the preview fitting inside the width. Writes a full-page screenshot per page. Not part of the node suite (needs Chrome).

    python tools/check-phone-pass.py [outdir]        (default D:/Ryagram-scratch/WEB/phone-pass-shots)
"""
import importlib.util
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/phone-pass-shots')
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)
aa.PORT = 8191
BASE = f'http://127.0.0.1:{aa.PORT}'

PAGES = [('home', '/'), ('help', '/help/'), ('connect-ai', '/connect-ai/'), ('film', '/film/'), ('report', '/report/'), ('ryagram', '/ryagram/'),
         ('workflow-audit', '/workflow-audit/'), ('ai-content', '/ai-content/'), ('terms', '/terms/'), ('privacy', '/privacy-policy.html'),
         ('app-signin', '/app/?mock#/'), ('workspace', '/tools/maker-edit/edit.html?fixture')]

# 44 px: every control that is not a plain link inside running text
BIG = r"""() => {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[aria-hidden=true]'); };
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') + ':' + (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 20);
  for (const el of document.querySelectorAll('button,select,summary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]),textarea,a[href]')) {
    if (!vis(el) || el.id === 'mock-outcome') continue;       // (the mock's own test control is not part of the product)
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && (cs.display === 'inline' || el.closest('p,li,dd,td') && cs.display !== 'block' && cs.display !== 'flex' && cs.display !== 'inline-flex' && !el.matches('[class*=btn],[class*=button],.rg-btn'))) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.push(desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out;
}"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = aa.serve()
    bad = 0
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            for key, path in PAGES:
                p = ctx.new_page()
                errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                p.goto(BASE + path, wait_until='load')
                p.wait_for_timeout(600)
                scan = p.evaluate(aa.SCAN)
                big = p.evaluate(BIG)
                extra = p.evaluate("() => { const pv = document.querySelector('#preview,.preview,canvas,#stage'); if (!pv) return null; const r = pv.getBoundingClientRect(); return { right: Math.round(r.right), w: Math.round(r.width), vw: innerWidth }; }") if key == 'workspace' else None
                p.screenshot(path=str(OUT / f'{key}.png'), full_page=True)
                f = []
                if scan['overflow']:
                    f.append('sideways scroll')
                f += ['no name: ' + v for v in scan['noname']]
                f += ['under 44 px: ' + v for v in big]
                f += ['page error: ' + e for e in errs]
                if extra and extra['right'] > extra['vw']:
                    f.append(f'preview sticks out: right edge {extra["right"]} of {extra["vw"]}')
                print(('  ok   ' if not f else '  FAIL ') + key + (' (preview %s)' % extra if extra else ''))
                for v in f:
                    print('         ' + v)
                bad += len(f)
                p.close()
            b.close()
    finally:
        srv.shutdown()
    print('FINDINGS:', bad)
    sys.exit(1 if bad else 0)


main()
