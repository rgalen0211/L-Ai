"""Abuse and limits review against the PROOF project only (never live). Prints a results table; exit 0 only when every row is as designed.

    pgvenv/Scripts/python tools/connect_abuse_pass.py

Replayed codes, wrong verifiers, plain PKCE, redirect tricks, response_type=token, a client secret, expired access and refresh tokens, a consent revoked
mid-session, oversized bodies and stories, malformed and hostile input, the per-client call limit, the open-sign-in cap, and the per-caller limits on the
public endpoints. Writes to the proof project only (throwaway clients, grants, a project) and clears the public-endpoint counters before and after.
Prints no key, token, code or password.
"""
import base64
import concurrent.futures
import hashlib
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import psycopg  # noqa: E402
from connect_proof_pass import CALLBACK, DB, FN, KEY, URL, call, record, results, sign_in, whoami  # noqa: E402

PUBLIC_BUCKETS = "('register','authorize','token','revoke')"


def clear_counters():
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        c.execute(f"delete from public.connect_buckets where bucket in {PUBLIC_BUCKETS}")


def pkce():
    v = secrets.token_urlsafe(48)[:64]
    return v, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def authorize(client_id, redirect_uri=CALLBACK, challenge=None, method="S256", response_type="code", scope="read"):
    q = {"response_type": response_type, "client_id": client_id, "redirect_uri": redirect_uri, "state": "ab", "code_challenge": challenge or pkce()[1],
         "code_challenge_method": method, "scope": scope, "resource": f"{FN}/mcp"}
    try:
        with urllib.request.build_opener(NoRedirect).open(f"{FN}/authorize?{urllib.parse.urlencode(q)}", timeout=30) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Location", "")


def register(name="Abuse pass (throwaway)", uris=None):
    return call("POST", f"{FN}/register", {"client_name": name, "redirect_uris": uris or [CALLBACK], "token_endpoint_auth_method": "none"})


def request_id(loc):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(loc).query).get("request", [None])[0]


def token_call(**kw):
    return call("POST", f"{FN}/token", kw, form=True)


class Session:
    """A throwaway client with a live connection for the test account."""
    def __init__(self, scope="read write"):
        self.sess = sign_in()
        self.person = {"apikey": KEY, "Authorization": f"Bearer {self.sess['access_token']}"}
        st, reg = register()
        assert st == 201, f"register {st}"
        self.cid = reg["client_id"]
        self.verifier, self.challenge = pkce()
        st, loc = authorize(self.cid, challenge=self.challenge, scope=scope)
        self.rid = request_id(loc)
        assert self.rid, f"authorize {st} {loc[:60]}"
        st, dec = call("POST", f"{URL}/rest/v1/rpc/connect_consent_decide", {"p_request": self.rid, "p_approve": True, "p_scopes": scope.split()}, headers=self.person)
        assert st == 200, f"decide {st}"
        self.code = urllib.parse.parse_qs(urllib.parse.urlsplit(dec["redirect_to"]).query)["code"][0]

    def exchange(self, code=None, verifier=None, **extra):
        return token_call(grant_type="authorization_code", code=code or self.code, client_id=self.cid, redirect_uri=CALLBACK, code_verifier=verifier or self.verifier, **extra)

    def connect(self):
        st, t = self.exchange()
        assert st == 200, f"exchange {st}"
        self.t = t
        return t

    def refresh(self):
        return token_call(grant_type="refresh_token", refresh_token=self.t["refresh_token"], client_id=self.cid)

    def mcp(self, method="tools/call", params=None, token=None, raw=None, ctype="application/json"):
        body = raw if raw is not None else json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
        req = urllib.request.Request(f"{FN}/mcp", data=body, method="POST", headers={"Content-Type": ctype, "Authorization": f"Bearer {token or self.t['access_token']}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw_out = r.read()
                return r.status, (json.loads(raw_out) if raw_out else None)
        except urllib.error.HTTPError as e:
            raw_out = e.read()
            try:
                return e.code, json.loads(raw_out)
            except Exception:
                return e.code, None

    def tool(self, name, args=None, token=None):
        st, j = self.mcp("tools/call", {"name": name, "arguments": args or {}}, token=token)
        res = (j or {}).get("result") or {}
        text = " ".join(c.get("text", "") for c in res.get("content", []))
        return st, bool(res.get("isError")), text, (j or {})

    def disconnect(self):
        call("POST", f"{URL}/rest/v1/rpc/disconnect_ai", {"p_client_id": self.cid}, headers=self.person)


def sha(t):
    return hashlib.sha256(t.encode()).hexdigest()


def db(sql, *a):
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        cur = c.execute(sql, a)
        return cur.fetchall() if cur.description else []


def main():
    clear_counters()
    sessions = []
    try:
        # ---- A1 a replayed code revokes what it made
        s = Session(); sessions.append(s)
        t = s.connect()
        ok_before = whoami(t["access_token"]) == 200
        st2, again = s.exchange()
        after = whoami(t["access_token"])
        record("A1 a replayed authorization code is refused AND revokes the tokens it made", ok_before and st2 == 400 and (again or {}).get("error") == "invalid_grant" and after == 401,
               f"first_ok={ok_before} replay={st2} first_token_after_replay={after}")

        # ---- A2 a wrong PKCE verifier is refused and burns the code
        s = Session(); sessions.append(s)
        st_bad, bad = s.exchange(verifier=pkce()[0])
        st_good, _ = s.exchange()
        record("A2 a wrong code_verifier is refused and the code is burned (the right one no longer works)", st_bad == 400 and (bad or {}).get("error") == "invalid_grant" and st_good == 400, f"wrong={st_bad} right_after={st_good}")

        # ---- A3 plain PKCE, response_type=token, an unlisted or altered redirect, a client secret
        st, reg = register(); cid = reg["client_id"]
        st_plain, loc_plain = authorize(cid, method="plain")
        st_rt, loc_rt = authorize(cid, response_type="token")
        st_alt, loc_alt = authorize(cid, redirect_uri=CALLBACK + "/../evil")
        st_other, loc_other = authorize(cid, redirect_uri="https://evil.example/cb")
        refused = lambda stt, loc: not (stt == 302 and request_id(loc))
        record("A3 plain PKCE, response_type=token, an altered redirect and an unregistered redirect never start a sign-in",
               all(refused(a, b) for a, b in ((st_plain, loc_plain), (st_rt, loc_rt), (st_alt, loc_alt), (st_other, loc_other))),
               f"plain={st_plain} token={st_rt} altered={st_alt} other={st_other}")
        st_evil, _ = register("Evil (throwaway)", ["https://evil.example/cb"])
        st_http, _ = register("Http (throwaway)", ["http://claude.ai/api/mcp/auth_callback"])
        record("A3b registering a return address that is not on the allowlist (or is plain http) is refused", st_evil == 400 and st_http == 400, f"evil={st_evil} http={st_http}")
        s = Session(); sessions.append(s)
        st_sec, sec = s.exchange(client_secret="guess")
        record("A3c a client secret on the token request is refused (public clients only)", st_sec in (400, 401) and (sec or {}).get("error") in ("invalid_request", "invalid_client", "invalid_grant"), f"{st_sec} {(sec or {}).get('error')}")
        st_gt, gt = token_call(grant_type="password", username="x", password="y", client_id=s.cid)
        st_none, _ = token_call(client_id=s.cid)
        record("A3d unsupported or missing grant types are refused", st_gt == 400 and st_none == 400, f"password_grant={st_gt} missing_grant_type={st_none}")

        # ---- A6 expired access token (refresh recovers), A7 expired refresh token
        s = Session(); sessions.append(s); t = s.connect()
        db("update public.connect_tokens set access_expires_at = now() - interval '1 second' where access_hash = %s", sha(t["access_token"]))
        st_exp = whoami(t["access_token"])
        st_r, t2 = s.refresh()
        st_ok = whoami(t2["access_token"]) if st_r == 200 else None
        record("A6 an expired access token is refused (401) and a refresh recovers the connection", st_exp == 401 and st_r == 200 and st_ok == 200, f"expired={st_exp} refresh={st_r} then={st_ok}")
        s.t = t2
        db("update public.connect_tokens set refresh_expires_at = now() - interval '1 second' where refresh_hash = %s", sha(t2["refresh_token"]))
        st_r2, r2 = s.refresh()
        record("A7 an expired refresh token is refused (invalid_grant): the person must sign in again", st_r2 == 400 and (r2 or {}).get("error") == "invalid_grant", f"{st_r2} {(r2 or {}).get('error')}")

        # ---- A8 consent revoked mid-session
        s = Session(); sessions.append(s); t = s.connect()
        before = whoami(t["access_token"])
        s.disconnect()
        after = whoami(t["access_token"])
        st_rf, rf = s.refresh()
        record("A8 consent revoked mid-session: the next call is 401 and a refresh is refused", before == 200 and after == 401 and st_rf == 400, f"before={before} after={after} refresh={st_rf}")

        # ---- A9 oversized inputs
        s = Session("read write"); sessions.append(s); s.connect()
        st_big, _ = s.mcp(raw=b'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami_and_credits","arguments":{"x":"' + b"a" * 400_000 + b'"}}}')
        st_proj, pr, ptext, _ = s.tool("create_project", {"title": "a" * 121})
        st_story, story_err, stext, _ = s.tool("create_project", {"title": "Abuse pass " + secrets.token_hex(3)})
        pid = None
        m = __import__("re").search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", stext)
        pid = m.group(0) if m else None
        st_big_story, big_err, big_text, _ = s.tool("set_story", {"project_id": pid, "story": {"schema": 1, "notes": "x" * 280_000}}) if pid else (0, False, "", {})
        record("A9 a 400 KB request is refused (413); a 121-character title is refused; a 280 KB story is not saved",
               st_big == 413 and pr and big_err, f"body={st_big} long_title_refused={pr} big_story_refused={big_err} ({big_text[:60]!r})")

        # ---- A10 malformed and hostile input
        st_json, j1 = s.mcp(raw=b"{not json")
        st_batch, j2 = s.mcp(raw=b'[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]')
        st_m, j3 = s.mcp("no/such/method")
        st_ut, ut_err, ut_text, _ = s.tool("drop_all_tables")
        st_arg, arg_err, arg_text, _ = s.tool("list_projects", {"unexpected": True})
        st_uuid, uuid_err, uuid_text, _ = s.tool("job_status", {"job_id": "not-a-uuid"})
        evil_title = "x'); drop table public.projects; -- <script>alert(1)</script>"
        st_inj, inj_err, inj_text, _ = s.tool("create_project", {"title": evil_title})
        listed_ok = whoami(s.t["access_token"]) == 200
        tables_ok = db("select to_regclass('public.projects') is not null")[0][0]
        record("A10 malformed JSON, a batch, an unknown method, an unknown tool, a stray argument and a bad uuid are refused in words; hostile text is stored as text and nothing breaks",
               "error" in (j1 or {}) and "error" in (j2 or {}) and "error" in (j3 or {}) and ut_err and arg_err and uuid_err and not inj_err and tables_ok and listed_ok,
               f"json={st_json} batch={st_batch} method={st_m} tool_refused={ut_err} extra_arg_refused={arg_err} bad_uuid_refused={uuid_err} hostile_title_ok={not inj_err} projects_table_exists={tables_ok}")
        if not inj_err:
            try:
                db("delete from public.projects where title = %s", evil_title)
            except Exception:
                pass                                    # the project keeps its versions; harmless test data on the proof project

        # ---- A11 the per-client call limit (60 a minute)
        s2 = Session(); sessions.append(s2); s2.connect()
        # the call limit uses fixed one-minute windows aligned to the clock, so a burst that straddles a minute boundary may legitimately pass up to twice the limit;
        # start just after a boundary so the whole burst lands in one window
        wait = 61 - (time.time() % 60)
        if wait < 40 and (time.time() % 60) > 25:
            time.sleep(wait)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            outs = list(ex.map(lambda _: s2.tool("whoami_and_credits"), range(75)))
        limited = sum(1 for st, err, text, j in outs if err and "Too many calls" in text)
        passed_n = sum(1 for st, err, text, j in outs if not err)
        record("A11 the per-connection limit: of 75 rapid calls at most 60 pass and the rest are refused in words ('Too many calls')", limited >= 10 and 50 <= passed_n <= 60, f"passed={passed_n} limited={limited} (fixed one-minute windows: a burst across a boundary can pass up to 120)")

        # ---- A12 the open sign-in cap per assistant (20) and the public-endpoint limits
        clear_counters()
        st, reg = register(); cid = reg["client_id"]
        codes = [authorize(cid)[0] for _ in range(24)]
        capped = [c for c in codes if c in (400, 429, 503)]
        record("A12 the 21st waiting sign-in for one assistant is refused (cap 20)", codes[:20].count(302) == 20 and len(capped) >= 1, f"first20_redirects={codes[:20].count(302)} later={codes[20:]}")
        clear_counters()
        outs = [token_call(grant_type="authorization_code", code="x" * 43, client_id="rgc_nobody", redirect_uri=CALLBACK, code_verifier="y" * 43)[0] for _ in range(66)]
        record("A13 the public /token endpoint limits one caller (60 in 10 minutes): the 61st bad request gets 429", outs[:60].count(429) == 0 and outs[60:].count(429) >= 1, f"first60_429={outs[:60].count(429)} after={outs[60:]}")
        clear_counters()
        regs = [register(f"Burst {i} (throwaway)")[0] for i in range(12)]
        record("A14 registration limits one caller (10 an hour): the 11th registration gets 429", regs[:10].count(429) == 0 and 429 in regs[10:], f"first10_201={regs[:10].count(201)} after={regs[10:]}")
    finally:
        for s in sessions:
            try:
                s.disconnect()
            except Exception:
                pass
        clear_counters()
        # remove this pass's test project rows so the proof account does not accumulate them
        try:
            db("delete from public.projects where title like 'Abuse pass %'")
        except Exception:
            pass

    bad = [r for r in results if not r[1]]
    print(f"\n{len(results)} rows, {len(results) - len(bad)} as designed, {len(bad)} NOT")
    print("ABUSE PASS: " + ("PASS" if not bad else "FAIL"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
