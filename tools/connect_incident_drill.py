"""Incident drill on the PROOF project only (never live): time the switch-off kill, switch back on, and revoke one grant. Prints a timing table.

    pgvenv/Scripts/python tools/connect_incident_drill.py

It runs the real files supabase/connect-live/90_switch_off.sql and 91_switch_on.sql (the text Ryan would paste into the SQL Editor) and the same calls the app's
Disconnect button makes. Throwaway clients only: it never touches the Claude or ChatGPT grants on the proof project, and it ends with the switch ON.
Prints no key, token, code or password.
"""
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import psycopg  # noqa: E402
from connect_abuse_pass import Session, clear_counters, db  # noqa: E402
from connect_proof_pass import DB, FN, KEY, ROOT, URL, call, whoami  # noqa: E402

LIVE = ROOT / "supabase" / "connect-live"
rows = []


def say(label, value):
    rows.append((label, value))
    print(f"{label:<78} {value}", flush=True)


def run_file(name):
    sql = (LIVE / name).read_text(encoding="utf-8")
    with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
        t0 = time.time()
        cur = c.execute(sql)
        res = cur.fetchall() if cur.description else []
        cols = [d.name for d in cur.description] if cur.description else []
    return t0, time.time(), cols, res


def poll_until(token, want_ok, t0, limit=20.0):
    """Seconds from t0 until the token's tool call first answers as wanted (200 when want_ok, otherwise anything but 200)."""
    while time.time() - t0 < limit:
        st = whoami(token)
        if (st == 200) == want_ok:
            return time.time() - t0, st
        time.sleep(0.05)
    return None, None


def refused_example(token):
    import json
    import urllib.error
    import urllib.request
    req = urllib.request.Request(f"{FN}/mcp", data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami_and_credits", "arguments": {}}}).encode(),
                                 method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        urllib.request.urlopen(req, timeout=30)
        return "200", "", ""
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return str(e.code), e.headers.get("WWW-Authenticate", "")[:120], body[:200]


def main():
    clear_counters()
    sessions = [Session("read") for _ in range(3)]
    for s in sessions:
        s.connect()
    a, b, c = sessions
    say("setup: three throwaway connections all answer 200", "yes" if all(whoami(s.t["access_token"]) == 200 for s in sessions) else "NO")
    try:
        # ---- 1. switch OFF (the real file)
        t0, t1, cols, res = run_file("90_switch_off.sql")
        say("90_switch_off.sql: statement took (seconds)", f"{t1 - t0:.2f}")
        say("90_switch_off.sql: its own result grid", f"{cols} -> {res}")
        dead = [poll_until(s.t["access_token"], False, t0) for s in sessions]
        say("switch-off: seconds until each live session is refused (from the moment the statement started)", ", ".join(f"{d[0]:.2f}s (HTTP {d[1]})" for d in dead))
        st, www, body = refused_example(a.t["access_token"])
        say("what a refused assistant sees while OFF: HTTP status", st)
        say("   WWW-Authenticate header", www or "(none)")
        say("   response body (first 200 characters)", body or "(empty)")
        st_reg, reg = call("POST", f"{FN}/register", {"client_name": "Drill while off", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"], "token_endpoint_auth_method": "none"})
        say("a NEW registration while OFF", f"HTTP {st_reg} {str(reg)[:120]}")
        st_rf, rf = a.refresh()
        say("a REFRESH while OFF", f"HTTP {st_rf} {str(rf)[:80]}")
        st_c, chk = call("POST", f"{URL}/rest/v1/rpc/connect_consent_check", {"p_request": "00000000-0000-4000-8000-000000000001"}, headers=a.person)
        say("what the consent page's check says while OFF", f"HTTP {st_c} reason={(chk or {}).get('reason')!r}")
        # ---- 2. switch ON (the real file)
        time.sleep(1.0)
        t0, t1, cols, res = run_file("91_switch_on.sql")
        say("91_switch_on.sql: statement took (seconds)", f"{t1 - t0:.2f}")
        back = [poll_until(s.t["access_token"], True, t0) for s in sessions]
        say("switch-on: seconds until each SAME session works again (tokens were kept)", ", ".join(f"{d[0]:.2f}s" if d[0] is not None else "NEVER" for d in back))
        # ---- 3. revoke ONE grant, by the person's route (what the app's Disconnect button calls)
        t0 = time.time()
        stat, _ = call("POST", f"{URL}/rest/v1/rpc/disconnect_ai", {"p_client_id": b.cid}, headers=b.person)
        t_call = time.time() - t0
        d_b = poll_until(b.t["access_token"], False, t0)
        say("revoke one grant (disconnect_ai, the app's Disconnect button): the call took", f"{t_call:.2f}s (HTTP {stat})")
        say("   seconds until THAT connection is refused", f"{d_b[0]:.2f}s" if d_b[0] is not None else "NEVER")
        say("   the other two connections still work (blast radius = one)", "yes" if whoami(a.t["access_token"]) == 200 and whoami(c.t["access_token"]) == 200 else "NO")
        st_rb, _ = b.refresh()
        say("   and the revoked connection's refresh is refused", f"HTTP {st_rb}")
        # ---- 4. revoke ONE assistant by SQL (the administrator's route, one client only)
        t0 = time.time()
        with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as cn:
            cn.execute("update public.connect_tokens set revoked_at = now() where revoked_at is null and client_id = %s", (c.cid,))
            cn.execute("update public.connect_grants set revoked_at = now() where revoked_at is null and client_id = %s", (c.cid,))
        d_c = poll_until(c.t["access_token"], False, t0)
        say("revoke one assistant by SQL (administrator, one client_id): seconds until it is refused", f"{d_c[0]:.2f}s" if d_c[0] is not None else "NEVER")
        say("   the remaining connection still works", "yes" if whoami(a.t["access_token"]) == 200 else "NO")
    finally:
        with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as cn:
            cn.execute("update public.connect_flags set connections_enabled = true where id")
            on = cn.execute("select connections_enabled from public.connect_flags where id").fetchone()[0]
        for s in sessions:
            try:
                s.disconnect()
            except Exception:
                pass
        clear_counters()
    say("end state: master switch ON", "yes" if on else "NO")
    return 0 if on else 1


if __name__ == "__main__":
    sys.exit(main())
