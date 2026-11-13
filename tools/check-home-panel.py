"""Real-Chrome check of the Ryagram home panel page (CONNECT, 2026-11-13): the page the chat shows for open_ryagram_home, run inside a sandboxed iframe with a stand-in host that answers like an MCP Apps host.
Needs Chrome and playwright, TEMP on D:. Offline: the stand-in host is in this file; nothing is fetched.   python tools/check-home-panel.py
What it proves: the departments are drawn from the tool's result as text (a hostile label stays text, a hostile page address gets no button), what works has its buttons and what is coming soon has none, a starting line goes
to the host as a user message and a host that refuses it gets the line to say, the site page is opened only as the app address plus a plain fragment, nothing leaves the page, and a phone width does not scroll sideways.
"""
import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
APP = 'https://uselai.com/app/'
JS = """
import { homeHtml, homeView } from %s;
const rows = [{id:'data_films',label:'Data films',status:'working'},{id:'compilations',label:'Compilations',status:'soon'},{id:'geo_intelligence',label:'Geographic Intelligence',status:'soon'},{id:'games',label:'Games',status:'soon'},{id:'animation_studio',label:'Animation Studio',status:'soon'}];
process.stdout.write(JSON.stringify({ html: homeHtml(%s), view: homeView(rows).data }));
""" % (json.dumps((ROOT / 'supabase/functions/connect-core/home_panel.ts').as_uri()), json.dumps(APP))
out = subprocess.run(['node', '--input-type=module', '-e', JS], capture_output=True, text=True, cwd=str(ROOT))
if out.returncode != 0:
    print(out.stderr)
    sys.exit(2)
built = json.loads(out.stdout)
HTML, VIEW = built['html'], built['view']

HOST = """<!doctype html><meta charset=utf-8><body><iframe id=f sandbox="allow-scripts" style="width:%dpx;height:900px;border:0"></iframe><script>
window.__in = []; window.__reply = 'ok';
const f = document.getElementById('f');
window.addEventListener('message', ev => {
  if (ev.source !== f.contentWindow) return;
  const m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
  window.__in.push(m);
  if (m.method === 'ui/initialize' && m.id !== undefined) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'stand-in', version: '1' }, hostCapabilities: {} } }, '*');
  else if ((m.method === 'ui/message' || m.method === 'ui/open-link') && m.id !== undefined) {
    if (m.method === 'ui/message' && window.__reply === 'refuse') f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'no' } }, '*');
    else f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
  }
});
window.__send = (structured) => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: structured, content: [] } }, '*');
</script>"""

fails = []
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)

def open_page(b, width, structured):
    cc = b.new_context(viewport={'width': width, 'height': 900})
    pg = cc.new_page()
    reqs, errs = [], []
    pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith(('data:', 'about:', 'blob:')) else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.set_content(HOST % (width - 10))
    pg.evaluate("(h) => { document.getElementById('f').srcdoc = h; }", HTML)
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/initialize')", timeout=8000)
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
    if structured is not None:
        pg.evaluate("(s) => window.__send(s)", structured)
        pg.wait_for_timeout(300)
    return cc, pg, pg.frames[1], reqs, errs

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    print('the Ryagram home panel: departments drawn from the tool result, buttons for what works, nothing to press for what is coming soon')
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW)
    heads = fr.eval_on_selector_all('h2', 'els => els.map(e => e.textContent)')
    check(heads == ['Works today', 'Coming soon'], 'two groups: Works today and Coming soon (%s)' % heads)
    works = fr.eval_on_selector_all('.dept', 'els => els.map(e => ({ h: e.querySelector("h3").childNodes[0].textContent, tag: !!e.querySelector(".tag"), buttons: Array.from(e.querySelectorAll("button")).map(x => x.textContent) }))')
    names = [w['h'] for w in works]
    check(names == ['Data films', 'My films', 'Compilations', 'Geographic Intelligence', 'Games', 'Animation Studio'], 'six entries in order (%s)' % names)
    check(works[0]['buttons'] == ['Start this in the chat', 'Open on the site'] and works[1]['buttons'] == ['Start this in the chat', 'Open on the site'], 'Data films and My films each have a start button and an open button')
    check(all(w['tag'] and not w['buttons'] for w in works[2:]), 'every coming-soon entry carries the tag and has NOTHING to press')
    geo = fr.locator('.dept').nth(3).inner_text()
    check('no sales data' in geo and 'No price and no date' in geo and 'Every number is labelled' in geo, 'the geographic entry shows its three rules and its not-yet line')
    check(any(m.get('method') == 'ui/notifications/size-changed' and m['params']['height'] > 100 for m in pg.evaluate('window.__in')), 'the page reports its height to the host')
    # start a film: the line goes to the host as a user message
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/message')", timeout=4000)
    msg = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message'][0]
    check(msg['params']['role'] == 'user' and msg['params']['content'] == {'type': 'text', 'text': VIEW['departments'][0]['starts'][0]}, 'a start button sends the starting line as a user message (%s)' % msg['params'])
    check(fr.locator('.copy').count() == 0, 'and when the host accepts it nothing else is shown')
    # a host that refuses the message: the line is shown to say
    pg.evaluate("window.__reply = 'refuse'")
    fr.get_by_role('button', name='Start this in the chat').nth(1).click()
    fr.locator('.copy').wait_for(timeout=4000)
    check(fr.locator('.copy').inner_text().startswith('Say this to your AI: Show me my films.'), 'a host that refuses it gets the line to say: %r' % fr.locator('.copy').inner_text())
    # open the site page
    fr.get_by_role('button', name='Open on the site').first.click()
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/open-link')", timeout=4000)
    link = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/open-link'][0]
    check(link['params'] == {'url': APP + '#/d/data_films'}, 'an open button asks the host to open exactly the app address plus the fixed fragment (%s)' % link['params'])
    check(not reqs and not errs, 'no request left the page and nothing threw (%s %s)' % (reqs[:2], errs[:2]))
    cc.close()

    print('hostile content stays text, and a hostile page address gets no button')
    EVIL = {'departments': [
        {'id': 'data_films', 'label': '<img src=x onerror="window.top.__pwned=1">Data', 'status': 'working', 'line': '<script>window.top.__pwned=2</script>Questions' + ' x' * 300, 'rules': [], 'not_yet': [],
         'starts': ['Say <b>this</b> ' + 'y' * 400], 'page': 'javascript:alert(1)'},
        {'id': 'my_films', 'label': 'My films', 'status': 'working', 'line': 'ok', 'rules': [], 'not_yet': [], 'starts': [], 'page': '#/../x'},
        {'id': 'games', 'label': 'Games', 'status': 'working', 'line': 'ok', 'rules': [], 'not_yet': [], 'starts': [], 'page': '#/d/games'},
        {'id': 'x', 'label': 'Odd status', 'status': 'weird', 'line': 'no'}, 7, None]}
    cc, pg, fr, reqs, errs = open_page(b, 640, EVIL)
    check(fr.locator('#home img, #home script, #home b').count() == 0, 'no markup from the content became an element')
    check('<img' in fr.locator('.dept').first.inner_text() and pg.evaluate('window.__pwned') is None, 'the hostile label is shown as plain text and nothing ran')
    btns = fr.eval_on_selector_all('.dept', 'els => els.map(e => Array.from(e.querySelectorAll("button")).map(x => x.textContent))')
    check(btns[0] == ['Start this in the chat'] and btns[1] == [] and btns[2] == ['Open on the site'], 'javascript: and a fragment with dots get no open button; a plain fragment does (%s)' % btns)
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/message')", timeout=4000)
    sent = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message'][0]['params']['content']['text']
    check(len(sent) <= 200, 'a starting line is cut to 200 characters (%d)' % len(sent))
    check(fr.locator('.dept').count() == 3 and 'Odd status' not in fr.locator('#home').inner_text(), 'an entry with a status that is neither working nor soon, and what is not an object, are left out')
    check(not reqs and not errs, 'no request and no error with hostile content')
    cc.close()

    print('before the result arrives, and on a phone')
    cc, pg, fr, reqs, errs = open_page(b, 360, None)
    check('listed in the conversation above' in fr.locator('#home').inner_text(), 'before any result the panel says the list is in the conversation')
    pg.evaluate("(s) => window.__send(s)", VIEW)
    pg.wait_for_timeout(300)
    over = fr.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check(over <= 0 and fr.locator('.dept').count() == 6, 'at 360 px wide nothing scrolls sideways (overflow %s)' % over)
    check(min(fr.eval_on_selector_all('button', 'els => els.map(e => e.getBoundingClientRect().height)')) >= 44, 'every button is at least 44 px high')
    cc.close()
    b.close()

if fails:
    print('FAILED:', len(fails))
    sys.exit(1)
print('ALL OK')
