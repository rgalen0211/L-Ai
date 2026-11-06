"""Keyboard-only and screen-reader pass (Claude's night note 11-06, item 3) of the signed-out pages in mock mode: sign-in, sign-in with the invite-code form open, and Create an account, at desktop
and phone width. Using only the keyboard: Tab order (top to bottom, no skipped control, no trap), a visible focus mark on every stop, the "Have an invite code?" and "Forgot your password?" buttons
opened by Enter and by Space with aria-expanded following, an empty or wrong submit announcing its error in a live region, the route change to Create an account and back landing focus on a heading,
and every field having a name. The screen-reader view is the page's accessibility tree (aria snapshot), written to the outdir and checked for the roles and names a person hears. Prints a FINDING for
each problem and the focus path for each page. Exit 1 on any finding. Needs Chrome, so it is not part of the node suite.

    python tools/check-signin-keyboard.py [outdir]        (default D:/Ryagram-scratch/WEB/signin-keyboard)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/signin-keyboard')
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)

DESCRIBE = """() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  const lab = (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40) || e.getAttribute('placeholder') || '';
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
  return { tag: e.tagName.toLowerCase(), id: e.id, name: lab, y: Math.round(r.top + window.scrollY), ring: !!ring, vis: r.width > 0 && r.height > 0 }; }"""
LIVE = """(id) => { const e = document.getElementById(id); return e ? { text: e.textContent.trim(), hidden: e.hidden, role: e.getAttribute('role') } : null; }"""


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
    found = []

    def bad(*a):
        found.append(a); print('FINDING', a)
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone', dict(viewport={'width': 375, 'height': 800}, is_mobile=True, has_touch=True))):
            ctx = b.new_context(**opts)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))

            def signed_out():
                p.goto(f'http://127.0.0.1:{port}/app/?mock#/', wait_until='load')
                p.wait_for_selector('#sign-out', state='attached', timeout=20000)
                p.evaluate("document.querySelector('#sign-out').click()")
                p.wait_for_selector('#sign-in:not([hidden])', timeout=20000)
                p.wait_for_timeout(300)

            def tab_path(limit=14):
                p.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)")
                p.click('h1:visible')                              # the next Tab starts after the heading, as a person's does at the top of the page
                path = []
                for _ in range(limit):
                    p.keyboard.press('Tab')
                    d = p.evaluate(DESCRIBE)
                    if d is None: break
                    path.append(d)
                return path

            def judge(label, path, want):
                names = [d['name'] for d in path]
                print(f'  [{name}] {label}: ' + ' > '.join(f"{d['tag']}#{d['id'] or '-'}({d['name'][:22]})" for d in path))
                for w in want:
                    if not any(w.lower() in n.lower() for n in names): bad(name, label, 'not reachable by Tab', w)
                for d in path:
                    if not d['ring']: bad(name, label, 'no visible focus mark', d['id'] or d['name'])
                    if not d['name']: bad(name, label, 'a stop with no name', d['id'] or d['tag'])
                    if not d['vis']: bad(name, label, 'focus on something not shown', d['id'] or d['tag'])
                ys = [d['y'] for d in path if d['vis']]
                if any(b2 + 14 < a for a, b2 in zip(ys, ys[1:])): bad(name, label, 'Tab order jumps upward', ys)

            # --- sign-in
            signed_out()
            path = tab_path()
            judge('sign-in', path, ['Email', 'Password', 'Sign in', 'Forgot', 'Create an account'])
            snap = p.locator('main').aria_snapshot() if p.locator('main').count() else p.locator('body').aria_snapshot()
            (OUT / f'sign-in-{name}.aria.txt').write_text(snap, encoding='utf-8')
            for w in ('heading "Sign in"', 'textbox "Email"', 'textbox "Password"', 'button "Sign in"', 'link "Create an account"'):
                if w not in snap: bad(name, 'sign-in accessibility tree', 'missing', w)
            # empty submit by keyboard: the error is announced, focus is not lost
            p.focus('#si-email'); p.keyboard.press('Enter')
            p.wait_for_timeout(300)
            invalid = p.evaluate("(() => { const e = document.activeElement; return e && e.matches(':invalid') ? e.id : null; })()")
            err = p.evaluate(LIVE, 'sign-in-error')
            if invalid != 'si-email' and not (err and not err['hidden'] and err['text']): bad(name, 'sign-in empty submit', 'neither a field message nor an announced error', invalid)
            # (a wrong password is not exercised here: the mock signs in with any password; tests/app-auth.test.cjs covers the error text and role=alert)
            # the two disclosure buttons: Enter and Space, aria-expanded follows, the form is shown and the button stays reachable
            signed_out()
            for btn, form in (('#have-invite', '#invite-form'), ('#forgot', '#reset-form')):
                if not p.locator(btn).is_visible(): continue
                for key in ('Enter', 'Space'):
                    p.focus(btn); before = p.get_attribute(btn, 'aria-expanded')
                    p.keyboard.press(key); p.wait_for_timeout(200)
                    after = p.get_attribute(btn, 'aria-expanded'); shown = p.locator(form).is_visible()
                    if before == after or shown != (after == 'true'): bad(name, btn, f'{key} does not toggle aria-expanded and the form together', (before, after, shown))
                    if after == 'true':
                        where = p.evaluate("document.activeElement && (document.activeElement.id || document.activeElement.tagName)")
                        print(f'  [{name}] {btn} {key}: opened, focus is on {where}')
                        p.keyboard.press(key); p.wait_for_timeout(150)          # close again for the next key
            # invite form open: Tab path through it
            if p.locator('#have-invite').is_visible():
                signed_out(); p.click('#have-invite'); p.wait_for_selector('#invite-form:not([hidden])', timeout=4000)
                path = tab_path(16)
                judge('invite open', path, ['Invite code', 'Your email', 'Join'])
                (OUT / f'invite-open-{name}.aria.txt').write_text(p.locator('main').aria_snapshot() if p.locator('main').count() else p.locator('body').aria_snapshot(), encoding='utf-8')
            # --- create account, reached by keyboard from the link, and back
            signed_out()
            p.focus('#create-link'); p.keyboard.press('Enter'); p.wait_for_selector('#create-account:not([hidden])', timeout=5000); p.wait_for_timeout(300)
            where = p.evaluate("document.activeElement ? (document.activeElement.tagName + '#' + document.activeElement.id) : ''")
            print(f'  [{name}] after Enter on "Create an account", focus is on {where}')
            if not where.startswith('H1'): bad(name, 'create-account route', 'focus did not move to the page heading (a screen reader is not told the page changed)', where)
            path = tab_path()
            judge('create-account', path, ['Email', 'Create account', 'Back to sign in'])
            snap = p.locator('main').aria_snapshot() if p.locator('main').count() else p.locator('body').aria_snapshot()
            (OUT / f'create-account-{name}.aria.txt').write_text(snap, encoding='utf-8')
            for w in ('heading "Create an account"', 'textbox "Email"', 'button "Create account"', 'link "Back to sign in"'):
                if w not in snap: bad(name, 'create-account accessibility tree', 'missing', w)
            # an empty and a wrong submit
            p.focus('#ca-email'); p.keyboard.press('Enter'); p.wait_for_timeout(250)
            inv = p.evaluate("(() => { const e = document.activeElement; return e && e.matches(':invalid') ? e.id : null; })()")
            if inv != 'ca-email': bad(name, 'create-account empty submit', 'no field message on an empty email', inv)
            p.fill('#ca-email', 'someone@example.com'); p.focus('#ca-email'); p.keyboard.press('Enter'); p.wait_for_timeout(900)
            note = p.evaluate(LIVE, 'create-account-note'); err = p.evaluate(LIVE, 'create-account-error')
            if not ((note and note['text']) or (err and not err['hidden'] and err['text'])): bad(name, 'create-account submit', 'nothing is announced after a good submit')
            # back to sign-in by keyboard: focus lands somewhere sensible
            p.focus('#create-back'); p.keyboard.press('Enter'); p.wait_for_selector('#sign-in:not([hidden])', timeout=5000); p.wait_for_timeout(300)
            where = p.evaluate("document.activeElement ? (document.activeElement.tagName + '#' + document.activeElement.id) : ''")
            print(f'  [{name}] after Enter on "Back to sign in", focus is on {where}')
            if where in ('BODY#', '', 'A#create-back'): bad(name, 'back to sign-in', 'focus is lost or left on a hidden link (a screen reader is not told the page changed)', where)
            # one visible h1 per page
            for st in ('#sign-in', '#create-account'):
                if p.locator(st).is_visible() and p.locator(f'{st} h1:visible').count() != 1: bad(name, st, 'not exactly one visible h1', p.locator(f'{st} h1:visible').count())
            if errors: bad(name, 'all', 'page errors', errors[:2])
            ctx.close()
        b.close()
    srv.shutdown()
    print(f'FINDINGS: {len(found)}')
    sys.exit(1 if found else 0)


if __name__ == '__main__':
    run()
