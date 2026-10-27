"""'Ask my AI' END TO END, in real Chrome: the person's note -> the line the page gives their AI -> a connected AI (scripted, but using ONLY the connector's real tool entry points) -> the change in the open editor
-> the person undoes the AI's changes -> the AI is told. NEXT-CONNECT 145.

    py tools/check-ask-my-ai.py [scratch folder for the screenshot]

tests/ask-my-ai-server.mjs is the bench: WEB's real editor page (pinned, tools/maker-live/) and the connector's real tools share ONE draft. Nothing leaves 127.0.0.1; the browser and the server are closed
at the end. The 'AI' is a few lines of script: it does what an assistant would do with the line and the tool answers it reads (text only), so what is proved is the SHAPE of the whole hand-over."""
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("D:/Ryagram-scratch/CONNECT/temp/ask-my-ai")
PORT = 8283
BASE = f"http://127.0.0.1:{PORT}"
PROJECT = "00000000-0000-4000-8000-0000000000a1"
TOKEN = "T0KEN-ask-my-ai"
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def ai(tool, args=None):
    """What the connected AI does: one tool call, read the text answer."""
    r = urllib.request.Request(BASE + "/__ai", data=json.dumps({"tool": tool, "args": args or {}}).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=20).read().decode())


OUT.mkdir(parents=True, exist_ok=True)
srv = subprocess.Popen(["node", str(ROOT / "tests" / "ask-my-ai-server.mjs"), str(PORT), PROJECT, TOKEN], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    ready = ""
    for _ in range(40):                                              # node may print warnings first
        ready = srv.stdout.readline().strip()
        if ready == "ready" or not ready:
            break
    check(ready == "ready", "the bench starts (the editor page and the connector's real tools over one shared draft)" + ("" if ready == "ready" else f": {ready}"))
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"{BASE}/live?t={TOKEN}&mode=compilation&project={PROJECT}", wait_until="load")
        pg.wait_for_selector('.le-clip[data-id="t1"]', timeout=15000)
        pg.wait_for_timeout(500)

        # 1. no editor was announced yet? the page's heartbeat makes it 'open': the AI can ask with no project
        first = ai("get_edit_state")
        t0 = time.time()
        while first["data"].get("open_editor") is False and time.time() - t0 < 25:          # the page's heartbeat says 'open' (it beats about every 15 s)
            time.sleep(1)
            first = ai("get_edit_state")
        check(not first.get("isError") and PROJECT in first["text"] and first["data"]["project_id"] == PROJECT, "with the editor open, the AI asks for the state WITHOUT a project and is told which project it is")
        check("Summer" in first["text"] and "Let my AI see" not in first["text"], "it sees the clip list the person shared (the title 'Summer')")
        check(ai("get_edit_state", {"project_id": PROJECT})["data"]["compilation"]["revision"] == first["data"]["compilation"]["revision"], "naming the project gives the same answer")

        # 2. the person's note, and the line the page hands to their AI
        pg.click("text=Ask my AI")
        note = "Make the title say Welcome home"
        pg.fill("#le-note", note)
        pg.click(".le-ai >> text=Copy")
        pg.wait_for_timeout(300)
        line = pg.evaluate("navigator.clipboard.readText()")
        check(note in line and "Do not render, save or spend credits" in line and "Use the Ryagram connector" in line, "the Copy button gives the AI the person's note and the three rules (draft only; no render, save or credits)")

        # 3. the AI reads the state and changes the title: only through the real tools
        m = re.search(r"say (.+?)\.", line)
        new_text = m.group(1)
        text_id = re.search(r"^\s*(t\d+)\s+text\b", first["text"], re.MULTILINE)
        text_id = text_id.group(1) if text_id else "t1"
        rev = first["data"]["compilation"]["revision"]
        res = ai("edit_tracks", {"project_id": PROJECT, "base_revision": rev, "ops": [{"op": "set_clip_text", "id": text_id, "text": new_text}]})
        check(not res.get("isError") and res["data"]["saved"] is False and res["data"]["pending"] is True, "the AI's change is accepted as a DRAFT (nothing saved, nothing built)")
        refused = ai("edit_tracks", {"project_id": PROJECT, "base_revision": rev, "ops": [{"op": "set_clip_text", "id": text_id, "text": "stale"}]})
        check(refused.get("isError") and refused["code"] == "conflict" and "get_edit_state" in refused["text"], "a second change on the old revision is refused and told to read again")

        # 4. the open editor shows it
        pg.locator(".le-banner").wait_for(state="visible", timeout=8000)
        check("Your AI changed 1 thing" in pg.inner_text(".le-banner"), "the open editor shows the banner 'Your AI changed 1 thing'")
        pg.click('.le-clip[data-id="t1"]')
        check(pg.input_value("#le-text") == new_text, f"the title in the open editor now says {new_text!r}")
        pg.screenshot(path=str(OUT / "ask-my-ai-after.png"), full_page=True)

        # 5. the person undoes their AI's changes; the AI is told it may not just put it back
        pg.click("text=Undo my AI’s changes")
        pg.wait_for_timeout(1200)
        pg.click('.le-clip[data-id="t1"]')
        check(pg.input_value("#le-text") == "Summer", "'Undo my AI's changes' puts the title back")
        state = ai("get_edit_state")
        check(len(state["data"]["recently_undone"]) == 1 and "recently took back" in state["text"], "the AI reads that the person took the change back")
        again = ai("edit_tracks", {"project_id": PROJECT, "base_revision": state["data"]["compilation"]["revision"], "ops": [{"op": "set_clip_text", "id": text_id, "text": new_text}]})
        check(again.get("isError") and again["code"] == "conflict" and "undid exactly this" in again["text"], "the AI cannot quietly put it back (the person undid exactly this)")

        # 6. the AI cannot do what the line forbids
        r = ai("request_full_render", {"project_id": PROJECT})
        check(r.get("isError") is True and r.get("code") == "not_available", "the final render is refused from an AI connection, whatever the line says")
        check(ai("get_edit_state")["data"]["compilation"]["pending"] >= 0 and not any(o["status"] == "applied" and o["op"].get("op") in ("save_story", "render") for o in json.loads(urllib.request.urlopen(BASE + "/__state").read())["ops"]), "nothing the AI did was a save or a render (the draft log holds only editor changes)")
        check(not errors, "no page errors" + (f": {errors[:2]}" if errors else ""))
        b.close()
finally:
    if srv.poll() is None:
        srv.terminate()
        try:
            srv.wait(10)
        except subprocess.TimeoutExpired:
            srv.kill()
    srv.stdout.close()
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
