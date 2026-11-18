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
const rows = [{id:'data_films',label:'Data films',status:'working'},{id:'compilations',label:'Compilations',status:'soon'},{id:'geo_intelligence',label:'Geographic Intelligence',status:'soon'},{id:'games',label:'Games',status:'soon'},{id:'animation_studio',label:'Animation Studio',status:'soon'},{id:'studio',label:'Studio',status:'soon'}];
process.stdout.write(JSON.stringify({ html: homeHtml(%s), view: homeView(rows).data }));
""" % (json.dumps((ROOT / 'supabase/functions/connect-core/home_panel.ts').as_uri()), json.dumps(APP))
out = subprocess.run(['node', '--input-type=module', '-e', JS], capture_output=True, text=True, cwd=str(ROOT))
if out.returncode != 0:
    print(out.stderr)
    sys.exit(2)
built = json.loads(out.stdout)
HTML, VIEW = built['html'], built['view']

HOST = """<!doctype html><meta charset=utf-8><body><iframe id=f sandbox="allow-scripts" style="width:%dpx;height:900px;border:0"></iframe><script>
window.__in = []; window.__reply = 'ok'; window.__caps = { message: { text: {} }, openLinks: {} };
const f = document.getElementById('f');
window.addEventListener('message', ev => {
  if (ev.source !== f.contentWindow) return;
  const m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
  window.__in.push(m);
  if (m.method === 'ui/initialize' && m.id !== undefined) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'stand-in', version: '1' }, hostCapabilities: window.__caps } }, '*');
  else if ((m.method === 'ui/message' || m.method === 'ui/open-link') && m.id !== undefined) {
    const r = window.__reply, arr = m.params && Array.isArray(m.params.content);
    if (m.method === 'ui/message' && r === 'refuse') f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Message sending denied' } }, '*');
    else if (m.method === 'ui/message' && ((r === 'array-bad' && arr) || (r === 'object-bad' && !arr))) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Invalid message format' } }, '*');
    else if (m.method === 'ui/message' && r === 'iserror') f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { isError: true } }, '*');
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

def tx(fr, sel):
    """The text of the first element that matches, or '(missing)': a missing element is a FAILED check with its name, never a crash."""
    loc = fr.locator(sel)
    return loc.first.inner_text() if loc.count() else '(missing %s)' % sel


def open_page(b, width, structured, caps=None, reply=None):
    cc = b.new_context(viewport={'width': width, 'height': 900})
    pg = cc.new_page()
    reqs, errs = [], []
    pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith(('data:', 'about:', 'blob:')) else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.set_content(HOST % (width - 10))
    pg.console_lines = []
    pg.on('console', lambda c: pg.console_lines.append(c.text))
    if caps is not None:
        pg.evaluate("(c) => { window.__caps = c; }", caps)
    if reply is not None:
        pg.evaluate("(r) => { window.__reply = r; }", reply)
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
    check(names == ['Data films', 'My films', 'Compilations', 'Opportunity Map', 'Games', 'Animation Studio', 'Studio'], 'seven entries in order, Studio last (%s)' % names)
    check(works[0]['buttons'] == ['Start this in the chat', 'Open on the site'] and works[1]['buttons'] == ['Start this in the chat', 'Open on the site'], 'Data films and My films each have a start button and an open button')
    check(all(w['tag'] and not w['buttons'] for w in works[2:]), 'every coming-soon entry carries the tag and has NOTHING to press')
    studio = fr.locator('.dept').nth(6).inner_text()
    check("Your podcast's camera crew and editor in one" in studio and 'no price and no date' in studio, 'the Studio entry says the approved line and that there is no price and no date (%s)' % studio[:80])
    geo = fr.locator('.dept').nth(3).inner_text()
    check('no sales data' in geo and 'No price and no date' in geo and geo.lower().count('every number') == 1, 'the geographic entry shows its two rules, its not-yet line, and says every number once')
    check(any(m.get('method') == 'ui/notifications/size-changed' and m['params']['height'] > 100 for m in pg.evaluate('window.__in')), 'the page reports its height to the host')
    # start a film: the line goes to the host as a user message
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/message')", timeout=4000)
    msg = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message'][0]
    check(msg['params']['role'] == 'user' and msg['params']['content'] == [{'type': 'text', 'text': VIEW['departments'][0]['starts'][0]}], 'a start button sends the starting line as a user message, content as a list of blocks (%s)' % msg['params'])
    check(fr.locator('.example').count() == 0, 'and when the host accepts it nothing else is shown')
    # open the site page
    fr.get_by_role('button', name='Open on the site').first.click()
    pg.wait_for_function("window.__in.some(m => m.method === 'ui/open-link')", timeout=4000)
    link = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/open-link'][0]
    check(link['params'] == {'url': APP + '#/d/data_films'}, 'an open button asks the host to open exactly the app address plus the fixed fragment (%s)' % link['params'])
    check(not reqs and not errs, 'no request left the page and nothing threw (%s %s)' % (reqs[:2], errs[:2]))
    cc.close()

    print('a host that refuses the message: the line is shown as an EXAMPLE (quote style, label, Copy button), never as a field')
    Q1, Q2 = chr(0x201c), chr(0x201d)
    LINE = 'Show me my films.'
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, reply='refuse')
    fr.get_by_role('button', name='Start this in the chat').nth(1).click()
    fr.locator('.example').wait_for(timeout=4000)
    check(tx(fr, '.example .label') == 'Example:', 'the box carries the label Example: (%r)' % tx(fr, '.example .label'))
    check(tx(fr, '.example .quote') == Q1 + LINE + Q2, 'the sentence is in quotes: %r' % tx(fr, '.example .quote'))
    check('did not let this panel type for you' in tx(fr, '.example .why'), 'it says plainly that the chat app did not let the panel type: %r' % tx(fr, '.example .why'))
    look = fr.evaluate("""() => { const ex = document.querySelector('.example'), cs = getComputedStyle(ex); const dashed = Array.from(document.querySelectorAll('.example, .example *')).filter(e => /dashed|dotted/.test(getComputedStyle(e).borderStyle)).length;
      return { left: cs.borderLeftStyle, leftW: parseFloat(cs.borderLeftWidth), top: cs.borderTopStyle, dashed, editable: document.querySelectorAll('.example input, .example textarea, .example [contenteditable]').length }; }""")
    check(look['dashed'] == 0, 'no dashed or dotted border anywhere in the box (the field look is gone)')
    check(look['left'] == 'solid' and look['leftW'] >= 2 and look['top'] == 'none', 'quote style: a solid left bar of %spx and no box around it (%s)' % (look['leftW'], look))
    check(look['editable'] == 0, 'nothing in it is a field')
    check(fr.locator('.example').get_by_role('button', name='Copy').count() == 1, 'one Copy button, inside the box')
    check(fr.locator('.example').get_by_role('button', name='Copy').evaluate('e => e.getBoundingClientRect().height') >= 44, 'the Copy button is at least 44 px high')
    diag = tx(fr, '.example .diag')
    check('Message sending denied' in diag and '-32000' in diag, "the host's own answer is shown small under the example: %r" % diag)
    check(any(c.startswith('ryagram-home: ui/message refused') and '-32000' in c and 'Message sending denied' in c for c in pg.console_lines), "and written to the panel's console line: %s" % [c for c in pg.console_lines if 'ryagram-home' in c][:2])
    check(sum(1 for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message') == 1, 'a plain refusal is asked once, not retried')
    # copy: the clipboard where it is allowed
    fr.evaluate("() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); }")
    fr.locator('.example').get_by_role('button', name='Copy').click()
    fr.locator('.example').get_by_role('button', name='Copied').wait_for(timeout=4000)
    check(fr.evaluate('window.__copied') == [LINE], 'Copy writes exactly the sentence, without the quotes or the label: %s' % fr.evaluate('window.__copied'))
    # copy refused everywhere: the text is selected and the person is told what to press
    fr.evaluate("() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); document.execCommand = () => false; }")
    fr.locator('.example').get_by_role('button', name='Copied').click()
    fr.locator('.example .hold').wait_for(timeout=4000)
    check('Ctrl+C' in tx(fr, '.example .hold'), 'when the clipboard is refused the person is told to press Ctrl+C: %r' % tx(fr, '.example .hold'))
    check(fr.evaluate('window.getSelection().toString()').strip() == LINE, 'and the sentence is selected, ready to copy: %r' % fr.evaluate('window.getSelection().toString()'))
    check(not reqs and not errs, 'no request left the page and nothing threw (%s %s)' % (reqs[:2], errs[:2]))
    cc.close()
    # the real clipboard path of this Chrome: either it copies or it tells the person what to press, and nothing throws
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, reply='refuse')
    fr.get_by_role('button', name='Start this in the chat').nth(1).click()
    fr.locator('.example').wait_for(timeout=4000)
    fr.locator('.example').get_by_role('button', name='Copy').click()
    pg.wait_for_timeout(600)
    said = fr.locator('.example').inner_text()
    check(('Copied' in said or 'Ctrl+C' in said) and not errs, 'the unstubbed Copy button ends in Copied or in the Ctrl+C words and throws nothing (%s)' % errs[:2])
    cc.close()

    print('a host that answers the message with isError, and a host that wants the older single-block shape')
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, reply='iserror')
    fr.get_by_role('button', name='Start this in the chat').first.click()
    fr.locator('.example').wait_for(timeout=4000)
    check(tx(fr, '.example .quote') == Q1 + VIEW['departments'][0]['starts'][0] + Q2, 'a result that says isError gets the example too')
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_function("window.__in.filter(m => m.method === 'ui/message').length >= 2", timeout=4000)
    pg.wait_for_timeout(300)
    check(fr.locator('.example').count() == 1, 'asking again replaces the example, it does not pile up (%d)' % fr.locator('.example').count())
    cc.close()
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, reply='array-bad')
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_function("window.__in.filter(m => m.method === 'ui/message').length >= 2", timeout=4000)
    pg.wait_for_timeout(300)
    msgs = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message']
    check(len(msgs) == 2 and isinstance(msgs[0]['params']['content'], list) and msgs[1]['params']['content'] == {'type': 'text', 'text': VIEW['departments'][0]['starts'][0]}, 'a host that calls the list shape invalid is asked once more with the single block (%s)' % [type(m['params']['content']).__name__ for m in msgs])
    check(fr.locator('.example').count() == 0, 'and when that works nothing else is shown')
    cc.close()
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, reply='object-bad')
    fr.get_by_role('button', name='Start this in the chat').first.click()
    pg.wait_for_timeout(500)
    check(sum(1 for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message') == 1 and fr.locator('.example').count() == 0, 'a host that takes the list shape is asked once')
    cc.close()

    print('a host that does not offer messages at all: no button that pretends to send')
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, caps={'openLinks': {}})
    check(fr.get_by_role('button', name='Start this in the chat').count() == 0 and fr.get_by_role('button', name='Show what to say').count() == 2, 'the two start buttons say Show what to say, none says it will start the chat')
    fr.get_by_role('button', name='Show what to say').nth(1).click()
    fr.locator('.example').wait_for(timeout=4000)
    check('does not let this panel type for you' in tx(fr, '.example .why') and tx(fr, '.example .quote') == Q1 + LINE + Q2, 'it shows the example with the plain sentence: %r' % fr.locator('.example').inner_text())
    check(not any(m.get('method') == 'ui/message' for m in pg.evaluate('window.__in')), 'and sent nothing to the host')
    check(fr.locator('.example .diag').count() == 0, 'there is no host answer to show')
    cc.close()
    cc, pg, fr, reqs, errs = open_page(b, 640, VIEW, caps={'message': {'text': {}}})
    check(fr.get_by_role('button', name='Start this in the chat').count() == 2, 'a host that offers messages gets the Start this in the chat buttons')
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
    sent = [m for m in pg.evaluate('window.__in') if m.get('method') == 'ui/message'][0]['params']['content'][0]['text']
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
    check(over <= 0 and fr.locator('.dept').count() == 7, 'at 360 px wide nothing scrolls sideways (overflow %s)' % over)
    check(min(fr.eval_on_selector_all('button', 'els => els.map(e => e.getBoundingClientRect().height)')) >= 44, 'every button is at least 44 px high')
    cc.close()
    b.close()

if fails:
    print('FAILED:', len(fails))
    sys.exit(1)
print('ALL OK')
