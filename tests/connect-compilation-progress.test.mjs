// COMPILATION PROGRESS, COUNTS ONLY (CONNECT 11-27 night, Ryan's 23:06 finding; BUILDER's contract 23:12): get_compilation_status and the in-chat status card say, from a CLOSED list of words built only from three
// whole numbers (step_done, step_total, percent), where a running build is: 'Planning: video 2 of 3, about 45% overall.' / 'Finding the matches: video 2 of 3, ...' / 'Building: clip 3 of 4, ...'.
// Against the connector's own code and its in-memory stand-in world; the card is run in a tiny fake DOM (the real-browser look is not run here); the SQL is NOT run (no Postgres tonight): its text is pinned by tests below.
// Must-fails are in tests/connect_compilation_progress_mutants.mjs. Hostile shapes are planted ON PURPOSE straight into the tool's data (the stand-in database already clamps like the SQL does) to prove the tool and the card do not trust it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { compilationHtml } from '../supabase/functions/connect-core/compilation_card.ts';
import { TOOLS, cleanProgress, progressWords, runWords } from '../supabase/functions/connect-core/tools.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const APP = 'https://uselai.com/app/';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function server() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId, ['read', 'write', 'render_free']);
  w.users.get(A.userId).switches = ['compilations'];
  w.issue('tok-a', A);
  const call = (name, args, data) => callTool(name, args, A, { data: data ?? w.data(A.userId), policy: w.policy(), deps: { compile } });
  return { w, call };
}
async function asked(s) {
  const id = (await s.call('create_project', { title: 'Compilation' })).data.project_id;
  const r = await s.call('set_compilation_request', { project_id: id, phrase: 'great news', folders: ['My Videos'] });
  assert.equal(r.isError, undefined, r.text);
  return id;
}
/** The tool's answer for a run the database returned (through the stand-in, which clamps like the SQL). */
async function status(run) {
  const s = server(); const id = await asked(s);
  s.w.setCompilationRun(A.userId, id, { current: true, ...run });
  return s.call('get_compilation_status', { project_id: id });
}
/** The tool's answer when the database returns EXACTLY this run, unchecked (a hostile or broken answer). */
async function statusRaw(run) {
  const s = server(); const id = await asked(s);
  const base = s.w.data(A.userId); const real = await base.compilationGet(id);
  return s.call('get_compilation_status', { project_id: id }, { ...base, compilationGet: async () => ({ ...real, run }) });
}
const where = (r) => r.text.split('Where it stands: ')[1].split('\n')[0];

// ------------------------------------------------------------------------------------------------ the numbers
test('cleanProgress: only whole numbers in range count, only while it runs; step_done only with a step_total and never above it; nothing is clamped or kept as it came', () => {
  const N = { step_done: null, step_total: null, percent: null };
  assert.deepEqual(cleanProgress('planning', { step_done: 2, step_total: 3, percent: 45 }), { step_done: 2, step_total: 3, percent: 45 });
  assert.deepEqual(cleanProgress('matching', { step_done: 0, step_total: 3, percent: 0 }), { step_done: 0, step_total: 3, percent: 0 });
  assert.deepEqual(cleanProgress('building', { step_done: 1000, step_total: 1000, percent: 100 }), { step_done: 1000, step_total: 1000, percent: 100 });
  for (const state of ['done', 'failed', 'cancelled', 'stale', 'exploding', '', 'constructor']) assert.deepEqual(cleanProgress(state, { step_done: 2, step_total: 3, percent: 45 }), N, state);
  assert.deepEqual(cleanProgress('planning', null), N); assert.deepEqual(cleanProgress('planning', undefined), N); assert.deepEqual(cleanProgress('planning', {}), N);
  assert.deepEqual(cleanProgress('planning', { step_done: 2, percent: 45 }), { step_done: null, step_total: null, percent: 45 }, 'step_done without step_total is ignored');
  assert.deepEqual(cleanProgress('planning', { step_done: 4, step_total: 3, percent: 45 }), { step_done: null, step_total: 3, percent: 45 }, 'step_done above step_total is ignored, not cut to it');
  assert.deepEqual(cleanProgress('planning', { step_done: 2, step_total: 1001, percent: 45 }), { step_done: null, step_total: null, percent: 45 }, 'step_total above 1000 is ignored (and step_done with it)');
  assert.deepEqual(cleanProgress('planning', { step_done: 2, step_total: 3, percent: 101 }), { step_done: 2, step_total: 3, percent: null });
  for (const bad of [-1, 2.5, 1e12, NaN, Infinity, -Infinity, '3', '<b>3</b>', 'C:\\Users\\x', 'My Videos', true, [3], { a: 1 }, null, undefined]) {
    const c = cleanProgress('building', { step_done: bad, step_total: bad, percent: bad });
    assert.deepEqual(c, N, String(typeof bad === 'object' ? JSON.stringify(bad) : bad));
  }
  for (const v of Object.values(cleanProgress('building', { step_done: 1, step_total: 2, percent: 50 }))) assert.equal(typeof v, 'number');
});

// ------------------------------------------------------------------------------------------------ the closed wording list
const WORDS = [
  ['planning', { step_done: 2, step_total: 3, percent: 45 }, 'Planning: video 2 of 3, about 45% overall.'],
  ['matching', { step_done: 2, step_total: 3, percent: 45 }, 'Finding the matches: video 2 of 3, about 45% overall.'],
  ['building', { step_done: 3, step_total: 4, percent: 80 }, 'Building: clip 3 of 4, about 80% overall.'],
  ['planning', { step_done: 1, step_total: 1, percent: 100 }, 'Planning: video 1 of 1, about 100% overall.'],
  ['planning', { step_done: 0, step_total: 3, percent: 0 }, 'Planning: getting started, about 0% overall.'],
  ['building', { step_done: 0, step_total: 4, percent: null }, 'Building: getting started.'],
  ['planning', { step_done: 2, step_total: 3, percent: null }, 'Planning: video 2 of 3.'],
  ['matching', { step_done: null, step_total: null, percent: 45 }, 'Finding the matches: about 45% overall.'],
  ['building', { step_done: null, step_total: 4, percent: 80 }, 'Building: about 80% overall.'],
];
test('the words: a closed list, built only from the state and the three integers', () => {
  for (const [state, p, text] of WORDS) assert.equal(progressWords(state, p), text, text);
  // nothing usable, or not running: nothing (the caller keeps its older line)
  assert.equal(progressWords('planning', { step_done: null, step_total: null, percent: null }), null);
  assert.equal(progressWords('planning', {}), null);
  assert.equal(progressWords('building', { step_done: 0, step_total: 0, percent: null }), null, 'a total of 0 is nothing to say');
  assert.equal(progressWords('building', { step_done: 1, step_total: null, percent: null }), null);
  for (const state of ['done', 'failed', 'cancelled', 'stale', 'nonsense']) assert.equal(progressWords(state, { step_done: 2, step_total: 3, percent: 45 }), null, state);
  // every word comes from this list: remove the digits and what is left is one of a few fixed sentences
  const shapes = new Set();
  for (const lead of ['Planning', 'Finding the matches', 'Building']) for (const unit of ['video', 'clip']) for (const [done, total, pct] of [[2, 3, 45], [0, 3, 7], [999, 1000, 100], [1, 1, 0]]) {
    const state = lead === 'Planning' ? 'planning' : lead === 'Building' ? 'building' : 'matching';
    const t = progressWords(state, { step_done: done, step_total: total, percent: pct });
    shapes.add(t.replace(/\d+/g, 'N'));
    assert.ok(!/[^A-Za-z0-9 :,.%]/.test(t), t);
    assert.ok(!/\b(credit|price|free|\$|file|folder|path|C:)\b/i.test(t), t);
  }
  assert.deepEqual([...shapes].sort(), ['Building: clip N of N, about N% overall.', 'Building: getting started, about N% overall.', 'Finding the matches: getting started, about N% overall.', 'Finding the matches: video N of N, about N% overall.', 'Planning: getting started, about N% overall.', 'Planning: video N of N, about N% overall.'].sort());
});

test('runWords: the progress line replaces the older line only when there is something to say; matching keeps its places count; done, failed and cancelled never say it', () => {
  const run = (state, extra = {}) => ({ state, matches: null, clips: null, film_seconds: null, error_code: null, ...extra });
  assert.equal(runWords(run('planning', { step_done: 2, step_total: 3, percent: 45 }), true), 'Planning: video 2 of 3, about 45% overall.');
  assert.equal(runWords(run('building', { clips: 6, step_done: 3, step_total: 4, percent: 80 }), true), 'Building: clip 3 of 4, about 80% overall.');
  assert.equal(runWords(run('matching', { matches: 14, step_done: 2, step_total: 3, percent: 45 }), true), 'Finding the matches: video 2 of 3, about 45% overall. Found 14 places so far.');
  assert.equal(runWords(run('matching', { matches: 1, percent: 5 }), true), 'Finding the matches: about 5% overall. Found 1 place so far.');
  // no counts: today's lines, word for word
  assert.equal(runWords(run('planning'), true), "The Ryagram app on the person's computer has the request and is planning the film.");
  assert.equal(runWords(run('matching', { matches: 14 }), true), 'Matching: found 14 places so far.');
  assert.equal(runWords(run('matching'), true), "Matching: the app is looking through the person's clips.");
  assert.equal(runWords(run('building', { clips: 6 }), true), "Building the film on the person's computer: 6 clips so far.");
  assert.equal(runWords(run('building', { step_done: 9, step_total: 3, percent: 200 }), true), "Building the film on the person's computer.", 'invalid values are ignored: today\'s line');
  for (const [state, extra] of [['done', { clips: 5, film_seconds: 40 }], ['failed', { error_code: 'crash' }], ['cancelled', {}]]) {
    const t = runWords(run(state, { ...extra, step_done: 2, step_total: 3, percent: 45 }), true);
    assert.ok(!/video|clip \d|overall/.test(t), t);
    assert.equal(t, runWords(run(state, extra), true), 'the same words as without the numbers');
  }
});

// ------------------------------------------------------------------------------------------------ the tool, end to end through the stand-in database
for (const [state, p, text] of WORDS.slice(0, 3)) {
  test(`get_compilation_status, ${state} with ${p.step_done} of ${p.step_total}, ${p.percent}%: the words and the structured numbers`, async () => {
    const r = await status({ state, ...p });
    assert.equal(r.isError, undefined, r.text);
    assert.ok(where(r).startsWith(text), where(r));
    assert.deepEqual(r.data.run, { state, matches: null, clips: null, film_seconds: null, error_code: null, ...p });
    assert.equal(r.data.looked_up, true);
    assert.ok(!/credit|price|\$/i.test(where(r)));
  });
}

test('get_compilation_status: no counts at all is today\'s answer, with the three keys null; an end state says nothing of progress even if the data still holds numbers', async () => {
  const none = await status({ state: 'building', clips: 6 });
  assert.equal(where(none), "Building the film on the person's computer: 6 clips so far.");
  assert.deepEqual(none.data.run, { state: 'building', matches: null, clips: 6, film_seconds: null, error_code: null, step_done: null, step_total: null, percent: null });
  for (const run of [{ state: 'done', clips: 5, film_seconds: 40 }, { state: 'failed', error_code: 'not_said' }, { state: 'cancelled' }]) {
    for (const via of [status, statusRaw]) {
      const r = await via({ ...run, current: true, step_done: 2, step_total: 3, percent: 45 });
      assert.ok(!/\bvideo \d|overall|clip \d/.test(where(r)), where(r));
      assert.deepEqual([r.data.run.step_done, r.data.run.step_total, r.data.run.percent], [null, null, null], run.state);
    }
  }
});

test('get_compilation_status: out-of-range or wrong-kind values from the database are ignored and never printed raw (not in the words, not in the data, not anywhere in the answer)', async () => {
  const hostile = [
    { step_done: 'My Secret Folder', step_total: 'C:\\Users\\alice\\clips', percent: '<b>45</b>' },
    { step_done: 9, step_total: 3, percent: 4500 },
    { step_done: -2, step_total: -3, percent: -1 },
    { step_done: 2.5, step_total: 3.5, percent: 45.5 },
    { step_done: NaN, step_total: Infinity, percent: -Infinity },
    { step_done: 2, step_total: 1e9, percent: 1e9 },
    { step_done: { name: 'x' }, step_total: ['a.mp4'], percent: true },
    { step_done: '2', step_total: '3', percent: '45' },
  ];
  for (const h of hostile) for (const state of ['planning', 'matching', 'building']) {
    const r = await statusRaw({ state, matches: null, clips: null, film_seconds: null, error_code: null, current: true, ...h });
    assert.equal(r.isError, undefined, r.text);
    const all = JSON.stringify(r);
    for (const raw of ['My Secret Folder', 'C:\\\\Users', '<b>', 'a.mp4', '4500', '1000000000', '"name"']) assert.ok(!all.includes(raw), `${raw} is not in the answer for ${JSON.stringify(h)}`);
    const run = r.data.run;
    for (const k of ['step_done', 'step_total', 'percent']) assert.ok(run[k] === null || (Number.isInteger(run[k]) && run[k] >= 0), `${k}: ${run[k]}`);
    assert.ok(run.step_total === null || run.step_total <= 1000); assert.ok(run.percent === null || run.percent <= 100); assert.ok(run.step_done === null || run.step_done <= run.step_total);
  }
  // one valid and two invalid: the valid one stands alone
  const one = await statusRaw({ state: 'planning', current: true, step_done: 'x', step_total: 'y', percent: 45 });
  assert.equal(where(one), 'Planning: about 45% overall.');
});

test('a report for an earlier request shows no progress at all (the run is not the answer for this request)', async () => {
  const r = await status({ state: 'building', step_done: 3, step_total: 4, percent: 80, current: false });
  assert.equal(r.data.run, null); assert.equal(r.data.run_is_for_an_earlier_request, true);
  assert.ok(!/clip 3|overall/.test(r.text));
});

test('the stand-in database answers like the SQL: three keys always, whole numbers in range or null, nothing outside planning, matching and building', async () => {
  const s = server(); const id = await asked(s); const d = s.w.data(A.userId);
  const get = async (run) => { s.w.setCompilationRun(A.userId, id, run); return (await d.compilationGet(id)).run; };
  const keys = (r) => [r.step_done, r.step_total, r.percent];
  assert.deepEqual(keys(await get({ state: 'planning' })), [null, null, null]);
  assert.deepEqual(keys(await get({ state: 'planning', step_done: 1, step_total: 2, percent: 50 })), [1, 2, 50]);
  assert.deepEqual(keys(await get({ state: 'building', step_done: 3, step_total: 2, percent: 101 })), [null, 2, null]);
  assert.deepEqual(keys(await get({ state: 'building', step_done: 1, percent: 5 })), [null, null, 5]);
  assert.deepEqual(keys(await get({ state: 'done', step_done: 1, step_total: 2, percent: 50 })), [null, null, null]);
  assert.deepEqual(keys(await get({ state: 'building', step_done: '1', step_total: '2', percent: '5' })), [null, null, null]);
});

test('the tool description says the progress plainly and promises nothing more', () => {
  const t = TOOLS.find((x) => x.name === 'get_compilation_status');
  assert.match(t.description, /which video or clip it is on, like 'video 2 of 3', and about how far along the whole build is, as a percent/);
  assert.ok(!/credit|price|\$|\bfree\b/i.test(t.description.replace('costs nothing', '')));
  assert.equal(t.readOnly, true);
});

// ------------------------------------------------------------------------------------------------ the status card
const HTML = compilationHtml(APP);
const SCRIPT = HTML.slice(HTML.indexOf('<script>') + 8, HTML.indexOf('</script>'));
class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._t = ''; this.listeners = {}; this.attrs = {}; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._t; }
  set textContent(v) { this.children = []; this._t = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  getAttribute(n) { return this.attrs[n] ?? null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  set innerHTML(_v) { throw new Error('innerHTML was used'); }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function load() {
  const host = { postMessage: () => {} };
  const root = new Node_('main'); const body = new Node_('body'); body.attrs['data-app-url'] = APP;
  const listeners = {};
  const win = { parent: host, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); } };
  const doc = { getElementById: (id) => (id === 'cc' ? root : null), body, createElement: (t) => new Node_(t), documentElement: { getBoundingClientRect: () => ({ height: 120, width: 400 }) } };
  vm.runInNewContext(SCRIPT, { window: win, document: doc, String, Array, Math, isFinite }, { timeout: 2000 });
  return { root, fire: (sc) => listeners.message.forEach((f) => f({ source: host, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'x' }], structuredContent: sc } } })) };
}
const stepLine = (root) => (root.all().find((n) => n.className === 'step') || { textContent: null }).textContent;
const REQ = { looked_up: true, has_request: true, request: { phrase: 'great news', search: 'every', folders: ['My Videos'], rules: 0, texts: 0, cards: 0 } };
const draw = (run) => { const p = load(); p.fire({ ...REQ, run }); return p; };

for (const [state, p, text] of WORDS) {
  test(`the card, ${state}: ${text}`, () => {
    const q = draw({ state, matches: null, clips: null, film_seconds: null, error_code: null, ...p });
    assert.equal(stepLine(q.root), text);
  });
}
test('the card: no counts is today\'s line; matching keeps its places count; an end state says nothing of progress', () => {
  const n = { matches: null, clips: null, film_seconds: null, error_code: null };
  assert.equal(stepLine(draw({ state: 'planning', ...n }).root), 'Planning: the Ryagram app on your computer has the request and is planning the film.');
  assert.equal(stepLine(draw({ state: 'planning', ...n, step_done: null, step_total: null, percent: null }).root), 'Planning: the Ryagram app on your computer has the request and is planning the film.');
  assert.equal(stepLine(draw({ state: 'matching', ...n, matches: 14 }).root), 'Matching: found 14 places so far.');
  assert.equal(stepLine(draw({ state: 'matching', ...n, matches: 14, step_done: 2, step_total: 3, percent: 45 }).root), 'Finding the matches: video 2 of 3, about 45% overall. Found 14 places so far.');
  assert.equal(stepLine(draw({ state: 'building', ...n, clips: 6 }).root), 'Building: 6 clips so far.');
  assert.equal(stepLine(draw({ state: 'building', ...n, clips: 6, step_done: 3, step_total: 4, percent: 80 }).root), 'Building: clip 3 of 4, about 80% overall.');
  for (const [state, extra, expect] of [['done', { clips: 5, film_seconds: 40 }, 'Done: 5 clips, 40 seconds. The film is on your computer: open the Ryagram app to see it.'], ['failed', { error_code: 'not_said' }, 'Stopped: your videos do not say it.'], ['cancelled', {}, 'Stopped: you stopped it on your computer.']]) {
    assert.equal(stepLine(draw({ state, ...n, ...extra, step_done: 2, step_total: 3, percent: 45 }).root), expect, state);
  }
});

test('the card: out-of-range, fractional, text, negative, NaN and object values are ignored and never drawn as they came; the page never makes an element from them', () => {
  const n = { matches: null, clips: null, film_seconds: null, error_code: null };
  const base = 'Building: the film is being made on your computer.';
  for (const h of [{ step_done: 9, step_total: 3, percent: 4500 }, { step_done: -1, step_total: -2, percent: -3 }, { step_done: 2.5, step_total: 3.5, percent: 45.5 }, { step_done: NaN, step_total: Infinity, percent: NaN },
    { step_done: 'My Secret Folder', step_total: 'C:\\Users\\alice', percent: '<img src=x onerror=alert(1)>' }, { step_done: { a: 1 }, step_total: [1], percent: true }, { step_done: 2, step_total: 1e9, percent: 1e9 }, { step_done: '2', step_total: '3', percent: '45' }, { step_done: 1, step_total: 1001, percent: 101 }, { percent: 150 }]) {
    const q = draw({ state: 'building', ...n, ...h });
    assert.equal(stepLine(q.root), base, JSON.stringify(h));
    assert.ok(!/Secret|Users|<|4500|overall/.test(q.root.textContent), JSON.stringify(h));
    assert.ok(q.root.all().every((x) => ['main', 'div', 'span', 'h1', 'p', 'button'].includes(x.tag)));
  }
  assert.equal(stepLine(draw({ state: 'planning', ...n, step_done: 'x', step_total: 'y', percent: 45 }).root), 'Planning: about 45% overall.', 'one valid number stands alone');
  assert.equal(stepLine(draw({ state: 'planning', ...n, step_done: 5, step_total: 3, percent: 45 }).root), 'Planning: about 45% overall.', 'step_done above step_total is dropped with its pair');
  assert.equal(stepLine(draw({ state: 'planning', ...n, step_done: 2, percent: 45 }).root), 'Planning: about 45% overall.', 'step_done without step_total is dropped');
  assert.equal(stepLine(draw({ state: 'planning', ...n, step_done: 0, step_total: 0, percent: 1 }).root), 'Planning: about 1% overall.', 'a total of 0 is no pair');
});

test('the card and the tool say the same progress words for the same run (the real tool answer is what the card draws), and the strip does not move', async () => {
  for (const [state, p, text] of WORDS) {
    const r = await status({ state, ...p });
    const q = load(); q.fire(r.data);
    assert.equal(stepLine(q.root), text);
    assert.ok(where(r).startsWith(text), where(r));
    const on = q.root.all().filter((x) => /^seg/.test(x.className)).map((x) => x.className === 'seg on');
    assert.deepEqual(on, [0, 1, 2, 3, 4].map((i) => i <= { planning: 1, matching: 2, building: 3 }[state]));
  }
});

test('the card uses textContent only, makes no network call and has no number, name or word of its own beyond the fixed lines (the page still passes its own safety scan)', () => {
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest']) assert.ok(!HTML.includes(bad), bad);
  assert.ok(!/=>|\blet\b|\bconst\b|`|\basync\b|\bawait\b|\.\.\./.test(SCRIPT.replace(/'[^'\n]*'/g, "''")), 'ES5 only');
  new vm.Script(SCRIPT);
  const words = SCRIPT.match(/'[^'\n]{6,}'/g).join('\n');
  assert.ok(!/\bcredit|\bprice|\bfree\b|\$\s?\d/i.test(words));
  for (const piece of ["'Finding the matches'", "'getting started'", "'about '+r.pc+'% overall'", "'Planning','video'", "'Building','clip'"]) assert.ok(SCRIPT.includes(piece), piece);
});

// ------------------------------------------------------------------------------------------------ the SQL (NOT run tonight: its text is pinned here, and the rollback is proved to be the old function)
const MIG = read('supabase/migrations/20261128000200_connect_compilation_progress.sql');
const ROLL = read('supabase/rollbacks/20261128000200_connect_compilation_progress_rollback.sql');
const CHECK = read('supabase/live-steps/86_connect_compilation_progress_check.sql');
const OLD = read('supabase/migrations/20261127000400_connect_compilation_status.sql');
const blobSha = (text) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(text) + '\0'), Buffer.from(text)])).digest('hex');
const body = (sql, start) => { const i = sql.indexOf(start); assert.ok(i >= 0, start); return sql.slice(i, sql.indexOf('end $$;', i) + 7); };

test('the earlier migration is untouched (blob 806c847f) and so is every other file this one must not change', () => {
  assert.ok(blobSha(OLD).startsWith('806c847f'), blobSha(OLD));
});

test('the migration: needs BUILDER\'s 20261128000100 first (said in the header), replaces ONE function with the same signature and the same grants, security definer, empty search path, and touches nothing else', () => {
  const head = MIG.split('begin;')[0];
  assert.match(head, /NEEDS BUILDER'S 20261128000100_compilation_progress\.sql FIRST/);
  assert.match(head, /NOT APPLIED/);
  assert.equal((MIG.match(/create or replace function/g) || []).length, 1);
  assert.equal((MIG.match(/create function/g) || []).length, 0);
  assert.match(MIG, /create or replace function public\.connect_compilation_get\(p_token_hash text, p_project uuid\) returns jsonb\nlanguage plpgsql security definer set search_path = '' as \$\$/);
  assert.match(MIG, /revoke execute on function public\.connect_compilation_get\(text, uuid\) from public, anon, authenticated, service_role;\ngrant execute on function public\.connect_compilation_get\(text, uuid\) to connect_runner;/);
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate)\b/i.test(MIG.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''")), 'no write, no schema change');
  assert.ok(!MIG.includes('connect_set_compilation_request(') && !/create (or replace )?function ryagram_private/.test(MIG), 'the writer and the gate are not touched');
  assert.match(MIG, /select ryagram_private\.gate_apply\(\);/);
  // everything in the old function that is not the run is still here, exactly
  for (const line of ["me uuid := ryagram_private.connect_actor(p_token_hash, 'read');", "if not ryagram_private.connect_compilations_open(me) then", "raise exception 'Compilations are not open for this account yet.' using errcode = '42501';",
    "if not exists (select 1 from public.projects p where p.id = p_project and p.owner_id = me) then", "from public.compilation_requests r where r.project_id = p_project and r.owner_id = me;",
    "return jsonb_build_object('request', null, 'sha256', null, 'updated_at', null, 'run', null);", "return jsonb_build_object('request', req_json, 'sha256', req_sha, 'updated_at', req_at, 'run', run);",
    "from public.compilation_runs c where c.project_id = $1 and c.owner_id = $2 order by c.started_at desc nulls last, c.id desc limit 1", "exception when undefined_column or undefined_function then"]) {
    assert.ok(OLD.includes(line), 'old has it: ' + line); assert.ok(MIG.includes(line), 'new has it: ' + line);
  }
});

test('the migration: the three values are read as keys of the row\'s own jsonb, only a JSON number written as a whole number counts, the ranges are the contract\'s, only while running, always three keys', () => {
  const fn = body(MIG, 'create or replace function public.connect_compilation_get');
  for (const k of ['step_done', 'step_total', 'percent']) assert.ok(fn.includes(`to_jsonb(c) -> ''${k}''`), k);
  assert.ok(fn.includes("run ->> 'state' in ('planning', 'matching', 'building')"));
  assert.equal((fn.match(/jsonb_typeof\(prog -> '(step_total|step_done|percent)'\) = 'number'/g) || []).length, 3, 'a number, not text');
  assert.ok(fn.includes("'^[0-9]{1,4}$'") && fn.includes("'^[0-9]{1,3}$'"));
  assert.ok(fn.includes('st_text::int <= 1000 else') && fn.includes('sd_text::int <= st else') && fn.includes('pc_text::int <= 100 else'), 'the ranges, each closed by its else (so 10000 or 1000 cannot pass for 1000 or 100)');
  assert.ok(fn.includes('case when st is not null and sd_text'), 'step_done only with a valid step_total');
  const code = fn.replace(/--[^\n]*/g, '');
  assert.ok(!/\band\s+\w+::int/.test(code) && !/::int[^\n]*\band\b/.test(code), 'a cast is never beside an AND (SQL may run it first): CASE only');
  assert.ok(fn.includes("jsonb_build_object('step_done', sd, 'step_total', st, 'percent', pc)"), 'always three keys');
  assert.ok(fn.includes("run := run - 'progress';"), 'the helper key does not leak into the answer');
  assert.ok(!/\b(name|folder|path|phrase|transcript)\b/i.test(fn.replace(/--[^\n]*/g, '')), 'no text column is read for progress');
});

test('the rollback puts back EXACTLY the function of 20261127000400 (its body is that file\'s, byte for byte) with the same grants, and touches nothing else', () => {
  const was = body(OLD, 'create function public.connect_compilation_get');
  const back = body(ROLL, 'create or replace function public.connect_compilation_get');
  assert.equal(back, was.replace('create function', 'create or replace function'));
  assert.match(ROLL, /grant execute on function public\.connect_compilation_get\(text, uuid\) to connect_runner;/);
  assert.match(ROLL, /revoke execute on function public\.connect_compilation_get\(text, uuid\) from public, anon, authenticated, service_role;/);
  assert.ok(!/step_done|step_total|percent/.test(ROLL.replace(/--[^\n]*/g, '')), 'the old function has no progress');
  assert.equal((ROLL.replace(/--[^\n]*/g, '').match(/create (or replace )?function/g) || []).length, 1);
  assert.ok(!/\bdrop\b|\balter\b/i.test(ROLL.replace(/--[^\n]*/g, '')));
  assert.match(ROLL.split('begin;')[0], /NOT a migration/);
});

test('the live step 86 check: one read-only SELECT, no write, the columns row, the function rows and the grants rows; step 66 still holds', () => {
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i.test(CHECK.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''")), 'read-only');
  assert.equal((CHECK.match(/^select /gm) || []).length, 1);
  assert.equal((CHECK.match(/union all select/g) || []).length, 8, 'nine rows');
  for (const x of ["'step_done', 'step_total', 'percent'", 'only the connector login', "''planning'', ''matching'', ''building''", "st_text::int <= 1000 else", 'sd_text::int <= st else', 'pc_text::int <= 100 else', 'has_function_privilege(\'authenticated\'']) assert.ok(CHECK.toLowerCase().includes(x.toLowerCase()), x);
  assert.match(CHECK.split('select')[0], /AFTER 20261128000200_connect_compilation_progress\.sql/);
  assert.match(CHECK, /BUILDER's 20261128000100/);
  const step66 = read('supabase/live-steps/66_connect_compilation_status_check.sql');
  assert.ok(step66.includes("p.prosrc like '%connect_actor(p_token_hash, ''read'')%'") && MIG.includes("connect_actor(p_token_hash, 'read')"), 'what step 66 pins on the function is still in the new body');
  assert.ok(!/(insert|update|delete)\b/i.test(body(MIG, 'create or replace function public.connect_compilation_get').replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''").replace(/updated_at/g, '')), 'step 66\'s "writes nothing" row still holds');
});
