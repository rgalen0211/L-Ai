"""The r9 LOCAL end-to-end harness (NEXT-CONNECT 102). Run it with run.ps1. LOCAL ONLY, nothing live.

    throwaway Postgres on D: (pgserver) + the repo's migrations + the credits ledger + WORKER's r9-node-draft rev4
      -> the REAL `node` function code (router.ts, db.ts, storage.ts) under Deno, reaching the database AS the role node_runner through a loopback bridge
      -> a loopback gateway that stands in for the one project host (functions + Storage + the approval page), so the app's host rule is exercised for real
      -> the maker-r9-node app code (SignIn + NodeLoop), signed in by a local device-code approval done in SQL as the person
    and ONE owner_local job flowing: submit (server sets run_on) -> house worker skips it -> app claims -> validate_job -> render (STAND-IN) -> artifact -> upload -> complete.
What is still fake is listed at the end of the run and in proposals\\CONNECT-R9-E2E.md.
"""
import hashlib
import http.client
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HARNESS = Path(__file__).resolve().parent


def _repo(var, default=None):
    v = os.environ.get(var) or default
    if not v:
        sys.exit(f"{var} is not set. Give the repo folder it names (see run.ps1 -Help). Nothing was started.")
    return Path(v).resolve()


APP_REPO = _repo("R9E2E_APP_REPO", str(HARNESS.parents[1]))          # default: the repo this script sits in (tools/r9-e2e/ -> repo root): the app AND the function code
E2E_DB_REPO = _repo("R9E2E_DB_REPO")                                  # an L-Ai checkout at WORKER's r9-node-draft: the SQL and the test helpers
ENGINE = _repo("R9E2E_ENGINE")                                        # a Ryagram checkout, for the worker's own validate_job


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True).stdout.strip()


print("HEADS UNDER TEST (the run is only evidence for exactly these):")
_dirty = []
for _name, _repo_path in (("app + function code", APP_REPO), ("sql (r9-node-draft)", E2E_DB_REPO), ("engine", ENGINE)):
    _head, _branch = _git(_repo_path, "rev-parse", "HEAD"), _git(_repo_path, "rev-parse", "--abbrev-ref", "HEAD")
    _changed = _git(_repo_path, "status", "--porcelain", "--untracked-files=no")
    print(f"  {_name:22s} {_head[:12] or '(not a git repo)'}  {_branch:24s} {_repo_path}{'   DIRTY' if _changed else ''}", flush=True)
    if not _head or _changed:
        _dirty.append(_name)
if _dirty:
    sys.exit("REFUSING TO RUN: not a clean git checkout: " + ", ".join(_dirty) + ". Commit or stash, so a pass names exact heads.")
sys.path.insert(0, str(E2E_DB_REPO / "supabase" / "tests"))
sys.path.insert(0, str(APP_REPO / "tools"))
sys.path.insert(0, str(ENGINE))
import pgserver                                  # noqa: E402
import psycopg                                   # noqa: E402
import psycopg.sql                               # noqa: E402,F401
from psycopg.rows import dict_row                # noqa: E402
import test_2a_core as core                      # noqa: E402
import ryagram_node as rn                        # noqa: E402
import ryagram_signin as si                      # noqa: E402

FAILS = []
KEY = "e2e-storage-key-" + uuid.uuid4().hex      # the ONE key the function holds; the gateway must see it only on function-to-storage calls
DBPASS = "e2e-" + uuid.uuid4().hex               # node_runner's throwaway LOGIN password (LOCAL ONLY; on live this is Ryan's own step)
SAM, ADMIN, BOB = (str(uuid.UUID(int=i)) for i in (201, 203, 202))
WORKER = core.WORKER


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


# ---------------------------------------------------------------------------------------------- the gateway: one host for functions, Storage and the approval page
class Gateway(ThreadingHTTPServer):
    daemon_threads = True


class State:
    bridge_conn = None
    admin_conn = None
    bridge_lock = threading.Lock()
    deno_port = 0
    objects = {}                 # path -> bytes
    tokens = {}                  # upload token -> path
    seen = []                    # (who, method, route) for the assertions: who = key | node_token | none
    bridge_errors = []
    fn_log = []                  # (method, route, status, first 160 bytes of the reply) for debugging a failed step


def make_handler(state):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _send(self, code, obj=None, raw=None, ctype="application/json"):
            b = raw if raw is not None else json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def _who(self):
            a = self.headers.get("Authorization") or ""
            return "key" if a == f"Bearer {KEY}" else "node_token" if a.startswith("Bearer rgn_") else "other" if a else "none"

        def _go(self, method):
            u = urlparse(self.path)
            path = u.path
            who = self._who()
            state.seen.append((who, method, re.sub(r"[0-9a-f-]{36}", "<id>", path)))
            if path == "/__bridge/q" and method == "POST":
                req = json.loads(self._body())
                sql = re.sub(r"\$(\d+)", r"%(p\1)s", req["sql"])
                params = {f"p{i + 1}": v for i, v in enumerate(req["params"])}
                with state.bridge_lock:
                    try:
                        rows = state.bridge_conn.execute(sql, params).fetchall()
                        return self._send(200, raw=json.dumps(rows, default=str).encode())
                    except psycopg.Error as e:
                        state.bridge_errors.append(getattr(e, "sqlstate", None)); state.fn_log.append(("SQL", sql[:90], getattr(e, "sqlstate", None), str(e)[:200].encode()))
                        return self._send(400, {"code": getattr(e, "sqlstate", None)})
            if path.startswith("/functions/v1/node"):
                body = self._body()
                conn = http.client.HTTPConnection("127.0.0.1", state.deno_port, timeout=60)
                hdrs = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection", "content-length")}
                conn.request(method, self.path, body=body or None, headers=hdrs)
                r = conn.getresponse()
                data = r.read()
                state.fn_log.append((method, path, r.status, data[:160]))
                self.send_response(r.status)
                for k, v in r.getheaders():
                    if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith("/storage/v1/object/upload/sign/") and method == "POST":
                if who != "key":
                    return self._send(401, {"error": "no key"})
                self._body()
                rest = path[len("/storage/v1/object/upload/sign/"):]
                bucket, _, obj = rest.partition("/")
                tok = uuid.uuid4().hex
                state.tokens[tok] = obj
                return self._send(200, {"url": f"/object/upload/sign/{bucket}/{obj}?token={tok}"})
            if path.startswith("/storage/v1/object/upload/sign/") and method == "PUT":
                rest = path[len("/storage/v1/object/upload/sign/"):]
                obj = rest.partition("/")[2]
                tok = (u.query.split("token=")[1] if "token=" in u.query else "")
                if state.tokens.get(tok) != obj:
                    return self._send(403, {"error": "bad token or path"})
                data = self._body()
                state.objects[obj] = data
                with state.bridge_lock:                         # what real Storage does: it records the object (and its size) where the DATABASE can see it
                    state.admin_conn.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, %s::jsonb) on conflict (bucket_id, name) do update set metadata = excluded.metadata",
                                             (obj, json.dumps({"size": len(data), "mimetype": self.headers.get("Content-Type")})))
                return self._send(200, {"Key": obj})
            if path.startswith("/storage/v1/object/info/") and method == "GET":
                if who != "key":
                    return self._send(401, {"error": "no key"})
                obj = path[len("/storage/v1/object/info/"):].partition("/")[2]
                if obj not in state.objects:
                    return self._send(404, {"error": "not found"})
                return self._send(200, {"size": len(state.objects[obj])})
            if path.startswith("/app"):
                return self._send(200, raw=b"<html><body>approval page (stand-in)</body></html>", ctype="text/html")
            return self._send(404, {"error": "not found"})

        def do_GET(self):  # noqa: N802
            self._go("GET")

        def do_POST(self):  # noqa: N802
            self._go("POST")

        def do_PUT(self):  # noqa: N802
            self._go("PUT")
    return H


# ---------------------------------------------------------------------------------------------- helpers
def tiny_png() -> bytes:
    """A real 8x8 grey PNG: the stand-in renderer's 'contact sheet'."""
    raw = b"".join(b"\x00" + bytes([128]) * 8 for _ in range(8))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


STORY = json.loads((HARNESS / "story.json").read_text(encoding="utf-8"))        # the Line template story, built by L-Ai's own templates.ts; it passes the worker's validate_story


def story():
    return json.dumps(STORY["story"])


def main():
    base = Path(tempfile.mkdtemp(prefix="ryagram-pg-r9e2e-"))
    folder = Path(tempfile.mkdtemp(prefix="r9e2e-app-"))
    srv = deno = gateway = None
    try:
        print("1. a throwaway Postgres on D: with the repo's migrations, the credits ledger and WORKER's r9-node-draft rev4")
        srv = pgserver.get_server(base, cleanup_mode="stop")
        with psycopg.connect(srv.get_uri(), autocommit=True) as c:
            c.execute("create database e2e")
        uri = srv.get_uri(database="e2e")
        with psycopg.connect(uri, autocommit=True) as c:
            c.execute((core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
            for p in [*core.MIGRATIONS, core.ROOT / "phase-2b" / "credits_ledger.sql", core.ROOT / "r9-drafts" / "r9_node_draft.sql"]:
                c.execute(p.read_text(encoding="utf-8"))
            c.execute("insert into auth.users (id, email) values (%s,'worker@x'),(%s,'sam@example.test'),(%s,'bob@example.test'),(%s,'admin@x')", (WORKER, SAM, BOB, ADMIN))
            c.execute("insert into public.workers (user_id, name) values (%s, 'house-pc')", (WORKER,))
            c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
            c.execute("update public.ops_settings set auto_render = true, default_credits_per_day = 100000")
            c.execute("insert into public.credit_dataset_shapes (dataset, shape, noted_by) values (%s, 'standard', 'test') on conflict do nothing", (STORY["dataset"],))
            c.execute(psycopg.sql.SQL("alter role node_runner login password {}").format(psycopg.sql.Literal(DBPASS)))        # LOCAL ONLY, throwaway
        db = core.Db(uri)
        check(True, "Postgres is up on D: and rev4 is applied")
        u = urlparse(srv.get_uri())

        print("\n2. the gateway (one host for functions, Storage and the approval page) and the node function under Deno, reaching the database AS node_runner")
        State.admin_conn = psycopg.connect(uri, autocommit=True)
        State.bridge_conn = psycopg.connect(host=u.hostname, port=u.port, dbname="e2e", user="node_runner", password=DBPASS, autocommit=True, row_factory=dict_row)
        who = State.bridge_conn.execute("select current_user as u").fetchone()["u"]
        check(who == "node_runner", f"the function's database connection is logged in as {who}")
        gateway = Gateway(("127.0.0.1", 0), make_handler(State))
        gport = gateway.server_address[1]
        threading.Thread(target=gateway.serve_forever, daemon=True).start()
        import socket
        _s = socket.socket(); _s.bind(("127.0.0.1", 0)); dport = _s.getsockname()[1]; _s.close()
        State.deno_port = dport
        env = dict(os.environ, PORT=str(dport), BRIDGE_URL=f"http://127.0.0.1:{gport}/__bridge/q", SUPABASE_URL=f"http://127.0.0.1:{gport}", NODE_UPLOAD_KEY=KEY,
                   NODE_APPROVAL_URL=f"http://127.0.0.1:{gport}/app", NODE_SALT="e2e-salt", FN_ROOT=(APP_REPO / "supabase" / "functions").as_uri())
        deno = subprocess.Popen(["deno", "run", "--no-lock", f"--allow-net=127.0.0.1", "--allow-env=PORT,BRIDGE_URL,SUPABASE_URL,NODE_UPLOAD_KEY,NODE_APPROVAL_URL,NODE_SALT,FN_ROOT", f"--allow-read={APP_REPO}", str(HARNESS / "serve.ts")], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        line = deno.stdout.readline()
        check("LISTENING" in line, f"the node function is serving under Deno ({line.strip()[:60]})")
        site = f"http://127.0.0.1:{gport}/functions/v1/node"

        print("\n3. the person, the tester flag (set by an admin), and ONE owner_local job (run_on is set by the SERVER)")
        admin = core.Db(uri)
        admin.as_(ADMIN).one("select admin_set_local_compute(%s, true, 'r9 e2e')", SAM)
        d = core.Db(uri)
        pid = d.as_(SAM).one("insert into projects (title) values ('e2e') returning id")
        vid = d.as_(SAM).one("select id from create_version(%s)", pid)
        d.as_(SAM).one("update versions set story_spec = %s::jsonb where id = %s returning id", story(), vid)
        job = d.as_(SAM).one("select id from submit_job(%s, 'contact_sheet', '{}')", vid)
        row = admin.as_(None).c.execute("select run_on, state, coalesce(credits_quoted,0) from jobs where id=%s", (job,)).fetchone()
        check(row[0] == "owner_local" and row[1] == "queued", f"the job is queued and run_on = {row[0]} (set by the database trigger, not by anyone's request)")
        check(row[2] == 0, "it is quoted at zero credits")
        # a house job for BOB, to show it is untouched
        d.as_(BOB)
        bpid = d.as_(BOB).one("insert into projects (title) values ('bob') returning id")
        bvid = d.as_(BOB).one("select id from create_version(%s)", bpid)
        d.as_(BOB).one("update versions set story_spec = %s::jsonb where id = %s returning id", story(), bvid)
        bjob = d.as_(BOB).one("select id from submit_job(%s, 'contact_sheet', '{}')", bvid)
        house = core.Db(uri).as_(WORKER).one("select id from claim_next_job()")
        check(str(house) == str(bjob), "the HOUSE worker claims BOB's house job and skips Sam's owner_local job")
        state_now = admin.as_(None).c.execute("select state, worker_user_id from jobs where id=%s", (job,)).fetchone()
        check(state_now[0] == "queued" and state_now[1] is None, "Sam's job is still queued, held by nobody")

        print("\n4. the app signs in: a code on screen, approved in SQL as Sam (the website's Approve), the token goes to the store")
        clock = time.time
        events = []
        store = si.MemoryStore()
        app = si.SignIn(site, store, folder, computer_name="Sam-PC", log=events.append)
        try:
            st = app.begin()
        except si.SignInError:
            print('  function log:', State.fn_log[-3:], 'bridge errors:', State.bridge_errors[-3:], flush=True)
            raise
        check(st["state"] == "waiting" and re.match(r"^[A-Z2-9]{4}-[A-Z2-9]{4}$", st["user_code"]) is not None, f"the app shows a code ({st['user_code']}) from the real function and database")
        check(st["open_url"].startswith(f"http://127.0.0.1:{gport}/app"), "the approval address is on the one trusted host")
        chk = core.Db(uri).as_(SAM).one("select device_request_check(%s)", st["user_code"])
        check(chk.get("state") == "pending" and chk.get("computer_name") == "Sam-PC", "the website's page sees the pending code and the name the computer gave itself")
        before = admin.as_(None).c.execute("select state from device_codes").fetchone()[0]
        check(before == "pending", "looking changed nothing (CC1 13:48 point 1)")
        core.Db(uri).as_(SAM).one("select device_decide(%s, true)", st["user_code"])
        time.sleep(5.5)
        st2 = app.poll()
        check(st2["state"] == "signed_in", "after the approval and the interval, the app is signed in")
        check(st2["email"].startswith("s***@") and "sam@example.test" not in json.dumps(st2), f"the account shows a MASKED email ({st2['email']})")
        tok = app._token()
        check(bool(tok) and tok.startswith("rgn_") and tok not in json.dumps(st2), "the token (rgn_...) is in the store only")
        trow = admin.as_(None).c.execute("select token_hash from node_tokens").fetchone()[0]
        check(trow == h(tok) and tok not in trow, "the database holds only SHA-256 of it")
        gate = app.gate()
        check(gate["node"] is True and gate["clip_films"] is True, "the account is flagged: the node may run")

        print("\n5. the node loop: claim -> validate_job -> render (STAND-IN) -> artifact -> upload -> complete")
        rendered = []

        def renderer(job_row, work, progress):
            rendered.append(job_row)
            (work / "sheet.png").write_bytes(tiny_png())
            return {"contact_sheet": work / "sheet.png"}
        # the worker's OWN validator, with the dataset allowlist the app is told it may use
        loop = rn.NodeLoop(app, folder, renderer=renderer, datasets={STORY["dataset"]}, log=events.append, work_root=folder / "jobs", engine_commit="abc1234")       # a stand-in commit id: the real one is ENGINE's
        loop.set_switch(True)
        r = loop.step()
        check(r == "worked", f"one step: the job was made and finished ({r}; {loop.status()['message']})")
        j = admin.as_(None).c.execute("select state, worker_user_id, worker_id from jobs where id=%s", (job,)).fetchone()
        if j[0] != "complete":
            print("  why:", admin.as_(None).c.execute("select error_code, error_detail from jobs where id=%s", (job,)).fetchone(), flush=True)
            print("  function log:", [x for x in State.fn_log if x[0]=="SQL" or x[2] != 200][-6:], flush=True)
        check(j[0] == "complete", f"the database says the job is complete (state {j[0]})")
        art = admin.as_(None).c.execute("select kind, storage_path, bytes, sha256 from artifacts where job_id=%s", (job,)).fetchall()
        png = tiny_png()
        check(len(art) == 1 and art[0][0] == "contact_sheet" and art[0][2] == len(png) and art[0][3] == hashlib.sha256(png).hexdigest(), "one artifact row, with the announced size and sha256")
        path = art[0][1]
        check(path.startswith(f"{SAM}/") and str(job) in path and path in State.objects and State.objects[path] == png, "the file is in Storage at the path the DATABASE derived from the job, byte for byte")
        check(len(rendered) == 1 and str(getattr(rendered[0], "id", None)) == str(job), "the renderer got the validated job (the worker's validate_job accepted the story)")
        led = admin.as_(None).c.execute("select count(*) from credit_ledger where job_id=%s", (job,)).fetchone()[0] if admin.as_(None).c.execute("select to_regclass('public.credit_ledger')").fetchone()[0] else 0
        check(led == 0, "no credit ledger row was written for the owner_local job")
        who_seen = [w for w, m, p in State.seen]
        check(not any(w == "key" and "/functions/" in p for w, m, p in State.seen), "the storage key never appeared on a call to the function")
        check(all(w in ("key", "none") for w, m, p in State.seen if p.startswith("/storage/")), "every Storage call was made with the key (function) or none (the signed upload); the node token never went to Storage")
        check(not any(w == "node_token" and p.startswith("/storage") for w, m, p in State.seen), "the node token was sent only to the function")
        check(KEY not in json.dumps(loop.status()) + json.dumps(app.status()) + " ".join(events), "the storage key is in no app status or log")
        check(loop.step() == "idle", "the next step finds nothing to do")
        check(core.Db(uri).as_(WORKER).one("select id from claim_next_job()") is None, "the house worker, asked again, finds nothing: Sam's job was never in its reach")

        print("\n6. Remove on the website: the computer is refused on its very next call")
        tid = admin.as_(None).c.execute("select id from node_tokens limit 1").fetchone()[0]
        core.Db(uri).as_(SAM).one("select remove_computer(%s)", tid)
        r2 = loop.step()
        check(r2 == "error" and app.status()["state"] == "signed_out", "the removed computer's next call is refused and the app signs itself out")
        check(app._token() is None, "the token is gone from the store")

        print("\n7. what the database refused along the way")
        check(set(State.bridge_errors) <= {"PT401"}, f"the only database errors the function saw were the refusal of the removed computer: {sorted(set(State.bridge_errors))}")
    finally:
        print("\ncleaning up (my own processes by PID, my own folders)")
        for what, fn in [("deno", lambda: deno and deno.terminate()), ("gateway", lambda: gateway and gateway.shutdown()), ("bridge", lambda: State.bridge_conn and State.bridge_conn.close()), ("admin", lambda: State.admin_conn and State.admin_conn.close()),
                         ("postgres", lambda: srv and srv.cleanup())]:
            try:
                fn()
            except Exception as e:                                          # noqa: BLE001
                print("  cleanup", what, type(e).__name__)
        shutil.rmtree(base, ignore_errors=True)
        shutil.rmtree(folder, ignore_errors=True)
        print("  left behind:", "nothing" if not base.exists() else str(base))
    print()
    print("STILL FAKE: the renderer (a stand-in that writes a real tiny PNG, not the engine); Storage (a loopback stand-in for the two calls); the npm 'postgres' driver and index.ts (the SQL goes over a loopback bridge "
          "as node_runner instead); the website's Approve (done in SQL as Sam); the live project, its roles, its secrets and its pooler.")
    if FAILS:
        print(f"\nFAILED: {len(FAILS)}")
        for f in FAILS:
            print("  -", f)
        sys.exit(1)
    print("\nall passed")


if __name__ == "__main__":
    main()
