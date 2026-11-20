// WEB's audit of what it built on 11-20 (proposals/WEB-AUDIT-1120.md): the film cards' picture address, the shared home page pieces, the film strip's keyboard use, and the dead code that went.
// Node only: the pieces are pure (makeCache, adminHub) or read from source (the strip, the old Admin dropdown). The Chrome side is tools/check-live-editor-film.py and tools/check-admin-nav.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const win = {};
vm.runInNewContext(read('assets/app-site.js'), { window: win, setTimeout, clearTimeout });
const dataWin = {};
vm.runInNewContext(read('assets/app-data.js'), { window: dataWin, setTimeout, clearTimeout });

test('FILM CARDS: the project list carries the latest version\'s id, or a card has no version to read a picture from (the picture never loaded before this)', async () => {
  const client = createFakeClient({});
  client.db.strictColumns = true;                                      // a read gives back ONLY the columns it selected, as the database does (the fake used to hand back everything, so this test could not fail)
  const data = dataWin.ryagramData(client);
  const made = await data.createProject('A film');
  const rows = await data.listProjects();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].latest && rows[0].latest.id, made.version.id, 'latest.id is the version id');
  assert.equal(rows[0].latest.number, 1);
});

test('LIGHT PICTURE READ: artifactsFor gives only the thumbnail and contact-sheet rows of ONE version, newest first, with only the four columns the card needs; the strict fake fails a missing column', async () => {
  const client = createFakeClient({});
  client.db.strictColumns = true;
  const data = dataWin.ryagramData(client);
  const made = await data.createProject('A film');
  const v = made.version.id;
  client.db.artifacts.push(
    { id: 'a1', version_id: v, kind: 'contact_sheet', storage_path: 'p/sheet-old.png', created_at: '2026-11-01T00:00:00Z', job_id: 'j1', bytes: 5 },
    { id: 'a2', version_id: v, kind: 'preview', storage_path: 'p/prev.mp4', created_at: '2026-11-03T00:00:00Z' },
    { id: 'a3', version_id: v, kind: 'thumbnail', storage_path: 'p/thumb.png', created_at: '2026-11-02T00:00:00Z' },
    { id: 'a4', version_id: v, kind: 'thumbnail', storage_path: 'p/gone.png', created_at: '2026-11-04T00:00:00Z', deleted_at: '2026-11-05T00:00:00Z' },
    { id: 'a5', version_id: 'other', kind: 'thumbnail', storage_path: 'p/other.png', created_at: '2026-11-06T00:00:00Z' });
  const rows = await data.artifactsFor(v);
  assert.deepEqual(rows.map(r => r.id), ['a3', 'a1'], 'thumbnail and contact sheet of THIS version only, newest first; no preview, no deleted file');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['created_at', 'id', 'kind', 'storage_path'], 'only the four columns');
  const src = read('assets/app-data.js');
  assert.match(src, /select\('id, kind, storage_path, created_at'\)\.eq\('version_id', versionId\)\.in\('kind', \['thumbnail', 'contact_sheet'\]\)/);
  const home = read('assets/app-site.js');
  assert.ok(!/getVersion/.test(home.replace(/\/\/.*$/gm, '')), 'the home page module never calls the heavy getVersion');
});

test('PICTURE ADDRESS CACHE: a signed address is kept for 10 minutes (it lasts 15), a failed read for 30 seconds, and the cache never grows without end', () => {
  let t = 1000;
  const c = win.ryagramSite.makeCache(10 * 60 * 1000, 30 * 1000, () => t);
  assert.equal(c.get('v1'), undefined, 'unknown');
  c.set('v1', 'https://x/a?sig=1'); c.set('v2', null);
  assert.equal(c.get('v1'), 'https://x/a?sig=1');
  assert.equal(c.get('v2'), null, 'a failure is remembered as null, not as unknown');
  t += 31 * 1000;
  assert.equal(c.get('v2'), undefined, 'a failed read is asked again after 30 s');
  assert.equal(c.get('v1'), 'https://x/a?sig=1', 'a good address is still used');
  t += 10 * 60 * 1000;
  assert.equal(c.get('v1'), undefined, 'a good address is dropped before it expires');
  for (let i = 0; i < 400; i++) c.set('k' + i, 'u');
  assert.ok(c.size() <= 201, `bounded (${c.size()})`);
});

test('ADMIN PAGE: pages are grouped People, Films, Computers in that order, an empty group draws nothing, and every card is a link with its line', () => {
  const nodes = [];
  const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter(k => k !== null && k !== undefined) });
  const out = win.ryagramSite.adminHub({ h, pages: [
    { href: '#/admin/renders', label: 'Render approvals', about: 'Full films waiting.', group: 'Films' },
    { href: '#/admin/ops', label: 'Operations and invites', about: 'People and invites.', group: 'People' }] });
  const text = JSON.stringify(out);
  assert.ok(text.indexOf('"People"') < text.indexOf('"Films"'), 'People before Films');
  assert.ok(!text.includes('"Computers"'), 'an empty group is not drawn');
  assert.ok(text.includes('#/admin/ops') && text.includes('#/admin/renders') && text.includes('People and invites.'));
  const none = win.ryagramSite.adminHub({ h, pages: [] });
  assert.ok(JSON.stringify(none).includes('No admin pages are switched on.'));
  assert.equal(nodes.length, 0);
});

test('FILM STRIP KEYBOARD: one tab stop for the strip, arrows inside it, the current tile is marked for a screen reader, and destroy() stops the timer', () => {
  const src = read('assets/app-editor-film.js');
  assert.match(src, /tabindex: '-1', 'aria-label': `Move to /, 'a tile starts out of the tab order');
  assert.match(src, /t\.tile\.tabIndex = on \? 0 : -1/, 'only the current tile is a tab stop');
  assert.match(src, /setAttribute\('aria-current', 'true'\)/);
  assert.match(src, /ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity/);
  assert.match(src, /destroy\(\) \{ destroyed = true; stop\(\); if \(pumpTimer\) clearInterval\(pumpTimer\); \}/);
});

test('DEAD CODE GONE: the old Admin dropdown\'s listeners, the unused tutorial link variable, and a leftover Admin link is cleaned on a new mount', () => {
  const lib = read('assets/app-library.js');
  assert.ok(!/const close = \(\) => \{ if \(menu\)/.test(lib) && !/const outside = event/.test(lib), 'no dropdown close/outside handlers');
  assert.ok(!/removeEventListener\('hashchange', close\)/.test(lib));
  assert.ok(!/buildLink/.test(lib), 'no buildLink leftover');
  assert.match(lib, /querySelectorAll\('\.admin-menu, \.admin-link'\)\.forEach\(m => m\.remove\(\)\)/);
});

test('NO PER-CARD OBSERVERS: the film cards share one IntersectionObserver and release a card when it is reached', () => {
  const src = read('assets/app-site.js');
  assert.equal((src.match(/new IntersectionObserver/g) || []).length, 1, 'one observer');
  assert.match(src, /shared\.unobserve\(e\.target\)/);
});

const proWin = {};
vm.runInNewContext(read('assets/app-editor-pro.js'), { window: proWin, setTimeout, clearTimeout });

test('PRO HISTORY: look changes are in plain words (never a story key like state.fill), an unknown key says a look setting, and the timecode is not a live region', () => {
  const P = proWin.ryagramEditorPro;
  assert.equal(P.describe({ op: 'set_look', key: 'state.fill', value: '#112233' }), 'Set the land colour to #112233');
  assert.equal(P.describe({ op: 'set_look', key: 'sequence.theme', value: 'light' }), 'Set the theme to light');
  assert.equal(P.describe({ op: 'unset_look', key: 'choropleth.high' }), 'Put the high colour back to the film’s own');
  assert.equal(P.describe({ op: 'set_look', key: 'glow.thing', value: 1 }), 'Set a look setting to 1', 'unknown keys get a neutral name');
  assert.ok(!/state\.|network\.|choropleth\.|sequence\./.test(P.describe({ op: 'set_look', key: 'network.base_color', value: '#fff' })));
  assert.ok(!/class: 'le-pro-tc', role: 'status'/.test(read('assets/app-editor-pro.js')), 'the timecode is not role=status');
});

test('DEPARTMENTS BAR: a bar asked for and then unmounted (or asked for again) while it loads never appears afterwards, and its media-query listener goes with it', () => {
  const src = read('assets/app-departments.js');
  assert.match(src, /const mine = \+\+mountToken;/);
  assert.match(src, /if \(mine !== mountToken \|\| !hasAny\(m\)\) return false;/);
  assert.match(src, /const unmountBar = \(\) => \{ mountToken\+\+; cleanup\(\); \};/);
  assert.match(src, /phoneQuery\.removeEventListener\('change', syncSoon\)/);
  assert.match(src, /if \(nav\.dispose\) nav\.dispose\(\);/);
});
