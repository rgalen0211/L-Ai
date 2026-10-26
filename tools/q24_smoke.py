"""Q24, the smoke test through the connector, as ONE command (INTERNAL, CONNECT 2026-10-19; follows proposals/CONNECT-Q24-SMOKE.md).

    py tools/q24_smoke.py --env-file <file> --account-file <file> [--live] [--no-writes] [--wait-minutes 15] [--poll-seconds 30] [--preview]

  --env-file      two lines: SUPABASE_URL=https://<ref>.supabase.co and SUPABASE_PUBLISHABLE_KEY=<the public key>   (the same file as Q22)
  --account-file  {"email": "...", "password": "..."}  of the TEST account (not an admin; ANY credit balance, which must be the same at the end)
  --live          REQUIRED, typed by Ryan himself, for the live project; refused for any other project. Without it the script refuses to touch live.
  --no-writes     creates no project and no job (steps 0, 1, 2, 4, 7 only)
  --preview       also runs step 12 (a free preview) -- only if Ryan said yes to it

It makes its OWN throwaway connection as the test account (register, sign in, approve as that person, token), walks the page's steps through the connector's
public tools, and ends by revoking that connection. It uses no SQL and no secret of the project: only the public key and the test account's own sign-in.
It never prints a key, a password, a token, a code, a result link or a project's text. Output: one PASS/FAIL line per step and the one-line report.
Not covered (and why): Ryan connecting HIS Claude (the Q24 connect step is his and stays his); the SQL evidence (connect_calls, 05_daily_health) which needs the SQL Editor."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LIVE_REF = "jxtkfishqfxuptwjzczz"
PROOF_REF = "awjbjersplaqhxhuvozi"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
STEPS: list[tuple[str, bool, str]] = []


def say(ok: bool | None, text: str, detail: str = ""):
    tag = "PASS " if ok else ("SKIP " if ok is None else "FAIL ")
    print(f"{tag} {text}" + (f"   [{detail}]" if detail else ""), flush=True)
    STEPS.append((text, bool(ok) if ok is not None else True, detail))


class Stop(Exception):
    pass


def must(ok: bool, text: str, detail: str = ""):
    say(ok, text, detail)
    if not ok:
        raise Stop(text)


def read_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            env[m.group(1)] = m.group(2).strip("\"'")
    return env


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http(method, url, body=None, headers=None, form=False, want_headers=False):
    h = dict(headers or {})
    data = None
    if body is not None:
        data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
        h.setdefault("Content-Type", "application/x-www-form-urlencoded" if form else "application/json")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h), timeout=60) as r:
            raw = r.read()
            out = (r.status, (json.loads(raw) if raw else None))
            return (*out, dict(r.headers)) if want_headers else out
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            j = json.loads(raw)
        except Exception:
            j = None
        return (e.code, j, dict(e.headers)) if want_headers else (e.code, j)


class Conn:
    """The script's own throwaway connection to the connector, as the test account."""

    def __init__(self, url: str, key: str, email: str, password: str):
        self.url, self.key, self.fn = url, key, f"{url}/functions/v1/connect"
        st, sess = http("POST", f"{url}/auth/v1/token?grant_type=password", {"email": email, "password": password}, headers={"apikey": key})
        if st != 200:
            raise Stop(f"the test account could not sign in (status {st})")
        self.person = {"apikey": key, "Authorization": f"Bearer {sess['access_token']}"}
        self.cid = self.token = self.refresh = None

    def connect(self, scope="read write render_free"):
        st, reg = http("POST", f"{self.fn}/register", {"client_name": "Q24 smoke test (throwaway)", "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"})
        if st != 201:
            raise Stop(f"registering the throwaway client failed (status {st})")
        self.cid = reg["client_id"]
        verifier = secrets.token_urlsafe(48)[:64]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        q = urllib.parse.urlencode({"response_type": "code", "client_id": self.cid, "redirect_uri": CALLBACK, "state": "q24", "code_challenge": challenge,
                                    "code_challenge_method": "S256", "scope": scope, "resource": f"{self.fn}/mcp"})
        try:
            urllib.request.build_opener(NoRedirect).open(f"{self.fn}/authorize?{q}", timeout=60)
            loc = ""
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location", "")
        rid = urllib.parse.parse_qs(urllib.parse.urlsplit(loc).query).get("request", [None])[0]
        if not rid:
            raise Stop("the sign-in could not start (no consent request)")
        st, dec = http("POST", f"{self.url}/rest/v1/rpc/connect_consent_decide", {"p_request": rid, "p_approve": True, "p_scopes": scope.split()}, headers=self.person)
        if st != 200 or not isinstance(dec, dict):
            raise Stop(f"the test account could not approve the connection (status {st}); is it invited, and not an administrator?")
        code = urllib.parse.parse_qs(urllib.parse.urlsplit(dec["redirect_to"]).query).get("code", [None])[0]
        st, tok = http("POST", f"{self.fn}/token", {"grant_type": "authorization_code", "code": code, "client_id": self.cid, "redirect_uri": CALLBACK, "code_verifier": verifier}, form=True)
        if st != 200:
            raise Stop(f"the token exchange failed (status {st})")
        self.token, self.refresh = tok["access_token"], tok["refresh_token"]

    def tool(self, name: str, args: dict | None = None):
        """-> (http status, isError, text, structured data)"""
        st, j = http("POST", f"{self.fn}/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}},
                     headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json, text/event-stream"})
        res = (j or {}).get("result") or {}
        return st, bool(res.get("isError")), " ".join(c.get("text", "") for c in res.get("content", [])), (res.get("structuredContent") or {})

    def end(self):
        """Revoke the token and remove the grant: this script leaves no live connection behind."""
        try:
            if self.refresh:
                http("POST", f"{self.fn}/revoke", {"token": self.refresh}, form=True)
            if self.token:
                http("POST", f"{self.fn}/revoke", {"token": self.token}, form=True)
            if self.cid:
                http("POST", f"{self.url}/rest/v1/rpc/disconnect_ai", {"p_client_id": self.cid}, headers=self.person)
        except Exception:                                   # noqa: BLE001
            pass


def credits_usable_at_start(data: dict) -> bool:
    """The test account may hold ANY balance (an invite can carry welcome credits, 20 on 10-25), but nothing may be held: a whole number, not negative, 0 held."""
    a, h = data.get("credits_available"), data.get("credits_held")
    return isinstance(a, int) and not isinstance(a, bool) and a >= 0 and h == 0


def credits_unchanged(start: tuple, data: dict) -> bool:
    """After the whole walk, the balance and the held count are exactly what they were at step 1: a connection spends nothing and holds nothing."""
    return (data.get("credits_available"), data.get("credits_held")) == start


def main() -> int:
    ap = argparse.ArgumentParser(description="Q24 smoke test through the connector")
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--account-file", required=True)
    ap.add_argument("--live", action="store_true", help="required, and only valid, for the live project")
    ap.add_argument("--no-writes", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--wait-minutes", type=float, default=15.0, help="how long to follow the contact-sheet job (0 = do not follow)")
    ap.add_argument("--poll-seconds", type=float, default=30.0)
    a = ap.parse_args()

    env = read_env(Path(a.env_file))
    url = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_PUBLISHABLE_KEY", "")
    m = re.fullmatch(r"https://([a-z0-9]{20})\.supabase\.co", url)
    if not m or not key:
        print("REFUSED: the env file needs SUPABASE_URL=https://<ref>.supabase.co and SUPABASE_PUBLISHABLE_KEY")
        return 2
    ref = m.group(1)
    if ref == LIVE_REF and not a.live:
        print("REFUSED: this is the LIVE project. The smoke test creates one project and one free job on the test account. If Ryan has said yes, he types --live himself.")
        return 2
    if a.live and ref != LIVE_REF:
        print("REFUSED: --live is only for the live project.")
        return 2
    if ref not in (LIVE_REF, PROOF_REF):
        print("REFUSED: this script runs only against the live project (with --live) or the proof project.")
        return 2
    live = ref == LIVE_REF
    acct = json.loads(Path(a.account_file).read_text(encoding="utf-8"))
    fn = f"{url}/functions/v1/connect"
    print(f"Q24 smoke test on the {'LIVE' if live else 'PROOF'} project; {'no writes' if a.no_writes else 'creates one project and one free contact-sheet job on the test account'}")

    conn = None
    fail_step = None
    credits_start = None
    project = job = None
    t_sheet = {}
    refused = {"bad story": "n/a", "other project": "n/a", "full render": "n/a"}
    try:
        # 0. no sign-in: a 401 that points at the metadata
        st, _, hdr = http("POST", f"{fn}/mcp", {}, want_headers=True)
        wa = next((v for k, v in hdr.items() if k.lower() == "www-authenticate"), "")
        must(st == 401 and f'resource_metadata="{fn}/.well-known/oauth-protected-resource"' in wa, "0  no sign-in: 401 with the resource_metadata pointer", f"status {st}")

        conn = Conn(url, key, acct["email"], acct["password"])
        conn.connect()
        say(True, "   a throwaway connection was made as the test account (register, sign in, approve, token); it is revoked at the end")

        # 1. whoami
        st, err, text, data = conn.tool("whoami_and_credits")
        must(st == 200 and not err and "You are acting as the Ryagram account" in text, "1  whoami_and_credits answers", f"status {st}")
        must(data.get("full_render_enabled") is False and "full render" in text.lower(), "1  says full renders from a connection are off (full_render_enabled false)")
        credits_start = (data.get("credits_available"), data.get("credits_held"))
        if live:
            must(credits_usable_at_start(data), "1  the test account has nothing held (its balance is recorded and must be the same at the end)", f"available {data.get('credits_available')}, held {data.get('credits_held')}")
        else:
            say(True, "1  credits on the proof test account (any balance; recorded for the end check)", f"available {data.get('credits_available')}, held {data.get('credits_held')}")
        label = re.search(r"account-label\">\s*(.*?)\s*</untrusted>", text, re.S)
        lab = (label.group(1) if label else "?")[:60]
        shown = lab[:3] + "..." + lab[lab.index("@"):] if "@" in lab[3:] else lab[:3] + "..."          # enough for Ryan to recognise the test account, not the whole address
        say(True, "1  the account label starts like this (is it the TEST account, not your own?)", shown)

        # 2. list_projects
        st, err, text, data = conn.tool("list_projects")
        must(st == 200 and not err, "2  list_projects answers", f"status {st}")

        # 4. the story rules and the example
        st, err, text, data = conn.tool("get_story_schema")
        example = data.get("example")
        must(st == 200 and not err and text.startswith("Engine rules:") and "Example story (valid):" in text and isinstance(example, dict), "4  get_story_schema: rules, catalog, a valid example")

        # 7. someone else's project is refused (creates nothing)
        st, err, text, data = conn.tool("make_contact_sheet", {"project_id": "00000000-0000-4000-8000-000000000001"})
        must(err and "was not found among your projects" in text, "7  MUST-FAIL ok: a project that is not the person's is refused, nothing queued", text[:70])
        refused["other project"] = "yes"

        if a.no_writes:
            say(None, "3, 3b, 5, 6, 8, 8b, 9, 10, 11, 12, 13 skipped (--no-writes)")
        else:
            # 3. create the project (and 3b the same title again)
            title = "Connector smoke " + time.strftime("%Y-%m-%d %H:%M")
            st, err, text, data = conn.tool("create_project", {"title": title})
            project = data.get("project_id")
            must(st == 200 and not err and bool(project) and data.get("created") is True, "3  create_project: a new project", f"status {st}")
            st, err, text2, data2 = conn.tool("create_project", {"title": title})
            must(not err and data2.get("project_id") == project and data2.get("created") is False, "3b the same title again returns the SAME project (idempotent)")

            # 5. MUST-FAIL: a bad story is refused
            bad = json.loads(json.dumps(example))
            clips = (bad.get("sequence") or {}).get("clips") or []
            target = next((c for c in clips if isinstance(c, dict) and "dataset" in json.dumps(c)), None)
            changed = False
            if target:
                def swap(o):
                    nonlocal changed
                    if isinstance(o, dict):
                        for k, v in o.items():
                            if k == "dataset" and isinstance(v, str):
                                o[k] = "not_a_dataset"; changed = True
                            else:
                                swap(v)
                    elif isinstance(o, list):
                        for v in o:
                            swap(v)
                swap(target)
            if not changed:                                        # the example has no data clip: break it another way
                bad = {"schema": 1, "engine": "sequence", "sequence": {"clips": [{"kind": "render", "dataset": "not_a_dataset"}]}}
            st, err, text, data = conn.tool("set_story", {"project_id": project, "story": bad})
            ok_bad = err and "The story was NOT saved." in text and data.get("saved") is False
            if not ok_bad and "Saved" in text:
                say(False, "5  INCIDENT: a bad story was SAVED (the checks are not running). Ryan: run 90_switch_off.sql.")
                raise Stop("incident")
            must(ok_bad, "5  MUST-FAIL ok: a story that breaks a rule is refused and not saved", text.split("\n")[0][:80])
            refused["bad story"] = "yes"

            # 6. the good story is saved
            st, err, text, data = conn.tool("set_story", {"project_id": project, "story": example})
            must(not err and "Saved as r" in text and data.get("saved") is True, "6  set_story saves the example story", text.split("\n")[0][:80])

            # 8. a free contact sheet (and 8b once only)
            t0 = time.time()
            st, err, text, data = conn.tool("make_contact_sheet", {"project_id": project})
            job = data.get("job_id") or (re.search(r"\(job ([0-9a-f-]{36})\)", text) or [None, None])[1]
            if not err and ("would cost" in text.lower()):
                say(False, "8  FINDING: the sheet 'would cost credits'; a connection never spends, nothing was started", text[:80])
                raise Stop("finding")
            must(not err and bool(job) and "It is free" in text, "8  make_contact_sheet queued a FREE job", text[:70])
            st, err, text2, data2 = conn.tool("make_contact_sheet", {"project_id": project})
            job2 = data2.get("job_id") or (re.search(r"\(job ([0-9a-f-]{36})\)", text2) or [None, None])[1]
            must(job2 == job and "already" in text2.lower(), "8b the same call again names the SAME job (never a second one)")

            # 9. follow the job
            if a.wait_minutes <= 0:
                say(None, "9  not followed (--wait-minutes 0); on a project with no render machine a job stays queued")
            else:
                last = None
                seen = []
                deadline = t0 + a.wait_minutes * 60
                finished = False
                while time.time() < deadline:
                    st, err, text, data = conn.tool("job_status", {"job_id": job})
                    line = text.strip().split("\n")[0][:80]
                    if line != last:
                        seen.append((int(time.time() - t0), line))
                        print(f"        +{int(time.time() - t0):4d}s  {line}", flush=True)
                        last = line
                    if "finished" in text.lower() and not err:
                        finished = True
                        break
                    if "failed" in text.lower() or "stopped because" in text.lower():
                        say(False, "9  the job did not finish", text[:160].replace("\n", " "))
                        raise Stop("job failed")
                    time.sleep(a.poll_seconds)
                t_sheet = {"total": int(time.time() - t0), "seen": seen}
                must(finished, "9  job_status followed the sheet to 'finished'", f"total {int(time.time() - t0)} s" if finished else f"still '{last}' after {a.wait_minutes:g} min: report it, do not resubmit")

                # 10. the result link (never printed)
                st, err, text, data = conn.tool("get_film_link", {"project_id": project})
                must(not err and re.search(r"https://\S+", text) is not None and "Nothing is finished yet" not in text, "10 get_film_link gives an https link (not printed here)")
            if a.wait_minutes <= 0:
                say(None, "10 get_film_link not run (the job was not followed to the end)")

            # 11. MUST-FAIL: no full render, ever
            st, err, text, data = conn.tool("request_full_render", {"project_id": project, "confirm": True})
            if not err:
                say(False, "11 INCIDENT: a full render was not refused. Ryan: run 90_switch_off.sql.")
                raise Stop("incident")
            must("A full render cannot be started from an AI connection" in text and "no credits were used" in text, "11 MUST-FAIL ok: a full render is refused, no credits used")
            refused["full render"] = "yes"

            # 12. optional preview
            if a.preview:
                st, err, text, data = conn.tool("make_preview", {"project_id": project, "start_seconds": 0, "end_seconds": 5})
                must(not err and "It is free" in text, "12 make_preview queued a FREE preview", text[:70])
            else:
                say(None, "12 preview not run (only if Ryan's yes included it: --preview)")

            # 13. the project is listed once
            st, err, text, data = conn.tool("list_projects")
            n = text.count(project) if project else 0
            must(n == 1, "13 list_projects lists the smoke project exactly once", f"{n}")

            # 14. nothing was spent and nothing is held: the same balance as at step 1
            st, err, text, data = conn.tool("whoami_and_credits")
            must(st == 200 and not err and credits_start is not None and credits_unchanged(credits_start, data), "14 credits are exactly what they were at step 1 (nothing spent, nothing held)",
                 f"start {credits_start}, now {data.get('credits_available')}/{data.get('credits_held')}")
    except Stop as e:
        fail_step = str(e)
    except Exception as e:                                   # noqa: BLE001
        say(False, f"the script stopped on an unexpected {type(e).__name__}")
        fail_step = type(e).__name__
    finally:
        if conn:
            conn.end()
            print("        the throwaway connection was revoked and removed")

    passed = fail_step is None
    when = time.strftime("%Y-%m-%d %H:%M")
    total = t_sheet.get("total")
    sheet = f"sheet job {job[:8] if job else '-'}: " + (f"total {total // 60}:{total % 60:02d}" if total is not None else "not followed")
    print(f"\nCONNECTOR SMOKE {when}: {'PASS' if passed else 'FAIL at ' + str(fail_step)} | account: test{f' ({credits_start[0]} credits at the start, the same at the end)' if (live and credits_start is not None and fail_step is None) else ''} | project {project or '-'} | {sheet} | "
          f"refused as designed: bad story {refused['bad story']}, other project {refused['other project']}, full render {refused['full render']} | "
          f"not run: {'preview, ' if not a.preview else ''}the connect_calls evidence (SQL Editor)")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
