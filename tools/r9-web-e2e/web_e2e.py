"""The r9 WEB local end-to-end run (NEXT-WEB 115). LOCAL ONLY: a throwaway Postgres on D: (pgserver) with the repo's migrations, the credits ledger and WORKER's r9-node-draft, a small loopback server
that serves THIS branch's app and stands in for PostgREST (it turns /rest/v1/rpc/<function> and one account_settings select into SQL run as the role `authenticated` for the user named in the Bearer
token), and real Chrome driving the person path with screenshots:

    admin turns Sam on as a tester (an audit row) -> a computer begins a sign-in code (the app's step, done in SQL) -> Sam opens the approval page and approves -> the app collects its token (SQL)
    -> Sam's account page says "Your films render on your own computer" and lists the computer -> Sam removes it. Plus: a bad code, a used code, and a non-admin refused on the server.

Nothing touches the live project, a live account or the network beyond 127.0.0.1: every request the browser makes to another host is ABORTED, and the supabase-js file (the exact bytes the page pins with
its integrity hash) is served from a local copy.

    <python with pgserver, psycopg and playwright> tools/r9-web-e2e/web_e2e.py
    environment: R9WEB_DB_REPO   an L-Ai checkout at WORKER's r9-node-draft (the SQL), clean
                 R9WEB_SUPABASE_JS  a local copy of supabase-js 2.117.2 dist/umd/supabase.js (its sha384 must equal the page's integrity value)
                 R9WEB_OUT       folder for the screenshots (default D:/Ryagram-scratch/WEB/r9-web-e2e-shots)
                 TEMP/TMP        on D: (the storage rule); the run uses about 50 MB and removes its own folders
"""
import base64
import hashlib
import http.server
import json
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import psycopg
import pgserver
from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parents[2]
DB_REPO = Path(os.environ.get('R9WEB_DB_REPO', '')).resolve() if os.environ.get('R9WEB_DB_REPO') else None
SUPABASE_JS = Path(os.environ.get('R9WEB_SUPABASE_JS', '')) if os.environ.get('R9WEB_SUPABASE_JS') else None
OUT = Path(os.environ.get('R9WEB_OUT', 'D:/Ryagram-scratch/WEB/r9-web-e2e-shots'))
if not DB_REPO or not SUPABASE_JS or not SUPABASE_JS.exists():
    sys.exit('Set R9WEB_DB_REPO and R9WEB_SUPABASE_JS (see the header). Nothing was started.')
if not str(os.environ.get('TEMP', '')).upper().startswith('D:'):
    sys.exit('TEMP must be on D: (the storage rule). Nothing was started.')
LIVE_HOST = 'jxtkfishqfxuptwjzczz.supabase.co'
CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
SQL_ROOT = DB_REPO / 'supabase'
SAM, ADMIN = str(uuid.UUID(int=301)), str(uuid.UUID(int=303))
USERS = {SAM: 'sam@example.test', ADMIN: 'admin@example.test'}
FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond:
        FAILS.append(what)


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')


def token_for(uid):
    return f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': uid, 'email': USERS[uid], 'role': 'authenticated', 'aud': 'authenticated', 'exp': 4102444800})}.local"


def sub_of(auth_header):
    try:
        payload = auth_header.split(' ', 1)[1].split('.')[1]
        return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('sub') or None
    except Exception:
        return None


STATUS = {'PT404': 404, 'PT429': 429, '42501': 403, '28000': 401}


class State:
    uri = None
    origin = None


def run_as(uid, sql, params=()):
    with psycopg.connect(State.uri, autocommit=True) as c:
        c.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or '',))
        c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({'sub': uid, 'role': 'authenticated'} if uid else {}),))
        c.execute('set role authenticated' if uid else 'set role anon')
        return c.execute(sql, params).fetchall()


def call_rpc(uid, fn, args):
    if not re.fullmatch(r'[a-z_]+', fn) or not all(re.fullmatch(r'p_[a-z_]+', k) for k in args):
        return 400, {'message': 'bad function or argument name'}
    with psycopg.connect(State.uri, autocommit=True) as c:
        meta = c.execute("select proretset, prorettype::regtype::text from pg_proc where proname = %s and pronamespace = 'public'::regnamespace limit 1", (fn,)).fetchone()
    if not meta:
        return 404, {'code': 'PGRST202', 'message': f'Could not find the function public.{fn}'}
    call = f"public.{fn}({', '.join(f'{k} => %s' for k in args)})"
    vals = tuple(args.values())
    try:
        if meta[1] == 'void':
            run_as(uid, f'select {call}', vals)
            return 200, None
        if meta[0]:
            rows = run_as(uid, f"select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from {call} t", vals)
        else:
            rows = run_as(uid, f'select to_jsonb({call})', vals)
        return 200, rows[0][0]
    except psycopg.Error as e:
        code = e.diag.sqlstate or ''
        return STATUS.get(code, 400), {'code': code, 'message': e.diag.message_primary or str(e)}


def make_config():
    flags = dict(visitCounting=False, aiEditor=False, credits=False, payments=False, stripeTestMode=True, filmPages=False, accountTools=False, passwordReset=False, industryTemplate=False,
                 inviteSignup=False, uploads=False, byodGuide=False, opsTools=False, creatorBeta=False, filmRequests=False, guidedBuilder=False, lookEditor=False, funnelTracking=False,
                 renderOrders=False, connectAi=False, catalog=False, catalogComingSoon=False, desktopApp=True)
    return 'window.ryagramConfig = Object.freeze(' + json.dumps({'supabaseUrl': State.origin, 'supabaseKey': 'sb_publishable_local_only', **flags}) + ');\n'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(APP), **k)

    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == 'application/json' else body).encode()
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ('/app/', '/app/index.html'):
            html = (APP / 'app' / 'index.html').read_text(encoding='utf8')
            html = html.replace(f'https://{LIVE_HOST} wss://{LIVE_HOST}', State.origin)               # the page's CSP only lets it talk to the live project; this copy talks to the loopback
            return self._send(200, html, 'text/html; charset=utf-8')
        if u.path == '/assets/ryagram-config.js':
            return self._send(200, make_config(), 'application/javascript')
        if u.path.startswith('/rest/v1/'):
            table = u.path[len('/rest/v1/'):]
            cols = (parse_qs(u.query).get('select') or ['*'])[0]
            if table != 'account_settings' or not re.fullmatch(r'[a-z_,]+', cols):
                return self._send(404, {'code': 'PGRST205', 'message': f'Could not find the table public.{table}'})
            try:
                rows = run_as(sub_of(self.headers.get('Authorization', '')), f"select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select {cols} from public.account_settings) t")
                return self._send(200, rows[0][0])
            except psycopg.Error as e:
                return self._send(STATUS.get(e.diag.sqlstate or '', 400), {'code': e.diag.sqlstate, 'message': e.diag.message_primary})
        if u.path == '/auth/v1/user':
            uid = sub_of(self.headers.get('Authorization', ''))
            return self._send(200, {'id': uid, 'email': USERS.get(uid), 'aud': 'authenticated', 'role': 'authenticated'}) if uid else self._send(401, {'message': 'no session'})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        if u.path.startswith('/rest/v1/rpc/'):
            status, out = call_rpc(sub_of(self.headers.get('Authorization', '')), u.path[len('/rest/v1/rpc/'):], body)
            return self._send(status, out)
        return self._send(404, {'message': 'not found'})


def seed_session(uid):
    sess = {'access_token': token_for(uid), 'refresh_token': 'local', 'expires_in': 3600 * 24 * 365, 'expires_at': 4102444800, 'token_type': 'bearer',
            'user': {'id': uid, 'email': USERS[uid], 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-10-20T00:00:00Z'}}
    return f"localStorage.setItem('sb-127-auth-token', {json.dumps(json.dumps(sess))});"


def main():
    sha = 'sha384-' + base64.b64encode(hashlib.sha384(SUPABASE_JS.read_bytes()).digest()).decode()
    html = (APP / 'app' / 'index.html').read_text(encoding='utf8')
    check(sha in html, f'the local supabase-js copy is the exact file the page pins ({sha[:22]}...)')
    for name, repo in (('app', APP), ('sql (r9-node-draft)', DB_REPO)):
        import subprocess
        head = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--short=12', 'HEAD'], capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=no'], capture_output=True, text=True).stdout.strip()
        print(f'  HEAD {name:22s} {head}{"   DIRTY" if dirty else ""}')
        if dirty:
            sys.exit(f'REFUSING TO RUN: {name} is not a clean checkout.')
    OUT.mkdir(parents=True, exist_ok=True)
    base = Path(tempfile.mkdtemp(prefix='ryagram-pg-webe2e-'))
    srv = httpd = browser = None
    try:
        print('1. a throwaway Postgres on D: with the repo migrations, the credits ledger and WORKER r9-node-draft')
        srv = pgserver.get_server(base, cleanup_mode='stop')
        with psycopg.connect(srv.get_uri(), autocommit=True) as c:
            c.execute('create database webe2e')
        State.uri = srv.get_uri(database='webe2e')
        # Two layouts of the r9 SQL, and the run works on both (CC1 13:51): BEFORE the r9 migration is merged it is the draft file under supabase/r9-drafts/; AFTER, it is the numbered migration
        # (supabase/migrations/*r9_render_node.sql). Either way the order is the one the live database had: every other migration, the credits ledger (live before r9), THEN r9.
        draft = SQL_ROOT / 'r9-drafts' / 'r9_node_draft.sql'
        all_migrations = sorted((SQL_ROOT / 'migrations').glob('*.sql'))
        r9_migration = [m for m in all_migrations if 'r9_render_node' in m.name]
        migrations = [SQL_ROOT / 'ryagram-waitlist.sql', *[m for m in all_migrations if m not in r9_migration]]
        r9_sql = [draft] if draft.exists() else r9_migration
        if not r9_sql:
            raise SystemExit('no r9 SQL found: expected supabase/r9-drafts/r9_node_draft.sql or a supabase/migrations/*r9_render_node.sql in R9WEB_DB_REPO')
        with psycopg.connect(State.uri, autocommit=True) as c:
            c.execute((SQL_ROOT / 'tests' / 'supabase_stub.sql').read_text(encoding='utf8'))
            for p in [*migrations, SQL_ROOT / 'phase-2b' / 'credits_ledger.sql', *r9_sql]:
                c.execute(p.read_text(encoding='utf8'))
            c.execute("insert into auth.users (id, email) values (%s, 'sam@example.test'), (%s, 'admin@example.test')", (SAM, ADMIN))
            c.execute('insert into public.app_admins (user_id) values (%s)', (ADMIN,))
        check(True, 'Postgres is up and the draft is applied')
        owner = psycopg.connect(State.uri, autocommit=True)

        class Srv(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True
        httpd = Srv(('127.0.0.1', 0), Handler)
        State.origin = f'http://127.0.0.1:{httpd.server_address[1]}'
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        print(f'2. the loopback server is up at {State.origin}')

        external = []

        def route(r):
            url = r.request.url
            if url == CDN:
                return r.fulfill(status=200, content_type='application/javascript', body=SUPABASE_JS.read_bytes())
            if url.startswith(State.origin):
                return r.continue_()
            external.append(url)
            return r.abort()

        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome')

            def person(uid, label):
                ctx = browser.new_context(viewport={'width': 1100, 'height': 900})
                ctx.route('**/*', route)
                ctx.add_init_script(seed_session(uid))
                p = ctx.new_page()
                p.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
                return p

            errors = []

            def shot(p, name):
                p.screenshot(path=str(OUT / f'{name}.png'), full_page=True)

            def body(p):
                return p.inner_text('main')

            print('\n3. ADMIN turns Sam on as a tester (an audit row)')
            a = person(ADMIN, 'admin')
            a.goto(f'{State.origin}/app/#/admin/tester', wait_until='load')
            a.wait_for_selector('h1:has-text("Tester computers")', timeout=20000)
            shot(a, '01-admin-before')
            a.fill('#tester-email', 'sam@example.test')
            a.fill('#tester-reason', 'r9 e2e: Sam tests the desktop app')
            a.get_by_role('button', name='Turn on').click()
            a.wait_for_selector('text=is now a tester', timeout=15000)
            a.wait_for_selector('text=off to on', timeout=15000)                                  # the history redraws just after the status line
            shot(a, '02-admin-after')
            check('off to on' in body(a) and 'r9 e2e: Sam tests the desktop app' in body(a), 'the history shows who, old, new and why')
            check(owner.execute('select local_compute from public.account_settings where owner_id = %s', (SAM,)).fetchone()[0] is True, "the database: Sam's tester flag is on")
            check(owner.execute('select was_on, turned_on, reason from public.local_compute_audit').fetchone() == (False, True, 'r9 e2e: Sam tests the desktop app'), 'the database: one audit row, off to on, with the reason')

            print('\n4. SAM: a computer begins a code (the app step, in SQL), Sam approves it on the website')
            code = 'KQ7M-X4RW'
            dev_hash, tok_hash = hashlib.sha256(b'device-secret').hexdigest(), hashlib.sha256(b'node-token').hexdigest()
            owner.execute("select public.node_device_begin(%s, %s, 'DESKTOP-SAM-PC')", (dev_hash, code))
            s = person(SAM, 'sam')
            s.goto(f'{State.origin}/app/#/device?code={code}', wait_until='load')
            s.wait_for_selector('h1:has-text("Approve this computer?")', timeout=20000)
            s.wait_for_timeout(1500)
            t = body(s)
            shot(s, '03-sam-approval-page')
            check('DESKTOP-SAM-PC' in t and 'The name it gave itself (not checked)' in t, "the page shows the computer's own name, labelled not checked")
            check('You are signed in as sam@example.test' in t, "the page says which account the computer will join")
            check('Approve only if this code is on YOUR screen right now' in t, 'the page warns to approve only a code on your own screen')
            s.get_by_role('button', name='Approve this computer').click()
            s.wait_for_selector('h1:has-text("This computer is signed in")', timeout=15000)
            shot(s, '04-sam-approved')
            check('It works until' in body(s) and 'Go back to the Ryagram app.' in body(s), 'the answer replaces the question: the heading says the computer is signed in, with the date and the next step')
            check(owner.execute('select state from public.device_codes where user_code = %s', (code,)).fetchone()[0] == 'approved', 'the database: the code is approved')

            print('\n5. the app collects its token (SQL), Sam looks at his account')
            res = owner.execute('select public.node_device_exchange(%s, %s)', (dev_hash, tok_hash)).fetchone()[0]
            check(res.get('state') == 'ok', f"the exchange gave the app its token, the account named only as {res.get('account', {}).get('email')}")
            s.goto(f'{State.origin}/app/#/account', wait_until='load')
            s.wait_for_selector('section[aria-labelledby=acct-computers]', timeout=20000)
            s.wait_for_timeout(1000)
            card = s.locator('section[aria-labelledby=acct-computers]').inner_text()
            shot(s, '05-sam-account-tester-card')
            check('Your films are made on your own computer.' in card, 'the tester card says the films are made on his own computer')
            check('DESKTOP-SAM-PC' in card and 'waiting for the app to finish signing in' in card and 'works until' in card, 'the fresh computer is listed as waiting for the app, with a works-until date (not a failure-looking "not seen yet")')

            print('\n6. Sam removes the computer')
            s.once('dialog', lambda d: d.accept())
            s.get_by_role('button', name='Remove this computer').click()
            s.wait_for_selector('text=is removed', timeout=15000)
            shot(s, '06-sam-removed')
            check(owner.execute('select revoked_at is not null from public.node_tokens where token_hash = %s', (tok_hash,)).fetchone()[0] is True, "the database: the computer's token is revoked at once")
            check('No computer is signed in. Your films wait until you sign one in' in s.locator('section[aria-labelledby=acct-computers]').inner_text(), 'the page says no computer is signed in and the film waits')

            print('\n7. the refusals')
            s.goto(f'{State.origin}/app/#/admin/tester', wait_until='load')
            s.wait_for_timeout(2500)
            shot(s, '07-sam-no-admin-page')
            check('Tester computers' not in body(s) and 'Turn on' not in body(s), 'a non-admin does not get the admin page')
            refused = s.evaluate("""async (tok) => { const r = await fetch('/rest/v1/rpc/admin_set_local_compute_by_email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
                       body: JSON.stringify({ p_email: 'sam@example.test', p_on: true, p_reason: 'let me in' }) }); return [r.status, (await r.json()).message]; }""", token_for(SAM))
            check(refused[0] in (400, 403) and 'dmin' in refused[1], f'the SERVER refuses a non-admin who calls the function directly ({refused})')
            s.goto(f'{State.origin}/app/#/device?code=ABCD0000', wait_until='load')
            s.wait_for_timeout(2500)
            shot(s, '08-sam-bad-code')
            check("That code doesn't look right" in body(s), 'a bad code in the link is said in words')
            s.goto(f'{State.origin}/app/#/device?code={code}', wait_until='load')
            s.wait_for_timeout(2500)
            shot(s, '09-sam-used-code')
            check('has already been used' in body(s), 'the used code says so and shows no facts')
            check(not external or all(not u.startswith('http://127.0.0.1') for u in external), f'every request to another host was aborted ({len(external)}: {sorted(set(urlparse(u).netloc for u in external))[:4]})')
            check(not errors, 'no page errors in any window' + (f': {errors[:2]}' if errors else ''))
    finally:
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        if httpd:
            httpd.shutdown()
        if srv is not None:
            try:
                srv.cleanup()
            except Exception as e:
                print('cleanup note:', e)
        shutil.rmtree(base, ignore_errors=True)
    print('\nRESULT: ' + ('PASS' if not FAILS else 'FAIL: ' + '; '.join(FAILS)))
    sys.exit(0 if not FAILS else 1)


if __name__ == '__main__':
    main()
