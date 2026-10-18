"""Apply the Ryagram schema and the connect migration to a NON-LIVE Supabase project (the proof project), in the README order.

    pgvenv/Scripts/python tools/connect_stage.py --dry-run     # list what would run
    pgvenv/Scripts/python tools/connect_stage.py               # apply what has not been applied yet
    pgvenv/Scripts/python tools/connect_stage.py --seed        # also: allowlist rows, the connect test account's invitation

Reads D:\\Ryagram-scratch\\oauth-proof\\.env  (SUPABASE_URL, SUPABASE_DB_URL, SUPABASE_SECRET_KEY). Never prints a value from it.
REFUSES to run against the live project (jxtkfishqfxuptwjzczz, or whatever supabase/.temp/project-ref says).
Each file is applied in its own transaction and recorded in public._connect_stage_applied, so a rerun skips what is done.
The role connect_runner is created by the migration WITHOUT a login. Its password is set by Ryan in the SQL Editor
(tools/oauth_proof/connect_runner_login.sql) and never passes through this script or chat.
"""
import json
import re
import secrets
import sys
import urllib.request
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
ENV = Path(r"D:\Ryagram-scratch\oauth-proof\.env")
LIVE_REFS = {"jxtkfishqfxuptwjzczz"}
LEDGER = ROOT / "supabase" / "phase-2b" / "credits_ledger.sql"
CONNECT = "20261018000100_connect_ai.sql"


def env():
    out = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip("\"'")
    return out


def files():
    mig = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
    first = [p for p in mig if p.name != CONNECT]
    return [ROOT / "supabase" / "ryagram-waitlist.sql", *first, LEDGER, ROOT / "supabase" / "migrations" / CONNECT]


def main():
    dry = "--dry-run" in sys.argv
    seed = "--seed" in sys.argv
    e = env()
    url, db = e.get("SUPABASE_URL", ""), e.get("SUPABASE_DB_URL", "")
    try:
        live = (ROOT.parent.parent / "GitHub" / "L-Ai" / "supabase" / ".temp" / "project-ref")
        if not live.exists():
            live = Path(r"C:\Users\Ryan\Documents\GitHub\L-Ai\supabase\.temp\project-ref")
        if live.exists():
            LIVE_REFS.add(live.read_text().strip())
    except OSError:
        pass
    if any(r and (r in url or r in db) for r in LIVE_REFS):
        print("REFUSED: that is the live Ryagram project.")
        return 3
    if dry:
        for p in files():
            print(("would apply  " if p.exists() else "MISSING      ") + p.relative_to(ROOT).as_posix())
        return 0
    if not db:
        print("SUPABASE_DB_URL is missing from the .env")
        return 2
    with psycopg.connect(db, autocommit=True, connect_timeout=15) as c:
        c.execute("create table if not exists public._connect_stage_applied (name text primary key, at timestamptz default now())")
        done = {r[0] for r in c.execute("select name from public._connect_stage_applied")}
        for p in files():
            name = p.relative_to(ROOT).as_posix()
            if name in done:
                print("skip   ", name)
                continue
            try:
                with c.transaction():
                    c.execute(p.read_text(encoding="utf-8"))
                    c.execute("insert into public._connect_stage_applied (name) values (%s)", (name,))
                print("applied", name)
            except psycopg.Error as err:
                print("FAILED ", name, "-", str(err).splitlines()[0][:200])
                return 1
        if seed:
            allow = [("https://claude.ai/api/mcp/auth_callback", "exact", "Claude"), ("https://claude.com/api/mcp/auth_callback", "exact", "Claude (new domain)"),
                     ("https://chatgpt.com/connector_platform_oauth_redirect", "exact", "ChatGPT (stable)"),
                     ("https://www.perplexity.ai/rest/connections/oauth_callback", "exact", "Perplexity"),
                     ("loopback", "loopback", "Claude Code and Gemini CLI on this computer")]
            for uri, kind, label in allow:
                c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s,%s,%s) "
                          "on conflict (redirect_uri) do update set enabled = true", (uri, kind, label))
            print("seeded the redirect allowlist:", len(allow), "rows")
            acct = Path(r"D:\Ryagram-scratch\oauth-proof\connect-test-account.json")
            if acct.exists():
                u = json.loads(acct.read_text())
            else:
                u = {"email": f"connect-test-{secrets.token_hex(4)}@example.test", "password": secrets.token_urlsafe(18)}
                req = urllib.request.Request(e["SUPABASE_URL"].rstrip("/") + "/auth/v1/admin/users", method="POST",
                    data=json.dumps({**u, "email_confirm": True}).encode(),
                    headers={"apikey": e["SUPABASE_SECRET_KEY"], "Authorization": "Bearer " + e["SUPABASE_SECRET_KEY"], "Content-Type": "application/json"})
                with urllib.request.urlopen(req) as r:
                    u["id"] = json.loads(r.read())["id"]
                acct.write_text(json.dumps(u))
                print("made a fresh test account; its sign-in is in", acct)
            c.execute("insert into public.connect_access (user_id) values (%s) on conflict (user_id) do update set enabled = true", (u["id"],))
            print("invited the test account for AI connections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
