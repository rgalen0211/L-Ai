"""Whole-app accessibility and phone pass (local only, mock mode, real Chrome). Every page a signed-in person can reach in /app/ (library, project, version, account, credits, request, help, the guided
builder, Your look and its editor, the delivery page, the consent page, the admin pages, an unknown route), the sign-in screens in the real page (nothing submitted), and the public pages linked from the
footer, at 1280 px (light and dark) and 390 px. Every page is scanned with tools/audit-a11y.py (control names, headings, contrast, tap targets, sideways scroll, a keyboard Tab walk with a visible focus mark),
and at phone width with the field rules (text fields at 16 px or more so iOS does not zoom, fields at least 40 px high, the right keyboard types). A keyboard-only run makes a project and goes back without
the mouse. Findings are listed by page. It turns the off-by-default flags on through a local copy of the config only; nothing is sent anywhere.

    python tools/audit-app-pass.py [shots-folder]      (prints findings by page; exit 1 if any; with a folder it also saves a full-page screenshot of every page and size)
"""
import importlib.util
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)
aa.PORT = 8195
aa.BASE = f'http://127.0.0.1:{aa.PORT}'
BASE = aa.BASE

FIELDS = r"""() => {
  const out = { small_font: [], short: [], keyboard: [] };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),select,textarea')) {
    if (!vis(el) || el.id === 'mock-outcome') continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 16) out.small_font.push(desc(el) + ' ' + getComputedStyle(el).fontSize);
    if (el.getBoundingClientRect().height < 40) out.short.push(desc(el) + ' ' + Math.round(el.getBoundingClientRect().height));
    if (el.type === 'password' && !/password/.test(el.autocomplete)) out.keyboard.push(desc(el) + ' autocomplete=' + el.autocomplete);
    if (/email/i.test(el.name + el.id) && el.type !== 'email') out.keyboard.push(desc(el) + ' type=' + el.type);
  }
  return out;
}"""

TEXT = r"""() => { const m = document.querySelector('main') || document.body; return m.innerText; }"""
SUSPECT = re.compile(r'\b(TODO|FIXME|lorem ipsum|undefined|\[object|NaN)\b|\bnull\b', re.I)
FLAGS_OFF = ['aiEditor', 'filmPages', 'industryTemplate', 'uploads', 'byodGuide', 'creatorBeta', 'guidedBuilder', 'lookEditor', 'funnelTracking', 'connectAi', 'catalog', 'catalogComingSoon']
MAKE = """() => { const db = window.ryagramMock.client.db; const v = db.versions[db.versions.length - 1]; return JSON.stringify({ p: v.project_id, v: v.id }); }"""
ORDER = """(id) => { const db = window.ryagramMock.client.db; const v = db.versions[db.versions.length - 1];
  db.render_orders.push({ id: 'o-pass', owner_id: 'u-ryan', state: 'delivered', want: 'final', source: 'app', project_id: v.project_id, version_id: v.id, created_at: new Date().toISOString(),
    stages: [{ stage: 'final_render', state: 'complete', credits_quoted: 10, job_id: null }], delivery: { id, label: 'AI-assisted', expires_at: '2026-11-17T00:00:00Z', deleted: false } }); }"""
DELIVERY = '11111111-1111-4111-8111-111111111111'
CONSENT = '00000000-0000-4000-8000-0000000000aa'


def main():
    srv = aa.serve()
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    for k in FLAGS_OFF:
        cfg = re.sub(rf'{k}:\s*false', f'{k}: true', cfg)
    findings = {}                 # page -> [finding]

    def add(where, text):
        findings.setdefault(where, [])
        if text not in findings[where]:
            findings[where].append(text)

    def scan(page, where, phone):
        page.wait_for_timeout(350)
        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOTS / (re.sub(r'[^a-z0-9]+', '-', where.lower()).strip('-') + '.png')), full_page=True)
        r = page.evaluate(aa.SCAN)
        for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
            for v in r[k]:
                add(where, f'{label}: {v}')
        if r['overflow']:
            add(where, 'sideways scroll')
        try:
            n, reached, noring, trapped = aa.tab_walk(page)
            if reached < n * 0.8:
                add(where, f'keyboard reaches {reached} of about {n} controls (missed: {", ".join(aa.tab_walk.missed[:4])})')
            for d in noring:
                add(where, f'no visible focus mark on {d}')
            if trapped:
                add(where, 'keyboard focus got stuck')
        except Exception as e:  # noqa: BLE001
            add(where, f'tab walk failed: {str(e)[:80]}')
        if phone:
            f = page.evaluate(FIELDS)
            for k, label in (('small_font', 'field text under 16 px (iOS zooms in)'), ('short', 'field under 40 px high'), ('keyboard', 'wrong keyboard or autocomplete')):
                for v in f[k]:
                    add(where, f'{label}: {v}')
        t = page.evaluate(TEXT)
        m = SUSPECT.search(t)
        if m:
            add(where, f'unfinished-looking text: {m.group(0)!r}')
        if not page.title() or len(page.title()) < 3:
            add(where, 'no page title')

    errors = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for tag, opts, scheme in (('1280', dict(viewport={'width': 1280, 'height': 900}), 'light'), ('1280 dark', dict(viewport={'width': 1280, 'height': 900}), 'dark'),
                                      ('390', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True), 'light')):
                phone = tag == '390'
                print(tag, flush=True)
                ctx = b.new_context(color_scheme=scheme, **opts)
                ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=cfg))
                page = ctx.new_page()
                page.on('dialog', lambda d: d.accept())
                page.on('pageerror', lambda e: errors.setdefault(tag, []).append(str(e)[:120]))
                page.on('console', lambda m: errors.setdefault(tag, []).append(m.text[:120]) if m.type == 'error' and 'status of 404' not in m.text and 'fake.supabase.co' not in m.text and 'media-src' not in m.text and 'Failed to load resource' not in m.text else None)

                def visit(name, hash_, js=None, arg=None):
                    page.evaluate(f"location.hash = {hash_!r}")
                    page.wait_for_timeout(700)
                    if js:
                        page.evaluate(js, arg) if arg is not None else page.evaluate(js)
                        page.wait_for_timeout(300)
                    scan(page, f'{name} [{tag}]', phone)

                # ---- signed in (mock): the library, then a project and a version
                page.goto(f'{BASE}/app/?mock#/', wait_until='load')
                page.wait_for_selector('#np-title', timeout=20000)
                scan(page, f'library [{tag}]', phone)
                page.fill('#np-title', 'Audit film')
                page.click('button:has-text("Create")')
                page.wait_for_selector('h1:has-text("Version 1")', timeout=20000)
                ids = __import__('json').loads(page.evaluate(MAKE))
                scan(page, f'version page [{tag}]', phone)
                if page.locator('details.template-picker:not([open]) summary').count():
                    page.click('.template-picker summary')
                    scan(page, f'version page, templates open [{tag}]', phone)
                visit('project page', f'#/p/{ids["p"]}')
                page.evaluate(ORDER, DELIVERY)
                visit('delivery page', f'#/delivery/{DELIVERY}')
                visit('account', '#/account')
                visit('credits', '#/credits')
                visit('credits after a purchase', '#/credits?paid=pack_starter')
                visit('request a film', '#/request')
                visit('help', '#/help')
                visit('guided builder', '#/build')
                visit('your look (list)', '#/looks')
                visit('your look (new)', '#/looks/new?preset=clean-light')
                visit('connect consent', f'#/connect/consent?request={CONSENT}')
                visit('admin: waitlist', '#/admin/waitlist')
                visit('admin: visits', '#/admin/visits')
                visit('admin: ops', '#/admin/ops')
                visit('admin: funnel', '#/admin/funnel')
                visit('admin: render approvals', '#/admin/renders')
                visit('unknown route', '#/nowhere')
                if tag == '1280':
                    # keyboard only: make a project and come back, no mouse
                    page.evaluate("location.hash = '#/'")
                    page.wait_for_selector('#np-title', timeout=20000)
                    page.evaluate("document.activeElement && document.activeElement.blur()")
                    ok = False
                    for _ in range(40):
                        page.keyboard.press('Tab')
                        if page.evaluate("document.activeElement && document.activeElement.id") == 'np-title':
                            ok = True
                            break
                    if not ok:
                        add('keyboard-only: create a project', 'Tab never reaches the project name box')
                    else:
                        page.keyboard.type('Keyboard film')
                        page.keyboard.press('Enter')
                        try:
                            page.wait_for_selector('h1:has-text("Version 1")', timeout=8000)
                            for step in ('the project page', 'the library'):
                                for _ in range(6):
                                    page.keyboard.press('Shift+Tab')
                                    if page.evaluate("(document.activeElement && document.activeElement.textContent || '').trim()").startswith('←'):
                                        break
                                page.keyboard.press('Enter')
                                page.wait_for_selector('h1:has-text("Keyboard film")' if step == 'the project page' else '#np-title', timeout=8000)
                        except Exception as e:  # noqa: BLE001
                            add('keyboard-only: create a project', f'could not finish with the keyboard alone: {str(e)[:80]}')
                ctx.close()
                # ---- the real pages: sign-in (nothing submitted) and the public pages
                ctx = b.new_context(color_scheme=scheme, **opts)
                page = ctx.new_page()
                page.on('dialog', lambda d: d.accept())
                page.goto(f'{BASE}/app/', wait_until='load')
                page.wait_for_selector('#sign-in:not([hidden])', timeout=20000)
                scan(page, f'sign-in [{tag}]', phone)
                if page.locator('#have-invite:visible').count():
                    page.click('#have-invite')
                    scan(page, f'sign-in, invite form [{tag}]', phone)
                if page.locator('#forgot:visible').count():
                    page.click('#forgot')
                    scan(page, f'sign-in, reset form [{tag}]', phone)
                for name, path in (('help (public)', '/help/'), ('terms', '/terms/'), ('privacy', '/privacy-policy.html'), ('AI content', '/ai-content/'), ('Ryagram landing', '/ryagram/'),
                                   ('film page sample', '/film/?mock'), ('report', '/report/'), ('connect your AI', '/connect-ai/')):
                    try:
                        page.goto(f'{BASE}{path}', wait_until='load')
                        scan(page, f'{name} [{tag}]', phone)
                    except Exception as e:  # noqa: BLE001
                        add(f'{name} [{tag}]', f'could not open: {str(e)[:80]}')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    # ---- report, by page, with the same finding across sizes folded together
    by_issue = {}
    for where, items in findings.items():
        base_page = re.sub(r' \[[^\]]+\]$', '', where)
        for it in items:
            by_issue.setdefault((base_page, it), []).append(where[where.rindex('[') + 1:-1] if '[' in where else '1280')
    total = 0
    cur = None
    for (pg, it), sizes in sorted(by_issue.items()):
        if pg != cur:
            print(f'\n{pg}')
            cur = pg
        print(f'  - {it}   [{", ".join(sizes)}]')
        total += 1
    for tag, errs in errors.items():
        for e in sorted(set(errs))[:5]:
            print(f'  page error at {tag}: {e}')
    print(f'\nFINDINGS: {total} distinct on {len({p for p, _ in by_issue})} pages')
    print('RESULT:', 'PASS' if not total and not errors else 'FAIL')
    return 0 if not total and not errors else 1


if __name__ == '__main__':
    sys.exit(main())
