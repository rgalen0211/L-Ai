"""The live editor INSIDE THE AI CHAT (supabase/functions/connect-core/editor_page.ts, built by tools/build-chat-editor.mjs) in real Chrome, desktop and phone, inside a stand-in for an MCP App host.

    py -I tools/check-chat-editor.py [outdir]     (needs node and Chrome; run with TEMP/TMP on D:; nothing here talks to a live host or server)

The stand-in host is the view-facing half of the MCP Apps bridge, written for this check: a sandboxed iframe, ui/initialize answered, the opening tool result handed over, tools/call forwarded to CONNECT's
stand-in for the editor functions (tests/fake-editor-rpcs.js) and refused for any tool that is not one of the five app-only names, ui/update-model-context and ui/request-display-mode recorded.
Checks: nothing is drawn before the opening result; the editor opens on the film it names; every call is one of the five names for that film only; a change goes to the draft first and the screen follows its
answer; the AI's change shows with the banner; a stale change is reported in words; the AI is told in ONE short line that carries no clip text; the final-build button cannot start anything; full screen only
where the host offers it; no sideways scroll; no request leaves the page; no policy violation; no console error. Exit 1 on any failure."""
import json
import re
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/CONNECT/chat-editor-shots')
PROJECT = '00000000-0000-4000-8000-0000000000a1'
NAMES = ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat']
SUMMARY = {'duration': 12, 'limits': {'text_chars': 20}, 'lanes': ['video', 'text'], 'rules': [], 'pictures': [], 'clips': [
    {'id': 'v1', 'track': 'video', 'start': 0, 'len': 2, 'label': 'great news everyone', 'source': 'a.mp4', 'source_start': 4, 'min_len': 0.3, 'max_len': 6},
    {'id': 'v2', 'track': 'video', 'start': 2, 'len': 2, 'label': 'we built a thing', 'source': 'a.mp4', 'source_start': 20, 'min_len': 0.3, 'max_len': 5},
    {'id': 'v3', 'track': 'video', 'start': 4, 'len': 3, 'label': 'for the weekend', 'source': 'b.mp4', 'source_start': 0, 'min_len': 0.3, 'max_len': 9},
    {'id': 't1', 'track': 'text', 'start': 0.2, 'len': 3.5, 'label': 'Title', 'text': 'Housing', 'style': 'caption', 'min_len': 0.5, 'max_len': 30}]}


def page_html(app_url=None):
    # the page as a host READS it: with the site's address on its root when the connector is configured with one (editorHtml); without, exactly the built page
    js = "import('./supabase/functions/connect-core/mcp_app.ts').then(m=>process.stdout.write(m.editorHtml(%s)))" % (json.dumps(app_url) if app_url else 'undefined')
    r = subprocess.run(['node', '--no-warnings', '-e', js], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
    if r.returncode:
        print(r.stderr)
        sys.exit(2)
    return r.stdout


INIT = """([p, s]) => { const OK = ['move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'add_clip', 'set_clip_style', 'set_music', 'set_rule', 'delete_rule', 'set_film_look'];
  window.pc = window.createEditorRpcs({ check: (mode, op) => (op && OK.includes(op.op) ? null : 'not a change this editor knows') }); window.pc.app.post(p, { mirror: true, aiVisible: true, summary: s });
  window.__calls = [];
  window.hostCall = async (n, a) => { window.__calls.push([n, a]); const res = window.pc.rpcs[n](a);
    return res.error ? { isError: true, content: [{ type: 'text', text: res.error.message }], structuredContent: { error: res.error } } : { content: [{ type: 'text', text: 'ok' }], structuredContent: { data: res.data } }; }; }"""


HOST = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#262624">
<iframe id="v" sandbox="allow-scripts" style="border:0;width:100%;height:80px;display:block"></iframe>
<script>
window.__log = []; window.__refused = []; window.__ctx = __CTX__;
const NAMES = __NAMES__, f = document.getElementById('v');
f.srcdoc = __DOC__;
addEventListener('message', async e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; window.__log.push(m);
  const reply = r => f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, ...r }, '*');
  if (m.method === 'ui/initialize') reply({ result: { protocolVersion: '2026-01-26', hostInfo: { name: 'stand-in', version: '0' }, hostCapabilities: {}, hostContext: window.__ctx } });
  else if (m.method === 'tools/call') {
    if (!NAMES.includes(m.params.name)) { window.__refused.push(m.params.name); reply({ error: { code: -32601, message: 'Tool is not visible to the app' } }); return; }
    let res = await window.hostCall(m.params.name, m.params.arguments);
    if (window.__textOnly) res = { content: [{ type: 'text', text: JSON.stringify(res.structuredContent) }], isError: !!res.isError };
    reply({ result: res });
  }
  else if (m.method === 'ui/request-display-mode') { window.__ctx = { ...window.__ctx, displayMode: m.params.mode }; reply({ result: { mode: m.params.mode } }); }
  else if (m.method === 'ui/update-model-context') reply({ result: {} });
  else if (m.method === 'ui/open-link') { const mode = window.__openLink || 'ok'; reply(mode === 'ok' ? { result: {} } : mode === 'refuse' ? { error: { code: -32000, message: 'Open link denied' } } : { result: { isError: true } }); }
  else if (m.method === 'ui/notifications/size-changed') f.style.height = m.params.height + 'px';
});
window.openInput = args => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: args } }, '*');
window.openText = (text, extra) => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text }], ...(extra || {}) } }, '*');
window.openWith = sc => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'opened' }], structuredContent: sc } }, '*');
</script>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    doc = page_html()
    fake_js = (ROOT / 'tests/fake-editor-rpcs.js').read_text(encoding='utf-8')
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    check(len(doc.encode()) <= 300 * 1024, 'the page is within its 300 KB budget (%d bytes)' % len(doc.encode()))
    check('http://' not in doc.replace('http://www.w3.org', '') and 'https://' not in doc, 'the page names no web address (except the SVG namespace)')
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        try:
            for name, opts, fullscreen in (('desktop', dict(viewport={'width': 1280, 'height': 900}), True),
                                           ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True), False)):
                print(name)
                phone = name == 'phone'
                ctx = b.new_context(**opts)
                h = ctx.new_page()
                calls = lambda: h.evaluate('window.__calls')
                errors, outside = [], []
                h.on('pageerror', lambda e: errors.append(str(e)))
                h.on('console', lambda m: errors.append(m.text) if m.type in ('error',) else None)
                h.on('request', lambda r: outside.append(r.url) if not r.url.startswith(('data:', 'about:', 'blob:')) else None)
                hostctx = {'theme': 'dark', 'displayMode': 'inline', 'availableDisplayModes': ['inline', 'fullscreen'] if fullscreen else ['inline'], 'platform': 'mobile' if phone else 'web'}
                h.set_content(HOST.replace('__DOC__', json.dumps(doc).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(NAMES)).replace('__CTX__', json.dumps(hostctx)))
                h.add_script_tag(content=fake_js)
                h.evaluate(INIT, [PROJECT, SUMMARY])
                h.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
                fr = h.frames[1]
                check('Opening your film' in fr.inner_text('body') and fr.locator('.le-panel').count() == 0, 'before the opening result nothing is drawn but "Opening your film"')
                h.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'My <b>film</b>'})
                fr.wait_for_selector('.le-panel', timeout=8000)
                h.wait_for_timeout(700)
                check(fr.inner_text('h1') == 'My <b>film</b>' and fr.locator('h1 b').count() == 0, 'the editor opens on the film the result names, its title shown as text')
                check(calls() and all(t in NAMES for t, _ in calls()), 'the editor called only the five editor names')
                check(all(a.get('p_project') == PROJECT for _, a in calls()), 'and only for that film')
                check(not h.evaluate('window.__refused'), 'the host refused nothing')
                check(fr.locator('canvas.le-canvas').count() == 0, 'no frame feed in the chat (the plain card is drawn): the editor draws its canvas only when the host offers a frame() feed')      # was `... or True`, which could never fail (11-20 audit)
                check(fr.locator('#live-root.le-nosketch').count() == 0 and fr.locator('.le-nopic').count() == 0 and fr.locator('.le-view').first.is_visible(), 'a CLIP film is unchanged by the no-sketch rule: no marker class, no sentence, its title boards stay')
                order = lambda: fr.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)')
                if phone:
                    check(fr.locator('.le-lanes').is_hidden() and fr.locator('.le-list').is_visible(), 'a phone shows the list and no lanes')
                else:
                    check(order() == ['v1', 'v2', 'v3'], 'the clips come from the draft the host forwarded')
                    n0 = len(calls())
                    fr.focus('.le-clip[data-id="v3"]')
                    h.keyboard.press('ArrowLeft')
                    h.wait_for_timeout(500)
                    check(order() == ['v1', 'v3', 'v2'] and any(t == 'editor_apply_ops' for t, _ in calls()[n0:]), 'a reorder goes to the draft first, and the screen follows its answer')
                    check(h.evaluate("window.pc.app.pending('%s').length" % PROJECT) == 1, 'the draft holds it as a waiting change')
                    # the AI is told, once, in one short line without the person's words
                    h.wait_for_timeout(1300)
                    told = h.evaluate("window.__log.filter(m => m.method === 'ui/update-model-context').map(m => m.params.content[0].text)")
                    check(len(told) == 1 and 'editing in the Ryagram panel' in told[0] and 'reorder_clip' in told[0] and 'get_edit_state' in told[0], 'the AI was told in one line that the person is editing here, and where to read the state')
                    check(not any(w in told[0] for w in ('great news', 'weekend', 'Housing', 'a.mp4')), 'and that line carries no clip text, label or file name')
                    # the AI's change, from the draft
                    h.evaluate("([p]) => window.pc.ai.apply(p, 'compilation', window.pc.draft(p, 'compilation').revision, [{ op: 'set_clip_text', id: 't1', text: 'By my AI' }], 'Claude')", [PROJECT])
                    fr.locator('.le-banner').wait_for(state='visible', timeout=7000)
                    check('Your AI changed 1 thing' in fr.inner_text('.le-banner'), 'the AI\u2019s change shows with the banner')
                    fr.click('.le-clip[data-id="t1"]')
                    check(fr.input_value('#le-text') == 'By my AI' and fr.get_attribute('#le-text', 'maxlength') == '20', 'its text is on the clip, and the field keeps the draft\u2019s 20-letter limit')
                    # a stale change: the AI gets in first and the page says so in words
                    h.evaluate("([p]) => window.pc.ai.apply(p, 'compilation', window.pc.draft(p, 'compilation').revision, [{ op: 'set_clip_text', id: 't1', text: 'AI again' }], 'Claude')", [PROJECT])
                    fr.fill('#le-text', 'Mine')
                    fr.dispatch_event('#le-text', 'change')
                    h.wait_for_timeout(700)
                    check(fr.input_value('#le-text') in ('Mine', 'AI again') and ('Your AI changed this just now' in fr.inner_text('.form-note') or fr.input_value('#le-text') == 'Mine'), 'a change that races the AI is reported in words or kept, never lost silently')
                    # the final film cannot be started from here
                    n1 = len(calls())
                    check(not fr.locator('button:has-text("Build final film")').is_visible() and not fr.locator('button:has-text("Render final film")').is_visible(), 'there is no build or render button in the chat panel')
                    check(not fr.locator('.le-pill').is_visible(), 'and no "Kept on this computer" pill (that is the computer page’s wording)')
                    check('Save or build the film in the Ryagram app' in fr.inner_text('.le-chatbar'), 'the panel says in words that saving and building happen in the Ryagram app')
                    foot = fr.inner_text('body')
                    check('final button' not in foot and 'kept on your computer' not in foot, 'and the computer page’s footer sentence (a final button, kept on your computer) is not in the chat panel')
                    said = fr.evaluate("window.ryagramLiveHost.render()")
                    check('built in the Ryagram app' in (said.get('error') or '') and len(said) == 1, 'and the page’s own build call, if anything ever made it, answers with that sentence and starts nothing')
                    check(all(t in NAMES and t not in ('render',) for t, _ in calls()[n1:]), 'and it called nothing that could start a build')
                    check(not any('render' in m.get('method', '') or 'render' in json.dumps(m.get('params', {})).lower() for m in h.evaluate('window.__log') if m.get('method') == 'tools/call'), 'no tool call mentions a render')
                # full screen only where the host offers it
                btn = fr.locator('.le-chatbar button', has_text=re.compile('Full screen|Back to the chat'))
                check(btn.is_visible() == fullscreen, 'the Full screen button shows only where the host offers full screen (%s)' % fullscreen)
                if fullscreen:
                    btn.click()
                    h.wait_for_timeout(300)
                    asked = h.evaluate("window.__log.filter(m => m.method === 'ui/request-display-mode').map(m => m.params.mode)")
                    check(asked == ['fullscreen'], 'it asks the host for full screen, nothing else %s' % asked)
                    h.evaluate("document.getElementById('v').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } }, '*')")
                    h.wait_for_timeout(200)
                    check(btn.inner_text() == 'Back to the chat', 'and the button then offers the way back')
                    pad = fr.evaluate("parseFloat(getComputedStyle(document.body).paddingBottom)")
                    check(pad >= 96, 'full screen leaves 96 px or more at the bottom for the chat reply box (%s px)' % pad)
                    h.evaluate("document.getElementById('v').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen', safeAreaInsets: { top: 0, right: 0, bottom: 20, left: 0 } } }, '*')")
                    h.wait_for_timeout(200)
                    pad2 = fr.evaluate("parseFloat(getComputedStyle(document.body).paddingBottom)")
                    check(pad2 >= 116, 'and a safe area the host reports is added (%s px)' % pad2)
                    h.evaluate("document.getElementById('v').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline' } }, '*')")
                    h.wait_for_timeout(200)
                    pad3 = fr.evaluate("parseFloat(getComputedStyle(document.body).paddingBottom)")
                    check(pad3 < 96, 'back in the chat the room is gone (%s px)' % pad3)
                sizes = h.evaluate("window.__log.filter(m => m.method === 'ui/notifications/size-changed').map(m => m.params.height)")
                check(bool(sizes) and sizes[-1] > 300, 'the panel reports its height to the host (%s)' % sizes[-1:])
                check(fr.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'no sideways scroll')
                check(not outside, 'no request left the page' + (': %s' % outside[:2] if outside else ''))
                check(not [e for e in errors if 'Content Security Policy' in e or 'Refused' in e], 'no policy violation')
                check(not errors, 'no console error' + (': %s' % errors[:2] if errors else ''))
                h.locator('#v').screenshot(path=str(OUT / ('chat-editor-%s.png' % name)))
                ctx.close()
            # a host that never opens a film, and one that refuses to start
            ctx = b.new_context(viewport={'width': 390, 'height': 700})
            h = ctx.new_page()
            h.set_content(HOST.replace('__DOC__', json.dumps(doc).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(NAMES)).replace('__CTX__', '{}'))
            h.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
            h.evaluate("(sc) => openWith(sc)", {'project_id': '../../etc', 'mode': 'compilation'})
            h.wait_for_timeout(300)
            check(h.frames[1].locator('.le-panel').count() == 0, 'a result naming a film in a bad form opens nothing')
            h.evaluate("(sc) => openWith(sc)", {})
            h.wait_for_timeout(200)
            check(h.frames[1].locator('.le-panel').count() == 0, 'a result naming no film opens nothing')
            ctx.close()
            # hosts differ in what they hand a panel: tool-input plus a prose result and text-only answers (no structuredContent), a result whose film is in its JSON text, a host that says nothing, and a page that throws while loading
            def fresh(html=None, textonly=False):
                c = b.new_context(viewport={'width': 1280, 'height': 900})
                p = c.new_page()
                p.on('pageerror', lambda e: None)
                p.set_content(HOST.replace('__DOC__', json.dumps(html or doc).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(NAMES)).replace('__CTX__', json.dumps({'displayMode': 'inline', 'availableDisplayModes': ['inline']})))
                p.add_script_tag(content=fake_js)
                p.evaluate(INIT, [PROJECT, SUMMARY])
                p.evaluate('(t) => { window.__textOnly = t; }', textonly)
                p.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
                return c, p
            print('a host that sends the call\u2019s arguments and a prose result, and keeps only text parts')
            c2, p2 = fresh(textonly=True)
            p2.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p2.evaluate("() => openText('The Ryagram editor is open for My film (a clip film). The person can change it there.')")
            p2.frames[1].wait_for_selector('.le-panel', timeout=8000)
            p2.wait_for_timeout(700)
            check(p2.frames[1].locator('.le-clip').count() >= 3, 'the editor opens from the call\u2019s arguments when the result is prose, and draws the draft that came back as text')
            check(all(t in NAMES for t, _ in p2.evaluate('window.__calls')) and not p2.evaluate('window.__refused'), 'and it called only the five editor names')
            p2.frames[1].focus('.le-clip[data-id="v3"]')
            p2.keyboard.press('ArrowLeft')
            p2.wait_for_timeout(600)
            check(any(t == 'editor_apply_ops' for t, _ in p2.evaluate('window.__calls')) and p2.frames[1].eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)') == ['v1', 'v3', 'v2'], 'a change made there reaches the draft and the screen follows, with text-only answers')
            c2.close()
            print('a host whose result holds the film as JSON text')
            c3, p3 = fresh(textonly=True)
            p3.evaluate("() => openText(JSON.stringify({ project_id: '%s', mode: 'compilation', title: 'Text title' }))" % PROJECT)
            p3.frames[1].wait_for_selector('.le-panel', timeout=8000)
            check(p3.frames[1].inner_text('h1') == 'Text title', 'the film and its title are read from the JSON text part')
            c3.close()
            print('a host that sends only the call\u2019s arguments')
            c4, p4 = fresh()
            p4.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p4.frames[1].wait_for_selector('.le-panel', timeout=15000)
            check(p4.frames[1].locator('.le-panel').count() == 1, 'the editor opens, after a wait for a result that never comes, from the arguments alone')      # was `check(True, ...)`: the wait above raises on a timeout, so this line could only ever pass (11-20 audit)
            c4.close()
            print('a refusal is read as words, never as an editor')
            NS = 'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app, then open the editor again.'
            c7, p7 = fresh(textonly=True)
            p7.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p7.wait_for_timeout(3000)
            p7.evaluate("(t) => openText(t, { isError: true })", NS)
            p7.wait_for_timeout(1500)
            check(p7.frames[1].locator('.le-panel').count() == 0, 'arguments, then a not-shared refusal 3 s later: no editor is drawn')
            check('Let my AI see my track list' in p7.frames[1].inner_text('body'), 'and the person reads the refusal’s own words')
            p7.wait_for_timeout(8000)
            check(p7.frames[1].locator('.le-panel').count() == 0, 'and no editor appears later from the arguments')
            c7.close()
            c8, p8 = fresh(textonly=True)
            p8.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p8.evaluate("() => openText('That film was not found among your projects.', { isError: true })")
            p8.wait_for_timeout(1200)
            check(p8.frames[1].locator('.le-panel').count() == 0 and 'not found among your projects' in p8.frames[1].inner_text('body'), 'arguments, then a not-found refusal with no structured part: the words, no editor')
            c8.close()
            c9, p9 = fresh()
            p9.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p9.wait_for_timeout(3000)
            check(p9.frames[1].locator('.le-panel').count() == 0, 'arguments, then a slow result: nothing is opened from the arguments while the result may still arrive')
            p9.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'Slow title'})
            p9.frames[1].wait_for_selector('.le-panel', timeout=8000)
            check(p9.frames[1].inner_text('h1') == 'Slow title' and p9.frames[1].locator('h1').count() == 1, 'a success 3 s late opens once, with its title')
            c9.close()
            c10, p10 = fresh()
            p10.evaluate("(a) => openInput(a)", {'project_id': PROJECT, 'mode': 'compilation'})
            p10.frames[1].wait_for_selector('.le-panel', timeout=15000)
            p10.evaluate("(t) => openText(t, { isError: true })", NS)
            p10.wait_for_timeout(1200)
            check(p10.frames[1].locator('.le-panel').count() == 0 and 'Let my AI see my track list' in p10.frames[1].inner_text('body'), 'a host that sends no result for 8 s, then a refusal: the editor opened from the arguments is taken down and the words shown')
            c10.close()
            print('a data film that has never had its look changed (or an older one) holds no look keys')
            c11, p11 = fresh()
            errs11 = []
            p11.on('pageerror', lambda e: errs11.append(str(e)))
            p11.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'data', 'title': 'Older state map'})
            for _ in range(40):
                if p11.frames[1].locator('.le-panel').count() or 'could not draw' in p11.frames[1].inner_text('body'):
                    break
                p11.wait_for_timeout(200)
            p11.wait_for_timeout(800)
            t11 = p11.frames[1].inner_text('body')
            check('could not draw' not in t11 and not any('toLowerCase' in e for e in errs11), 'the page draws and throws nothing when the film names no line colour, land colour or page colour')
            check(p11.frames[1].locator('h1').count() == 1 and p11.frames[1].inner_text('h1') == 'Older state map' and not any('colour' in w for w in p11.frames[1].locator('.le-warn').all_inner_texts()), 'it opens on the film, with no colour warning made up from keys that are missing')
            check('undefined' not in t11, 'and no word undefined reaches the person')
            sw = p11.frames[1].evaluate("Array.from(document.querySelectorAll('input[type=color]')).map(i => i.value)")
            check(len(sw) >= 5 and '#000000' not in sw, 'no look swatch is black when the film has set no colour (%s)' % sw)
            check(p11.frames[1].locator('.le-defaults').count() == 1 and 'not shown here yet' in p11.frames[1].locator('.le-defaults').inner_text(), 'and the panel says these are the editor\'s starting colours, not the film\'s own')
            c11.close()
            print('the film look card (Editor Step A): the film\'s real colours and one real still, rebuilt safely')
            CARD_NAMES = NAMES + ['editor_film_card']
            EVIL = ('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" onload="window.top.__pwned=1">'
                    '<defs><linearGradient id="g1"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#ddeeff"/></linearGradient></defs>'
                    '<rect width="960" height="540" fill="url(#g1)" style="fill:red" onclick="window.__pwned=2"/>'
                    '<script>window.__pwned=3</script><image href="https://evil.example/x.png" width="10" height="10"/>'
                    '<foreignObject><div>hi</div></foreignObject><use href="#g1"/><path d="M0 0L9 9" stroke="https://evil.example/s" fill="#ffffff"/>'
                    '<rect id="bs1" width="9" height="9" fill="#ffffff" stroke-dasharray="1' + chr(92) + '2"/>'
                    '<text x="20" y="40" fill="#ffffff" font-size="20">Greene &amp; Montgomery</text>'
                    '<text x="20" y="80" textLength="120.5" lengthAdjust="spacing" xml:space="preserve" fill="#ffffff">Fitted</text>'
                    '<text x="20" y="120" textLength="1e3" lengthAdjust="evil" xml:space="remove" fill="#ffffff">Bad</text></svg>')
            LOOK = {'network.color': '#aa1111', 'network.base_color': '#11aa11', 'network.context_color': '#1111aa', 'state.fill': '#aaaa11', 'page.background': '#11aaaa'}
            CARD = {'schema': 1, 'basis': {'story_sha256': 'a' * 64, 'view': 'network', 'theme': 'dark3'}, 'look': LOOK, 'frame': {'label': '2024', 'width': 960, 'height': 540, 'svg': EVIL}}

            def card_page(answers, capture=False):
                cc = b.new_context(viewport={'width': 1280, 'height': 900})
                if capture:
                    # step B: every timer of exactly 15 s (the quick poll) or 100 s and more (the new quiet and slow reads) is parked (not run) so a check can count them and fire them by hand; the fake ids are large so they never collide with a real timer id
                    cc.add_init_script("(() => { const st = window.setTimeout.bind(window); window.__slow = []; window.setTimeout = (fn, ms, ...a) => { if (typeof ms === 'number' && (ms === 15000 || ms > 20000)) { window.__slow.push({ ms, fn: () => fn(...a) }); return 900000 + window.__slow.length; } return st(fn, ms, ...a); }; })();")
                pp = cc.new_page()
                errs, out = [], []
                pp.on('pageerror', lambda e: errs.append(str(e)))
                pp.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                pp.on('request', lambda r: out.append(r.url) if not r.url.startswith(('data:', 'about:', 'blob:')) else None)
                pp.set_content(HOST.replace('__DOC__', json.dumps(doc).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(CARD_NAMES)).replace('__CTX__', '{}'))
                pp.add_script_tag(content=fake_js)
                pp.evaluate(INIT, [PROJECT, SUMMARY])
                pp.evaluate("""(ans) => { const old = window.hostCall; window.__cardAnswers = ans.slice();
                    window.hostCall = async (n, a) => { if (n !== 'editor_film_card') return old(n, a); window.__calls.push([n, a]);
                      const r = window.__cardAnswers.length > 1 ? window.__cardAnswers.shift() : window.__cardAnswers[0];
                      return r.error ? { isError: true, content: [{ type: 'text', text: 'no' }], structuredContent: r } : { content: [{ type: 'text', text: 'ok' }], structuredContent: { data: r } }; }; }""", answers)
                pp.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
                pp.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'data', 'title': 'Card film'})
                for _ in range(40):
                    if pp.frames[1].locator('.le-panel').count():
                        break
                    pp.wait_for_timeout(200)
                pp.wait_for_timeout(1200)
                return cc, pp, errs, out

            NOSKETCH = lambda fr: fr.locator('#live-root.le-nosketch').count() == 1 and fr.locator('.le-standin > .le-view').count() >= 1 and fr.locator('.le-standin > .le-scrub').count() >= 1 and not any(fr.locator(sel).first.is_visible() for sel in ('.le-standin > .le-view', '.le-standin > .le-scrub', '.le-standin > .le-tl-holder', '.le-standin > .le-ticks', '.le-standin > .le-keys', '.le-row.le-waiting') if fr.locator(sel).count())   # the sketch and slider elements must EXIST (hidden by the rule), so a renamed class cannot make this pass by matching nothing
            swatches = lambda pg: pg.frames[1].evaluate("Array.from(document.querySelectorAll('input[type=color]')).map(i => i.value)")
            c12, p12, e12, o12 = card_page([{'state': 'ready', 'stale': False, 'built_sha256': 'a' * 64, 'card': CARD}])
            fr12 = p12.frames[1]
            cc12 = [(t, a) for t, a in p12.evaluate('window.__calls') if t == 'editor_film_card']
            check(len(cc12) >= 1 and cc12[0][1] == {'p_project': PROJECT, 'p_ask': True}, 'the panel asks for the film\'s card once, for that film, with p_ask (%s)' % cc12[:1])
            check(swatches(p12)[:5] == [LOOK['network.color'], LOOK['network.base_color'], LOOK['network.context_color'], LOOK['state.fill'], LOOK['page.background']], 'the Look swatches show the film\'s real colours (%s)' % swatches(p12))
            check('the film\'s own colours, as saved' in fr12.locator('.le-defaults').inner_text(), 'and the sentence under them says they are the film\'s own')
            check(fr12.locator('.le-cardpic svg').count() == 1 and fr12.locator('.le-cardpic').is_visible(), 'one real still is drawn, and it is the film\'s picture')
            check(NOSKETCH(fr12) and 'stand-in' not in fr12.inner_text('body').lower(), 'NO stand-in sketch: the invented picture, the slider row and the five waiting rows are not on screen and no sentence calls anything a stand-in')
            check(fr12.locator('.le-nopic').is_hidden(), 'and the no-picture sentence is not shown while a real still is')
            tags = fr12.eval_on_selector_all('.le-cardpic svg, .le-cardpic svg *', 'els => els.map(e => e.localName)')
            check(set(tags) <= {'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title'} and 'rect' in tags and 'text' in tags, 'the picture was rebuilt from the allowed elements only (%s)' % tags)
            attrs = fr12.eval_on_selector_all('.le-cardpic svg, .le-cardpic svg *', 'els => els.flatMap(e => Array.from(e.attributes).map(a => a.name + "=" + a.value))')
            check(not any(a.startswith(('on', 'style', 'href', 'xlink')) for a in attrs) and not any('evil.example' in a for a in attrs), 'no event handler, style, href or outside address survived (%d attributes)' % len(attrs))
            check('textLength=120.5' in attrs and 'lengthAdjust=spacing' in attrs and 'xml:space=preserve' in attrs, 'a plain text length, a length adjustment and xml:space survive the rebuild')
            check(not any(a in attrs for a in ('textLength=1e3', 'lengthAdjust=evil', 'xml:space=remove')), 'and the same three with a value that is not allowed are dropped')
            check(fr12.eval_on_selector_all('.le-cardpic svg text', 'els => els.flatMap(e => Array.from(e.attributes).filter(a => a.name === "xml:space").map(a => a.namespaceURI))') == ['http://www.w3.org/XML/1998/namespace'], 'xml:space is written in the xml namespace')
            ids = fr12.eval_on_selector_all('.le-cardpic svg [id]', 'els => els.map(e => e.id)')
            check(ids and all(i.startswith('lecard-') for i in ids) and any('url(#lecard-g1)' in a for a in attrs), 'every id inside the picture is renamed, and a paint reference follows it (%s)' % ids)
            check('Greene & Montgomery' in fr12.locator('.le-cardpic svg text').first.text_content(), 'text in the picture is text')
            check(fr12.locator('.le-cardpic svg rect[id="lecard-bs1"]').count() == 1 and not fr12.evaluate("Array.from(document.querySelectorAll('.le-cardpic svg *')).some(e => Array.from(e.attributes).some(a => a.value.indexOf(String.fromCharCode(92)) >= 0))"), 'an attribute with a backslash is dropped by the panel itself (the shape stays, the attribute does not): the second lock holds on its own')
            check(p12.evaluate('window.__pwned') is None and fr12.evaluate('window.__pwned') is None, 'no script in the picture ran')
            check(not o12 and not e12, 'no request left the page and nothing threw (%s %s)' % (o12[:2], e12[:2]))
            check('This is your film as saved (2024)' in fr12.locator('.le-card').inner_text() and 'does not move' in fr12.locator('.le-card').inner_text(), 'the caption says what the picture is and that it does not move')
            c12.close()
            # the film's HATCH (a pattern of lines used as a fill): kept, with its ids renamed, and only what a pattern may hold; a hostile pattern is rebuilt without the bad parts; the size cap is 300000
            HATCH = ('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs>'
                     '<pattern id="p0" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">'
                     '<line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff" stroke-width="3"/><circle cx="1" cy="1" r="1" fill="#ff0000"/>'
                     '<path d="M0 0" stroke="#00ff00"><rect width="1" height="1"/></path><rect width="3" height="3" fill="url(#g9)"/><pattern id="p9" width="8" height="8"/></pattern>'
                     '<pattern id="p1" width="1" height="8"><line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff"/></pattern></defs>'
                     '<rect width="960" height="540" fill="#101018"/><path d="M100 100L860 100L860 440L100 440Z" fill="url(#p0)"/></svg>')
            HCARD = dict(CARD, frame={'label': '2024', 'width': 960, 'height': 540, 'svg': HATCH})
            c15, p15, e15, o15 = card_page([{'state': 'ready', 'stale': False, 'built_sha256': 'a' * 64, 'card': HCARD}])
            fr15 = p15.frames[1]
            pats = fr15.eval_on_selector_all('.le-cardpic svg pattern', 'els => els.map(e => ({id: e.id, units: e.getAttribute("patternUnits"), tr: e.getAttribute("patternTransform"), kids: Array.from(e.children).map(k => k.localName + ":" + Array.from(k.attributes).map(a => a.name).join(",")), nested: e.querySelectorAll("pattern").length}))')
            check(len(pats) == 1 and pats[0]['id'] == 'lecard-p0' and pats[0]['units'] == 'userSpaceOnUse' and pats[0]['tr'] == 'rotate(45)', 'the hatch pattern is kept, its id renamed and its two pattern attributes kept (%s)' % pats)
            check(len(pats) == 1 and [k.split(':')[0] for k in pats[0]['kids']] == ['line', 'path', 'rect'] and pats[0]['nested'] == 0, 'a pattern keeps its lines, paths and rectangles only: the circle and the pattern inside it are gone (%s)' % (pats[0]['kids'] if pats else None))
            check(len(pats) == 1 and not any('fill' in k.split(':')[1] for k in pats[0]['kids'] if k.startswith('rect')), 'a reference inside a pattern is dropped')
            check(fr15.eval_on_selector_all('.le-cardpic svg pattern path *', 'els => els.length') == 0, 'and what was inside a pattern child is gone')
            check(fr15.eval_on_selector_all('.le-cardpic svg path[fill]', 'els => els.map(e => e.getAttribute("fill"))') == ['url(#lecard-p0)'], 'the shape is filled by the renamed pattern')
            try:
                from PIL import Image
                import io
                png = fr15.locator('.le-cardpic svg').screenshot()
                im = Image.open(io.BytesIO(png)).convert('RGB')
                px = list(im.getdata())
                light = sum(1 for r, g, bl in px if r > 200 and g > 200 and bl > 200)
                check(light > 200, 'and the hatch is really painted: stripes of the tile colour show inside the shape (%d light pixels)' % light)
            except ImportError:
                print('  (no Pillow here: the painted-stripes check was skipped)')
            check(p15.evaluate('window.__pwned') is None and not o15 and not e15, 'no script ran, no request left the page and nothing threw with a hatch')
            c15.close()
            rest = 300000 - len(HATCH)
            fill = ''
            while rest > 0:
                n = min(rest, 40012)
                if rest - n > 0 and rest - n < 14:
                    n -= 14
                fill += '<path d="M' + '0' * (n - 13) + '"/>'
                rest -= n
            BIG = HATCH.replace('</svg>', fill + '</svg>')
            check(len(BIG) == 300000, 'the test picture is exactly 300000 characters (%d)' % len(BIG))
            c16, p16, e16, o16 = card_page([{'state': 'ready', 'stale': False, 'built_sha256': 'a' * 64, 'card': dict(CARD, frame={'label': '2024', 'width': 960, 'height': 540, 'svg': BIG})}])
            check(p16.frames[1].locator('.le-cardpic svg').count() == 1, 'a picture AT the 300000 cap is drawn')
            c16.close()
            c17, p17, e17, o17 = card_page([{'state': 'ready', 'stale': False, 'built_sha256': 'a' * 64, 'card': dict(CARD, frame={'label': '2024', 'width': 960, 'height': 540, 'svg': BIG.replace('</svg>', '0</svg>')})}])
            check(p17.frames[1].locator('.le-cardpic svg').count() == 0 and not e17, 'a picture one character over the cap is no picture, and nothing threw')
            c17.close()
            c13, p13, e13, o13 = card_page([{'state': 'asked', 'waited_seconds': 200}])
            t13 = p13.frames[1].locator('.le-card').inner_text()
            check('being drawn by the Ryagram computer' in t13 and 'may be switched off' in t13, 'while the card is waiting the panel says so, and that the computer may be off after two minutes')
            check(p13.frames[1].locator('.le-defaults').count() == 1 and 'not shown here yet' in p13.frames[1].locator('.le-defaults').inner_text() and '#000000' not in swatches(p13), 'and the swatches keep the starting colours with the old sentence')
            check(NOSKETCH(p13.frames[1]) and 'stand-in' not in t13.lower(), 'while waiting no sketch is shown, and the waiting sentence no longer mentions a stand-in')
            check(not o13 and not e13, 'nothing left the page and nothing threw while waiting')
            c13.close()
            c14, p14, e14, o14 = card_page([{'state': 'failed', 'code': 'view_not_supported', 'message': 'The engine cannot draw a picture of this kind of film yet, so no picture is shown here. The film\'s real frames are in the editor on the Ryagram website.'}])
            check('cannot draw a picture of this kind of film yet' in p14.frames[1].locator('.le-card').inner_text() and not e14, 'a film the engine cannot draw says why in words')
            check(NOSKETCH(p14.frames[1]) and 'stand-in' not in p14.frames[1].inner_text('body').lower() and 'real frames are in the editor on the Ryagram website' in p14.frames[1].locator('.le-card').inner_text(), 'and shows no sketch and points to the site, never to a stand-in')
            c14.close()
            c14b, p14b, e14b, o14b = card_page([{'state': 'failed', 'code': 'view_not_supported', 'size': {'characters': 359069, 'limit': 200000},
                'message': "This film's picture is too detailed to draw in the chat: it would be 359,069 characters and the limit is 200,000. No picture is shown here; the film's real frames are in the editor on the Ryagram website."}])
            f14b = p14b.frames[1]
            t14b = f14b.locator('.le-card').inner_text()
            check("too detailed to draw in the chat: it would be 359,069 characters and the limit is 200,000" in t14b and not e14b, 'a county map the engine refused for size says so in ONE plain sentence with its two numbers, and nothing threw')
            check(f14b.locator('.le-cardpic').count() == 0 and not f14b.locator('.le-card svg').count(), 'no picture box and no broken or empty picture in its place')
            check(NOSKETCH(f14b) and len(swatches(p14b)) >= 5, 'the film\'s other parts still work: the colour controls are there, and the sketch is not')
            check('D:' not in t14b and 'Error' not in t14b and 'engine' not in t14b.lower(), 'no path, no engine talk in the words')
            c14b.close()
            # Try again (CONNECT 11-18, card retry plan A): a button for a picture the engine failed to draw, one press = one ask (p_ask), never by itself, and none for a film the engine cannot draw
            ENG = 'Drawing the film\'s picture did not work this time. Open the editor again in about ten minutes to try again.'
            c18, p18, e18, o18 = card_page([{'state': 'failed', 'code': 'engine_error', 'retry': False, 'message': ENG}, {'state': 'failed', 'code': 'engine_error', 'retry': False, 'message': ENG}])
            f18 = p18.frames[1]
            t18 = f18.locator('.le-card').inner_text()
            check("Drawing the film's picture did not work this time." in t18 and 'Open the editor again' not in t18 and t18.count('ten minutes') == 1 and 'It can be tried again about ten minutes after it failed.' in t18 and 'You can try again now' not in t18, 'a failed picture too soon says when it can be tried again once, and not "now", and does not also say to open the editor again (the button replaces that)')
            check(f18.locator('.le-cardtry').count() == 1 and f18.locator('.le-cardtry').inner_text().strip() == 'Try again' and f18.locator('.le-cardtry').is_enabled(), 'and offers one Try again button')
            n18 = len([1 for t_, a_ in p18.evaluate('window.__calls') if t_ == 'editor_film_card'])
            p18.wait_for_timeout(1000)
            check(len([1 for t_, a_ in p18.evaluate('window.__calls') if t_ == 'editor_film_card']) == n18, 'the panel asks nothing by itself while it is failed')
            f18.locator('.le-cardtry').click()
            p18.wait_for_timeout(500)
            calls18 = [a_ for t_, a_ in p18.evaluate('window.__calls') if t_ == 'editor_film_card']
            check(len(calls18) == n18 + 1 and calls18[-1] == {'p_project': PROJECT, 'p_ask': True}, 'one press makes exactly one call, with p_ask (%s)' % calls18[-1:])
            t18b = f18.locator('.le-card').inner_text()
            check('Not yet. Please try again in a few minutes.' in t18b and 'ten minutes' not in t18b and f18.locator('.le-cardtry').count() == 1 and not e18, 'a press that is too early says "not yet" and keeps the button, and nothing threw')
            check(not o18, 'nothing left the page')
            c18.close()
            c19, p19, e19, o19 = card_page([{'state': 'failed', 'code': 'engine_error', 'retry': True, 'message': ENG}, {'state': 'asked', 'waited_seconds': 0}])
            f19 = p19.frames[1]
            t19a = f19.locator('.le-card').inner_text()
            check('You can try again now.' in t19a and 'Open the editor again' not in t19a and 'ten minutes' not in t19a and f19.locator('.le-cardtry').count() == 1, 'ten minutes on the words say "you can try again now" and never also "open the editor again in about ten minutes"')
            f19.locator('.le-cardtry').click()
            p19.wait_for_timeout(500)
            t19 = f19.locator('.le-card').inner_text()
            calls19 = [a_ for t_, a_ in p19.evaluate('window.__calls') if t_ == 'editor_film_card']
            check(calls19[-1] == {'p_project': PROJECT, 'p_ask': True} and 'being drawn by the Ryagram computer' in t19 and f19.locator('.le-cardtry').count() == 0 and not e19, 'a press that the database accepts shows the waiting words and the button goes')
            c19.close()
            c20, p20, e20, o20 = card_page([{'state': 'ready', 'stale': True, 'built_sha256': 'a' * 64, 'refresh': {'state': 'failed', 'code': 'engine_error', 'retry': True}, 'card': CARD}])
            f20 = p20.frames[1]
            t20 = f20.locator('.le-card').inner_text()
            check('A newer picture could not be drawn.' in t20 and 'You can try again now.' in t20 and f20.locator('.le-cardtry').count() == 1 and f20.locator('.le-cardpic svg').count() == 1 and not e20, 'under an older picture whose newer one failed the button is offered and the older picture stays')
            c20.close()
            c21, p21, e21, o21 = card_page([{'state': 'failed', 'code': 'engine_error', 'retry': False, 'message': ENG}, {'error': {'code': 'PT429', 'message': 'The limit of 20 film pictures an hour is reached.'}}])
            f21 = p21.frames[1]
            f21.locator('.le-cardtry').click()
            p21.wait_for_timeout(500)
            t21 = f21.locator('.le-card').inner_text()
            check('Could not ask just now. The limit of 20 film pictures an hour is reached.' in t21 and f21.locator('.le-cardtry').count() == 1 and f21.locator('.le-cardtry').is_enabled() and not e21, 'a refused press says so in the connector\'s own words and leaves the button usable')
            c21.close()
            # a refused press with an error the connector did not write for people (no PT code): the panel says only that it could not ask, never the raw text
            c23, p23, e23, o23 = card_page([{'state': 'failed', 'code': 'engine_error', 'retry': True, 'message': ENG}, {'error': {'code': None, 'message': 'connection reset by peer at db-7f3a internal'}}])
            f23 = p23.frames[1]
            f23.locator('.le-cardtry').click()
            p23.wait_for_timeout(500)
            t23 = f23.locator('.le-card').inner_text()
            check('Could not ask just now.' in t23 and 'connection reset' not in t23 and 'db-7f3a' not in t23 and f23.locator('.le-cardtry').is_enabled() and not e23, 'an error the connector did not write for people is never shown raw')
            c23.close()
            # Step B (card retry plan B, CONNECT 11-18): a failed picture that is not yet old enough to retry is read ONCE more, quietly, about ten minutes later (a read, never an ask), so an open panel notices "you can try again now"; a picture still being drawn after the 40 quick reads gets 10 slow reads, then stops
            slow = lambda pg: pg.frames[1].evaluate('(window.__slow || []).map(t => t.ms)')
            fire = lambda pg, i: pg.frames[1].evaluate('(i) => window.__slow[i].fn()', i)
            eng = lambda r, a=None: {'state': 'failed', 'code': 'engine_error', 'retry': r, 'message': ENG, **({'failed_s': a} if a is not None else {})}
            c25, p25, e25, o25 = card_page([eng(False), eng(True)], capture=True)
            f25 = p25.frames[1]
            check(slow(p25) == [620000], 'a failed picture that may not be retried yet parks ONE quiet re-read, about ten minutes and twenty seconds out (%s)' % slow(p25))
            n25 = len([1 for t_, a_ in p25.evaluate('window.__calls') if t_ == 'editor_film_card'])
            check('It can be tried again about ten minutes after it failed.' in f25.locator('.le-card').inner_text(), 'before it, the words say it cannot be tried yet')
            fire(p25, 0)
            p25.wait_for_timeout(400)
            calls25 = [a_ for t_, a_ in p25.evaluate('window.__calls') if t_ == 'editor_film_card']
            check(len(calls25) == n25 + 1 and calls25[-1] == {'p_project': PROJECT}, 'the quiet re-read is a read: one call, no p_ask (%s)' % calls25[-1:])
            t25 = f25.locator('.le-card').inner_text()
            check('You can try again now.' in t25 and f25.locator('.le-cardtry').count() == 1 and slow(p25) == [620000] and not e25, 'and the open panel now says "you can try again now"; nothing more is parked')
            c25.close()
            # GAMES finding 2 (11-19): when the database says how long ago it failed, the quiet read is timed from the failure, not from when the panel looked
            c29, p29, e29, o29 = card_page([eng(False, 540), eng(True, 620)], capture=True)
            check(slow(p29) == [80000], 'a picture that failed 9 minutes before the panel opened parks its quiet re-read 80 seconds out, not 620 (%s)' % slow(p29))
            fire(p29, 0)
            p29.wait_for_timeout(400)
            check('You can try again now.' in p29.frames[1].locator('.le-card').inner_text() and slow(p29) == [80000] and not e29, 'and the words turn at once')
            c29.close()
            c30, p30, e30, o30 = card_page([eng(False, 0)], capture=True)
            check(slow(p30) == [620000] and not e30, 'a picture that has only just failed waits the full 620 seconds (%s)' % slow(p30))
            c30.close()
            for bad in (-5, 601, 99999, 'x', '7'):
                cb, pb, eb, ob = card_page([eng(False, bad)], capture=True)
                check(slow(pb) == [620000] and not eb, 'an age that makes no sense (%r) is no age: the fixed wait (%s)' % (bad, slow(pb)))
                cb.close()
            REFAGE = {'state': 'ready', 'stale': True, 'built_sha256': 'a' * 64, 'refresh': {'state': 'failed', 'code': 'engine_error', 'retry': False, 'failed_s': 300}, 'card': CARD}
            c31, p31, e31, o31 = card_page([REFAGE], capture=True)
            check(slow(p31) == [320000] and not e31, 'under an older picture the age of the failed REFRESH is the one used (%s)' % slow(p31))
            c31.close()
            c26, p26, e26, o26 = card_page([eng(False), eng(False)], capture=True)
            fire(p26, 0)
            p26.wait_for_timeout(400)
            check(slow(p26) == [620000] and 'It can be tried again about ten minutes after it failed.' in p26.frames[1].locator('.le-card').inner_text() and not e26, 'a re-read that is STILL too early parks nothing more: one quiet re-read per failure')
            c26.close()
            c27, p27, e27, o27 = card_page([{'state': 'failed', 'code': 'view_not_supported', 'message': 'The engine cannot draw a picture of this kind of film yet, so no picture is shown here. The film\'s real frames are in the editor on the Ryagram website.'}], capture=True)
            check(slow(p27) == [] and not e27, 'a film the engine cannot draw parks no re-read at all')
            c27.close()
            c28, p28, e28, o28 = card_page([{'state': 'asked', 'waited_seconds': 0}], capture=True)
            f28 = p28.frames[1]
            for _ in range(70):
                n_ = len(slow(p28))
                idx = n_ - 1
                if idx < 0:
                    break
                tot = len(slow(p28))
                fire(p28, idx)
                p28.wait_for_timeout(60)
                if len(slow(p28)) == tot:
                    break
            ms28 = slow(p28)
            calls28 = [a_ for t_, a_ in p28.evaluate('window.__calls') if t_ == 'editor_film_card']
            check(ms28 == [15000] * 39 + [120000] * 10, 'a picture still being drawn: 39 quick reads (15 s), then 10 slow ones (2 minutes), then no more (%d quick, %d slow)' % (ms28.count(15000), ms28.count(120000)))
            check(len(calls28) == 50 and calls28[0] == {'p_project': PROJECT, 'p_ask': True} and all('p_ask' not in a_ for a_ in calls28[1:]) and not e28, 'the first call asks once; every re-read after it is a read, never an ask (%d calls)' % len(calls28))
            c28.close()
            # a press that is too early under an older picture whose newer one failed: the same "not yet" words, no time named
            REF = {'state': 'ready', 'stale': True, 'built_sha256': 'a' * 64, 'refresh': {'state': 'failed', 'code': 'engine_error', 'retry': False}, 'card': CARD}
            c24, p24, e24, o24 = card_page([REF, REF])
            f24 = p24.frames[1]
            f24.locator('.le-cardtry').click()
            p24.wait_for_timeout(500)
            t24 = f24.locator('.le-card').inner_text()
            check('Not yet. Please try again in a few minutes.' in t24 and 'ten minutes after it failed' not in t24.split('Not yet.')[1] and f24.locator('.le-cardtry').count() == 1 and not e24, 'under an older picture a press that is too early says not yet, with no time named, and keeps the button')
            c24.close()
            c22, p22, e22, o22 = card_page([{'state': 'failed', 'code': 'view_not_supported', 'message': 'The engine cannot draw a picture of this kind of film yet, so no picture is shown here. The film\'s real frames are in the editor on the Ryagram website.'}])
            check(p22.frames[1].locator('.le-cardtry').count() == 0 and 'Try again' not in p22.frames[1].locator('.le-card').inner_text() and not e22, 'a film the engine cannot draw has no Try again')
            c22.close()
            c15, p15, e15, o15 = card_page([{'error': {'code': None, 'message': 'The film picture is not available yet.'}}])
            check(p15.frames[1].locator('.le-card').count() == 0 or p15.frames[1].locator('.le-card').is_hidden(), 'a database without the card shows no card box')
            check(NOSKETCH(p15.frames[1]) and p15.frames[1].locator('.le-nopic').is_visible() and 'No picture of your film is shown here yet' in p15.frames[1].locator('.le-nopic').inner_text() and 'stand-in' not in p15.frames[1].locator('.le-nopic').inner_text().lower(), 'and no sketch: one plain sentence stands in the picture\'s place')
            check(p15.frames[1].locator('.le-defaults').count() == 1 and not e15, 'the editor still works and still says the colours are starting colours')
            c15.close()
            c16, p16, e16, o16 = card_page([{'state': 'ready', 'stale': True, 'built_sha256': 'a' * 64, 'refresh': {'state': 'asked'}, 'card': CARD}])
            t16 = p16.frames[1].locator('.le-card').inner_text()
            check('earlier version of the film' in t16 and 'A newer picture is being drawn' in t16, 'a stale card is shown and called stale, and says a newer one is being drawn')
            check('earlier version of the film' in p16.frames[1].locator('.le-defaults').inner_text() and swatches(p16)[0] == LOOK['network.color'], 'and the swatch note says so too')
            c16.close()
            BADCARD = dict(CARD, frame={'label': '2024', 'width': 960, 'height': 540, 'svg': '<svg><g></svg>'})
            c17, p17, e17, o17 = card_page([{'state': 'ready', 'stale': False, 'built_sha256': 'a' * 64, 'card': BADCARD}])
            check('could not be shown here' in p17.frames[1].locator('.le-card').inner_text() and swatches(p17)[1] == LOOK['network.base_color'] and not e17, 'a picture that will not parse is said not to be shown, the colours still come from the card, nothing throws')
            c17.close()
            print('a host that never says which film')
            c5, p5 = fresh()
            for _ in range(80):
                if 'has not told it which film' in p5.frames[1].inner_text('body'):
                    break
                p5.wait_for_timeout(250)
            t5 = p5.frames[1].inner_text('body')
            check('Ask your AI to open the editor again' in t5 and 'the chat sent initialized' in t5, 'after a wait the panel says in words that the chat did not name a film, and what it did send')
            c5.close()
            print('a host that asks the person before each write (ChatGPT approval prompt stand-in): every write answer arrives 5 s late')
            c14, p14 = fresh()
            p14.evaluate("""() => { const old = window.hostCall; window.hostCall = async (n, a) => { if (n === 'editor_apply_ops') await new Promise(r => setTimeout(r, 5000)); return old(n, a); }; }""")
            p14.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'Slow film'})
            fr14 = p14.frames[1]
            fr14.wait_for_selector('.le-panel', timeout=8000)
            p14.wait_for_timeout(600)
            ord14 = lambda: fr14.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)')
            fr14.focus('.le-clip[data-id="v3"]')
            p14.keyboard.press('ArrowLeft')
            p14.wait_for_timeout(500)
            check(ord14() == ['v1', 'v2', 'v3'], 'while the host is still asking the person, the screen is unchanged (the host decides first, nothing is shown that was not accepted) %s' % ord14())
            fr14.focus('.le-clip[data-id="v2"]')
            p14.keyboard.press('ArrowLeft')
            p14.wait_for_timeout(500)
            body14 = fr14.inner_text('body')
            check('could not' not in body14 and 'did not answer' not in body14 and 'undefined' not in body14 and 'changed this just now' not in body14, 'nothing says it failed while the host is still asking, and the page did not freeze')
            p14.wait_for_timeout(13000)
            n14 = sum(1 for t, _ in p14.evaluate('window.__calls') if t == 'editor_apply_ops')
            body14 = fr14.inner_text('body')
            check(n14 == 2 and ord14() == ['v2', 'v1', 'v3'], 'both changes were sent to the host, one after the other, each against the revision the one before it produced %s' % n14)
            check('changed this just now' not in body14 and 'could not' not in body14 and 'did not answer' not in body14, 'and no stale or error words appear for a host that was only slow')
            c14.close()
            print('a host that refuses the first write in words (a limit, an approval that was declined)')
            c16, p16 = fresh()
            p16.evaluate("""() => { const old = window.hostCall; let first = true; window.hostCall = async (n, a) => { if (n === 'editor_apply_ops' && first) { first = false; return { isError: true, content: [{ type: 'text', text: 'no' }], structuredContent: { error: { code: 'PT429', message: 'The editor panel is asking too often. It will catch up in a moment.' } } }; } return old(n, a); }; }""")
            p16.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'Refusing film'})
            fr16 = p16.frames[1]
            fr16.wait_for_selector('.le-panel', timeout=8000)
            p16.wait_for_timeout(600)
            fr16.focus('.le-clip[data-id="v3"]')
            p16.keyboard.press('ArrowLeft')
            p16.wait_for_timeout(900)
            check('too many changes too fast' in fr16.inner_text('body'), 'a refusal is shown to the person in plain words (the panel puts its own wording on the host code)')
            check(fr16.locator('.le-lane').count() >= 1 and fr16.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)') == ['v1', 'v2', 'v3'], 'and the editor stays on screen, with the film as it was (nothing was shown that the host refused)')
            fr16.focus('.le-clip[data-id="v3"]')
            p16.keyboard.press('ArrowLeft')
            p16.wait_for_timeout(900)
            check(fr16.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)') == ['v1', 'v3', 'v2'], 'a second try after the refusal goes through and shows')
            c16.close()
            print('a host that re-creates the panel in the middle of a session (a display-mode change)')
            c15, p15 = fresh()
            p15.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'Remounted film'})
            fr15 = p15.frames[1]
            fr15.wait_for_selector('.le-panel', timeout=8000)
            p15.wait_for_timeout(600)
            fr15.focus('.le-clip[data-id="v3"]')
            p15.keyboard.press('ArrowLeft')
            p15.wait_for_timeout(1500)
            p15.evaluate("() => { const f = document.getElementById('v'); const s = f.srcdoc; f.srcdoc = ''; setTimeout(() => { f.srcdoc = s; }, 80); }")
            p15.wait_for_function("window.__log.filter(m => m.method === 'ui/notifications/initialized').length >= 2", timeout=8000)
            p15.evaluate("(sc) => openWith(sc)", {'project_id': PROJECT, 'mode': 'compilation', 'title': 'Remounted film'})
            fr15b = p15.frames[1]
            fr15b.wait_for_selector('.le-panel', timeout=8000)
            p15.wait_for_timeout(1200)
            RC = 'els => els.map(e => e.dataset.id)'
            # the stand-in's computer keeps one fixed track summary (the real computer rebuilds it from the draft), so the new panel opens on that summary; what must hold is that the panel reads the draft's REVISION from the host, not from the old page
            fr15b.focus('.le-clip[data-id="v3"]')
            p15.keyboard.press('ArrowLeft')
            p15.wait_for_timeout(900)
            body15 = fr15b.inner_text('body')
            check(fr15b.eval_on_selector_all('.le-lane:first-child .le-clip', RC) == ['v1', 'v3', 'v2'] and 'changed this just now' not in body15, 'the new panel takes a change straight away: it read the revision of the draft from the host, so the host does not call it stale')
            check(fr15b.inner_text('h1') == 'Remounted film' and 'could not draw' not in body15, 'it opens on the same film with no error')
            c15.close()
            print('the button that opens the real frames on the site')
            SITE = 'https://uselai.com/app/'
            site_doc = page_html(SITE)
            check(site_doc != doc and ('data-app-url="%s"' % SITE) in site_doc, 'the page as the host reads it carries the site address on its root')
            DATA_PROJECT = '11111111-2222-4333-8444-555555555555'

            def site_page(html, mode, project, reply=None):
                c = b.new_context(viewport={'width': 390, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
                p = c.new_page()
                p.on('pageerror', lambda e: None)
                p.set_content(HOST.replace('__DOC__', json.dumps(html).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(NAMES)).replace('__CTX__', json.dumps({'displayMode': 'inline', 'availableDisplayModes': ['inline']})))
                p.add_script_tag(content=fake_js)
                p.evaluate(INIT, [PROJECT, SUMMARY])
                if reply:
                    p.evaluate('(r) => { window.__openLink = r; }', reply)
                p.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=8000)
                p.evaluate("(sc) => openWith(sc)", {'project_id': project, 'mode': mode, 'title': 'A data film'})
                p.wait_for_timeout(900)
                return c, p
            SEE = 'See the real frames on the site'
            c9, p9 = site_page(site_doc, 'data', DATA_PROJECT)
            f9 = p9.frames[1]
            btn = f9.get_by_role('button', name=SEE)
            check(btn.count() == 1, 'a data film in a chat with the site address has the button (%d)' % btn.count())
            bb = btn.first.bounding_box() if btn.count() else None
            check(bb and bb['height'] >= 44, 'the button is at least 44 px high for a thumb (%s)' % (bb and round(bb['height'])))
            btn.first.click()
            p9.wait_for_function("window.__log.some(m => m.method === 'ui/open-link')", timeout=4000)
            opened = p9.evaluate("window.__log.filter(m => m.method === 'ui/open-link').map(m => m.params)")
            check(opened == [{'url': SITE + '#/editor/data/' + DATA_PROJECT}], 'one press asks the host to open exactly the site editor on this film (%s)' % opened)
            check('Open this address' not in f9.inner_text('body'), 'when the host opens it nothing else is said')
            check(set(p9.evaluate('window.__refused')) <= {'editor_film_card'}, 'the host refused no tool call but the film card (this stand-in host offers only the five names; a data film also asks for its card)')
            check(f9.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'at phone width nothing scrolls sideways')
            c9.close()
            for mode_name, reply in (('an error', 'refuse'), ('an isError result', 'iserror')):
                c10, p10 = site_page(site_doc, 'data', DATA_PROJECT, reply)
                f10 = p10.frames[1]
                f10.get_by_role('button', name=SEE).first.click()
                p10.wait_for_timeout(700)
                body10 = f10.inner_text('body')
                check('Your chat app did not open it. Open this address in your browser:' in body10 and (SITE + '#/editor/data/' + DATA_PROJECT) in body10, 'a host that refuses (%s) gets the address in words to open by hand' % mode_name)
                check(f10.locator('.le-sitelink').count() == 1, 'the words are there once')
                f10.get_by_role('button', name=SEE).first.click()
                p10.wait_for_timeout(500)
                check(f10.locator('.le-sitelink').count() == 1, 'pressing again does not pile up the words')
                c10.close()
            c11, p11 = site_page(site_doc, 'compilation', DATA_PROJECT)
            check(p11.frames[1].get_by_role('button', name=SEE).count() == 0, 'a clip film has no such button (its frames are on the person computer, not the site)')
            c11.close()
            c12, p12 = site_page(doc, 'data', DATA_PROJECT)
            check(p12.frames[1].get_by_role('button', name=SEE).count() == 0, 'a connector with no site address configured has no such button')
            c12.close()
            c13, p13 = site_page(site_doc, 'data', '../../etc')
            check(p13.frames[1].get_by_role('button', name=SEE).count() == 0, 'a film id that is not the form the site uses has no such button')
            c13.close()
            print('a page that throws while loading')
            bad = doc.replace('<script>\n/* ---- assets/app-editor-core.js', '<script>throw new Error("boom in load");\n/* ---- assets/app-editor-core.js', 1)
            check(bad != doc, 'the throwing page was built')
            c6 = b.new_context(viewport={'width': 1280, 'height': 900})
            p6 = c6.new_page()
            p6.on('pageerror', lambda e: None)
            p6.set_content(HOST.replace('__DOC__', json.dumps(bad).replace('</', '<' + chr(92) + '/')).replace('__NAMES__', json.dumps(NAMES)).replace('__CTX__', '{}'))
            for _ in range(40):
                if 'could not draw' in p6.frames[1].inner_text('body'):
                    break
                p6.wait_for_timeout(200)
            build = (re.search(r'data-build="([0-9a-f]{12})"', doc) or [None, ''])[1]
            check('boom in load' in p6.frames[1].inner_text('body'), 'the person reads that it could not draw, with the reason, not a placeholder that never changes')
            check(len(build) == 12 and p6.frames[1].inner_text('body').rstrip().endswith('Panel build ' + build + '.'), 'the words end with the page\'s build id, so an old page (no id) is told from a new one')
            c6.close()
        finally:
            b.close()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
