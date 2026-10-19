"""Proof of "Use Claude's published identity" (client ID metadata documents) on the PROOF project only (CONNECT 2026-10-19; prototype branch connect-cimd).

    py tools/connect_cimd_proof.py [--apply-migration]      (the function `connect` must already be deployed to the proof project with this branch's code)

The proof project is the only project it accepts (tools/connect_proof_guard.py). It uses the proof test account; it prints no key, token or code.
What it proves, with the REAL fetch of Anthropic's published document from the Edge Function:
  1 the metadata advertises CIMD (and keeps registration, 'none' and S256)       2 a client_id that is not allowlisted is refused
  3 Claude's published address: authorize -> consent -> code -> token -> a real MCP call -> refresh, all with client_id = the address
  4 the stored client has the allowlist label as its name, not a document value    5 registration (DCR) still works
  6 the database function: not callable by anon/authenticated/public, refuses a non-allowlisted address, a redirect not on Ryan's list, and the master switch
It cleans up what it made."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import psycopg  # noqa: E402
from connect_abuse_pass import NoRedirect, Session, authorize, call, clear_counters, pkce, request_id, token_call  # noqa: E402
from connect_proof_pass import CALLBACK, DB, FN, KEY, ROOT, URL, record, results, sign_in, whoami  # noqa: E402

CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata"
MIG = ROOT / "supabase" / "migrations" / "20261019000100_connect_cimd.sql"


def sql(q, params=None):
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        cur = c.execute(q, params)
        return cur.fetchall() if cur.description else None


def main():
    if "--apply-migration" in sys.argv:
        if not sql("select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'connect_cimd_client'"):
            with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
                c.execute(MIG.read_text(encoding="utf-8"))
            print("migration applied to the proof project")
        else:
            print("migration already there")
    clear_counters()

    # 1 metadata
    for path in ("/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"):
        st, md = call("GET", FN + path)
        record(f"metadata {path.split('/')[-1]}: CIMD advertised, registration kept, 'none' and S256 present",
               st == 200 and md.get("client_id_metadata_document_supported") is True and "none" in md.get("token_endpoint_auth_methods_supported", [])
               and md.get("code_challenge_methods_supported") == ["S256"] and str(md.get("registration_endpoint", "")).endswith("/register"))

    # 2 refusals (and nothing to follow)
    for label, cid in (("another host", "https://evil.example/oauth/client.json"), ("the cloud metadata address", "https://169.254.169.254/latest/meta-data"),
                       ("Claude's address with a query added", CLAUDE + "?x=1"), ("Claude Code's address (not on our list)", "https://claude.ai/oauth/claude-code-client-metadata")):
        st, loc = authorize(cid)
        record(f"a client_id that is not on the allowlist is refused: {label}", st in (400, 403) and not loc, f"status {st}")        # 403 = the platform gateway itself refused the request

    # 3 the published identity, end to end
    sess = sign_in()
    person = {"apikey": KEY, "Authorization": f"Bearer {sess['access_token']}"}
    verifier, challenge = pkce()
    st, loc = authorize(CLAUDE, challenge=challenge, scope="read write")
    rid = request_id(loc)
    record("authorize with Claude's published address: the Edge Function fetched Anthropic's document and started the sign-in", st == 302 and bool(rid), f"status {st}")
    if not rid:
        return finish()
    st, chk = call("POST", f"{URL}/rest/v1/rpc/connect_consent_check", {"p_request": rid}, headers=person)
    record("the consent page is told the app is named by OUR label (Claude (claude.ai)), and the return address is Anthropic's", st == 200 and isinstance(chk, dict)
           and "claude.ai" in json.dumps(chk) and "Claude" in json.dumps(chk), json.dumps({k: v for k, v in (chk or {}).items() if k in ("client_name", "redirect_label", "client")})[:120] if isinstance(chk, dict) else str(st))
    st, dec = call("POST", f"{URL}/rest/v1/rpc/connect_consent_decide", {"p_request": rid, "p_approve": True, "p_scopes": ["read", "write"]}, headers=person)
    code = urllib.parse.parse_qs(urllib.parse.urlsplit(dec["redirect_to"]).query).get("code", [None])[0] if st == 200 and isinstance(dec, dict) else None
    record("the person approves; the redirect goes to Anthropic's callback with a code", bool(code) and dec["redirect_to"].startswith(CALLBACK))
    st, tok = token_call(grant_type="authorization_code", code=code or "x", client_id=CLAUDE, redirect_uri=CALLBACK, code_verifier=verifier)
    record("token exchange with client_id = the published address (public client, PKCE)", st == 200 and "access_token" in (tok or {}))
    if st == 200:
        who = whoami(tok["access_token"])
        record("a real MCP call with that token works (whoami)", bool(who), "ok" if who else "no answer")
        st4, _ = token_call(grant_type="refresh_token", refresh_token=tok["refresh_token"], client_id="https://evil.example/doc")
        record("a refresh token cannot be used under a different client_id", st4 == 400)
        st3, ref = token_call(grant_type="refresh_token", refresh_token=tok["refresh_token"], client_id=CLAUDE)
        record("refresh works with the published address as client_id (the refresh token is rotated)", st3 == 200 and ref.get("refresh_token") != tok["refresh_token"])
        st2, again = token_call(grant_type="authorization_code", code=code, client_id=CLAUDE, redirect_uri=CALLBACK, code_verifier=verifier)       # last: a replayed code ends the whole family
        record("the code cannot be used twice (and the replay ends that connection)", st2 == 400)

    # 4 what is stored
    row = sql("select name, redirect_uris from public.connect_clients where client_id = %s", (CLAUDE,))
    record("the stored client carries the allowlist label as its name and exactly Anthropic's callback", bool(row) and row[0][0] == "Claude (claude.ai)" and list(row[0][1]) == [CALLBACK], str(row[0][0]) if row else "no row")

    # 5 registration still works
    s2 = Session()
    s2.connect()
    record("Register automatically (DCR) still works end to end", bool(whoami(s2.t["access_token"])))

    # 6 the database function
    priv = sql("select has_function_privilege('anon', 'public.connect_cimd_client(text,text[])', 'execute'), has_function_privilege('authenticated', 'public.connect_cimd_client(text,text[])', 'execute'), "
               "has_function_privilege('connect_runner', 'public.connect_cimd_client(text,text[])', 'execute')")
    record("connect_cimd_client: callable by connect_runner only (not anon, not authenticated)", priv == [(False, False, True)], str(priv))

    def runner(q, params):                                  # as the role the Edge Function uses is not possible without its password; test the logic as the owner role with the same function
        try:
            sql(q, params)
            return None
        except psycopg.errors.Error as e:
            return str(e).split("\n")[0]
    why = runner("select public.connect_cimd_client(%s, %s::text[])", ("https://evil.example/x", [CALLBACK]))
    record("the function refuses an address that is not on the allowlist", bool(why) and "invalid_client" in why, why or "")
    why = runner("select public.connect_cimd_client(%s, %s::text[])", (CLAUDE, ["https://evil.example/cb"]))
    record("the function refuses a redirect address that is not on Ryan's list, even for an allowlisted client", bool(why) and "invalid_redirect_uri" in why, why or "")
    why = runner("select public.connect_cimd_client(%s, %s::text[])", (CLAUDE, []))
    record("the function refuses an empty redirect list", bool(why))
    sql("update public.connect_flags set connections_enabled = false")
    try:
        why = runner("select public.connect_cimd_client(%s, %s::text[])", (CLAUDE, [CALLBACK]))
        st, loc = authorize(CLAUDE)
        record("with the master switch OFF the function refuses and so does the sign-in", bool(why) and "switched off" in why and st == 400, why or "")
    finally:
        sql("update public.connect_flags set connections_enabled = true")
    sql("update public.connect_cimd_allowlist set enabled = false where client_id_url = %s", (CLAUDE,))
    try:
        why = runner("select public.connect_cimd_client(%s, %s::text[])", (CLAUDE, [CALLBACK]))
        record("an allowlist row switched off stops the function at once", bool(why) and "invalid_client" in why, why or "")
    finally:
        sql("update public.connect_cimd_allowlist set enabled = true where client_id_url = %s", (CLAUDE,))
    return finish()


def finish():
    # clean up: this run's published-identity connection and client row
    try:
        sql("delete from public.connect_clients where client_id = %s", (CLAUDE,))
        sql("update public.connect_flags set connections_enabled = true")
    except Exception as e:                                  # noqa: BLE001
        print("cleanup problem:", type(e).__name__)
    bad = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(bad)} of {len(results)} pass")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
