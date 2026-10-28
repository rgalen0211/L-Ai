// Departments in the top bar and their Coming soon pages (NEXT-WEB 147; proposals/WEB-DEPARTMENTS.md; Ryan 2026-10-26 17:52). Behind `departments` (off). The page in real Chrome, desktop and phone,
// is tools/check-departments.py (needs Chrome). The server side (my_departments() and the interest functions) is proposed, not applied: the mock mirrors it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-departments.js', 'app-data.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const Dp = win.ryagramDepartments;
const plain = x => JSON.parse(JSON.stringify(x));

// a tiny element builder: enough to read what a page shows and to press its buttons
const h = (tag, attrs, ...kids) => ({ tag, attrs: (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !attrs.tag) ? attrs : {}, kids: ((attrs && attrs.tag) || typeof attrs === 'string' ? [attrs, ...kids] : kids).flat(Infinity).filter(x => x != null && x !== false) });
const text = n => (typeof n === 'string' ? n : n.kids.map(text).join(''));
const all = (n, pred, out = []) => { if (typeof n !== 'string') { if (pred(n)) out.push(n); n.kids.forEach(k => all(k, pred, out)); } return out; };
const textOf = list => list.flat(Infinity).filter(x => x != null && x !== false).map(text).join(' ');
const withReplace = el => { el.replaceChildren = (...k) => { el.kids = k.flat(Infinity).filter(x => x != null && x !== false); }; return el; };
const hh = (...a) => { const e = h(...a); return withReplace(e); };

test('FLAG: departments is OFF in the committed config and needs aiFirst and connectAi', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /departments: false,/);
  win.ryagramConfig = { departments: true, aiFirst: true, connectAi: true }; assert.equal(Dp.flagOn(), true);
  for (const c of [{ departments: false, aiFirst: true, connectAi: true }, { departments: true, aiFirst: false, connectAi: true }, { departments: true, aiFirst: true, connectAi: false }, {}]) { win.ryagramConfig = c; assert.equal(Dp.flagOn(), false, JSON.stringify(c)); }
  win.ryagramConfig = {};
});

test('NORMALIZE: only ids the page knows, only the two statuses, each once, in the page\'s own order; a working id with no page and a soon id with no words are NOT shown; a non-list is null', () => {
  const rows = [{ id: 'games', status: 'soon' }, { id: 'data_films', status: 'working' }, { id: 'time_machine', status: 'working' }, { id: 'compilations', status: 'working' },          // compilations has no working page yet
                { id: 'animation_studio', status: 'soon' }, { id: 'games', status: 'working' }, { id: 'geo_intelligence', status: 'soon' }, { id: 'data_films', status: 'soon' },        // data_films has no coming-soon words
                { id: 5, status: 'soon' }, null, { id: 'compilations', status: 'maybe' }, { status: 'soon' }];
  assert.deepEqual(plain(Dp.normalize(rows)), { working: ['data_films'], soon: ['geo_intelligence', 'games', 'animation_studio'] });
  assert.deepEqual(plain(Dp.normalize([{ id: 'compilations', status: 'soon' }])), { working: [], soon: ['compilations'] });
  for (const bad of [null, undefined, 'x', {}, 5]) assert.equal(Dp.normalize(bad), null);
  assert.equal(Dp.hasAny(Dp.normalize([])), false);
  assert.equal(Dp.hasAny(null), false);
  assert.equal(Dp.hasAny(Dp.normalize([{ id: 'games', status: 'soon' }])), true);
});

test('ROUTES: #/d/<id> only for ids the page knows', () => {
  assert.equal(Dp.idFromHash('#/d/data_films'), 'data_films');
  assert.equal(Dp.idFromHash('#/d/compilations'), 'compilations');
  for (const bad of ['#/d/time_machine', '#/d/', '#/d/Data_Films', '#/d/data_films/x', '#/d/__proto__', '#/d/constructor', '#/start', '', null]) assert.equal(Dp.idFromHash(bad), null, String(bad));
  assert.equal(Dp.pathOf('games'), '#/d/games');
});

test('DRAFT WORDING: every public line is DRAFT until Ryan answers Q244; the draft note is on every Coming soon page; Games is flagged as a placeholder; no date, price or plan anywhere', () => {
  assert.equal(Dp.DRAFT_NOTE, '[DRAFT WORDING, pending Ryan]');
  assert.deepEqual(Object.keys(Dp.KNOWN), ['data_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio']);
  assert.equal(Dp.KNOWN.games.placeholder, true);
  const lines = Object.values(Dp.KNOWN).filter(k => k.line).map(k => k.line).join(' ');
  assert.doesNotMatch(lines, /\$|\bprice|\bplan\b|\b20\d\d\b|\bsoon\b.*\b(by|in)\b \d|\bwill be (ready|available) (on|by)\b/i);
  assert.equal(Dp.WORDS.button, 'Tell me when it’s ready');
  assert.equal(Dp.WORDS.noted, 'Noted. We’ll let you know here when it is ready.');
});

async function pageOf(id, { rows, interests = [], fail = false } = {}) {
  const calls = [];
  const interestSet = new Set(interests);
  const data = {
    myDepartments: async () => { if (fail) throw new Error('down'); return rows || [{ id: 'data_films', status: 'working' }, { id: 'compilations', status: 'soon' }, { id: 'games', status: 'soon' }]; },
    myDepartmentInterests: async () => [...interestSet],
    registerDepartmentInterest: async d => { calls.push(['register', d]); if (data.failSave) throw new Error('x'); interestSet.add(d); },
    withdrawDepartmentInterest: async d => { calls.push(['withdraw', d]); interestSet.delete(d); },
    listProjects: async () => [{ id: 'p1', title: 'My film', latest: { number: 1 } }]
  };
  const ui = Dp.create({ h: hh, data });
  const view = await ui.pageView(id);
  return { view, calls, data, ui };
}
const wrap = v => ({ tag: 'div', attrs: {}, kids: v.flat(Infinity).filter(x => x != null && x !== false) });
const press = async (view, id) => { const b = all(wrap(view), n => n.attrs && n.attrs.id === id)[0]; await b.attrs.onclick(); return b; };

test('A COMING SOON PAGE: tag, heading, one line, the picture only where there is one, the button, the draft note; no email or send path', async () => {
  const { view } = await pageOf('compilations');
  const t = textOf(view);
  assert.ok(t.includes('Coming soon') && t.includes('Compilations') && t.includes('Say a phrase.') && t.includes('Tell me when it’s ready') && t.includes('[DRAFT WORDING, pending Ryan]'));
  assert.equal(all(wrap(view), n => n.attrs && /soon-picture/.test(n.attrs.class || '')).length, 1, 'Compilations has its picture');
  const g = await pageOf('games');
  assert.equal(all(wrap(g.view), n => n.attrs && /soon-picture/.test(n.attrs.class || '')).length, 0, 'Games has none yet');
  const src = read('assets/app-departments.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /mailto:|\bemail\b|sendMail|\.send\(|notify\(|fetch\(|XMLHttpRequest|sendBeacon|innerHTML|insertAdjacentHTML|localStorage|document\.cookie/i);
});

test('THE BUTTON STORES INTEREST AND SENDS NOTHING: one register call for that department, then Noted. with Take it back; Take it back withdraws it; a failure says so and changes nothing', async () => {
  const p = await pageOf('compilations');
  await press(p.view, 'soon-notify');
  assert.deepEqual(p.calls, [['register', 'compilations']]);
  const after = await p.ui.pageView('compilations');                       // a fresh page now shows it as noted
  assert.ok(textOf(after).includes('Noted. We’ll let you know here when it is ready.') && textOf(after).includes('Take it back'));
  assert.equal(all(wrap(after), n => n.attrs && n.attrs.id === 'soon-notify').length, 0, 'no second button while it is noted');
  await press(after, 'soon-takeback');
  assert.deepEqual(p.calls, [['register', 'compilations'], ['withdraw', 'compilations']]);
  const again = await p.ui.pageView('compilations');
  assert.equal(all(wrap(again), n => n.attrs && n.attrs.id === 'soon-notify').length, 1, 'the button is back');
  // a failed save
  const f = await pageOf('games');
  f.data.failSave = true;
  await press(f.view, 'soon-notify');
  assert.deepEqual(f.calls, [['register', 'games']]);
  const live = all(wrap(f.view), n => n.attrs && n.attrs['aria-live'] === 'polite')[0];                  // the page writes its message into this line's textContent
  assert.equal(live.textContent, 'Couldn’t save that just now. Try again in a minute.');
  assert.equal(all(wrap(f.view), n => n.attrs && n.attrs.id === 'soon-notify').length, 1, 'still just the button, nothing noted');
});

test('A WORKING DEPARTMENT: Data films has the AI strip (or the connect line), your films, and the no-AI way', async () => {
  const { view } = await pageOf('data_films');
  const t = textOf(view);
  assert.ok(t.includes('Data films') && t.includes('Start one in your AI') && t.includes('Your data films') && t.includes('No AI? Build it step by step') && t.includes('My film'));
});

test('FALLBACKS: an id the account does not have, an unknown id and a failing my_departments() are the plain "not available" page with a way home, never a blank page or a raw error', async () => {
  for (const [id, opt] of [['games', { rows: [{ id: 'data_films', status: 'working' }] }], ['compilations', { rows: [{ id: 'compilations', status: 'working' }] }], ['time_machine', {}], ['data_films', { fail: true }], ['data_films', { rows: 'nope' }]]) {
    const { view } = await pageOf(id, opt);
    const t = textOf(view);
    assert.ok(t.includes('This page isn’t available on this account') && t.includes('Back to your projects'), `${id}: ${t.slice(0, 80)}`);
    assert.ok(!/down|Error|undefined|null/.test(t), t);
  }
});

test('THE BAR: Start, the working departments, ONE Coming soon group of marked items, My films, Credits only when credits are on; Help and Account join the phone Menu; nothing mounts without the flag, an invited account or a usable list', async () => {
  const src = read('assets/app-departments.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /link\('#\/start', 'Start'\)/);
  assert.match(src, /h\('details', \{ class: 'soon-group' \}, h\('summary', \{\}, WORDS\.soonGroup\)/);
  assert.match(src, /window\.ryagramConfig\?\.credits === true\) items\.push\(h\('li', \{\}, link\('#\/credits', 'Credits'\)\)\)/);
  assert.match(src, /if \(!slot \|\| !flagOn\(\)\) return false;/);
  assert.match(src, /if \(\(await data\.connectAccess\(\)\) !== true\) return false;/);
  assert.match(src, /if \(!hasAny\(m\)\) return false;/);
  // a working department is a normal item; a soon one is ONLY in the group
  const m = Dp.normalize([{ id: 'data_films', status: 'working' }, { id: 'compilations', status: 'soon' }]);
  assert.deepEqual(plain(m), { working: ['data_films'], soon: ['compilations'] });
});

test('WIRING: the script loads before the library, the route and the mount are behind the flag, the data layer names the proposed functions, the header has its slot, and the stamps moved', () => {
  const html = read('app/index.html');
  assert.ok(html.indexOf('app-departments.js') > html.indexOf('app-start.js') && html.indexOf('app-departments.js') < html.indexOf('app-library.js'));
  assert.match(html, /id="dept-slot" hidden/);
  const lib = read('assets/app-library.js');
  assert.match(lib, /const departmentsOn = \(\) => window\.ryagramDepartments\?\.flagOn\(\) === true;/);
  assert.match(lib, /departmentsOn\(\) && window\.ryagramDepartments\.idFromHash\(hash\)\) view = await deptUi\(\)\.pageView\(window\.ryagramDepartments\.idFromHash\(hash\)\);/);
  assert.match(lib, /if \(departmentsOn\(\)\) deptUi\(\)\.mountBar\(document\.getElementById\('dept-slot'\)\);/);
  const dat = read('assets/app-data.js');
  for (const rpc of ['my_departments', 'my_department_interests', 'register_department_interest', 'withdraw_department_interest']) assert.ok(dat.includes(`'${rpc}'`), rpc);
  assert.match(html, /app-departments\.js\?v=20261027a/);
  assert.match(html, /app-data\.js\?v=20261027c/);
  assert.match(html, /app-library\.js\?v=20261027b/);
});

test('THE MOCK MIRRORS THE PROPOSED SERVER: five departments (one works), interest once per person per department, an unannounced id refused, withdraw removes it', async () => {
  const client = createFakeClient({}, {});
  const data = win.ryagramData(client);
  const rows = await data.myDepartments();
  assert.deepEqual(plain(rows.map(r => [r.id, r.status])), [['data_films', 'working'], ['compilations', 'soon'], ['geo_intelligence', 'soon'], ['games', 'soon'], ['animation_studio', 'soon']]);
  assert.deepEqual(await data.myDepartmentInterests(), []);
  await data.registerDepartmentInterest('games');
  await data.registerDepartmentInterest('games');
  assert.deepEqual(await data.myDepartmentInterests(), ['games']);
  await assert.rejects(data.registerDepartmentInterest('data_films'), /not announced/);
  await assert.rejects(data.registerDepartmentInterest('time_machine'), /not announced/);
  await data.withdrawDepartmentInterest('games');
  assert.deepEqual(await data.myDepartmentInterests(), []);
});
