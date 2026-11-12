// Per-account switches (Q576): assets/app-switches.js. A switch holding exactly 'account' is on only for a person whose OWN list names it; exactly true is everyone; everything else is OFF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function make(cfg) {
  const win = { ryagramConfig: cfg };
  vm.runInNewContext(read('assets/app-switches.js'), { window: win });
  return win.ryagramSwitches;
}
const ok = list => ({ mySwitches: async () => list });

test('true is everyone; false, a missing switch and a non-string name are off', () => {
  const s = make({ a: true, b: false });
  assert.equal(s.featureOn('a'), true);
  for (const n of ['b', 'zzz', '', undefined, null, 1, {}, 'constructor', '__proto__', 'toString']) assert.equal(s.featureOn(n), false, String(n));
});

test("'account' is off until the person's own list names it, then on only for that name", async () => {
  const s = make({ myFilms: 'account', intake: 'account', credits: true });
  assert.equal(s.featureOn('myFilms'), false);                       // before the list is read
  await s.load(ok(['myFilms']));
  assert.equal(s.featureOn('myFilms'), true);
  assert.equal(s.featureOn('intake'), false);                        // listed for another switch only
});

test("'true', 1, 'yes', 'ACCOUNT', ' account' and an array are NOT on, even when the list names them (the list never widens a switch that is not exactly 'account')", async () => {
  const s = make({ a: 'true', b: 1, c: 'yes', d: 'ACCOUNT', e: ' account', f: ['account'], g: 'on', h: null });
  await s.load(ok(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));      // nothing is exactly 'account' here, so the list is not even read
  for (const n of 'abcdefgh') assert.equal(s.featureOn(n), false, n);
});

test('a list that fails, is missing or is the wrong shape gives OFF (fails closed)', async () => {
  for (const bad of [null, undefined, 'myFilms', 'myFilms,intake', { myFilms: true }, { rows: ['myFilms'] }, [[ 'myFilms' ]], [{ name: 'myFilms' }], [1], [true], [''], ['my films'], ['myFilms; drop'], 42]) {
    const s = make({ myFilms: 'account' });
    await s.load(ok(bad));
    assert.equal(s.featureOn('myFilms'), false, JSON.stringify(bad));
  }
  const s = make({ myFilms: 'account' });
  assert.equal(await s.load({ mySwitches: async () => { throw new Error('server error'); } }), false);
  assert.equal(s.featureOn('myFilms'), false);
});

test('a bad entry does not spoil the good ones, and a name in the list that has no switch is never on', async () => {
  const s = make({ myFilms: 'account' });
  await s.load(ok(['myFilms', 5, 'x y', 'neverASwitch']));
  assert.equal(s.featureOn('myFilms'), true); assert.equal(s.featureOn('neverASwitch'), false);
});

test("the server is asked ONLY when some switch is exactly 'account' (nothing is asked of it today)", async () => {
  let asked = 0; const data = { mySwitches: async () => { asked++; return []; } };
  await make({ a: true, b: false }).load(data); assert.equal(asked, 0);
  await make({ a: 'account' }).load(data); assert.equal(asked, 1);
});

test('a failed read is tried again next time; a good one is kept; sign-out forgets the list', async () => {
  const s = make({ myFilms: 'account' }); let n = 0;
  const data = { mySwitches: async () => { n++; if (n === 1) throw new Error('x'); return ['myFilms']; } };
  await s.load(data); assert.equal(s.featureOn('myFilms'), false);
  await s.load(data); assert.equal(s.featureOn('myFilms'), true);
  await s.load(data); assert.equal(n, 2);
  s.forget(); assert.equal(s.featureOn('myFilms'), false);
});

test('the person cannot grant themselves a switch from the page: the helper only ever READS the list (no write call anywhere)', () => {
  const src = read('assets/app-switches.js'), data = read('assets/app-data.js');
  assert.ok(!/admin_set_account_switch|switches_on\s*=|\.rpc\(/.test(src));
  assert.match(data, /client\.rpc\('my_switches'\)/);
  assert.ok(!/admin_set_account_switch/.test(data + read('assets/app-library.js')), 'no page code calls the admin writer');
});

test("the shipping config holds 'account' for myFilms and intake ONLY (Q577, walkthrough v2), and each reads through featureOn at every site", () => {
  assert.deepEqual([...read('assets/ryagram-config.js').replace(/\/\/.*$/gm, '').matchAll(/^\s*(\w+):\s*'account'/gm)].map(m => m[1]).sort(), ['intake', 'myFilms']);
  for (const f of ['assets/app-library.js', 'assets/app-departments.js']) assert.ok(!/ryagramConfig[^\n]{0,12}\.myFilms/.test(read(f)), f);
  assert.ok(!/ryagramConfig[^\n]{0,12}\.intake/.test(read('assets/app-library.js'))); assert.match(read('assets/app-library.js'), /featureOn\('intake'\)/); assert.match(read('assets/app-library.js'), /featureOn\('myFilms'\)/); assert.match(read('assets/app-departments.js'), /featureOn\('myFilms'\)/);
});

test('the page loads the helper before the library, and a returning visitor gets it (stamp)', () => {
  const html = read('app/index.html');
  assert.ok(html.indexOf('/assets/app-switches.js?v=') > 0 && html.indexOf('/assets/app-switches.js') < html.indexOf('/assets/app-library.js'));
  assert.match(read('assets/app-library.js'), /ryagramSwitches\?\.load\(data\)/);
});
