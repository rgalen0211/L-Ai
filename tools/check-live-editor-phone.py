"""Phone-width check of the live editor page (Claude's night note 11-06, item 1: what the sweep left open: a very long title). Mock mode, `liveEditor` ON in a local copy of the config, the data
mode and the compilation mode at 320, 360, 375 and 390 px: once as it is, and once with the page heading and the first words of the page stretched to 80 unbroken capital letters (the longest
heading the page allows) so a long title cannot push the page sideways. Each: no sideways scroll, nothing wider than the screen, no text cut off in its own box, controls at least 44 px, the accessibility
scan. Exit 1 on any finding. Needs Chrome; not part of the node suite. Reuses the probe of tools/check-signin-phone.py. Not covered, and said so: a SLOW network answer (the mock has no network to slow).

It measures a page only when it has settled (see SETTLE: editor mounted, fonts ready, no animation running, geometry equal across two reads) and serves on its OWN port (the shared 8185 can be bound twice at once on
Windows, which gave this check 0 to 335 findings on a busy PC, CC1 11-06 12:02). Every finding prints the page width, the scroll width and the heading box it was measured with.

    python tools/check-live-editor-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/live-editor-phone-shots)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/live-editor-phone-shots')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


# "Settled" is a real condition, not a sleep (CC1 11-06 12:02: fixed waits gave 0 to 129 findings on a busy PC, because the page was measured mid-transition: an opacity fade made 'Undo' read 1.99:1, buttons
# read 158x19 before their style landed). The editor is mounted (its own .le root with the heading), nothing in it is still loading, fonts are ready, no finite animation or CSS transition is running, two
# animation frames have passed, and the geometry of every element is the same across two reads 120 ms apart (up to 15 s, then the state is reported as NOT SETTLED, never measured).
SETTLE = """async () => {
  const sig = () => { let s = document.documentElement.scrollWidth + '|'; for (const e of document.querySelectorAll('#library *')) { const r = e.getBoundingClientRect(); s += Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height) + ';'; } return s; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t0 = performance.now(); let tries = 0;
  while (performance.now() - t0 < 15000) {
    tries++;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const running = document.getAnimations().filter(a => { try { return isFinite(a.effect.getComputedTiming().endTime) && a.playState === 'running'; } catch { return false; } });
    await Promise.all(running.map(a => a.finished.catch(() => {})));
    await frame();
    const loading = document.querySelector('#library .le-loading, #library .le-streaming');
    const a = sig(); await new Promise(r => setTimeout(r, 120)); await frame(); const b = sig();
    if (a === b && !loading && document.getAnimations().every(x => { try { return !isFinite(x.effect.getComputedTiming().endTime) || x.playState !== 'running'; } catch { return true; } })) return { ok: true, tries, ms: Math.round(performance.now() - t0) };
  }
  return { ok: false, tries, ms: Math.round(performance.now() - t0) };
}"""
# what was measured, printed with every finding
DIMS = """() => { const h = document.querySelector('#library .le h1'), r = h && h.getBoundingClientRect(); return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, h1: r ? Math.round(r.left) + '..' + Math.round(r.right) : 'none' }; }"""


aa = load('aa', 'audit-a11y.py')
sp = load('sp', 'check-signin-phone.py')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r"liveEditor:\s*(?:false|'account')", 'liveEditor: true', cfg)
    assert 'liveEditor: true' in flipped
    srv = aa.serve(); port = srv.server_address[1]          # its OWN port: the shared 8185 can be bound by a second run at once on Windows, which served this page its files from the wrong server
    found, states = [], 0
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for width in (320, 360, 375, 390):
            ctx = b.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            for mode, url in (('data', '/app/?mock&standin#/editor/data'), ('compilation', '/app/?mock#/editor/compilation')):
                for stretch in (False, True):
                    p.goto(f'http://127.0.0.1:{port}{url}', wait_until='load')
                    p.wait_for_selector('#library .le h1:not([hidden])', timeout=20000)         # the editor's own heading, not whatever page heading came first
                    st = p.evaluate(SETTLE)
                    if stretch:
                        p.evaluate("(() => { const long = 'W'.repeat(80); const h = document.querySelector('#library .le h1'); if (h) h.textContent = long; })()")
                        st = p.evaluate(SETTLE)
                    r = p.evaluate(sp.PROBE); states += 1
                    d = p.evaluate(DIMS)
                    tag = (width, mode, 'long heading' if stretch else 'as is', f"[page {d['client']} wide, scrolls {d['scroll']}, heading {d['h1']}, settled in {st['ms']} ms]")
                    if not st['ok']: found.append(tag + ('NOT SETTLED after 15 s',))
                    if r['sideways']: found.append(tag + ('sideways scroll',))
                    for k in ('wide', 'cut', 'small', 'wrapped'):
                        for v in r[k]: found.append(tag + (k, v))
                    s = p.evaluate(aa.SCAN)
                    for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                        for v in s[k]: found.append(tag + ('a11y-' + k, v))
                    p.screenshot(path=str(OUT / f'{mode}-{"long" if stretch else "asis"}-{width}.png'), full_page=True)
            if errors: found.append((width, 'all', 'page errors', errors[:2]))
            ctx.close()
        b.close()
    srv.shutdown(); srv.server_close()
    for f in found: print('FINDING', f)
    print(f'states checked: {states} (of 16); FINDINGS: {len(found)}')
    sys.exit(1 if found or states != 16 else 0)


if __name__ == '__main__':
    main()
