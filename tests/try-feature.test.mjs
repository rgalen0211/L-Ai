// tools/try-feature.mjs: the one-command way to try an OFF website feature on your own PC. It must change ONLY the named switches, ONLY in the copy it serves, and serve only this PC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { readSwitches, withSwitches, startServer, NEEDS } from '../tools/try-feature.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const real = fs.readFileSync(path.join(root, 'assets/ryagram-config.js'), 'utf8');
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
const off = Object.entries(readSwitches(real)).filter(([, v]) => v === false).map(([k]) => k);

test('one named switch turns on and nothing else changes', () => {
  const r = withSwitches(real, ['myFilms']), before = readSwitches(real), after = readSwitches(r.text);
  assert.equal(after.myFilms, true);
  for (const k of Object.keys(before)) if (k !== 'myFilms') assert.equal(after[k], before[k], k);
  assert.deepEqual(r.turnedOn, ['myFilms']);
});

test('every switch that is off can be turned on alone (plus what it needs) and the file still parses', () => {
  assert.ok(off.length > 10);
  for (const n of off) { const r = withSwitches(real, [n]); assert.ok(r.turnedOn.includes(n), n); assert.equal(readSwitches(r.text)[n], true); }
});

test('a name that is not a true/false switch is refused in words (a key, a web address, a typo, an object name)', () => {
  for (const n of ['supabaseKey', 'supabaseUrl', 'myFilmz', '', 'constructor']) assert.throws(() => withSwitches(real, [n]), /is not a true\/false switch/, n);
});

test('a feature that needs another turns the other on too and says so', () => {
  const r = withSwitches(real, ['whyClip']);
  assert.ok(NEEDS.whyClip.includes('liveEditor') && readSwitches(r.text).liveEditor === true && r.added.includes('liveEditor'));
});

test('the served config is the copy; the file on disk is untouched', async () => {
  const before = fs.readFileSync(path.join(root, 'assets/ryagram-config.js'), 'utf8');
  const s = await startServer(['myFilms']);
  try {
    const c = await get(s.port, '/assets/ryagram-config.js?v=20261105b');
    assert.equal(c.status, 200); assert.match(c.body, /myFilms:\s*true/);
    assert.equal(readSwitches(c.body).liveEditor, readSwitches(before).liveEditor);
    assert.equal((await get(s.port, '/app/')).status, 200);
  } finally { s.server.close(); }
  assert.equal(fs.readFileSync(path.join(root, 'assets/ryagram-config.js'), 'utf8'), before);
});

test('it listens on this PC only, never on all addresses', async () => {
  const s = await startServer(['myFilms']);
  try { assert.equal(s.server.address().address, '127.0.0.1'); } finally { s.server.close(); }
});

test('it will not serve a file outside the folder or inside .git', async () => {
  const s = await startServer(['myFilms']);
  try {
    for (const p of ['/..%2fpackage.json', '/..%2f..%2fWindows%2fwin.ini', '/assets%2f..%2f..%2fpackage.json', '/.git/config']) { const r = await get(s.port, p); assert.ok([403, 404].includes(r.status), `${p} gave ${r.status}`); }
  } finally { s.server.close(); }
});
