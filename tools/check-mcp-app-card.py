"""The inline Ryagram card in a REAL browser, inside a stand-in for an MCP App host (CONNECT, 2026-11-05).

    py -I tools/check-mcp-app-card.py        (needs node and Chrome; run with TEMP/TMP on D:)

The stand-in host is the view-facing half of the MCP Apps bridge, written for this check: it puts the built card page (supabase/functions/connect-core/mcp_app.ts, cardHtml) in a sandboxed iframe under the
spec's DEFAULT policy (default-src 'none'; script/style inline; img data:; connect-src 'none'), answers ui/initialize, hands over tool results, and records everything the card sends.
Checks, at 320, 390, 768 and 1280 px wide, with a light and a dark host: the card draws the account, the credits and the projects; no sideways scroll; the button is at least 44 px tall;
text keeps contrast of 4.5:1 or better on its own background; the card reports a height; no request leaves the page; no policy violation; markup in a project title stays text and nothing runs;
a host that never answers still leaves a readable card. Exit 1 on any finding. Nothing here talks to a live host or server."""
import json
import re
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FAILED = []
APP = "https://uselai.com/app/"


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def card_html():
    js = "import('./supabase/functions/connect-core/mcp_app.ts').then(m=>process.stdout.write(m.cardHtml(%s)))" % json.dumps(APP)
    r = subprocess.run(["node", "--no-warnings", "-e", js], cwd=ROOT, capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        print(r.stderr)
        sys.exit(2)
    return r.stdout


CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'"

HOST = """<!doctype html><meta charset="utf-8"><body style="margin:0;background:__BG__">
<iframe id="v" sandbox="allow-scripts" style="border:0;width:100%;height:60px;display:block"></iframe>
<script>
window.__log = []; window.__answer = true;
const f = document.getElementById('v');
f.srcdoc = __DOC__;
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; window.__log.push(m);
  if (m.method === 'ui/initialize' && window.__answer) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'stand-in', version: '0' }, hostCapabilities: {}, hostContext: { theme: '__THEME__' } } }, '*');
  if (m.method === 'ui/notifications/size-changed') f.style.height = m.params.height + 'px';
  if (m.method === 'ui/open-link' && m.id !== undefined) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
});
window.sendResult = sc => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } }, '*');
</script>"""


def host_page(doc, theme):
    # the policy goes INSIDE the framed document, as a host's proxy would set it
    doc = doc.replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="%s">' % CSP, 1)
    return HOST.replace("__DOC__", json.dumps(doc).replace("</", "<" + chr(92) + "/")).replace("__THEME__", theme).replace("__BG__", "#ffffff" if theme == "light" else "#262624")


def lum(rgb):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)


def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def rgb(s):
    m = re.findall(r"[\d.]+", s)
    return tuple(float(x) for x in m[:3])


def main():
    doc = card_html()
    check(len(doc.encode()) <= 12 * 1024, "the page is within its 12 KB budget (%d bytes)" % len(doc.encode()))
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        try:
            for theme in ("light", "dark"):
                for width in (320, 390, 768, 1280):
                    tag = "%s host, %d px" % (theme, width)
                    ctx = b.new_context(viewport={"width": width, "height": 700}, color_scheme=theme)
                    page = ctx.new_page()
                    bad_requests, dialogs, violations = [], [], []
                    page.on("request", lambda r: bad_requests.append(r.url) if not re.match(r"^(data:|about:|blob:)", r.url) else None)
                    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
                    page.on("console", lambda m: violations.append(m.text) if "Content Security Policy" in m.text or "Refused to" in m.text else None)
                    page.set_content(host_page(doc, theme))
                    page.wait_for_function("window.__log.some(m => m.method === 'ui/notifications/initialized')", timeout=5000)
                    page.evaluate("sendResult({ account: 'alice@example.test', credits_available: 100, credits_held: 3, projects: [{id:'a',title:'<img src=x onerror=alert(1)>'},{id:'b',title:'Film two'},{id:'c',title:'Film three'},{id:'d',title:'Film four'}] })")
                    fr = page.frames[1]
                    fr.wait_for_selector("text=Film two", timeout=5000)
                    page.wait_for_timeout(200)
                    text = fr.inner_text("body")
                    for want in ("Ryagramming", "alice@example.test", "100", "<img src=x onerror=alert(1)>", "Film two", "and 1 more", "Open Ryagram"):
                        check(want in text, "%s: shows %r" % (tag, want))
                    check(fr.query_selector("img") is None, "%s: markup in a title made no image" % tag)
                    check(not dialogs, "%s: nothing ran (no dialog)" % tag)
                    check(not bad_requests, "%s: no request left the page %s" % (tag, bad_requests[:2]))
                    check(not violations, "%s: no policy violation %s" % (tag, violations[:2]))
                    over = fr.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
                    check(not over, "%s: no sideways scroll" % tag)
                    btn = fr.query_selector("button")
                    box = btn.bounding_box() if btn else None
                    check(bool(box) and box["height"] >= 44, "%s: the button is at least 44 px tall (%s)" % (tag, box and round(box["height"])))
                    pairs = fr.evaluate("""() => [...document.querySelectorAll('h1,.k,.v,.hint,button,.mark')].map(e => {
                        let n = e, bg = 'rgba(0, 0, 0, 0)'; while (n) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } n = n.parentElement; }
                        return [e.className || e.tagName, getComputedStyle(e).color, bg]; })""")
                    low = [(n, round(ratio(rgb(c), rgb(bg)), 1)) for n, c, bg in pairs if ratio(rgb(c), rgb(bg)) < 4.5]
                    check(not low, "%s: every text keeps 4.5:1 on its own background %s" % (tag, low[:3]))
                    sizes = page.evaluate("window.__log.filter(m => m.method === 'ui/notifications/size-changed').map(m => m.params.height)")
                    check(bool(sizes) and sizes[-1] > 100, "%s: the card reports a height (%s)" % (tag, sizes[-1:]))
                    frame_h = page.evaluate("document.getElementById('v').getBoundingClientRect().height")
                    content_h = fr.evaluate("document.documentElement.getBoundingClientRect().height")
                    check(abs(frame_h - content_h) <= 2, "%s: the frame is exactly as tall as the card (%d vs %d)" % (tag, frame_h, content_h))
                    fr.click("button")
                    page.wait_for_timeout(100)
                    opened = page.evaluate("window.__log.filter(m => m.method === 'ui/open-link').map(m => m.params.url)")
                    check(opened == [APP], "%s: the button asks the host to open the app address %s" % (tag, opened))
                    methods = set(page.evaluate("window.__log.map(m => m.method)"))
                    check(methods <= {"ui/initialize", "ui/notifications/initialized", "ui/notifications/size-changed", "ui/open-link"}, "%s: the card sent only the expected messages %s" % (tag, sorted(methods)))
                    ctx.close()
            # a host that never answers: the card is still readable
            ctx = b.new_context(viewport={"width": 390, "height": 700})
            page = ctx.new_page()
            page.set_content(host_page(doc, "dark").replace("window.__answer = true", "window.__answer = false"))
            page.wait_for_timeout(500)
            fr = page.frames[1]
            t = fr.inner_text("body")
            check("Ryagramming" in t, "a host that never answers: the card still says Ryagramming")
            check(page.evaluate("!window.__log.some(m => m.method === 'ui/notifications/initialized')"), "a host that never answers: the card does not claim to be ready")
            ctx.close()
        finally:
            b.close()
    print("\n%d finding(s)" % len(FAILED) if FAILED else "\nall checks passed")
    sys.exit(1 if FAILED else 0)


main()
