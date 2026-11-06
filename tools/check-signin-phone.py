"""Phone-width check (Claude's night note 11-06, item 3) of the signed-out pages in mock mode: the sign-in page, the sign-in page with the invite-code form open, and the 'First time here? Create an
account' page, at 320, 360, 375 and 390 px. For each: no sideways scroll, nothing wider than the screen, no text cut off inside its own box, every visible control at least 44 px tall and wide enough,
no button label wrapped to more than two lines, and the accessibility scan of tools/audit-a11y.py. Writes screenshots. Exit 1 on any finding. Needs Chrome, so it is not part of the node suite.

    python tools/check-signin-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/signin-phone-shots)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/signin-phone-shots')
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)

PROBE = """() => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && e.closest('[hidden]') === null; };
  const W = document.documentElement.clientWidth, out = { sideways: document.documentElement.scrollWidth > W, wide: [], cut: [], small: [], wrapped: [] };
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.closest('.mock-bar') || e.closest('.admin-menu')) continue;       // the mock's developer bar is not a page; the admin menu is closed unless opened (its links are squeezed to nothing while closed)
    const r = e.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.wide.push((e.id || e.tagName.toLowerCase()) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if (['P','H1','H2','LABEL','A','BUTTON','SPAN','LI'].includes(e.tagName) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') out.cut.push((e.id || e.textContent.trim().slice(0, 30)));
  }
  for (const e of document.querySelectorAll('main button, main a.button, main input:not([type=hidden]), main select, main textarea, #sign-in button, #create-account button, #sign-in input, #create-account input, #sign-in a.button, #create-account a')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(), inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline';
    if (!inline && (r.height < 43.5 || r.width < 43.5)) out.small.push((e.id || e.textContent.trim().slice(0, 30)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if ((e.tagName === 'BUTTON' || e.matches('a.button')) && r.height > 2 * parseFloat(getComputedStyle(e).lineHeight || 20) + 40) out.wrapped.push((e.id || e.textContent.trim().slice(0, 30)) + ' h=' + Math.round(r.height));
  }
  return out;
}"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
    found, states = [], 0
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for width in (320, 360, 375, 390):
            ctx = b.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            for label in ('sign-in', 'invite-open', 'create-account'):
                p.goto(f'http://127.0.0.1:{port}/app/?mock#/', wait_until='load')
                p.wait_for_selector('#sign-out', state='attached', timeout=20000)
                p.evaluate("document.querySelector('#sign-out').click()")           # the mock signs in by itself; signing out is how the signed-out pages are reached
                p.wait_for_selector('#sign-in:not([hidden])', timeout=20000)
                if label == 'invite-open':
                    p.wait_for_selector('#have-invite', state='visible', timeout=8000)
                    p.click('#have-invite'); p.wait_for_selector('#invite-form:not([hidden])', timeout=5000)
                elif label == 'create-account':
                    p.click('#create-link'); p.wait_for_selector('#create-account:not([hidden])', timeout=5000)
                p.wait_for_timeout(400)
                r = p.evaluate(PROBE); states += 1
                if r['sideways']: found.append((width, label, 'sideways scroll'))
                for k in ('wide', 'cut', 'small', 'wrapped'):
                    for v in r[k]: found.append((width, label, k, v))
                s = p.evaluate(aa.SCAN)
                for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                    for v in s[k]: found.append((width, label, 'a11y-' + k, v))
                p.screenshot(path=str(OUT / f'{label}-{width}.png'), full_page=True)
            if errors: found.append((width, 'all', 'page errors', errors[:2]))
            ctx.close()
        b.close()
    srv.shutdown()
    for f in found: print('FINDING', f)
    print(f'states checked: {states}; FINDINGS: {len(found)}')
    sys.exit(1 if found or states != 12 else 0)


if __name__ == '__main__':
    main()
