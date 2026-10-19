"""Keyboard and screen-reader pass on the desktop maker (tools/desktop_maker.py) in real Chrome, local only, at 1280 and 390 px, light and dark. Every state of one run (the start, a failed door check, files chosen,
a plan running, ready, a missing word, built, cancelled) is scanned with tools/audit-a11y.py's checks (names, headings, contrast, tap targets, sideways scroll, a keyboard Tab walk with a visible focus mark)
and with the rules for what a screen reader says: every field has a label; buttons that repeat on the page say which slot they belong to; a disabled button says why; the live regions announce a change once,
not every second while a job runs; an error is announced; the page language and title are set. The check uses the same stand-in ENGINE CLI as tools/check-desktop-maker.py (no speech model, no ffmpeg).
It does not replace a person with a screen reader. Prints findings; exit 1 if any.

    python tools/audit-maker-a11y.py [path to a Ryagram checkout with ryagram/local]      (default D:/Ryagram-scratch/WEB/engine-lr)
"""
import importlib.util
import json
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


aa = load('audit_a11y', 'audit-a11y.py')
cm = load('check_desktop_maker', 'check-desktop-maker.py')
dm = cm.dm

# what a screen reader gets from the page beyond names: roles, live regions, descriptions, language
SR = r"""() => {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  if (!document.documentElement.lang) out.push('the page has no language');
  if (!document.title || document.title.length < 3) out.push('the page has no title');
  const names = {};
  for (const b of document.querySelectorAll('main button, main a[href], main summary')) {
    if (!vis(b)) continue;
    const n = (b.getAttribute('aria-label') || b.textContent || '').trim();
    (names[n] = names[n] || []).push(b);
  }
  for (const [n, els] of Object.entries(names)) if (els.length > 1 && !els.every(e => e.getAttribute('aria-label'))) out.push(els.length + ' controls are all called "' + n + '" (a screen reader list cannot tell them apart)');
  for (const b of document.querySelectorAll('main button:disabled')) {
    if (!vis(b)) continue;
    const d = b.getAttribute('aria-describedby');
    if (!d || !document.getElementById(d) || !document.getElementById(d).textContent.trim()) out.push('the disabled "' + b.textContent.trim() + '" button does not say why it is off');
  }
  for (const el of document.querySelectorAll('[aria-live]')) {
    if (el.id === 'job-out' || el.id === 'plan-out') out.push('#' + el.id + ' is a live region whose whole content is rewritten on every poll, so a screen reader would read it again each second');
  }
  if (!document.querySelector('[role=status]#job-status, #job-status[aria-live]')) out.push('there is no quiet status line that announces a job starting, finishing or failing once');
  return out;
}"""


def main():
    engine = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/engine-lr')
    tmp = Path(tempfile.mkdtemp(prefix='maker-a11y-'))
    findings = []
    try:
        eng = tmp / 'engine'
        shutil.copytree(engine / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__', 'globe3d', 'maprace', 'trends'))
        (eng / 'ryagram' / 'local' / '__main__.py').write_text(cm.STUB_MAIN, encoding='utf8')
        recipes = tmp / 'recipes'
        recipes.mkdir()
        (recipes / 'great-news.json').write_text(json.dumps(cm.RECIPE), encoding='utf8')
        clips = tmp / 'clips'
        clips.mkdir()
        for n in ('a.mp4', 'b.mkv', 'slow.mp4', 'gap.mp4'):
            (clips / n).write_bytes(b'x')
        srv = dm.make_server(eng, recipes, tmp / 'work', tmp / 'films', port=0, token='t')
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{dm.STATE['port']}"
        pick = {'f': lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]}
        dm.pick_files = lambda multiple: pick['f'](multiple)

        def scan(page, where):
            page.wait_for_timeout(200)
            r = page.evaluate(aa.SCAN)
            for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
                for v in r[k]:
                    findings.append(f'{where}: {label}: {v}')
            if r['overflow']:
                findings.append(f'{where}: sideways scroll')
            n, reached, noring, trapped = aa.tab_walk(page)
            if reached < n * 0.8:
                findings.append(f'{where}: keyboard reaches {reached} of about {n} controls (missed: {", ".join(aa.tab_walk.missed[:5])})')
            for d in noring:
                findings.append(f'{where}: no visible focus mark on {d}')
            if trapped:
                findings.append(f'{where}: keyboard focus got stuck')
            for v in page.evaluate(SR):
                findings.append(f'{where}: screen reader: {v}')

        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for size, scheme in (('desktop', 'light'), ('desktop', 'dark'), ('phone', 'light')):
                opts = dict(viewport={'width': 1280, 'height': 900}) if size == 'desktop' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                ctx = b.new_context(color_scheme=scheme, **opts)
                page = ctx.new_page()
                tag = f'{size} {scheme}'
                page.goto(f'{base}/?t=t', wait_until='load')
                page.wait_for_selector('#recipe option', state='attached')
                scan(page, f'{tag} start')
                page.click('#plan')
                page.wait_for_selector('#plan-out .problems')
                scan(page, f'{tag} door check refused')
                pick['f'] = lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]
                page.get_by_role('button', name='Choose a file for First footage').click()
                page.wait_for_selector('.slot li')
                page.locator('summary:has-text("Paste bind lines")').click()
                page.fill('#paste', f'--bind source-2={clips / "b.mkv"}')
                page.click('#use-paste')
                page.locator('#paste-note:not(:empty)').wait_for()
                scan(page, f'{tag} files chosen')
                page.click('#plan')
                page.wait_for_selector('#job-out .ok', timeout=30000)
                scan(page, f'{tag} plan ready')
                page.click('#build')
                page.wait_for_selector('#job-out:has-text("Your film:")', timeout=30000)
                scan(page, f'{tag} built')
                pick['f'] = lambda multiple: [str(clips / 'gap.mp4')]
                page.get_by_role('button', name='Choose a file for Second footage').click()
                page.locator('.slot').nth(1).get_by_text('gap.mp4').wait_for()
                page.click('#plan')
                page.wait_for_selector('#job-out:has-text("Not said anywhere")', timeout=30000)
                scan(page, f'{tag} a word is missing')
                pick['f'] = lambda multiple: [str(clips / 'slow.mp4')]
                page.get_by_role('button', name='Choose a file for Second footage').click()
                page.locator('.slot').nth(1).get_by_text('slow.mp4').wait_for()
                page.click('#plan')
                page.wait_for_selector('#cancel:not([hidden])', timeout=15000)
                scan(page, f'{tag} a plan is running')
                page.click('#cancel')
                page.get_by_text('Cancelled.', exact=False).first.wait_for(timeout=15000)
                scan(page, f'{tag} cancelled')
                ctx.close()
            b.close()
        srv.shutdown()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    seen = {}
    for f in findings:
        where, rest = f.split(': ', 1)
        seen.setdefault(rest, []).append(where)
    for rest, wheres in seen.items():
        print(f'{len(wheres)}x {rest}   [first: {wheres[0]}]')
    print(f'FINDINGS: {len(findings)} ({len(seen)} distinct)')
    print('RESULT:', 'PASS' if not findings else 'FAIL')
    return 0 if not findings else 1


if __name__ == '__main__':
    sys.exit(main())
