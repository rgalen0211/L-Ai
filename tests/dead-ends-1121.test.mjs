// WEB dead-end sweep 2026-11-21 (proposals/WEB-DEAD-END-SWEEP-1121.md), the HIGH rows fixed one by one: a link or button is shown only to an account for whom its target works, and the live site never
// pretends. Each section names its row. tests/dead_ends_1121_mutants.mjs plants each fault again and this file must then fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const plain = x => JSON.parse(JSON.stringify(x));

// a tiny element builder: enough to read what a page shows and to press its buttons
const h = (tag, attrs, ...kids) => ({ tag, attrs: (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !attrs.tag) ? attrs : {}, kids: ((attrs && attrs.tag) || typeof attrs === 'string' ? [attrs, ...kids] : kids).flat(Infinity).filter(x => x != null && x !== false) });
const text = n => (typeof n === 'string' ? n : n.kids.map(text).join(''));
const all = (n, pred, out = []) => { if (typeof n !== 'string') { if (pred(n)) out.push(n); n.kids.forEach(k => all(k, pred, out)); } return out; };
const textOf = list => list.flat(Infinity).filter(x => x != null && x !== false).map(text).join(' ');
const withReplace = el => { el.replaceChildren = (...k) => { el.kids = k.flat(Infinity).filter(x => x != null && x !== false); }; return el; };
const hh = (...a) => withReplace(h(...a));
const wrap = v => ({ tag: 'div', attrs: {}, kids: v.flat(Infinity).filter(x => x != null && x !== false) });
const byId = (view, id) => all(wrap(view), n => n.attrs && n.attrs.id === id);

function load(files) { const win = {}; for (const f of files) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout }); return win; }

// ---------------------------------------------------------------------------------------------- ROW 1 and ROW 2: the departments pages
const win = load(['app-start.js', 'app-departments.js']);
const Dp = win.ryagramDepartments, St = win.ryagramStart;

async function pageOf(id, { invited = true, throws = false, rows, connected = [] } = {}) {
  const calls = [];
  const data = {
    connectAccess: async () => { if (throws) throw new Error('down'); return invited; },
    myConnectedAis: async () => connected,
    myDepartments: async () => rows || (invited ? ['compilations', 'geo_intelligence', 'games', 'animation_studio', 'studio'].map(id => ({ id, status: 'soon' })).concat([{ id: 'data_films', status: 'working' }]) : []),
    myDepartmentInterests: async () => [],
    registerDepartmentInterest: async d => { calls.push(['register', d]); if (!invited) throw new Error('This is for invited accounts for now.'); },
    withdrawDepartmentInterest: async d => { calls.push(['withdraw', d]); },
    listProjects: async () => []
  };
  const ui = Dp.create({ h: hh, data, startUi: () => St.create({ h: hh, data, refresh: () => {} }) });
  return { view: await ui.pageView(id), calls, ui };
}
const startLinks = view => all(wrap(view), n => n.tag === 'a' && n.attrs && n.attrs.href === '#/start');

test('ROW 1 THE ONE GATE: canStart is true only for connectAccess() exactly true; a failing or odd answer is no; #/start itself (startView) and the strip use that same helper', async () => {
  assert.equal(await St.canStart({ connectAccess: async () => true }), true);
  for (const v of [false, null, undefined, 'true', 1]) assert.equal(await St.canStart({ connectAccess: async () => v }), false, String(v));
  assert.equal(await St.canStart({ connectAccess: async () => { throw new Error('x'); } }), false);
  assert.equal(await St.canStart(null), false);
  const src = read('assets/app-start.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /allowed = await canStart\(data\)/);                          // the #/start route
  assert.match(src, /if \(!\(await canStart\(data\)\)\) return null;/);          // the strip
  assert.match(read('assets/app-departments.js'), /window\.ryagramStart\.canStart\(data\)/);
});

test('ROW 1 DATA FILMS PAGE: an account that is NOT invited sees no link to #/start and no "Start one in your AI" heading (only the step-by-step way); an invited one keeps both; a failing check is not invited', async () => {
  for (const opt of [{ invited: false }, { throws: true }]) {
    const p = await pageOf('data_films', opt);
    assert.equal(startLinks(p.view).length, 0, `no #/start link: ${JSON.stringify(opt)}`);
    const t = textOf(p.view);
    assert.ok(!t.includes('Start one in your AI') && !t.includes('Connect your AI'), t);
    assert.ok(!/in your AI/.test(t), 'no word about an AI the account cannot connect');
    assert.ok(t.includes('Data films') && t.includes('Your data films') && t.includes('No AI? Build it step by step'), t);
    assert.equal(all(wrap(p.view), n => n.tag === 'a' && n.attrs.href === '#/build').length, 1, 'the no-AI way stays');
  }
  const inv = await pageOf('data_films', { invited: true, connected: [] });
  assert.ok(textOf(inv.view).includes('Start one in your AI'));
  assert.equal(startLinks(inv.view).length >= 1, true, 'an invited account with no AI connected is led to #/start, where it works');
  const link = startLinks(inv.view)[0];
  assert.ok(textOf([link]).includes('Connect your AI to start films by talking'));
});

// ---------------------------------------------------------------------------------------------- ROW 2: Coming soon sign-up
test('ROW 2 COMING SOON: an account that is NOT invited gets a plain line and NO "Tell me when it’s ready" button (the server would refuse it for ever); an invited account keeps the working button', async () => {
  for (const id of ['compilations', 'geo_intelligence', 'games', 'animation_studio', 'studio']) {
    for (const opt of [{ invited: false, rows: [] }, { throws: true, rows: [] }]) {
      const p = await pageOf(id, opt);
      assert.equal(byId(p.view, 'soon-notify').length, 0, `${id}: no button`);
      assert.equal(byId(p.view, 'soon-invited-only').length, 1, `${id}: the honest line`);
      assert.equal(textOf(byId(p.view, 'soon-invited-only')), 'Sign-up for this is for invited accounts for now.');
      assert.ok(!/Try again/.test(textOf(p.view)), 'no retry promise');
    }
    const inv = await pageOf(id, { invited: true });
    assert.equal(byId(inv.view, 'soon-notify').length, 1, `${id}: invited keeps the button`);
    assert.equal(byId(inv.view, 'soon-invited-only').length, 0);
  }
});

test('ROW 2 AND THE FALLBACK LIST: a non-invited account whose list is empty (the server answers [] for it) still reaches the page, with the line and without the button', async () => {
  const p = await pageOf('compilations', { invited: false, rows: [] });
  const t = textOf(p.view);
  assert.ok(t.includes('Coming soon') && t.includes('Compilations') && t.includes('Say a phrase.'));
  assert.deepEqual(p.calls, []);
  const m = await p.ui.load();
  assert.ok(m.soon.includes('compilations'));
});
