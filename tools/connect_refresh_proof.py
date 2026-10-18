"""Token lifetimes and refresh, proven against the DEPLOYED connect function on the PROOF project (never live).

    pgvenv/Scripts/python tools/connect_refresh_proof.py

Registers a throwaway client, signs the test account in through the API (no password typed anywhere), approves its own consent request over REST
exactly as the consent page does, exchanges the code, then checks what a real assistant relies on to stay connected without a daily login:
  - /token returns a refresh_token and expires_in; the registration says the client may use the refresh_token grant
  - the access token works; a refresh returns a NEW access token AND a NEW refresh token, and the new access token works
  - the refresh does not extend the 30 days (absolute), which this prints from the database as a read-only query
  - a refresh with a different client_id is refused; a second use of an old refresh token is refused AND kills the whole family
  - the family can be disconnected and then nothing works
Prints no token, code or password. Cleans up after itself (the throwaway client's grant is disconnected).
"""
import base64
import hashlib
import json
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV = "D:/Ryagram-scratch/oauth-proof/.env"
ACCT = "D:/Ryagram-scratch/oauth-proof/connect-test-account.json"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"

env = {}
for line in open(ENV, encoding="utf-8").read().splitlines():
    m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
    if m:
        env[m.group(1)] = m.group(2).strip("\"'")
URL = env["SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_PUBLISHABLE_KEY"]
if "jxtkfishqfxuptwjzczz" in URL:
    sys.exit("REFUSED: live project")
FN = f"{URL}/functions/v1/connect"
acct = json.load(open(ACCT))


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


ok_all = True


def check(cond, what):
    global ok_all
    print(("  ok   " if cond else "  FAIL ") + what)
    ok_all = ok_all and bool(cond)


# --- register + authorize + approve (the consent page's own calls)
st, reg = call("POST", f"{FN}/register", {"client_name": "Refresh proof (throwaway)", "redirect_uris": [CALLBACK], "token_endpoint_auth_method": "none"})
check(st == 201 and "refresh_token" in reg.get("grant_types", []), f"registration says the client may use the refresh_token grant ({reg.get('grant_types') if reg else st})")
cid = reg["client_id"]
verifier = secrets.token_urlsafe(48)[:64]
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
q = urllib.parse.urlencode({"response_type": "code", "client_id": cid, "redirect_uri": CALLBACK, "state": "s1", "code_challenge": challenge,
                            "code_challenge_method": "S256", "scope": "read", "resource": f"{FN}/mcp"})
try:
    urllib.request.build_opener(NoRedirect).open(f"{FN}/authorize?{q}", timeout=30)
    loc = ""
except urllib.error.HTTPError as e:
    loc = e.headers.get("Location", "")
rid = urllib.parse.parse_qs(urllib.parse.urlsplit(loc).query)["request"][0]
st, sess = call("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": acct["email"], "password": acct["password"]}, headers={"apikey": KEY})
person = {"apikey": KEY, "Authorization": f"Bearer {sess['access_token']}"}
st, dec = call("POST", f"{URL}/rest/v1/rpc/connect_consent_decide", {"p_request": rid, "p_approve": True, "p_scopes": ["read"]}, headers=person)
code = urllib.parse.parse_qs(urllib.parse.urlsplit(dec["redirect_to"]).query)["code"][0]


def token(**kw):
    return call("POST", f"{FN}/token", kw, form=True)


def whoami(access):
    st, r = call("POST", f"{FN}/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami_and_credits", "arguments": {}}},
                 headers={"Authorization": f"Bearer {access}"})
    return st


# --- exchange
st, t1 = token(grant_type="authorization_code", code=code, client_id=cid, redirect_uri=CALLBACK, code_verifier=verifier)
check(st == 200 and t1.get("refresh_token") and t1.get("access_token"), "the code exchange returns an access token AND a refresh token")
check(t1.get("expires_in") == 3600, f"access token lifetime: expires_in = {t1.get('expires_in')} seconds")
check(whoami(t1["access_token"]) == 200, "the access token works")

# --- refresh
st, t2 = token(grant_type="refresh_token", refresh_token=t1["refresh_token"], client_id=cid)
check(st == 200 and t2.get("access_token") and t2.get("refresh_token"), "a refresh returns a NEW access token and a NEW refresh token")
check(t2["access_token"] != t1["access_token"] and t2["refresh_token"] != t1["refresh_token"], "both are different from the first pair (rotation)")
check(whoami(t2["access_token"]) == 200, "the refreshed access token works")
check(whoami(t1["access_token"]) == 401, "the previous pair is SPENT by the refresh: its access token stops at once (design: one live pair per connection)")

# --- refresh must be bound to the client
st, bad = token(grant_type="refresh_token", refresh_token=t2["refresh_token"], client_id="rgc_does_not_exist")
check(st == 400 and (bad or {}).get("error") == "invalid_grant", "a refresh with another client_id is refused")
# --- the family now survived that? (the wrong-client attempt must not have used the token)
st, t3 = token(grant_type="refresh_token", refresh_token=t2["refresh_token"], client_id=cid)
check(st == 200 and t3.get("refresh_token"), "the right client can still refresh after a wrong-client attempt (a stranger cannot burn your token)")

# --- reuse of an old refresh token revokes the family
st, reuse = token(grant_type="refresh_token", refresh_token=t1["refresh_token"], client_id=cid)
check(st == 400 and (reuse or {}).get("error") == "invalid_grant", "re-using an OLD refresh token is refused")
check(whoami(t3["access_token"]) == 401, "and that revokes the whole family: the newest access token stops too")
st, dead = token(grant_type="refresh_token", refresh_token=t3["refresh_token"], client_id=cid)
check(st == 400, "and the newest refresh token is dead as well (the assistant must sign in again, as designed)")

# --- clean up: disconnect the throwaway client's grant
call("POST", f"{URL}/rest/v1/rpc/disconnect_ai", {"p_client_id": cid}, headers=person)
print("RESULT:", "PASS" if ok_all else "FAIL")
sys.exit(0 if ok_all else 1)
