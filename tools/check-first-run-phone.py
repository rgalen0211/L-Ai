"""A newcomer's first run at PHONE width (390 x 844, touch), end to end on a LOCAL server: the sign-in screen and its two folded forms (invite code, forgot password) in the real page (nothing is submitted; the
sign-in call is never made), then, in mock mode, the empty library, the first project, the template picker, and the first version page down to its Render panel. At every step: a screenshot, the accessibility
findings of tools/audit-a11y.py (names, headings, contrast, tap targets, live regions, a keyboard Tab walk), sideways scroll, and the phone rules a script can see: text fields at 16 px or more (iOS zooms in on smaller
ones), fields and buttons at least 40 px high, the main button of a form on the first screen without scrolling, the right keyboard (email/password types and autocomplete). Writes screenshots, prints findings, exit 1 if any.
Not part of the node suite (needs Chrome).

    python tools/check-first-run-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/first-run-shots)
"""
import importlib.util
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/first-run-shots')
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)
aa.PORT = 8188
aa.BASE = f'http://127.0.0.1:{aa.PORT}'
BASE = aa.BASE

FIELDS = r"""() => {
  const out = { small_font: [], short: [], below_fold: [], keyboard: [] };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')) {
    if (!vis(el) || el.id === 'mock-outcome') continue;     // (the mock's own test control is not part of the product)
    if (parseFloat(getComputedStyle(el).fontSize) < 16) out.small_font.push(desc(el) + ' ' + getComputedStyle(el).fontSize);
    if (el.getBoundingClientRect().height < 40) out.short.push(desc(el) + ' ' + Math.round(el.getBoundingClientRect().height));
    if (el.type === 'password' && !/password/.test(el.autocomplete)) out.keyboard.push(desc(el) + ' autocomplete=' + el.autocomplete);
    if (/email/i.test(el.name + el.id) && el.type !== 'email') out.keyboard.push(desc(el) + ' type=' + el.type);
  }
  for (const f of document.querySelectorAll('form')) {
    if (!vis(f)) continue;
    const b = f.querySelector('button[type=submit]'); if (!b || !vis(b)) continue;
    const r = b.getBoundingClientRect(); if (r.bottom > window.innerHeight) out.below_fold.push(desc(f) + ' submit at ' + Math.round(r.bottom) + ' of ' + window.innerHeight);
  }
  return out;
}"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = aa.serve()
    ok = True
    findings = []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    def step(p, key, title, fold_rule=False):
        p.wait_for_timeout(250)
        p.screenshot(path=str(OUT / f'{key}.png'), full_page=True)
        n0 = len(aa_findings)
        r = p.evaluate(aa.SCAN)
        for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
            for v in r[k]:
                aa_findings.append(f'{title}: {label}: {v}')
        if r['overflow']:
            aa_findings.append(f'{title}: sideways scroll')
        for v in r['live']:
            if 'NOT-LIVE' in v:
                aa_findings.append(f'{title}: message not in a live region: {v}')
        n, reached, noring, trapped = aa.tab_walk(p)
        if reached < n * 0.8:
            aa_findings.append(f'{title}: keyboard reaches {reached} of about {n} controls (missed: {", ".join(aa.tab_walk.missed[:6])})')
        for d in noring:
            aa_findings.append(f'{title}: no visible focus mark on {d}')
        f = p.evaluate(FIELDS)
        for k, label in (('small_font', 'field text under 16 px (iOS zooms in)'), ('short', 'field under 40 px high'), ('keyboard', 'wrong keyboard or autocomplete')):
            for v in f[k]:
                aa_findings.append(f'{title}: {label}: {v}')
        if fold_rule:
            for v in f['below_fold']:
                aa_findings.append(f'{title}: main button below the first screen: {v}')
        new = aa_findings[n0:]
        check(not new, f'{title}: ' + ('no findings' if not new else f'{len(new)} finding(s): ' + '; '.join(new)[:300]))

    aa_findings = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            # ---- the real page: nothing is submitted
            ctx = b.new_context(**opts)
            sent = []
            ctx.on('request', lambda r: sent.append(r.method + ' ' + r.url) if r.method != 'GET' and not r.url.startswith(BASE) else None)
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.goto(f'{BASE}/app/', wait_until='load')
            p.wait_for_selector('#sign-in:not([hidden])', timeout=20000)
            print('sign-in')
            step(p, '01-sign-in', 'sign-in', fold_rule=True)
            check(p.evaluate("document.querySelector('#sign-in-form button[type=submit]').getBoundingClientRect().bottom <= window.innerHeight"), 'the Sign in button is on the first screen without scrolling')
            if p.locator('#have-invite:visible').count():
                p.click('#have-invite')
                p.wait_for_selector('#invite-form:not([hidden])')
                step(p, '02-invite', 'sign-in with the invite form open')
            if p.locator('#forgot:visible').count():
                p.click('#forgot')
                p.wait_for_selector('#reset-form:not([hidden])')
                step(p, '03-forgot', 'sign-in with the reset form open')
            check(not sent, f'nothing was submitted ({sent[:2]})')
            ctx.close()
            # ---- mock mode: signed in
            ctx = b.new_context(**opts)
            p = ctx.new_page()
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.on('dialog', lambda d: d.accept())
            p.goto(f'{BASE}/app/?mock#/', wait_until='load')
            p.wait_for_selector('#np-title', timeout=20000)
            print('first project')
            step(p, '04-library', 'the library')
            p.fill('#np-title', 'My first film')
            step(p, '05-named', 'the library with a name typed')
            p.click('button:has-text("Create")')
            p.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
            p.wait_for_selector('.template-picker summary', timeout=20000)
            step(p, '06-version', 'the first version page')
            if p.locator('details.template-picker[open]').count() == 0:
                p.click('.template-picker summary')
            step(p, '07-templates', 'the template picker open')
            p.click('button:has-text("Use this film")')
            p.wait_for_function("document.body.innerText.includes('Template applied and saved')", timeout=20000)
            step(p, '08-applied', 'after choosing a film')
            p.get_by_role('button', name='Make contact sheet').click()
            p.evaluate("() => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), 130) }")
            end = time.time() + 40
            while time.time() < end and p.locator('.job .state.job-complete').count() < 1:
                p.wait_for_timeout(250)
            p.evaluate('clearInterval(window.__fast)')
            step(p, '09-sheet', 'with the first contact sheet')
            check(not errors, f'no page errors {errors}')
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print(f'FINDINGS: {len(aa_findings)}')
    for f in aa_findings:
        print('  ' + f)
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
