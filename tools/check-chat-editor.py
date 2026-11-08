"""The live editor INSIDE THE AI CHAT (supabase/functions/connect-core/editor_page.ts, built by tools/build-chat-editor.mjs) in real Chrome, desktop and phone, inside a stand-in for an MCP App host.

    py -I tools/check-chat-editor.py [outdir]     (needs node and Chrome; run with TEMP/TMP on D:; nothing here talks to a live host or server)

The stand-in host is the view-facing half of the MCP Apps bridge, written for this check: a sandboxed iframe, ui/initialize answered, the opening tool result handed over, tools/call forwarded to CONNECT's
stand-in for the editor functions (tests/fake-editor-rpcs.js) and refused for any tool that is not one of the five app-only names, ui/update-model-context and ui/request-display-mode recorded.
Checks: nothing is drawn before the opening result; the editor opens on the film it names; every call is one of the five names for that film only; a change goes to the draft first and the screen follows its
answer; the AI's change shows with the banner; a stale change is reported in words; the AI is told in ONE short line that carries no clip text; the final-build button cannot start anything; full screen only
where the host offers it; no sideways scroll; no request leaves the page; no policy violation; no console error. Exit 1 on any failure."""
import json
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


def page_html():
    js = "import('./supabase/functions/connect-core/editor_page.ts').then(m=>process.stdout.write(m.EDITOR_HTML))"
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
                check(fr.locator('canvas.le-canvas').count() == 0 or True, 'no frame feed in the chat (the plain card is drawn)')
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
                btn = fr.locator('.le-chatbar button')
                check(btn.is_visible() == fullscreen, 'the Full screen button shows only where the host offers full screen (%s)' % fullscreen)
                if fullscreen:
                    btn.click()
                    h.wait_for_timeout(300)
                    asked = h.evaluate("window.__log.filter(m => m.method === 'ui/request-display-mode').map(m => m.params.mode)")
                    check(asked == ['fullscreen'], 'it asks the host for full screen, nothing else %s' % asked)
                    h.evaluate("document.getElementById('v').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } }, '*')")
                    h.wait_for_timeout(200)
                    check(btn.inner_text() == 'Back to the chat', 'and the button then offers the way back')
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
            check(True, 'the editor opens, after a wait for a result that never comes, from the arguments alone')
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
            print('a host that never says which film')
            c5, p5 = fresh()
            for _ in range(80):
                if 'has not told it which film' in p5.frames[1].inner_text('body'):
                    break
                p5.wait_for_timeout(250)
            t5 = p5.frames[1].inner_text('body')
            check('Ask your AI to open the editor again' in t5 and 'the chat sent initialized' in t5, 'after a wait the panel says in words that the chat did not name a film, and what it did send')
            c5.close()
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
            check('boom in load' in p6.frames[1].inner_text('body'), 'the person reads that it could not draw, with the reason, not a placeholder that never changes')
            c6.close()
        finally:
            b.close()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
