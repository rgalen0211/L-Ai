"""The games JOIN CARD (tools/games-host/join-card.mjs) in a REAL browser, inside a stand-in for an MCP App host (CONNECT, 2026-11-10).

    py -I tools/check-games-join-card.py [page.html]        (needs node and Chrome; run with TEMP/TMP on D:; the optional file is a copy of the page to check instead of the built one)

The stand-in host is the view-facing half of the MCP Apps bridge (the same one tools/check-mcp-app-card.py uses): it puts the built page in a sandboxed iframe under the spec's DEFAULT policy (default-src 'none'; script and
style inline; connect-src 'none'), answers ui/initialize, hands over tool results, and records everything the page sends. Checks, at 320, 390, 768 and 1280 px wide with a light and a dark host: the four letters of the code and
the players are drawn; a player's name is text (markup stays text, nothing runs, hidden direction characters are gone, a long name is cut); more than 20 players say how many more; an address, a link or a phone address in the result
is NEVER shown (the TV shows where to go); a code that is not four capital letters is not shown; no button and no link; no request leaves the page; no policy violation; no sideways scroll; text keeps 4.5:1; the page reports
its height and the frame is exactly as tall; a second result updates the card; a host that never answers still leaves a readable card. Exit 1 on any finding. Nothing here talks to a live host or server."""
import json
import re
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FAILED = []
CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'"
RLO = chr(0x202E)

HOST = """<!doctype html><meta charset="utf-8"><body style="margin:0;background:__BG__">
<iframe id="v" sandbox="allow-scripts" style="border:0;width:100%;height:60px;display:block"></iframe>
<script>
window.__log = []; window.__answer = true;
const f = document.getElementById('v');
f.srcdoc = __DOC__;
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; window.__log.push(m);
  if (m.method === 'ui/initialize' && window.__answer) f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'stand-in', version: '0' }, hostCapabilities: {} } }, '*');
  if (m.method === 'ui/notifications/size-changed') f.style.height = m.params.height + 'px';
});
window.sendResult = sc => f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } }, '*');
</script>"""


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def card_html():
    js = "import('./tools/games-host/join-card.mjs').then(m=>process.stdout.write(m.joinCardHtml()))"
    r = subprocess.run(["node", "--no-warnings", "-e", js], cwd=ROOT, capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        print(r.stderr)
        sys.exit(2)
    return r.stdout


def host_page(doc, theme):
    doc = doc.replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="%s">' % CSP, 1)
    return HOST.replace("__DOC__", json.dumps(doc).replace("</", "<" + chr(92) + "/")).replace("__BG__", "#ffffff" if theme == "light" else "#262624")


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
    return tuple(float(x) for x in re.findall(r"[\d.]+", s)[:3])


def main():
    doc = Path(sys.argv[1]).read_text(encoding='utf-8') if len(sys.argv) > 1 else card_html()       # an optional page file: the planted-fault runner checks a broken copy
    check(len(doc.encode()) <= 8 * 1024, "the page is within its 8 KB budget (%d bytes)" % len(doc.encode()))
    check(not re.search(r"https?:|<link|<img|<iframe|@import|url\(|fetch\(|XMLHttpRequest|WebSocket|eval\(|new Function|innerHTML|document\.write", doc), "the page holds no address, no fetch, no eval and no innerHTML")
    players = [{"name": "Ana"}, {"name": "<img src=x onerror=alert(1)>"}, {"name": "Ben" + RLO + "evil"}, {"name": "x" * 60}] + ["Zed the player"] + [{"name": "P%d" % i} for i in range(18)]       # one player given as plain text, as an older server might
    result = {"code": "KXQT", "players": players, "address": "http://192.168.1.50:8080/phone", "phone_url": "http://192.168.1.50:8080/p", "link": "https://example.test/x", "changed_at": 3}
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
                    page.evaluate("sendResult(%s)" % json.dumps(result))
                    fr = page.frames[1]
                    fr.wait_for_selector(".ch", timeout=5000)
                    page.wait_for_timeout(200)
                    letters = fr.eval_on_selector_all(".ch", "els => els.map(e => e.textContent).join('')")
                    check(letters == "KXQT", "%s: the four letters of the code (%s)" % (tag, letters))
                    check(fr.get_attribute(".code", "aria-label") == "Join code K X Q T", "%s: the code is read out letter by letter" % tag)
                    text = fr.inner_text("body")
                    names = fr.eval_on_selector_all(".who li", "els => els.map(e => e.textContent)")
                    check(len(names) == 20 and "Players so far: 23" in text and "and 3 more" in text, "%s: 20 names drawn, the count and how many more (%d names)" % (tag, len(names)))
                    check("<img src=x onerror=alert(1)>"[:24] in names and fr.query_selector("img") is None, "%s: markup in a name stayed text (cut to 24 characters)" % tag)
                    check(not dialogs, "%s: nothing ran (no dialog)" % tag)
                    check("Zed the player" in names, "%s: a player given as plain text is drawn" % tag)
                    check(not any(RLO in n for n in names) and "Ben evil" in names, "%s: a hidden direction character in a name is gone" % tag)
                    check(all(len(n) <= 24 for n in names) and ("x" * 24) in names, "%s: a long name is cut to 24 characters" % tag)
                    check("192.168" not in text and "http" not in text and "example.test" not in text, "%s: an address, a phone address or a link in the result is never shown" % tag)
                    check(fr.query_selector("a") is None and fr.query_selector("button") is None and fr.query_selector("[href]") is None, "%s: no button and no link" % tag)
                    check(not bad_requests, "%s: no request left the page %s" % (tag, bad_requests[:2]))
                    check(not violations, "%s: no policy violation %s" % (tag, violations[:2]))
                    check(not fr.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), "%s: no sideways scroll" % tag)
                    pairs = fr.evaluate("""() => [...document.querySelectorAll('h1,.hint,.sub,.ch,.who li,.mark')].map(e => {
                        let n = e, bg = 'rgba(0, 0, 0, 0)'; while (n) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } n = n.parentElement; }
                        return [e.className || e.tagName, getComputedStyle(e).color, bg]; })""")
                    low = [(n, round(ratio(rgb(c), rgb(bg)), 1)) for n, c, bg in pairs if ratio(rgb(c), rgb(bg)) < 4.5]
                    check(not low, "%s: every text keeps 4.5:1 on its own background %s" % (tag, low[:3]))
                    sizes = page.evaluate("window.__log.filter(m => m.method === 'ui/notifications/size-changed').map(m => m.params.height)")
                    check(bool(sizes) and sizes[-1] > 100, "%s: the card reports a height (%s)" % (tag, sizes[-1:]))
                    frame_h = page.evaluate("document.getElementById('v').getBoundingClientRect().height")
                    content_h = fr.evaluate("document.documentElement.getBoundingClientRect().height")
                    check(abs(frame_h - content_h) <= 2, "%s: the frame is exactly as tall as the card (%d vs %d)" % (tag, frame_h, content_h))
                    methods = set(page.evaluate("window.__log.map(m => m.method)"))
                    check(methods <= {"ui/initialize", "ui/notifications/initialized", "ui/notifications/size-changed"}, "%s: the page sent only the expected messages %s" % (tag, sorted(methods)))
                    # a second result updates the card, and a bad code is not shown
                    page.evaluate("sendResult(%s)" % json.dumps({"code": "ABCD", "players": []}))
                    page.wait_for_function("window.frames && document.getElementById('v').contentDocument === null || true")
                    fr.wait_for_selector("text=No one has joined yet.", timeout=3000)
                    check(fr.eval_on_selector_all(".ch", "els => els.map(e => e.textContent).join('')") == "ABCD", "%s: a second result updates the card" % tag)
                    for bad in ({"code": "kxqt", "players": []}, {"code": "KXQ", "players": []}, {"code": "KXQT1", "players": []}, {"code": "<b>X</b>", "players": []}, {"players": [{"name": "Ana"}]}, None, "KXQT"):
                        page.evaluate("sendResult(%s)" % json.dumps(bad))
                        page.wait_for_timeout(60)
                        check(fr.query_selector(".ch") is None and "The room code is in the conversation above." in fr.inner_text("body"), "%s: a code that is not four capital letters is not shown (%r)" % (tag, bad))
                    ctx.close()
            ctx = b.new_context(viewport={"width": 390, "height": 700})
            page = ctx.new_page()
            page.set_content(host_page(doc, "dark").replace("window.__answer = true", "window.__answer = false"))
            page.wait_for_timeout(500)
            fr = page.frames[1]
            check("Join the game" in fr.inner_text("body"), "a host that never answers: the card still says what it is")
            check(page.evaluate("!window.__log.some(m => m.method === 'ui/notifications/initialized')"), "a host that never answers: the card does not claim to be ready")
            ctx.close()
        finally:
            b.close()
    print("\nALL OK" if not FAILED else "\n%d FAILED" % len(FAILED))
    sys.exit(1 if FAILED else 0)


main()
