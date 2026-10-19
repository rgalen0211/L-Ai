"""End-to-end check of the connect SQL on the NON-LIVE project, before any function is deployed.

    pgvenv/Scripts/python tools/connect_stage_smoke.py

Uses the proof project's own database login to act AS connect_runner (it temporarily grants itself that role and takes it back), the
fresh test account for the consent step (through the project's REST API, as a signed-in person), and prints only results.
Refuses the live project. Never prints a key, token, code or password.
"""
import base64
import hashlib
import json
import re
import secrets
import sys
import urllib.request
from pathlib import Path

import psycopg

ENV = Path(r"D:\Ryagram-scratch\oauth-proof\.env")
ACCT = Path(r"D:\Ryagram-scratch\oauth-proof\connect-test-account.json")
URI = "https://claude.ai/api/mcp/auth_callback"


def env():
    e = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            e[m.group(1)] = m.group(2).strip("\"'")
    return e


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def rest(e, method, path, body=None, token=None):
    req = urllib.request.Request(e["SUPABASE_URL"].rstrip("/") + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": e["SUPABASE_PUBLISHABLE_KEY"], "Authorization": "Bearer " + (token or e["SUPABASE_PUBLISHABLE_KEY"]),
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def main():
    e = env()
    if "jxtkfishqfxuptwjzczz" in e.get("SUPABASE_URL", "") + e.get("SUPABASE_DB_URL", ""):
        print("REFUSED: live project")
        return 3
    acct = json.loads(ACCT.read_text())
    ok = True

    def check(name, cond, extra=""):
        nonlocal ok
        print(("PASS  " if cond else "FAIL  ") + name + (f"  [{extra}]" if extra and not cond else ""))
        ok &= bool(cond)

    with psycopg.connect(e["SUPABASE_DB_URL"], autocommit=True, connect_timeout=15) as c:
        c.execute("grant connect_runner to postgres")
        try:
            def run_as_runner(sql, *args):
                c.execute("set role connect_runner")
                try:
                    return c.execute(sql, args).fetchone()
                finally:
                    c.execute("reset role")

            def denied(sql, *args):
                try:
                    run_as_runner(sql, *args)
                except psycopg.Error as err:
                    c.execute("reset role")
                    return str(err).splitlines()[0][:80]
                return None

            # 1. register + begin as the runner
            client = run_as_runner("select public.connect_register_client('Smoke test client', array[%s])", URI)[0]
            verifier = secrets.token_urlsafe(48)[:64]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            req = run_as_runner("select public.connect_begin_authorization(%s,%s,'st',%s,'S256','read write render_free',null)", client, URI, challenge)[0]
            req = str(req)
            check("register and begin authorization work as connect_runner", bool(client and req))

            # 2. consent as the signed-in test person, through the real REST API
            st, tok = rest(e, "POST", "/auth/v1/token?grant_type=password", {"email": acct["email"], "password": acct["password"]})
            check("the test account can sign in", st == 200)
            jwt = tok["access_token"]
            st, chk = rest(e, "POST", "/rest/v1/rpc/connect_consent_check", {"p_request": req}, jwt)
            check("consent check allows the invited test account", st == 200 and chk.get("allowed") is True, f"{st} {str(chk)[:120]}")
            check("consent page data: host, scopes, no credit scopes", chk.get("redirect_host") == "claude.ai" and chk.get("credit_scopes") == [] and "render_final" not in chk.get("offered_scopes", []))
            st, dec = rest(e, "POST", "/rest/v1/rpc/connect_consent_decide", {"p_request": req, "p_approve": True, "p_scopes": ["read", "write", "render_free"]}, jwt)
            to = (dec or {}).get("redirect_to", "") if st == 200 else ""
            check("consent decide returns the redirect with a code and state, starting with the shown address", to.startswith(URI + "?code=") and to.endswith("&state=st"), str(st))
            st2, again = rest(e, "POST", "/rest/v1/rpc/connect_consent_decide", {"p_request": req, "p_approve": True, "p_scopes": ["read"]}, jwt)
            check("a request cannot be decided twice", st2 >= 400)
            st3, _ = rest(e, "POST", "/rest/v1/rpc/connect_whoami", {"p_token_hash": "0" * 64}, jwt)
            check("an app session cannot call the tool functions over REST", st3 in (401, 403, 404))
            st4, _ = rest(e, "POST", "/rest/v1/rpc/connect_exchange_code", {"p_code_hash": "0" * 64, "p_client_id": client, "p_redirect_uri": URI, "p_verifier": verifier, "p_access_hash": "1" * 64, "p_refresh_hash": "2" * 64}, jwt)
            check("an app session cannot call the authorization-server functions over REST", st4 in (401, 403, 404))
            st5, _ = rest(e, "POST", "/rest/v1/rpc/connect_exchange_code", {"p_code_hash": "0" * 64}, None)
            check("anonymous cannot either", st5 in (401, 403, 404))

            # 3. exchange the code, then use the tools
            code = to.split("code=")[1].split("&")[0]
            access, refresh = "rga_" + secrets.token_urlsafe(32), "rgr_" + secrets.token_urlsafe(32)
            # a wrong verifier burns the code it was tried on (OAuth 2.1), so it is tried on a code of its own
            req2 = str(run_as_runner("select public.connect_begin_authorization(%s,%s,'st',%s,'S256','read write render_free',null)", client, URI, challenge)[0])
            _, d2 = rest(e, "POST", "/rest/v1/rpc/connect_consent_decide", {"p_request": req2, "p_approve": True, "p_scopes": ["read", "write", "render_free"]}, jwt)
            code2 = d2["redirect_to"].split("code=")[1].split("&")[0]
            wrong = run_as_runner("select public.connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code2), client, URI, "x" * 43, h(access), h(refresh))[0]
            check("a wrong PKCE verifier is refused", wrong == {"error": "invalid_grant"})
            again = run_as_runner("select public.connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code2), client, URI, verifier, h(access), h(refresh))[0]
            check("and the code it was tried on is spent", again == {"error": "invalid_grant"})
            tokens = run_as_runner("select public.connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, verifier, h(access), h(refresh))[0]
            check("the right verifier gives tokens with the granted scopes", tokens.get("scope") == "read write render_free", str(tokens)[:80])
            A = h(access)
            who = run_as_runner("select public.connect_whoami(%s)", A)[0]
            check("whoami names the test account", who["label"] == acct["email"])
            title = "Smoke test film " + secrets.token_hex(3)
            proj = run_as_runner("select public.connect_create_project(%s, %s)", A, title)[0]
            again = run_as_runner("select public.connect_create_project(%s, %s)", A, title)[0]
            check("create_project is idempotent", proj["created"] and not again["created"] and proj["id"] == again["id"])
            ver = run_as_runner("select public.connect_current_version(%s, %s)", A, proj["id"])[0]
            story = {"schema": 1, "engine": "sequence", "name": "smoke", "sequence": {"clips": []}}
            sha = run_as_runner("select public.connect_save_story(%s, %s, %s::jsonb)", A, ver, json.dumps(story))[0]
            check("save_story stores the story", bool(re.fullmatch("[0-9a-f]{64}", sha or "")))
            q = run_as_runner("select public.connect_quote(%s, %s, 'preview')", A, ver)[0]
            check("quote comes from the real credits ledger", "credits" in q and "available" in q, str(q))
            job = run_as_runner("select public.connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", A, ver)[0]
            check("a contact sheet job is queued (nothing will render it here: no worker)", job["state"] == "queued")
            info = run_as_runner("select public.connect_job(%s, %s)", A, job["id"])[0]
            check("job status shows queued with a queue position", info["state"] == "queued" and isinstance(info["queue_position"], int) and info["queue_position"] >= 1)
            msg = denied("select public.connect_submit_job(%s, %s, 'final_render', '{}'::jsonb, gen_random_uuid(), gen_random_uuid())", A, ver)
            check("a full render cannot be started (refused: this token has no render_final scope; with every switch on it is refused too, proved locally)", msg is not None)

            # 4. the boundary on the real project
            check("connect_runner cannot read a table", denied("select * from public.projects") is not None)
            check("connect_runner cannot read the token table", denied("select * from public.connect_tokens") is not None)
            check("connect_runner cannot call submit_job directly", denied("select public.submit_job(gen_random_uuid(), 'preview')") is not None)
            check("connect_runner cannot reach the private schema", denied("select ryagram_private.connect_actor(%s, null)", A) is not None)
            check("connect_runner cannot call a platform function", denied("select storage.foldername('a/b')") is not None and denied("select auth.uid()") is not None)
            check("connect_runner cannot forge claims and reach an app function", denied("select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\"}', false), (select count(*) from public.projects)") is not None)

            # 5. revocation is effective on the very next call
            run_as_runner("select public.connect_revoke(%s)", h(refresh))
            check("a revoked token is refused at once", denied("select public.connect_whoami(%s)", A) is not None)
            st, _ = rest(e, "POST", "/rest/v1/rpc/disconnect_ai", {"p_client_id": client}, jwt)
            check("disconnect_ai works for the person", st in (200, 204))
        finally:
            c.execute("reset role")
            c.execute("revoke connect_runner from postgres")
    print("\nALL PASS" if ok else "\nSOMETHING FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
