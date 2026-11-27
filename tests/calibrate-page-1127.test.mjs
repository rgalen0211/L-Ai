// "Help tune Ryagram, earn credits" (#/calibrate; WEB 11-27): behind the per-account switch 'calibrate'. Switch off = nothing; no task or clip before the opt-in; an answer only from a real click or key press;
// the calls carry only the round token, the item token and the chosen option; every credit number comes from the server; the page knows nothing about checks or timing; the words are the planned ones. Driven through a tiny fake DOM (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; this.className = ''; this.src = ''; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; }
  append(...c) { for (const x of c) this.children.push(x); }
  replaceChildren(...c) { this.children = []; this.append(...c); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  focus() {}
  get id() { return this.attrs.id; }
  get textContent() { return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.children = [String(v)]; }
  walk(fn) { fn(this); for (const c of this.children) if (typeof c !== 'string') c.walk(fn); }
  querySelectorAll(sel) { const out = []; this.walk(n => { if (n !== this && n.tag === sel) out.push(n); }); return out; }
  find(pred) { let r = null; this.walk(n => { if (!r && pred(n)) r = n; }); return r; }
  findAll(pred) { const r = []; this.walk(n => { if (pred(n)) r.push(n); }); return r; }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const fire = async (el, type, ev) => { for (const fn of el.listeners[type] || []) await fn({ type, ...ev, preventDefault() {} }); await new Promise(r => setTimeout(r, 0)); };
const click = (el, trusted = true) => fire(el, 'click', { isTrusted: trusted });
const top = nodes => { const root = new El('div'); root.append(...nodes); return root; };
const text = root => root.textContent;

const win = { ryagramSwitches: { featureOn: n => n === 'calibrate' && win.__on !== false } };
vm.runInNewContext(read('assets/app-calibrate.js'), { window: win });
const C = win.ryagramCalibrate;

const TASKS = {
  better_cut: { token: 'it-1', type: 'better_cut', prompt: 'Which cut is better?', options: [{ id: 'a', label: 'Cut A', clip: { kind: 'own_app', url: 'http://127.0.0.1:5000/a.mp4', label: 'A' } }, { id: 'b', label: 'Cut B', clip: { kind: 'licensed', url: 'https://example.test/b.mp4', label: 'B' } }] },
  confirm_speaker: { token: 'it-2', type: 'confirm_speaker', prompt: 'Same person?', clip: { kind: 'own_app', url: 'http://localhost:5000/c.mp4', label: 'C' }, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  is_phrase: { token: 'it-3', type: 'is_phrase', prompt: 'Is this the phrase?', clip: { kind: 'licensed', url: 'https://example.test/d.mp4', label: 'D' }, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  rate_match: { token: 'it-4', type: 'rate_match', prompt: 'Rate it', clip: { kind: 'licensed', url: 'https://example.test/e.mp4', label: 'E' }, options: [1, 2, 3, 4, 5].map(n => ({ id: String(n), label: String(n) })) }
};
function stub(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  const state = { consented: false };
  const d = {
    calls,
    myCalibrationConsent: rec('consent_get', async () => ({ consented: state.consented })),
    setMyCalibrationConsent: rec('consent_set', async on => { state.consented = on; return { consented: on }; }),
    myCalibrationRound: rec('round_get', async () => ({ state: 'ready', round: { token: 'rt-1', total: 4, answered: 0, tasks: Object.values(TASKS) }, cap: { reached: false } })),
    setMyCalibrationAnswer: rec('answer_set', async () => ({ ok: true, answered: 1, total: 4, cap_reached: false, round_done: false })),
    myCalibrationEarned: rec('earned_get', async () => ({ total: 7, today: 2, week: 3, round: 1, ledger: [{ id: 'l-1', at: '2026-11-27T10:00:00Z', task_type: 'round', credits: 2, undone: false }] })),
    undoMyCalibrationAward: rec('undo', async () => ({ ok: true })),
    ...over
  };
  d.state = state;
  return d;
}
const make = d => C.create({ h, data: d, date: () => 'Nov 27, 2026' });

test('SWITCH OFF: one Coming soon line, no call at all, no form', async () => {
  win.__on = false;
  const d = stub();
  const page = top(await make(d).pageView());
  assert.equal(d.calls.length, 0);
  assert.match(text(page), /Coming soon\./);
  assert.equal(page.findAll(n => n.tag === 'button' || n.tag === 'input').length, 0);
  win.__on = true;
});

test('CONSENT GATE: with no opt-in nothing is fetched or drawn (no round call, no task, no video); the button stays off until the box is ticked, and only a real click counts', async () => {
  const d = stub();
  const page = top(await make(d).pageView());
  assert.deepEqual(d.calls.map(c => c[0]), ['consent_get']);
  assert.equal(page.findAll(n => n.tag === 'video').length, 0);
  assert.ok(!page.find(n => n.id === 'cal-task'));
  const box = page.find(n => n.id === 'cal-optin'), go = page.find(n => n.id === 'cal-on');
  assert.equal(go.disabled, true);
  assert.ok(text(page).includes('My answers may be used to improve Ryagram.'));
  await click(go);      // box not ticked: nothing
  assert.deepEqual(d.calls.map(c => c[0]), ['consent_get']);
  box.checked = true; go.disabled = false;
  await click(go, false);      // a script's click: nothing, and the page says so
  assert.deepEqual(d.calls.map(c => c[0]), ['consent_get']);
  assert.match(text(page), /Answers only count from your own click or key press\./);
  await click(go);
  assert.deepEqual(d.calls.slice(1, 2)[0], ['consent_set', true, 'calibrate-consent-1']);
  assert.ok(d.calls.some(c => c[0] === 'round_get'));
  assert.ok(page.find(n => n.id === 'cal-task'), 'after the opt-in the first task is drawn');
});

test('ONLY THE PERSON ANSWERS: a script click, a script key press, and an Enter on nothing send nothing; a real click or key sends ids and the option only', async () => {
  const d = stub(); d.state.consented = true;
  const page = top(await make(d).pageView());
  const card = page.find(n => n.id === 'cal-task');
  assert.equal(card.attrs['data-type'], 'better_cut');
  const opt = page.find(n => n.attrs && n.attrs['data-option'] === 'b');
  await click(opt, false);
  await fire(card, 'keydown', { isTrusted: false, key: '1' });
  assert.equal(d.calls.filter(c => c[0] === 'answer_set').length, 0);
  assert.match(text(page), /Answers only count from your own click or key press\./);
  await click(opt, true);
  assert.deepEqual(d.calls.filter(c => c[0] === 'answer_set')[0], ['answer_set', 'rt-1', 'it-1', 'b']);
  const card2 = page.find(n => n.id === 'cal-task');
  assert.equal(card2.attrs['data-type'], 'confirm_speaker');
  await fire(card2, 'keydown', { isTrusted: true, key: '2' });
  assert.deepEqual(d.calls.filter(c => c[0] === 'answer_set')[1], ['answer_set', 'rt-1', 'it-2', 'no']);
  await fire(page.find(n => n.id === 'cal-task'), 'keydown', { isTrusted: true, key: 's' });
  assert.deepEqual(d.calls.filter(c => c[0] === 'answer_set')[2], ['answer_set', 'rt-1', 'it-3', 'skip']);
  await fire(page.find(n => n.id === 'cal-task'), 'keydown', { isTrusted: true, key: '1', ctrlKey: true });      // a browser shortcut is not an answer
  assert.equal(d.calls.filter(c => c[0] === 'answer_set').length, 3);
});

test('NO PATH OR CLIP DATA IN ANY CALL: only the choice, the words id, a round id, a task id and an option; no clip address, no label, no path', async () => {
  const d = stub();
  const page = top(await make(d).pageView());
  page.find(n => n.id === 'cal-optin').checked = true;
  await click(page.find(n => n.id === 'cal-on'));
  for (let i = 0; i < 4; i++) await click(page.find(n => n.attrs && n.attrs['data-option']) || page.find(n => n.id === 'cal-skip'));
  await click(page.find(n => n.id === 'cal-undo') || page.find(n => n.className && n.className.includes('cal-undo')));
  const sent = JSON.stringify(d.calls.map(c => c.slice(1)));
  assert.ok(!/http|127\.0|localhost|\.mp4|[\\/]|clip|label|prompt|[A-Za-z]:/i.test(sent.replace('calibrate-consent-1', '')), sent);
  const src = read('assets/app-calibrate.js') + read('assets/app-data.js').split('Calibrate for credits')[1].split('listOrders')[0];
  assert.ok(!/fetch\(|XMLHttpRequest|FileReader|FormData|arrayBuffer|\.blob\(/.test(src), 'the page reads and sends no file');
});

test('EVERY CREDIT NUMBER COMES FROM THE SERVER: shown as sent, omitted when absent, never typed on the page', async () => {
  const d = stub(); d.state.consented = true;
  let page = top(await make(d).pageView());
  assert.match(text(page), /Earned this round: 1\. Earned today: 2\. Earned this week: 3\. Credits earned so far: 7\./);
  await click(page.find(n => n.attrs && n.attrs['data-option'] === 'a'));
  assert.ok(/Saved\./.test(text(page)) && !/You earned/.test(text(page)), 'a single answer never shows a credit number');
  assert.match(text(page), /1 of 4 answered\./);
  const d2 = stub({ myCalibrationEarned: async () => ({ ledger: [] }), setMyCalibrationAnswer: async () => ({ ok: true, answered: 1, total: 4 }) }); d2.state.consented = true;
  page = top(await make(d2).pageView());
  assert.ok(!/Credits earned/.test(text(page)));
  await click(page.find(n => n.attrs && n.attrs['data-option'] === 'a'));
  assert.ok(/Saved\./.test(text(page)) && !/You earned/.test(text(page)));
  for (const s of flat(C.WORDS)) assert.ok(!/\d/.test(s), `no number in the words: ${s}`);
  assert.equal(JSON.stringify(C.earnedLines({ total: 'x' })), '[]');
});
function flat(o) { return Object.values(o).flatMap(v => (typeof v === 'string' ? [v] : flat(v))); }

test('TAKE BACK: a real click undoes one award and the block reloads; a script click does not', async () => {
  const d = stub(); d.state.consented = true;
  const page = top(await make(d).pageView());
  const undo = page.find(n => n.className && n.className.includes('cal-undo'));
  await click(undo, false);
  assert.equal(d.calls.filter(c => c[0] === 'undo').length, 0);
  await click(undo);
  assert.deepEqual(d.calls.filter(c => c[0] === 'undo')[0], ['undo', 'l-1']);
  assert.match(text(page), /Taken back\./);
});

test('THE FOUR TASK TYPES draw; an unknown type or a bad shape offers only Skip; a bad clip address is never played', () => {
  for (const t of Object.values(TASKS)) assert.ok(C.taskShape(t), t.type);
  assert.equal(C.taskShape({ ...TASKS.is_phrase, type: 'mystery' }), null);
  assert.equal(C.taskShape({ ...TASKS.is_phrase, options: [] }), null);
  assert.equal(C.taskShape({ ...TASKS.is_phrase, options: [{ id: 'skip', label: 'x' }] }), null, 'skip is the page’s own word');
  assert.equal(C.taskShape({ ...TASKS.is_phrase, options: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }] }), null);
  assert.equal(C.taskShape({ ...TASKS.better_cut, options: [TASKS.better_cut.options[0], { id: 'b', label: 'B' }] }), null, 'better_cut needs a clip for each side');
  const ok = ['http://127.0.0.1:8080/a.mp4', 'http://localhost/a.mp4', 'http://[::1]:9/a'];
  for (const u of ok) assert.ok(C.clipUrl({ kind: 'own_app', url: u }), u);
  for (const u of ['http://example.com/a.mp4', 'https://127.0.0.1/a', 'file:///C:/a.mp4', 'javascript:alert(1)', 'http://127.0.0.1.evil.test/a', 'http://localhost@evil.test/a']) assert.equal(C.clipUrl({ kind: 'own_app', url: u }), null, u);
  assert.ok(C.clipUrl({ kind: 'licensed', url: 'https://example.test/a.mp4' }));
  for (const u of ['http://example.test/a.mp4', 'https://user@evil.test/a', 'data:video/mp4;base64,AA', 'javascript:1', '//example.test/a']) assert.equal(C.clipUrl({ kind: 'licensed', url: u }), null, u);
  assert.equal(C.clipUrl({ kind: 'weird', url: 'https://example.test/a' }), null);
});

test('AN UNKNOWN TASK on the page: the card says so and the only button is Skip; the bad clip draws a line, not a video', async () => {
  const bad = { ...TASKS.is_phrase, token: 'it-8', clip: { kind: 'licensed', url: 'javascript:alert(1)' } };
  const d = stub({ myCalibrationRound: async () => ({ state: 'ready', round: { token: 'rt-2', total: 2, answered: 0, tasks: [{ token: 'it-9', type: 'mystery', prompt: 'x', options: [] }, bad] } }) }); d.state.consented = true;
  const page = top(await make(d).pageView());
  assert.match(text(page), /We can’t show this question\. Skip it\./);
  assert.deepEqual(page.findAll(n => n.tag === 'button' && !(n.className || '').includes('cal-undo')).map(b => b.attrs.id), ['cal-skip', 'cal-stop']);
  await click(page.find(n => n.id === 'cal-skip'));
  assert.deepEqual(d.calls.find(c => c[0] === 'answer_set'), ['answer_set', 'rt-2', 'it-9', 'skip']);
  assert.equal(page.findAll(n => n.tag === 'video').length, 0);
  assert.match(text(page), /We can’t show this question\./);
});

test('CLIPS: a video gets a source only for an opted-in person and only a good address, never autoplay, preload none', async () => {
  const d = stub(); d.state.consented = true;
  const page = top(await make(d).pageView());
  const vids = page.findAll(n => n.tag === 'video');
  assert.equal(vids.length, 2);      // better_cut: A and B
  for (const v of vids) assert.ok(v.attrs.preload === 'none' && !('autoplay' in v.attrs) && v.attrs.controls !== undefined && v.src.startsWith('http'));
});

test('STATES: no round, the daily cap (from the round or from an answer), round done, withdraw, and the errors are plain lines', async () => {
  let d = stub({ myCalibrationRound: async () => ({ state: 'none', round: null }) }); d.state.consented = true;
  let page = top(await make(d).pageView());
  assert.match(text(page), /There are no questions right now\. Come back later\./);
  d = stub({ myCalibrationRound: async () => ({ state: 'cap_reached', round: null, cap: { reached: true } }) }); d.state.consented = true;
  page = top(await make(d).pageView());
  assert.match(text(page), /You have reached today’s limit\. Come back tomorrow\./);
  assert.ok(!page.find(n => n.id === 'cal-task'));
  d = stub({ setMyCalibrationAnswer: async () => ({ ok: true, answered: 1, total: 4, cap_reached: true }) }); d.state.consented = true;
  page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option']));
  assert.ok(page.find(n => n.id === 'cal-cap') && !page.find(n => n.id === 'cal-task'));
  d = stub({ setMyCalibrationAnswer: async () => ({ ok: true, answered: 4, total: 4, round_done: true, round_result: 'awarded' }) }); d.state.consented = true;
  page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option']));
  assert.match(text(page), /That is all for this round\. Thank you\./);
  d = stub(); d.state.consented = true;
  page = top(await make(d).pageView());
  await click(page.find(n => n.id === 'cal-stop'), false);
  assert.equal(d.calls.filter(c => c[0] === 'consent_set').length, 0);
  await click(page.find(n => n.id === 'cal-stop'));
  assert.deepEqual(d.calls.find(c => c[0] === 'consent_set'), ['consent_set', false, 'calibrate-consent-1']);
  assert.match(text(page), /Stopped\./);
  assert.ok(page.find(n => n.id === 'cal-optin') && !page.find(n => n.id === 'cal-optin').checked, 'back to the opt-in, box clear');
  d = stub({ myCalibrationRound: async () => { throw new Error('boom'); } }); d.state.consented = true;
  page = top(await make(d).pageView());
  assert.match(text(page), /Couldn’t load your questions\. Try again in a minute\./);
  d = stub({ setMyCalibrationAnswer: async () => { throw new Error('boom'); } }); d.state.consented = true;
  page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option']));
  assert.match(text(page), /Couldn’t save that answer\. Try it again\./);
  assert.ok(page.find(n => n.id === 'cal-task'), 'the question stays so the person can try again');
  d = stub({ setMyCalibrationConsent: async () => { throw new Error('boom'); } });
  page = top(await make(d).pageView());
  page.find(n => n.id === 'cal-optin').checked = true; page.find(n => n.id === 'cal-on').disabled = false;
  await click(page.find(n => n.id === 'cal-on'));
  assert.match(text(page), /Couldn’t save your choice\. Try again\./);
});

test('PLAIN WORDS: every sentence the page can show is in the design (FOR RYAN’S YES), none promises an amount, none carries legal wording or names Ryan’s own clips', () => {
  const doc = read('proposals/WEB-CALIBRATE-PAGE-1127.md');
  const W = C.WORDS;
  const own = { ...W }; delete own.types; delete own.other; delete own.err; delete own.gate;
  for (const s of [...flat(own), ...flat(W.err), ...flat(W.gate)]) assert.ok(doc.includes(s), `not in the design doc: ${s}`);
  const all = flat(W).join(' ');
  assert.ok(!/\b(paid|per answer|per day|each answer|guarantee|TV|Ryan|lawyer|license agreement|terms|liab|GDPR|waive)/i.test(all), all);
  assert.equal(W.optIn, 'My answers may be used to improve Ryagram.');
  assert.match(W.noAi, /^Answer yourself\. Answers that look automated earn nothing\.$/);
  assert.ok(!/human|prove|verified/i.test(W.noAi), 'never claims to prove a person is human');
  assert.equal(W.stop, 'Stop helping and withdraw my consent');
});

test('WIRING: calibrate is an account switch read through featureOn; the card shows only behind it and makes no call; the route is department-free; the data calls are the proposed names', () => {
  assert.match(read('assets/ryagram-config.js'), /^\s*calibrate: 'account',/m);
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes("featureOn('calibrate') === true"));
  assert.ok(lib.includes("calibrateOn() && window.ryagramCalibrate ? window.ryagramCalibrate.card(h) : null"));
  assert.ok(lib.includes("hash === '#/calibrate'"));
  assert.ok(!/ryagramConfig[^\n]{0,12}\.calibrate/.test(lib));
  const card = C.card(h);
  assert.equal(card.find(n => n.id === 'cal-home-link').attrs.href, '#/calibrate');
  const data = read('assets/app-data.js');
  for (const rpc of ['my_calibration_consent_get', 'my_calibration_consent_set', 'my_calibration_round_get', 'my_calibration_answer_set', 'my_calibration_earned_get', 'my_calibration_undo']) assert.ok(data.includes(`client.rpc('${rpc}'`), rpc);
  assert.ok(read('docs/calibrate-contract-needs-1127.md').includes('my_calibration_answer_set(p_round text, p_item text, p_answer text)'));
  const html = read('app/index.html');
  assert.match(html, /\/assets\/app-calibrate\.js\?v=20261127k3/);
  assert.ok(html.indexOf('app-calibrate.js') < html.indexOf('app-library.js'), 'loaded before the library');
});

// ---------------------------------------------------------------- the abuse-review round (11-27, FACES / RENDERER / GEO / WORKER): the page half of the defences

test('ANSWERS CARRY THE TOKENS: every answer is exactly (round token, item token, option); one answer per item (a repeat is dropped, not resent); the page never sends or shows which item the server uses as a check', async () => {
  const d = stub(); d.state.consented = true;
  const page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option'] === 'a'));
  await click(page.find(n => n.id === 'cal-skip'));
  const sent = d.calls.filter(c => c[0] === 'answer_set');
  for (const c of sent) { assert.equal(c.length, 4); assert.equal(c[1], 'rt-1'); assert.match(c[2], /^it-\d$/); }
  assert.notEqual(sent[0][2], sent[1][2]);
  const d2 = stub({ setMyCalibrationAnswer: async () => { throw new Error('item_used'); } }); d2.state.consented = true;
  const p2 = top(await make(d2).pageView());
  await click(p2.find(n => n.id === 'cal-skip'));
  assert.match(text(p2), /That question was already answered\./);
  assert.equal(p2.find(n => n.id === 'cal-task').attrs['data-type'], 'confirm_speaker');
  const src = read('assets/app-calibrate.js');
  assert.ok(!/\bgold\b|known[- ]answer|check[_ ]item|is_check|\bdecoy\b/i.test(src), 'the page file knows nothing about which items are checks');
  assert.ok(!/Date\.now|performance\.now|new Date\(\)\.getTime|setTimeout|setInterval/.test(src), 'the page measures no time: a minimum time per item is the server’s business');
});

test('TOO FAST: the line shows only when the server refuses the answer as too fast; the question stays; no other error shows it', async () => {
  const d = stub({ setMyCalibrationAnswer: async () => { throw new Error('too_fast'); } }); d.state.consented = true;
  const page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option'] === 'a'));
  assert.match(text(page), /Too fast\. Take your time\./);
  assert.ok(page.find(n => n.id === 'cal-task') && page.find(n => n.attrs && n.attrs['data-option'] === 'a' && !n.disabled));
  const d2 = stub({ setMyCalibrationAnswer: async () => { throw new Error('boom'); } }); d2.state.consented = true;
  const p2 = top(await make(d2).pageView());
  await click(p2.find(n => n.attrs && n.attrs['data-option'] === 'a'));
  assert.ok(!/Too fast/.test(text(p2)));
});

test('NO AWARD YET: at the end of a round the page shows only what the server says (earned / no award because the check questions were not all right / added later), never which questions were checks', async () => {
  const run = async result => {
    const d = stub({ setMyCalibrationAnswer: async () => ({ ok: true, answered: 4, total: 4, round_done: true, round_result: result }) }); d.state.consented = true;
    const page = top(await make(d).pageView());
    await click(page.find(n => n.attrs && n.attrs['data-option']));
    return page;
  };
  let page = await run('no_award');
  assert.match(text(page), /That is all for this round\. Thank you\./);
  assert.match(text(page), /No credits for this round yet, because some of the check questions were not all right\./);
  assert.ok(page.find(n => n.id === 'cal-noaward') && !/question \d|item \d|which one/i.test(text(page)));
  page = await run('pending');
  assert.match(text(page), /Your credits for this round will be added to your account later\./);
  assert.ok(!/No credits for this round/.test(text(page)));
  page = await run('awarded');
  assert.ok(!/No credits for this round|added to your account later/.test(text(page)));
  assert.match(text(page), /Earned this round: 1/, 'the number is the server’s (earned_get)');
  page = await run(undefined);
  assert.ok(!/No credits for this round/.test(text(page)), 'nothing is claimed when the server says nothing');
});

test('ACCOUNT GATE: a closed account sees one line with the numbers the SERVER sent (days, first film), no task, no clip; the numbers are not typed on the page', async () => {
  const gated = g => { const d = stub({ myCalibrationRound: async () => ({ state: 'gate', round: null, gate: g }) }); d.state.consented = true; return d; };
  let d = gated({ days_needed: 7, needs_film: true }); let page = top(await make(d).pageView());
  assert.match(text(page), /Help tune opens after 7 days and your first film\./);
  assert.ok(!page.find(n => n.id === 'cal-task') && page.findAll(n => n.tag === 'video').length === 0);
  d = gated({ days_needed: 3, needs_film: true }); page = top(await make(d).pageView());
  assert.match(text(page), /Help tune opens after 3 days and your first film\./, 'the number follows the server');
  d = gated({ days_needed: 2, needs_film: false }); page = top(await make(d).pageView());
  assert.match(text(page), /Help tune opens after 2 days\./);
  d = gated({ needs_film: true }); page = top(await make(d).pageView());
  assert.match(text(page), /Help tune opens after your first film\./);
  d = gated({}); page = top(await make(d).pageView());
  assert.match(text(page), /Help tune is not open for your account yet\./);
  assert.equal(C.gateLine({ days_needed: 'x', needs_film: true }), 'Help tune opens after your first film.');
  const d3 = stub({ myCalibrationConsent: async () => ({ consented: false, gate: { days_needed: 7, needs_film: true } }) });
  const p3 = top(await make(d3).pageView());
  assert.match(text(p3), /Help tune opens after 7 days and your first film\./);
  assert.ok(!p3.find(n => n.id === 'cal-optin') && !d3.calls.some(c => c[0] === 'round_get'), 'no opt-in box and no round call for a closed account');
});

test('CAPS AND LIMITS: the daily and the weekly limit, the programme’s weekly credits used up and a pause each get the server’s state in one plain line, and no task', async () => {
  const states = [[{ state: 'cap_reached', cap: { reached: true, period: 'day' } }, /today’s limit/], [{ state: 'cap_reached', cap: { reached: true, period: 'week' } }, /this week’s limit\. Come back next week/],
    [{ state: 'budget_used' }, /credits for helping this week are all given out/], [{ state: 'paused' }, /Helping is paused on your account for now\./]];
  for (const [r, re] of states) {
    const d = stub({ myCalibrationRound: async () => ({ round: null, ...r }) }); d.state.consented = true;
    const page = top(await make(d).pageView());
    assert.match(text(page), re);
    assert.ok(!page.find(n => n.id === 'cal-task') && page.find(n => n.id === 'cal-stop'));
  }
  const d = stub({ setMyCalibrationAnswer: async () => ({ ok: true, answered: 1, total: 4, cap_reached: true, cap_period: 'week' }) }); d.state.consented = true;
  const page = top(await make(d).pageView());
  await click(page.find(n => n.attrs && n.attrs['data-option']));
  assert.match(text(page), /this week’s limit/);
});

test('WITHDRAW: a visible Stop helping and withdraw my consent control (every opted-in state) calls consent_set(false); what happens to earlier answers is the server’s sentence, never the page’s; a script click does nothing', async () => {
  const note = 'Server words about earlier answers.', after = 'Server reply about earlier answers.';
  const d = stub({ myCalibrationConsent: async () => ({ consented: true, withdraw_note: note }) });
  d.setMyCalibrationConsent = async (on, id) => { d.calls.push(['consent_set', on, id]); return { consented: false, note: after }; };
  let page = top(await make(d).pageView());
  const stop = page.find(n => n.id === 'cal-stop');
  assert.equal(stop.textContent, 'Stop helping and withdraw my consent');
  assert.equal(page.find(n => n.id === 'cal-withdraw-note').textContent, note, 'shown before the click, in the server’s words');
  await click(stop, false);
  assert.equal(d.calls.filter(c => c[0] === 'consent_set').length, 0);
  await click(stop);
  assert.deepEqual(d.calls.find(c => c[0] === 'consent_set'), ['consent_set', false, 'calibrate-consent-1']);
  assert.equal(page.find(n => n.id === 'cal-withdrawn-note').textContent, after);
  assert.ok(!/stay yours|deleted|kept|removed/i.test(text(page).replace(after, '').replace(note, '')), 'the page says nothing of its own about earlier answers or credits');
  assert.ok(page.find(n => n.id === 'cal-optin'), 'back to the opt-in');
  for (const over of [{ myCalibrationRound: async () => ({ state: 'none' }) }, { myCalibrationRound: async () => ({ state: 'gate', gate: { needs_film: true } }) }, { myCalibrationRound: async () => ({ state: 'cap_reached', cap: { reached: true } }) }]) {
    const d2 = stub(over); d2.state.consented = true; assert.ok(top(await make(d2).pageView()).find(n => n.id === 'cal-stop'));
  }
  const d3 = stub(); d3.state.consented = true; page = top(await make(d3).pageView());
  assert.ok(!page.find(n => n.id === 'cal-withdraw-note'), 'no note from the server: the page adds none');
  await click(page.find(n => n.id === 'cal-stop'));
  assert.ok(!page.find(n => n.id === 'cal-withdrawn-note'));
});

test('UNTRUSTED CLICKS: every control (retry, option, skip, stop, take back) ignores an event whose isTrusted is not true', async () => {
  let tries = 0;
  const d = stub({ myCalibrationRound: async () => { tries++; throw new Error('boom'); } }); d.state.consented = true;
  let page = top(await make(d).pageView());
  const before = tries;
  await click(page.find(n => n.id === 'cal-retry'), false);
  assert.equal(tries, before);
  await click(page.find(n => n.id === 'cal-retry'), true);
  assert.ok(tries > before);
  const d2 = stub(); d2.state.consented = true;
  page = top(await make(d2).pageView());
  for (const n of page.findAll(n => n.tag === 'button')) await click(n, false);
  assert.deepEqual(d2.calls.map(c => c[0]), ['consent_get', 'round_get', 'earned_get']);
});

test('NOTHING ABOUT CREDIT AMOUNTS IS TYPED ON THE PAGE: no digit next to the word credit in the page file, no amount in any word', () => {
  const src = read('assets/app-calibrate.js').replace(/\/\/[^\n]*/g, '').replace(/v=\d+\w*/g, '');
  assert.ok(!/\d[\d.,]*\s*(?:[a-z]+\s+)?credits?\b|\bcredits?\b[^\n]{0,24}?\d/i.test(src), 'a digit sits next to the word credit');
  for (const s of flat(C.WORDS)) assert.ok(!/\d|\b(half|tenth|dozen|one credit|two credits)\b/i.test(s), s);
  assert.ok(!/\b(per answer|per round|a day|a week)\b/i.test(flat(C.WORDS).join(' ')), 'no rate or per-period figure');
});

test('PRIVACY: the person’s own clip carries no label and no times on the page, only a licensed clip may show a label; a task without an item token is not drawn', () => {
  const t = C.taskShape({ token: 'it-1', type: 'is_phrase', prompt: 'p', clip: { kind: 'own_app', url: 'http://127.0.0.1:9/x', label: 'my-holiday-video.mp4', start_seconds: 3, end_seconds: 5 }, options: [{ id: 'y', label: 'Yes' }] });
  assert.equal(t.clip.label, '');
  assert.ok(!('start' in t.clip) && !('end' in t.clip));
  const l = C.taskShape({ token: 'it-2', type: 'is_phrase', prompt: 'p', clip: { kind: 'licensed', url: 'https://example.test/x', label: 'Public domain clip' }, options: [{ id: 'y', label: 'Yes' }] });
  assert.equal(l.clip.label, 'Public domain clip');
  assert.equal(C.taskShape({ type: 'is_phrase', prompt: 'p', options: [{ id: 'y', label: 'Yes' }] }), null);
});

test('OWN FOOTAGE LEAKS NOTHING: even if a server sends label, start, end and path keys for an own_app clip, nothing of them is shown or sent back; every call body is only tokens, the words id and the option', async () => {
  const own = { kind: 'own_app', url: 'http://127.0.0.1:9/h/abc', label: 'holiday-2025.mp4', start_seconds: 3, end_seconds: 9, path: 'C:\Videos\holiday-2025.mp4', file_name: 'holiday-2025.mp4' };
  const task = { token: 'it-1', type: 'is_phrase', prompt: 'Is this the phrase?', clip: own, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] };
  const d = stub({ myCalibrationRound: async () => ({ state: 'ready', round: { token: 'rt-1', total: 1, answered: 0, tasks: [task] } }) }); d.state.consented = true;
  const page = top(await make(d).pageView());
  assert.ok(!/holiday|Videos|\.mp4/.test(text(page)), 'nothing of the label or path is shown');
  await click(page.find(n => n.attrs && n.attrs['data-option'] === 'yes'));
  const bodies = JSON.stringify(d.calls.map(c => c.slice(1)));
  assert.ok(!/label|start|end|path|file|holiday|Videos|\.mp4|http/i.test(bodies), bodies);
  assert.deepEqual(d.calls.find(c => c[0] === 'answer_set'), ['answer_set', 'rt-1', 'it-1', 'yes']);
  const shaped = C.taskShape(task);
  assert.deepEqual(Object.keys(shaped.clip).sort(), ['kind', 'label', 'url']);
  assert.equal(shaped.clip.label, '');
});
