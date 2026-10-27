"""Ryagram launch smoke test: every page loads clean at desktop and phone width, the forms submit, you can sign in, and (only if you ask) a Stripe TEST-mode
purchase and refund round-trip puts the credits up and back down. Run it yourself, from a terminal, after the site is up.

    python tools/launch-smoke.py                                  pages only, against https://uselai.com (changes nothing)
    python tools/launch-smoke.py --submit-forms                   also submit the waitlist and creator-beta forms ONCE with obvious test data
    python tools/launch-smoke.py --app                            also sign in as your test account and open the app screens
    python tools/launch-smoke.py --purchase                       also buy the Starter pack with Stripe's TEST card, then refund it (needs --app)
    python tools/launch-smoke.py --serve .                        test a local copy of the repo instead (changes nothing; no purchase)
    python tools/launch-smoke.py --self-test                      check the script's own helpers (no browser, no network)

Secrets come from the ENVIRONMENT only and are never printed or written anywhere:
    SMOKE_EMAIL, SMOKE_PASSWORD   a test account you made for this (not your own); needed for --app and --purchase
    STRIPE_TEST_KEY               a Stripe TEST-mode key (rk_test_... or sk_test_...) with permission to read payment intents and create refunds;
                                  needed only for --purchase's refund step. A LIVE key (rk_live_ / sk_live_) is refused outright.
Nothing here costs money: the purchase uses Stripe's test card 4242 4242 4242 4242 in test mode, and it stops before typing any card if the Checkout
page does not say it is a test. Needs Chrome and playwright (the same as the other tools/check-*.py). Put TEMP/TMP on D: (the storage rule).
It exits 0 if every REQUIRED check passed, 1 otherwise, and writes smoke-report.json and screenshots to --out (default D:/Ryagram-scratch/WEB/smoke-out).
"""
import argparse
import base64
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

CARD = {'number': '4242 4242 4242 4242', 'expiry': '12 / 34', 'cvc': '123', 'name': 'Smoke Test', 'zip': '10001'}
HEADLINE = 'You have a question. Ryagram makes the data answer it.'
# The hero button follows the creatorBeta switch (Ryan, 2026-10-17): 'Join the creator beta' when the form is on, 'Email to request an invite'
# while it is off. check_pages reads the switch from the live page and expects the matching words.
CREATOR_CTA = '<creator call to action>'
CREATOR_CTA_ON, CREATOR_CTA_OFF = 'Join the creator beta', 'Email to request an invite'
VIEWPORTS = (('desktop', dict(viewport={'width': 1280, 'height': 900})),
             ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)))

# (path, what it is, required?, text it must show, text it must NOT show, request failures that are normal on this page)
PAGES = [
    ('/', "L'Ai home", True, [], [], []),
    ('/ryagram/', 'Ryagram landing page', True, [HEADLINE, CREATOR_CTA, 'Rise of the Interstate Highway'], ['DRAFT FOR RYAN', 'TODO', 'undefined', 'null'], []),
    ('/film/?sample=interstate', 'the Interstate sample film page', False, ['Rise of the Interstate Highway', 'Sources and method', 'Make your own data film'], ['DRAFT FOR RYAN'], []),
    ('/film/?s=AAAAAAAAAAAAAAAAAAAAAA', 'an unknown film page says "No film here"', True, ['No film here'], [], ['/functions/v1/film-page']),
    ('/app/', 'the app sign-in screen', True, ['Sign in'], [], []),
    ('/help/', 'help', False, [], ['DRAFT FOR RYAN'], []),
    ('/report/', 'report a film', False, [], ['DRAFT FOR RYAN'], []),
    ('/terms/', 'Terms of Use', False, ['Terms of Use'], ['DRAFT FOR RYAN', 'draft-decision', '[Ryan', '[counsel', 'TODO'], []),
    ('/privacy-policy.html', 'Privacy Policy', True, ['Privacy Policy'], ['DRAFT FOR RYAN', '[Ryan', '[counsel', 'TODO'], []),
    ('/workflow-audit/', 'the Workflow Audit page', True, [], [], []),
]


# ---------------------------------------------------------------------------------------------------------------------------- pure helpers (self-tested)
def key_problem(key):
    """None if the Stripe key is acceptable for the refund step, else why not. A live key is NEVER acceptable."""
    k = (key or '').strip()
    if not k:
        return 'STRIPE_TEST_KEY is not set'
    if re.match(r'^(rk|sk)_live_', k):
        return 'that is a LIVE Stripe key: this script only ever uses a test key'
    if not re.match(r'^(rk|sk)_test_[A-Za-z0-9]+$', k):
        return 'STRIPE_TEST_KEY is not a Stripe test key (rk_test_... or sk_test_...)'
    return None


def parse_credits(text):
    """The credit balance from the app's line ('20 credits available', '1 credit available'), or None."""
    m = re.search(r'(-?\d+)\s+credits?\b', text or '')
    return int(m.group(1)) if m else None


def pick_payment_intent(items, amount_cents, since):
    """The newest succeeded payment intent of this amount made after `since` (unix seconds), or None."""
    best = None
    for pi in items or []:
        if pi.get('status') == 'succeeded' and pi.get('amount') == amount_cents and pi.get('created', 0) >= since and not pi.get('amount_refunded'):
            if best is None or pi['created'] > best['created']:
                best = pi
    return best


def redact(text, secrets):
    out = text
    for s in secrets:
        if s and len(s) >= 6:
            out = out.replace(s, '***')
    return out


def fail_summary(results):
    return [r for r in results if r['required'] and not r['ok']]


def self_test():
    assert key_problem('rk_test_abc123') is None and key_problem('sk_test_abc123') is None
    for bad in ('', None, 'rk_live_abc123', 'sk_live_abc123', 'whsec_abc', 'pk_test_abc', 'rk_test_', 'sk_test_abc 123'):
        assert key_problem(bad), bad
    assert 'LIVE' in key_problem('sk_live_x')
    assert parse_credits('20 credits available') == 20 and parse_credits('1 credit available') == 1 and parse_credits('-3 credits') == -3 and parse_credits('nope') is None
    items = [{'id': 'a', 'status': 'succeeded', 'amount': 1200, 'created': 100}, {'id': 'b', 'status': 'succeeded', 'amount': 1200, 'created': 200},
             {'id': 'c', 'status': 'requires_payment_method', 'amount': 1200, 'created': 300}, {'id': 'd', 'status': 'succeeded', 'amount': 3000, 'created': 300},
             {'id': 'e', 'status': 'succeeded', 'amount': 1200, 'created': 250, 'amount_refunded': 1200}]
    assert pick_payment_intent(items, 1200, 150)['id'] == 'b'
    assert pick_payment_intent(items, 1200, 250) is None
    assert pick_payment_intent([], 1200, 0) is None
    assert redact('key rk_test_secret123 here', ['rk_test_secret123', 'x']) == 'key *** here'
    paths = [p[0] for p in PAGES]
    assert len(paths) == len(set(paths)) and all(p.startswith('/') for p in paths)
    assert all(isinstance(p[2], bool) for p in PAGES)
    assert any(p[0] == '/ryagram/' and p[2] for p in PAGES) and any(p[0] == '/app/' and p[2] for p in PAGES)
    assert fail_summary([{'required': True, 'ok': False}, {'required': False, 'ok': False}, {'required': True, 'ok': True}]) == [{'required': True, 'ok': False}]
    assert 'DRAFT FOR RYAN' in ' '.join(' '.join(p[4]) for p in PAGES if p[0] == '/terms/')          # a published Terms page must not still say DRAFT
    print('self-test ok')


# ---------------------------------------------------------------------------------------------------------------------------- the run
class Run:
    def __init__(self, a):
        self.a = a
        self.results = []
        self.secrets = [os.environ.get('SMOKE_PASSWORD', ''), os.environ.get('STRIPE_TEST_KEY', ''), os.environ.get('SMOKE_EMAIL', '')]
        self.out = Path(a.out)
        self.out.mkdir(parents=True, exist_ok=True)

    def check(self, section, name, ok, detail='', required=True):
        detail = redact(str(detail), self.secrets)
        print(('  ok   ' if ok else ('  FAIL ' if required else '  warn ')) + name + (f'  [{detail}]' if detail and not ok else ''))
        self.results.append({'section': section, 'name': name, 'ok': bool(ok), 'required': required, 'detail': detail if not ok else ''})
        return ok

    def shot(self, page, label):
        try:
            page.screenshot(path=str(self.out / (re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-') + '.png')))
        except Exception:
            pass


def serve_local(root):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(root), **k)

        def log_message(self, *a):
            pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def check_pages(run, pw_browser, base):
    print('PAGES (desktop and phone)')
    for vname, vopts in VIEWPORTS:
        ctx = pw_browser.new_context(**vopts)
        for path, what, required, must, must_not, normal_failures in PAGES:
            page = ctx.new_page()
            problems = []
            page.on('pageerror', lambda e, p=problems: p.append(f'page error: {e}'))
            page.on('console', lambda m, p=problems: p.append(f'console error: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            page.on('response', lambda r, p=problems, nf=normal_failures: p.append(f'{r.status} {r.url}')
                    if r.status >= 400 and not r.url.endswith('/favicon.ico') and not any(x in r.url for x in nf) else None)
            label = f'{vname} {path} ({what})'
            try:
                resp = page.goto(base + path, wait_until='load', timeout=45000)
                page.wait_for_timeout(1200)
                status = resp.status if resp else 0
                if status == 404 and not required:
                    run.check('pages', f'{label}: not live yet (404), skipped', True, required=False)
                    page.close()
                    continue
                run.check('pages', f'{label}: loads (HTTP {status})', status == 200, f'HTTP {status}', required)
                text = page.inner_text('body')
                on = bool(page.evaluate('!!(window.ryagramConfig && window.ryagramConfig.creatorBeta === true)')) if CREATOR_CTA in must else None
                for t in must:
                    if t == CREATOR_CTA:
                        t = CREATOR_CTA_ON if on else CREATOR_CTA_OFF
                    run.check('pages', f'{label}: shows "{t[:50]}"', t in text, 'text missing', required)
                for t in must_not:
                    run.check('pages', f'{label}: does not show "{t[:30]}"', t not in text and t not in page.content(), 'found on the page', required)
                run.check('pages', f'{label}: has a title and a heading', bool(page.title().strip()) and page.locator('h1').count() >= 1, 'no title or h1', required)
                run.check('pages', f'{label}: no console errors, failed requests or page errors', not problems, '; '.join(problems[:3]), required)
                bad_img = page.evaluate("[...document.images].filter(i => i.complete && i.naturalWidth === 0 && getComputedStyle(i).display !== 'none').map(i => i.src).slice(0, 3)")
                run.check('pages', f'{label}: every image loaded', not bad_img, ', '.join(bad_img), required)
                if vname == 'phone':
                    over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
                    run.check('pages', f'{label}: fits a phone (no sideways scroll)', over <= 0, f'{over}px too wide', required)
                    small = page.evaluate("[...document.querySelectorAll('a,button')].filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.height < 24 && r.width < 24 && !e.closest('.hp,[aria-hidden=true]'); }).length")
                    run.check('pages', f'{label}: no tiny tap targets (under 24px)', small == 0, f'{small} found', False)
                run.shot(page, f'page-{vname}-{path}')
            except Exception as e:
                run.check('pages', f'{label}: could be opened', False, str(e)[:160], required)
            page.close()
        ctx.close()


def check_forms(run, pw_browser, base):
    print('FORMS (these submit REAL rows with obvious test data)')
    stamp = time.strftime('%Y%m%d%H%M%S')
    ctx = pw_browser.new_context(**VIEWPORTS[1][1])
    page = ctx.new_page()
    page.goto(base + '/ryagram/', wait_until='load')
    page.fill('#wl-email', f'smoke+{stamp}@example.com')
    page.fill('#wl-use', 'launch smoke test')
    page.click('#waitlist-form button[type=submit]')
    page.wait_for_timeout(4000)
    msg = page.inner_text('#waitlist-status') if page.locator('#waitlist-status').is_visible() else ''
    run.check('forms', 'the waitlist form accepts an address', "on the list" in msg, msg[:120])
    page.fill('#cb-name', 'Smoke Test')
    page.fill('#cb-email', f'smoke+creator{stamp}@example.com')
    page.select_option('#cb-kind', 'other')
    page.fill('#cb-makes', 'Launch smoke test, please ignore')
    page.fill('#cb-link', f'https://example.com/smoke-{stamp}')
    page.fill('#cb-question', 'This is an automated launch smoke test. Please ignore and delete it.')
    page.click('#creator-form button[type=submit]')
    page.wait_for_timeout(4000)
    msg = page.inner_text('#creator-status') if page.locator('#creator-status').is_visible() else ''
    live = 'we have your application' in msg
    run.check('forms', 'the creator beta form accepts an application' if live else 'the creator beta form is OFF (it says to email); switch creatorBeta on to test it', live, msg[:120], required=bool(run.a.expect_creator_live))
    print(f'     cleanup: delete from public.ryagram_waitlist where email like \'smoke+{stamp}%\'; and the creator_applications row for smoke+creator{stamp}@example.com (SQL Editor)')
    ctx.close()


def sign_in(page, base, email, password):
    page.goto(base + '/app/', wait_until='load')
    page.wait_for_selector('#si-email', timeout=20000)
    page.fill('#si-email', email)
    page.fill('#si-password', password)
    page.click('#sign-in-form button[type=submit]')
    page.wait_for_selector('h1:has-text("Your projects")', timeout=30000)


def check_app(run, pw_browser, base):
    print('APP (signed in as your test account)')
    email, password = os.environ.get('SMOKE_EMAIL'), os.environ.get('SMOKE_PASSWORD')
    if not email or not password:
        run.check('app', 'SMOKE_EMAIL and SMOKE_PASSWORD are set (a test account)', False, 'set both in the environment')
        return None
    ctx = pw_browser.new_context(**VIEWPORTS[1][1])
    page = ctx.new_page()
    problems = []
    page.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    page.on('console', lambda m: problems.append(f'console error: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    try:
        sign_in(page, base, email, password)
        run.check('app', 'sign-in works and the library opens', True)
        run.shot(page, 'app-library')
        bal = page.locator('.credit-balance').first
        if bal.count():
            run.check('app', 'the credit balance is shown', parse_credits(bal.inner_text()) is not None, bal.inner_text()[:80], required=False)
        for route, name, heading in (('#/request', 'Request a film', 'Request a film'), ('#/help', 'Get help', 'Get help'), ('#/account', 'Your account', 'Your account')):
            page.goto(f'{base}/app/{route}', wait_until='load')
            page.wait_for_timeout(1500)
            ok = page.locator(f'h1:has-text("{heading}")').count() > 0
            run.check('app', f'{name} opens', ok, 'heading not found (the feature may be switched off)', required=False)
        run.check('app', 'no console errors in the app', not problems, '; '.join(problems[:3]))
        page.goto(f'{base}/app/', wait_until='load')
        page.wait_for_timeout(1000)
        out = page.locator('button:has-text("Sign out")')
        if out.count():
            out.first.click()
            page.wait_for_selector('#si-email', timeout=15000)
            run.check('app', 'sign-out works', True)
    except Exception as e:
        run.check('app', 'the app flow ran', False, str(e)[:200])
    ctx.close()
    return True


def stripe_api(path, key, data=None):
    req = urllib.request.Request('https://api.stripe.com' + path, data=urllib.parse.urlencode(data).encode() if data else None,
                                 headers={'Authorization': 'Basic ' + base64.b64encode((key + ':').encode()).decode()})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def check_purchase(run, pw_browser, base):
    print('PURCHASE and REFUND (Stripe TEST mode)')
    email, password, key = os.environ.get('SMOKE_EMAIL'), os.environ.get('SMOKE_PASSWORD'), os.environ.get('STRIPE_TEST_KEY')
    problem = key_problem(key)
    if problem or not email or not password:
        run.check('purchase', 'the purchase test can start', False, problem or 'set SMOKE_EMAIL and SMOKE_PASSWORD')
        return
    since = int(time.time()) - 5
    ctx = pw_browser.new_context(viewport={'width': 1100, 'height': 900})
    page = ctx.new_page()
    try:
        sign_in(page, base, email, password)
        page.goto(f'{base}/app/#/credits', wait_until='load')
        page.wait_for_selector('.credit-balance', timeout=20000)
        text = page.inner_text('main, body')
        run.check('purchase', 'the Credits page says it is test mode', re.search(r'test mode|4242', text, re.I) is not None, 'no test-mode note: payments may be live. STOPPING.')
        if not re.search(r'test mode|4242', text, re.I):
            return
        b0 = parse_credits(page.locator('.credit-balance').first.inner_text())
        run.check('purchase', f'the starting balance is readable ({b0})', b0 is not None)
        card = page.locator('li, article, section, .pack, .plan', has_text='Starter').first
        card.get_by_role('button', name=re.compile('Buy|Subscribe')).first.click()
        page.wait_for_url(re.compile(r'checkout\.stripe\.com'), timeout=60000)
        page.wait_for_timeout(2500)
        body = page.inner_text('body')
        is_test = re.search(r'test mode|sandbox', body, re.I) is not None
        run.check('purchase', 'the Stripe Checkout page says TEST mode (a card is typed only if it does)', is_test, 'no test-mode marker: STOPPING before any card is typed')
        if not is_test:
            return
        run.shot(page, 'purchase-checkout')
        if run.a.manual_card:
            print('     --manual-card: complete the payment in the open window with 4242 4242 4242 4242 (any future date, any CVC); waiting up to 5 minutes...')
        else:
            page.get_by_label(re.compile('Card number', re.I)).fill(CARD['number'])
            page.get_by_label(re.compile('Expiration', re.I)).fill(CARD['expiry'])
            page.get_by_label(re.compile('CVC|Security code', re.I)).fill(CARD['cvc'])
            for lbl, val in (('Cardholder name', CARD['name']), ('ZIP|Postal', CARD['zip'])):
                el = page.get_by_label(re.compile(lbl, re.I))
                if el.count():
                    el.first.fill(val)
            page.get_by_role('button', name=re.compile('Pay|Subscribe', re.I)).first.click()
        page.wait_for_url(re.compile(re.escape(base)), timeout=300000 if run.a.manual_card else 90000)
        deadline = time.time() + 90
        b1 = b0
        while time.time() < deadline:
            page.goto(f'{base}/app/#/credits', wait_until='load')
            page.wait_for_selector('.credit-balance', timeout=20000)
            b1 = parse_credits(page.locator('.credit-balance').first.inner_text())
            if b0 is not None and b1 is not None and b1 >= b0 + 10:
                break
            page.wait_for_timeout(5000)
        run.check('purchase', f'the purchase put 10 credits on the account ({b0} -> {b1})', b0 is not None and b1 == b0 + 10)
        pi = pick_payment_intent(stripe_api('/v1/payment_intents?limit=10', key).get('data'), 1200, since)
        run.check('purchase', 'the test payment of $12.00 is in Stripe', pi is not None, 'no matching succeeded payment found (does the key allow reading payment intents?)')
        if not pi:
            return
        refund = stripe_api('/v1/refunds', key, {'payment_intent': pi['id']})
        run.check('purchase', 'the refund was accepted by Stripe', refund.get('status') in ('succeeded', 'pending'), str(refund.get('status')))
        deadline = time.time() + 90
        b2 = b1
        while time.time() < deadline:
            page.goto(f'{base}/app/#/credits', wait_until='load')
            page.wait_for_selector('.credit-balance', timeout=20000)
            b2 = parse_credits(page.locator('.credit-balance').first.inner_text())
            if b2 is not None and b0 is not None and b2 <= b0:
                break
            page.wait_for_timeout(5000)
        run.check('purchase', f'the refund took the credits back ({b1} -> {b2})', b0 is not None and b2 == b0)
    except Exception as e:
        run.check('purchase', 'the purchase round-trip ran', False, str(e)[:240])
    ctx.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default='https://uselai.com')
    ap.add_argument('--serve', help='serve this directory locally and test that instead of --base')
    ap.add_argument('--out', default='D:/Ryagram-scratch/WEB/smoke-out')
    ap.add_argument('--submit-forms', action='store_true')
    ap.add_argument('--expect-creator-live', action='store_true', help='with --submit-forms: fail (not just warn) if the creator beta form is still off')
    ap.add_argument('--app', action='store_true')
    ap.add_argument('--purchase', action='store_true')
    ap.add_argument('--manual-card', action='store_true', help='with --purchase: you type the test card yourself in a visible window')
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args(argv)
    if a.self_test:
        self_test()
        return 0
    if a.purchase and not a.app:
        print('--purchase needs --app (it signs in)')
        return 2
    if a.purchase and a.serve:
        print('--purchase is only for the real site (a local copy has no Stripe return address)')
        return 2
    from playwright.sync_api import sync_playwright
    run = Run(a)
    srv = None
    base = a.base.rstrip('/')
    if a.serve:
        srv, base = serve_local(a.serve)
    print(f'Testing {base}  (output: {a.out})')
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome', headless=not (a.headed or a.manual_card))
            check_pages(run, b, base)
            if a.submit_forms:
                check_forms(run, b, base)
            if a.app:
                check_app(run, b, base)
            if a.purchase:
                check_purchase(run, b, base)
            b.close()
    finally:
        if srv:
            srv.shutdown()
    bad = fail_summary(run.results)
    warns = [r for r in run.results if not r['required'] and not r['ok']]
    (Path(a.out) / 'smoke-report.json').write_text(json.dumps({'base': base, 'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'results': run.results}, indent=1), encoding='utf-8')
    print(f'\n{len(run.results)} checks, {len(bad)} REQUIRED failures, {len(warns)} warnings. Report: {a.out}/smoke-report.json')
    for r in bad:
        print('  FAILED:', r['section'], r['name'], '-', r['detail'])
    print('RESULT:', 'PASS' if not bad else 'FAIL')
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
