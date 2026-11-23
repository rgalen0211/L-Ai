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
      assert.equal(textOf(byId(p.view, 'soon-invited-only')), 'Sign-up for this is not open to your account yet.');
      assert.ok(!/invite/i.test(textOf(p.view)), 'no invite word');
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

// ---------------------------------------------------------------------------------------------- ROW 3: the public help entry
test('ROW 3 HELP FAQ: "How do I connect Claude or ChatGPT?" is true for everyone: it says in its first words what not seeing Connected AIs means (not available on this account; write to us; no "invited for now" and no "we will tell you when it opens", 11-22), BEFORE the steps', () => {
  const html = read('help/index.html');
  const m = /<details[^>]*data-flag="connectAi"[^>]*><summary>How do I connect Claude or ChatGPT to Ryagram\?<\/summary>\s*<p>([^<]*)<\/p>/.exec(html);
  assert.ok(m, 'the entry is there');
  const first = m[1];
  assert.match(first, /^You can connect an AI assistant such as Claude or ChatGPT to your account\. If you do not see Connected AIs under Account, it is not available on your account; write to ryagram@uselai\.com\. If you do see it:/);
  assert.doesNotMatch(first, /invited|for now|we will tell you when it opens/i);
  assert.ok(first.indexOf('not available on your account') < first.indexOf('open Account, then Connected AIs'), 'the caveat comes before the steps');
  assert.doesNotMatch(first, /^Open Account/);
  assert.match(first, /^You can connect an AI assistant such as Claude or ChatGPT to your account\./, 'the same sentence as the Terms (Connect-an-AI open to everyone, L5)');
});

// ---------------------------------------------------------------------------------------------- ROW 4: the live editor's "Start the render"
// renderPath, RENDER_SOON and showCommit are cut out of the page's source (assets/app-editor.js) and run against fakes, so the BEHAVIOUR is tested: the made-up job (startJob) only in mock mode.
const EDSRC = read('assets/app-editor.js');
const SHOW = (() => { const i = EDSRC.indexOf('const renderPath ='), j = EDSRC.indexOf("// On the person's own computer the maker builds", i); assert.ok(i > 0 && j > i, 'markers'); return EDSRC.slice(i, j); })();
function commitPanel({ host = null, mock = false } = {}) {
  const started = [];
  const renderBox = { hidden: true, kids: [], replaceChildren(...k) { this.kids = k.flat(Infinity).map(x => (x == null || x === false || x === true ? String(x) : x)); } /* like the real DOM: null becomes the TEXT 'null' */, querySelector: () => ({ focus() {} }) };
  const btn = (label, cls, onclick) => h('button', { type: 'button', class: cls, onclick }, label);
  const f = vm.runInNewContext(`(function (h, btn, host, window, renderBox, committedWords, startJob, startHostBuild, closeRender) { ${SHOW}; return { showCommit, renderPath }; })`, { Array, String });
  const api = f(h, btn, host, { ryagramMock: mock ? {} : undefined }, renderBox, () => ['Line colour: blue'], () => started.push('fake'), () => started.push('host'), () => {});
  api.showCommit();
  return { box: wrap(renderBox.kids), started, api };
}
const startBtns = box => all(box, n => n.tag === 'button' && text(n) === 'Start the render');

test('ROW 4 LIVE EDITOR: on the website (no host.render, not mock) there is NO "Start the render" button and no made-up job can start; the panel says plainly the render is coming soon and points to the film’s page', () => {
  const { box, started, api } = commitPanel({ host: null, mock: false });
  assert.equal(api.renderPath(), null);
  assert.equal(startBtns(box).length, 0);
  const soon = byId(box.kids, 'le-render-soon');
  assert.equal(soon.length, 1);
  assert.equal(text(soon[0]), 'Rendering the final film from here is coming soon. For now, make it from the film’s page.');
  assert.ok(textOf([box]).includes('Line colour: blue'), 'what it is made from is still shown');
  assert.ok(!textOf([box]).includes('This exact draft is what the final film is made from'), 'no promise that the edits are used');
  assert.ok(textOf([box]).includes('Changes made here are not part of the final film yet. The render on the film’s page makes the film without them.'), 'the plain line');
  assert.ok(all(box, n => n.tag === 'button' && text(n) === 'Close').length === 1, 'a way out');
  assert.deepEqual(started, []);
  const hostWithoutRender = commitPanel({ host: { rpc() {} }, mock: false });          // a host page that has no render function is the same: nothing pretend
  assert.equal(startBtns(hostWithoutRender.box).length, 0);
});

test('ROW 4 MOCK AND HOST: in mock mode the made-up job still starts (every mock check relies on it); with a real host.render the real build starts, never the made-up job', async () => {
  const m = commitPanel({ host: null, mock: true });
  assert.equal(m.api.renderPath(), 'mock');
  assert.equal(startBtns(m.box).length, 1);
  assert.equal(byId(m.box.kids, 'le-render-soon').length, 0);
  await startBtns(m.box)[0].attrs.onclick();
  assert.deepEqual(m.started, ['fake']);
  const r = commitPanel({ host: { render: () => {} }, mock: false });
  assert.equal(r.api.renderPath(), 'host');
  await startBtns(r.box)[0].attrs.onclick();
  assert.deepEqual(r.started, ['host']);
  const both = commitPanel({ host: { render: () => {} }, mock: true });
  assert.equal(both.api.renderPath(), 'host', 'a real render path beats the mock');
});

test('ROW 4 THE MADE-UP JOB IS REACHED ONLY THROUGH THE MOCK GATE: startJob is referenced from exactly one place in the page', () => {
  const uses = EDSRC.replace(/^\s*\/\/.*$/gm, '').split('startJob').length - 1;
  assert.equal(uses, 2, 'the definition and the one mock-gated use');
  assert.match(EDSRC, /path === 'mock' \? \[btn\('Start the render', 'primary', startJob\)\]/);
});

// CC1 review (MEDIUM, 11-21): with no render path the film page's render ignores the editor's draft, so the panel must NOT say the draft is what the final film is made from.
const DRAFT_PROMISE = 'This exact draft is what the final film is made from. Nothing is added and nothing is dropped.';
const NOT_IN_FILM_LINE = 'Changes made here are not part of the final film yet. The render on the film’s page makes the film without them.';
test('NO RENDER PATH WORDING: the dropped sentence is absent and the plain line is present; with mock or host.render the draft sentence stays and the plain line is absent', () => {
  for (const c of [{ host: null, mock: false }, { host: { rpc() {} }, mock: false }]) {
    const t = textOf([commitPanel(c).box]);
    assert.ok(!t.includes('what the final film is made from'), 'promise dropped');
    assert.ok(t.includes(NOT_IN_FILM_LINE), 'plain line present');
  }
  for (const c of [{ host: null, mock: true }, { host: { render: () => {} }, mock: false }]) {
    const t = textOf([commitPanel(c).box]);
    assert.ok(t.includes(DRAFT_PROMISE), 'true where a path builds from the draft');
    assert.ok(!t.includes(NOT_IN_FILM_LINE));
  }
});

test('NO RENDER PATH WORDING: the Look rows do not say "Shows in the final film" or "changes when the final film is made" unless a render path exists', () => {
  assert.doesNotMatch(EDSRC, /'From 0 to 4\. Shows in the final film\.'/);
  assert.match(EDSRC, /const SHOWS_IN_FILM = \(\) => \(renderPath\(\) \?/);
  assert.match(EDSRC, /\(renderPath\(\) \? ' The film above changes when the final film is made\.'/);
});

// GAMES r4 M1/M2 (11-21): no stray 'null' text in the panel in ANY state, and the heading never contradicts the line under it.
test('PANEL TEXT: never contains "null", "undefined" or "false" in any state (mock, host.render, host without render, no path)', () => {
  for (const c of [{ host: null, mock: true }, { host: { render: () => {} }, mock: false }, { host: { rpc() {} }, mock: false }, { host: null, mock: false }]) {
    const t = textOf([commitPanel(c).box]);
    assert.doesNotMatch(t, /null|undefined|false/, JSON.stringify(Object.keys(c.host || {})) + ' mock=' + c.mock + ': ' + t);
  }
});
test('PANEL HEADING: with no render path it is "Your changes (not in the final film yet)"; where the draft is the film it stays "What will render"; the old heading is gone', () => {
  for (const c of [{ host: null, mock: false }, { host: { rpc() {} }, mock: false }]) { const t = textOf([commitPanel(c).box]); assert.ok(t.includes('Your changes (not in the final film yet)')); assert.ok(!t.includes('What the film will be made from')); assert.ok(!t.includes('What will render')); }
  for (const c of [{ host: null, mock: true }, { host: { render: () => {} }, mock: false }]) { const t = textOf([commitPanel(c).box]); assert.ok(t.includes('What will render')); assert.ok(!t.includes('Your changes (not in the final film yet)')); }
});
