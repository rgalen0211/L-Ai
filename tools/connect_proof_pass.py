"""Full connector test pass against the PROOF project only (never live). Prints one results table; exit 0 only when every row passes.

    pgvenv/Scripts/python tools/connect_proof_pass.py [--abuse] [--page-python <python with playwright> --page-tree <WEB consent tree>]

Rows: (1) drift: the proof database holds exactly the function bodies the repo's connect migration defines (read-only); (2) discovery with the MCP SDK;
(3) the real MCP client end to end (register, consent, token, every tool, request_full_render refused, revoke); (4) token lifetimes: refresh, rotation,
the one-retry grace, the sliding 30 days; (5) [optional] the hosted consent page in real Chrome; (6) an administrator is refused at consent (a rolled-back
transaction: nothing is left behind); (7) the master switch kills sessions at once and brings them back (flipped for about two seconds, restored in a
finally). Reads D:/Ryagram-scratch/oauth-proof/.env and connect-test-account.json. Prints no key, token, code or password. Refuses the live project.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
ENV = "D:/Ryagram-scratch/oauth-proof/.env"
ACCT = "D:/Ryagram-scratch/oauth-proof/connect-test-account.json"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
MIG = ROOT / "supabase" / "migrations" / "20261018000100_connect_ai.sql"

env = {}
for line in open(ENV, encoding="utf-8").read().splitlines():
    m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
    if m:
        env[m.group(1)] = m.group(2).strip("\"'")
URL = env["SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_PUBLISHABLE_KEY"]
DB = env["SUPABASE_DB_URL"]
if "jxtkfishqfxuptwjzczz" in URL or "jxtkfishqfxuptwjzczz" in DB:
    sys.exit("REFUSED: live project")
FN = f"{URL}/functions/v1/connect"
acct = json.load(open(ACCT))
results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS  " if ok else "FAIL  ") + name + (f"   [{detail}]" if detail else ""), flush=True)


def call(method, url, body=None, headers=None, form=False):
    h = dict(headers or {})
    data = None
    if body is not None:
        data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
        h.setdefault("Content-Type", "application/x-www-form-urlencoded" if form else "application/json")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h), timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def run_script(label, argv, cwd, ok_marker, timeout=1500):
    r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "") + (r.stderr or "")
    out = re.sub(r"(eyJ|sb_)[A-Za-z0-9._-]{12,}", "<redacted>", out)
    passed = len(re.findall(r"^(?:  ok   |PASS  )", out, flags=re.M))
    failed = [l.strip()[:120] for l in out.splitlines() if re.match(r"^(?:  FAIL |FAIL  )", l)]
    ok = r.returncode == 0 and ok_marker in out and not failed
    record(label, ok, f"{passed} checks passed" + (f"; failed: {failed[:2]}" if failed else ""))


# ------------------------------------------------------------------------------------------------ 1. drift (read-only)
def drift():
    src = MIG.read_text(encoding="utf-8").replace("\r\n", "\n")
    funcs = {}
    for m in re.finditer(r"^create (?:or replace )?function ([a-z_]+)\.([a-z_0-9]+)\((.*?)\)\s*(?:returns .*?)?\n?(?:language [a-z]+[^\n]*?)?(?:\s+(?:stable|volatile|security definer|set search_path = ''))*\s*as \$\$(.*?)\$\$;?",
                         src, flags=re.S | re.M):
        funcs[(m.group(1), m.group(2))] = " ".join(m.group(4).split())
    diff, missing = [], []
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        c.execute("set default_transaction_read_only = on")
        for (sch, name), body in funcs.items():
            rows = c.execute("select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = %s and p.proname = %s", (sch, name)).fetchall()
            if not rows:
                missing.append(f"{sch}.{name}")
            elif " ".join(rows[0][0].split()) != body:
                diff.append(f"{sch}.{name}")
    record("1 drift: the proof database holds the repo's function bodies", len(funcs) >= 40 and not diff and not missing,
           f"{len(funcs)} functions; different: {diff or 'none'}; missing: {missing or 'none'}")


# ------------------------------------------------------------------------------------------------ helpers for 6 and 7
def sign_in():
    st, sess = call("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": acct["email"], "password": acct["password"]}, headers={"apikey": KEY})
    assert st == 200, f"sign-in {st}"
    return sess


def new_request(name):
    st, reg = call("POST", f"{FN}/register", {"client_name": name, "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"})
    assert st == 201, f"register {st}"
    verifier = secrets.token_urlsafe(48)[:64]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = urllib.parse.urlencode({"response_type": "code", "client_id": reg["client_id"], "redirect_uri": CALLBACK, "state": "pp", "code_challenge": challenge,
                                "code_challenge_method": "S256", "scope": "read", "resource": f"{FN}/mcp"})
    try:
        urllib.request.build_opener(NoRedirect).open(f"{FN}/authorize?{q}", timeout=30)
        loc = ""
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location", "")
    rid = urllib.parse.parse_qs(urllib.parse.urlsplit(loc).query)["request"][0]
    return reg["client_id"], rid, verifier


def whoami(token):
    st, _ = call("POST", f"{FN}/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami_and_credits", "arguments": {}}},
                 headers={"Authorization": f"Bearer {token}"})
    return st


# ------------------------------------------------------------------------------------------------ 6. an administrator is refused at consent
def admin_refused():
    sess = sign_in()
    uid = sess["user"]["id"]
    cid, rid, _ = new_request("Pass: admin refusal (throwaway)")
    claims = json.dumps({"sub": uid, "role": "authenticated"})
    refused_decide = False
    with psycopg.connect(DB, prepare_threshold=None) as c:                       # one transaction, ALWAYS rolled back
        try:
            c.execute("insert into public.app_admins (user_id, note) values (%s, 'connect proof pass (rolled back)')", (uid,))
            c.execute("set local role authenticated")
            c.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))
            chk = c.execute("select public.connect_consent_check(%s)", (rid,)).fetchone()[0]
            try:
                c.execute("savepoint s")
                c.execute("select public.connect_consent_decide(%s, true, array['read'])", (rid,))
            except psycopg.Error as e:
                refused_decide = True
                c.execute("rollback to savepoint s")
        finally:
            c.rollback()
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        left = c.execute("select count(*) from public.app_admins where note like 'connect proof pass%%'").fetchone()[0]
    ok = (chk.get("allowed") is False and "dministrator" in (chk.get("reason") or "") and refused_decide and left == 0)
    record("6 an administrator is refused at consent (check says not allowed, decide raises; rolled back, 0 rows left)", ok,
           f"allowed={chk.get('allowed')} reason={(chk.get('reason') or '')[:70]!r} decide_refused={refused_decide} admin_rows_left={left}")


# ------------------------------------------------------------------------------------------------ 7. the master switch kills sessions and restores them
def switch_off():
    sess = sign_in()
    person = {"apikey": KEY, "Authorization": f"Bearer {sess['access_token']}"}
    cid, rid, verifier = new_request("Pass: switch-off (throwaway)")
    st, dec = call("POST", f"{URL}/rest/v1/rpc/connect_consent_decide", {"p_request": rid, "p_approve": True, "p_scopes": ["read"]}, headers=person)
    code = urllib.parse.parse_qs(urllib.parse.urlsplit(dec["redirect_to"]).query)["code"][0]
    st, t = call("POST", f"{FN}/token", {"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": CALLBACK, "code_verifier": verifier}, form=True)
    assert st == 200, f"token {st}"
    before = whoami(t["access_token"])
    off = reg_off = refresh_off = None
    try:
        with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
            c.execute("update public.connect_flags set connections_enabled = false where id")
            try:
                off = whoami(t["access_token"])
                st1, _ = call("POST", f"{FN}/token", {"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid}, form=True)
                refresh_off = st1
                st2, _ = call("POST", f"{FN}/register", {"client_name": "Pass: while off", "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"})
                reg_off = st2
            finally:
                c.execute("update public.connect_flags set connections_enabled = true where id")
        time.sleep(1)
        after = whoami(t["access_token"])
        st3, t2 = call("POST", f"{FN}/token", {"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid}, form=True)
    finally:
        with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
            c.execute("update public.connect_flags set connections_enabled = true where id")
            on = c.execute("select connections_enabled from public.connect_flags where id").fetchone()[0]
    call("POST", f"{URL}/rest/v1/rpc/disconnect_ai", {"p_client_id": cid}, headers=person)
    ok = before == 200 and off in (401, 403, 503) and refresh_off in (400, 401, 403, 503) and reg_off in (400, 401, 403, 503) and after == 200 and st3 == 200 and on is True
    record("7 switch off: the live session is refused at once, refresh and registration too; switch on: the same session works again (tokens kept)", ok,
           f"before={before} while_off: tool={off} refresh={refresh_off} register={reg_off}; after={after} refresh_after={st3} switch_restored={on}")


def reset_register_counter():
    """The proof project limits /register to 10 an hour per caller; the page check alone registers about 8. Clear ONLY that counter (test bookkeeping, proof only)."""
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        c.execute("delete from public.connect_buckets where bucket = 'register'")


def main():
    args = sys.argv[1:]
    py_page = args[args.index("--page-python") + 1] if "--page-python" in args else None
    tree = args[args.index("--page-tree") + 1] if "--page-tree" in args else None
    t0 = time.time()
    drift()
    reset_register_counter()
    run_script("2 discovery with the MCP SDK (every candidate address, one GET each)", ["node", "tools/connect_discovery_proof.mjs"], ROOT, "DISCOVERY OK")
    run_script("3 the real MCP client end to end (register, consent, token, every tool, full render refused, revoke)", ["node", "tools/connect_e2e.mjs"], ROOT, "ALL PASS")
    run_script("4 token lifetimes: refresh, rotation, ONE retry grace, sliding 30 days", [sys.executable, "tools/connect_refresh_proof.py"], ROOT, "RESULT: PASS")
    reset_register_counter()
    if py_page and tree:
        run_script("5 the hosted consent page in real Chrome (desktop and phone)", [py_page, "tools/connect_hosted_page_check.py", tree], ROOT, "RESULT: PASS")
    reset_register_counter()
    admin_refused()
    switch_off()
    if "--abuse" in args:
        run_script("8 abuse and limits (replays, expiry, revoked consent, oversize, hostile input, rate limits)", [sys.executable, "tools/connect_abuse_pass.py"], ROOT, "ABUSE PASS: PASS")
    bad = [r for r in results if not r[1]]
    print(f"\n{len(results)} rows, {len(results) - len(bad)} pass, {len(bad)} fail, {time.time() - t0:.0f} s")
    print("PROOF PASS: PASS" if not bad else "PROOF PASS: FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
