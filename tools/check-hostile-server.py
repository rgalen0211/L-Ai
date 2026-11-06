"""Hostile SERVER ANSWERS (WEB, 11-06) to the waiting pages and the departments code, in real Chrome on the mock (needs Chrome; not part of the node suite). A wrapper around the mock client
replaces one rpc or function answer per scenario (a weird my_access shape, an answer that never comes, admin list rows with markup, junk or 5,000 characters, an invite refusal with markup, department
rows with duplicates and __proto__ ids). Each is judged: no page error, no injected script run, no sideways scroll, and the page the person ought to see (a non-active answer, even a hung one,
is the waiting page; the admin list is drawn). Exit 1 if any scenario fails.

    python tools/check-hostile-server.py
"""
import importlib.util, json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aa', ROOT / 'tools' / 'audit-a11y.py'); aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)

INIT = """
(() => { let real; const H = () => window.__hostile || {};
  Object.defineProperty(window, 'createFakeClient', { configurable: true, get() { return real; }, set(f) {
    real = (...a) => { const c = f(...a); const rpc = c.rpc.bind(c), inv = c.functions.invoke.bind(c.functions);
      c.rpc = (name, args) => (H().rpc && Object.prototype.hasOwnProperty.call(H().rpc, name) ? Promise.resolve().then(() => H().rpc[name](args)).then(v => (v && v.__error ? { data: null, error: v.__error } : { data: v, error: null })) : rpc(name, args));
      c.functions.invoke = (name, opts) => (H().fn && Object.prototype.hasOwnProperty.call(H().fn, name) ? Promise.resolve().then(() => H().fn[name](opts)).then(v => (v && v.__error ? { data: null, error: v.__error } : { data: v, error: null })) : inv(name, opts));
      return c; }; } });
})();
"""
BIG = 'x' * 5000
SCEN = []


def S(name, url, js, expect=None, wait=2500):
    SCEN.append((name, url, js, expect, wait))


# my_access answers (the gate must fail closed: only 'active' opens the app)
for label, ans in (('null', 'null'), ('undefined', 'undefined'), ('empty object', '{}'), ('ACTIVE upper', "'ACTIVE'"), ('status array', "{status:['active']}"), ('status object', "{status:{a:1}}"),
                   ('number 1', '1'), ('true', 'true'), ('error object', "{__error:{message:'<img src=x onerror=window.__x=1>'}}"), ('data wrapper', "{data:'active'}"), ('big string', "'" + BIG + "'")):
    S(f'my_access = {label}', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => (%s)}};" % ans, 'waiting')
S('my_access throws', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => { throw new Error('<b>boom</b>'); }}};", 'waiting')
S('my_access rejects', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => Promise.reject({message:'<b>x</b>'})}};", 'waiting')
S('my_access never answers (12 s, then the waiting page)', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => new Promise(() => {})}};", 'waiting', 14500)
S('my_access active (control)', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => 'active'}};", 'app')
S('my_access {status:active} (control)', '/app/?mock#/', "window.__hostile = {rpc: {my_access: () => ({status:'active', is_admin:'yes'})}};", 'app')
# the admin waiting list
mk = "Array.from({length: %d}, (_, i) => ({user_id: 'u' + i, email: 'p' + i + '@example.com', created_at: '2026-11-0' + (i %% 9 + 1)}))"
for label, ans in (('null', 'null'), ('not an array', "{a:1}"), ('string', "'rows'"), ('empty', '[]'), ('rows with markup', "[{user_id:'a', email:'<img src=x onerror=window.__x=1>@e.co', created_at:'2026-11-01'}]"),
                   ('rows 5000-char email', "[{user_id:'a', email:'%s@e.co', created_at:'2026-11-01'}]" % BIG), ('rows bad dates', "[{user_id:'a', email:'a@e.co', created_at:'nope'},{user_id:'b', email:'b@e.co', created_at:null},{user_id:'c', email:'c@e.co'}]"),
                   ('rows with junk entries', "[null, 1, 'x', [], {}, {user_id:'a', email:'a@e.co', created_at:'2026-11-01'}]"), ('duplicate ids', "[{user_id:'a', email:'a@e.co', created_at:'2026-11-01'},{user_id:'a', email:'a@e.co', created_at:'2026-11-01'}]"),
                   ('rows missing email', "[{user_id:'a', created_at:'2026-11-01'}]"), ('2000 rows', mk % 2000)):
    S(f'admin_waiting_list = {label}', '/app/?mock#/admin/waiting', "window.__hostile = {rpc: {admin_waiting_list: () => (%s)}};" % ans, 'admin', 3500)
S('admin_waiting_list throws', '/app/?mock#/admin/waiting', "window.__hostile = {rpc: {admin_waiting_list: () => { throw new Error('x'); }}};", 'adminerr')
# the waiting page's invite claim
for label, ans in (('markup message', "{message:'<img src=x onerror=window.__x=1>'}"), ('null', 'null'), ('active string', "'active'"), ('big message', "{message:'%s'}" % BIG)):
    S(f'claim-invite = {label}', '/app/?mock&waiting#/', "window.__hostile = {fn: {'claim-invite': () => (%s)}};" % ans, 'claim')
S('claim-invite throws', '/app/?mock&waiting#/', "window.__hostile = {fn: {'claim-invite': () => { throw new Error('<b>x</b>'); }}};", 'claim')
# departments
for label, rows in (('null', 'null'), ('not an array', "{a:1}"), ('junk entries', "[null, 1, 'x', [], {id:5}]"), ('duplicates', "[{id:'games',label:'Games',status:'soon'},{id:'games',label:'Games',status:'working'}]"),
                    ('proto ids', "[{id:'__proto__',label:'x',status:'soon'},{id:'constructor',label:'x',status:'working'},{id:'toString',label:'x',status:'soon'}]"),
                    ('markup labels', "[{id:'games',label:'<img src=x onerror=window.__x=1>',status:'soon'},{id:'data_films',label:'<b>x</b>',status:'working'}]"),
                    ('weird statuses', "[{id:'games',label:'g',status:'SOON'},{id:'compilations',label:'c',status:null},{id:'geo_intelligence',label:'g',status:{a:1}}]"),
                    ('all unknown', "[{id:'zzz',label:'z',status:'soon'}]")):
    S(f'my_departments = {label}', '/app/?mock&aiconnected#/', "window.__hostile = {rpc: {my_departments: () => (%s)}};" % rows, 'dept')
S('my_departments throws', '/app/?mock&aiconnected#/', "window.__hostile = {rpc: {my_departments: () => { throw new Error('x'); }}};", 'dept')

PROBE = """() => { const W = document.documentElement.clientWidth; return { h1: [...document.querySelectorAll('h1')].filter(h => h.offsetParent !== null).map(h => h.textContent.trim().slice(0, 40)), sideways: document.documentElement.scrollWidth > W,
  x: !!window.__x, body: document.body.innerText.slice(0, 80).replace(/\\n/g, ' | '), bar: document.querySelectorAll('.dept-bar').length, libVisible: !document.querySelector('#library')?.hidden }; }"""


def main():
    srv = aa.serve(); port = srv.server_address[1]
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r'waitingAccounts:\s*false', 'waitingAccounts: true', cfg)
    rows = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for name, url, js, expect, wait in SCEN:
            ctx = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
            ctx.add_init_script(INIT)
            ctx.add_init_script(js)
            p = ctx.new_page(); errs = []
            p.on('pageerror', lambda e: errs.append(str(e)[:100]))
            try:
                p.goto(f'http://127.0.0.1:{port}{url}', wait_until='load')
                p.wait_for_timeout(wait)
                if expect == 'claim':
                    if p.locator('#wt-code').count():
                        p.fill('#wt-code', 'RYATESTCODE'); p.click('#library form button[type=submit]'); p.wait_for_timeout(1200)
                r = p.evaluate(PROBE)
            except Exception as e:
                r = {'h1': ['(probe error: ' + str(e)[:60] + ')'], 'sideways': False, 'x': False, 'body': '', 'bar': 0, 'libVisible': False}
            ok = True; why = []
            if errs: ok = False; why.append('page errors ' + '; '.join(errs[:2]))
            if r['x']: ok = False; why.append('INJECTED SCRIPT RAN')
            if r['sideways']: ok = False; why.append('sideways scroll')
            h = ' / '.join(r['h1'])
            if expect == 'waiting' and 'on the list' not in h: ok = False; why.append(f'NOT the waiting page: "{h}" | {r["body"][:50]}')
            if expect == 'app' and 'on the list' in h: ok = False; why.append('active account shown the waiting page')
            if expect == 'admin' and 'Waiting list' not in h: ok = False; why.append(f'the admin list was not drawn: "{h}"')
            if expect == 'adminerr' and 'on the list' in h: ok = False; why.append('an admin error showed the waiting page')
            rows.append((ok, name, '; '.join(why), h[:50]))
            ctx.close()
        b.close()
    srv.shutdown()
    for ok, name, why, h in rows:
        print(('ok   ' if ok else 'FAIL ') + name + (f'   [{h}]' if ok else '   -> ' + why + f'   [{h}]'))
    bad = sum(1 for r in rows if not r[0])
    print(f'scenarios: {len(rows)}; FAILING: {bad}')
    sys.exit(1 if bad else 0)


main()
