// NEXT-WEB 179: the "keep named faces sharp" panel. The page decides NOTHING about who is sharp: these tests hold it to that. The engine's rule (kept AND consent exactly true AND a typed name) lives in
// ryagram/local/bystander.py; here a fake engine answers the five calls, and the panel must draw only what it is told, never write kept/consent/name/people/person itself, and show the engine's sentences as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const ctx = { Math, Number, String, Object, Array, JSON, Set, Error, Promise }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('assets/app-faces-sharp.js'), ctx);
const S = ctx.ryagramFacesSharp, J = x => JSON.parse(JSON.stringify(x));

// A tiny element model: enough to draw the panel, find things and click them.
const text = n => (typeof n === 'string' ? n : n && n.children ? n.children.map(text).join('') : '');
function h(tag, attrs, ...kids) {
  const el = { tag, attrs: attrs || {}, children: [], listeners: {}, value: (attrs && attrs.value) || '', checked: !!(attrs && attrs.checked), hidden: !!(attrs && attrs.hidden) };
  const add = k => { if (Array.isArray(k)) k.forEach(add); else if (k !== null && k !== undefined && k !== false) el.children.push(typeof k === 'object' ? k : String(k)); };
  kids.forEach(add);
  el.addEventListener = (ev, fn) => { (el.listeners[ev] = el.listeners[ev] || []).push(fn); };
  el.replaceChildren = (...k) => { el.children = []; k.forEach(add); };
  if (attrs && attrs.onclick) el.addEventListener('click', attrs.onclick);
  return el;
}
const find = (el, pred, out = []) => { if (el && typeof el === 'object') { if (pred(el)) out.push(el); el.children.forEach(c => find(c, pred, out)); } return out; };
const click = async el => { for (const f of el.listeners.click || []) await f(); await new Promise(r => setTimeout(r, 5)); };
const change = async (el, value) => { el.value = value; for (const f of el.listeners.change || []) await f(); await new Promise(r => setTimeout(r, 5)); };

const base = () => ({ schema: 1, on: true, frame: [1920, 1080], people: [], tracks: [{ id: 'a', kf: [[0, 1, 1, 2, 2]], n: 5, score: 0.9, kept: false, consent: false, name: '', person: null }, { id: 'b', kf: [[0, 5, 5, 2, 2]], n: 4, score: 0.8, kept: false, consent: false, name: '', person: null }, { id: 'c', kf: [[0, 9, 9, 2, 2]], n: 3, score: 0.7, kept: false, consent: false, name: '', person: null }] });
// A fake engine that follows the SPEC'S words, not the page: it fills kept/consent/name from the person and refuses in the engine's sentences.
function engine() {
  const calls = [];
  const resolve = s => { for (const t of s.tracks) { const p = s.people.find(q => q.name === t.person); if (t.person && p && p.consent === true) Object.assign(t, { kept: true, consent: true, name: p.name }); else if (t.person) Object.assign(t, { kept: false, consent: false, name: '' }); } return s; };
  const clone = s => JSON.parse(JSON.stringify(s));
  return { calls, faces: {
    async status(s) { calls.push(['status']); return s.tracks.filter(t => t.kept === true && t.consent === true && t.name).map(t => t.id); },
    async confirm(s, name, consent) { calls.push(['confirm', name, consent]); if (!name) throw new Error("Type the person's name to leave their face sharp."); if (consent !== true) throw new Error("Tick that you have this person's OK before their face is left sharp."); s = clone(s); s.people.push({ name, consent: true }); return resolve(s); },
    async revoke(s, name) { calls.push(['revoke', name]); s = clone(s); s.people.forEach(p => { if (p.name === name) p.consent = false; }); return resolve(s); },
    async link(s, id, name) { calls.push(['link', id, name]); s = clone(s); const p = s.people.find(q => q.name === name); if (!p) throw new Error('Confirm this person first (their name and that you have their OK) before linking their face.'); const t = s.tracks.find(x => x.id === id); if (!t) throw new Error('That face is not in this clip.'); t.person = name; return resolve(s); },
    async unlink(s, id) { calls.push(['unlink', id]); s = clone(s); const t = s.tracks.find(x => x.id === id); t.person = null; Object.assign(t, { kept: false, consent: false, name: '' }); return s; }
  } };
}
const settle = () => new Promise(r => setTimeout(r, 10));
const mount = async (spec, extra = {}) => { const eng = engine(), seen = []; const el = S.create({ h }).panel({ spec, host: eng, offered: ['Ann', 'Bob'], thumbs: {}, onChange: s => seen.push(J(s)), ...extra }); await settle(); return { el, eng, seen }; };

test('pure helpers: names to offer, who can be linked, and the summary line come from what the engine holds', () => {
  assert.deepEqual(J(S.nameChoices(['Ann', ' Bob  ', 'Ann', '', 5], { people: [{ name: 'Cy', consent: true }, { name: 'Ann', consent: false }] })), ['Ann', 'Bob', 'Cy']);
  assert.deepEqual(J(S.confirmed({ people: [{ name: 'Ann', consent: true }, { name: 'Bob', consent: false }, { name: 'Cy' }, null] })), ['Ann']);
  assert.deepEqual(J(S.confirmed(undefined)), []);
  const rows = S.trackRows(base(), ['a'], { a: 'data:image/png;base64,AAAA', b: 'javascript:alert(1)', c: 'https://example.com/x.png' });
  assert.deepEqual(J(rows.map(r => [r.id, r.sharp, !!r.thumb])), [['a', true, true], ['b', false, false], ['c', false, false]]);
  assert.equal(S.summary([{ sharp: true, person: 'Ann' }, { sharp: false }, { sharp: false }]), '3 faces: 1 sharp (Ann), 2 blurred.');
  assert.equal(S.summary([{ sharp: false }]), '1 face: 0 sharp, 1 blurred.'); assert.equal(S.summary([]), 'No faces were found in this clip.');
});

test('a face is drawn blurred unless the ENGINE says it is sharp; a hand-made spec cannot make one look sharp', async () => {
  const spec = base(); spec.tracks[0].kept = true; spec.tracks[0].consent = true; spec.tracks[0].name = 'Ann';       // the engine's rule says sharp
  spec.tracks[1].kept = true; spec.tracks[1].consent = 'yes'; spec.tracks[1].name = 'Bob';                           // not exactly true: the engine says blurred
  const { el } = await mount(spec);
  const tiles = find(el, e => e.attrs['data-track'] && e.tag === 'li');
  assert.deepEqual(tiles.map(t => t.attrs.class.includes('is-sharp')), [true, false, false]);
  assert.match(text(find(el, e => e.attrs.class === 'fs-summary')[0]), /3 faces: 1 sharp, 2 blurred\./);
  const dead = await mount(base(), { host: { faces: { status: async () => { throw new Error('down'); } } } });
  assert.ok(find(dead.el, e => e.attrs['data-track'] && e.tag === 'li').every(t => t.attrs.class.includes('is-blurred')), 'if the engine cannot say, nothing is drawn as sharp');
});

test('confirming a person needs the tick and a name: the engine refuses in its own sentence, and the page shows it as it is', async () => {
  const { el, eng, seen } = await mount(base());
  await click(find(el, e => e.attrs.id === 'fs-confirm')[0]);
  assert.equal(seen.length, 0);
  const err = find(el, e => e.attrs.class && e.attrs.class.includes('faces-sharp-error'))[0];
  assert.equal(err.hidden, false); assert.equal(err.children[0] || err.textContent, "Type the person's name to leave their face sharp.");
  assert.deepEqual(eng.calls.filter(c => c[0] === 'confirm'), [['confirm', '', false]]);
});

test('the whole walk: confirm Ann, link one face, it becomes sharp; withdraw Ann and it is blurred again; the page never wrote the fields itself', async () => {
  let spec = base();
  const m = await mount(spec);
  const name = find(m.el, e => e.attrs.id === 'fs-name')[0], tick = find(m.el, e => e.attrs.id === 'fs-ok')[0];
  name.value = 'Ann'; for (const f of name.listeners.input) f(); tick.checked = true; for (const f of tick.listeners.change) f();
  await click(find(m.el, e => e.attrs.id === 'fs-confirm')[0]);
  assert.deepEqual(m.eng.calls.filter(c => c[0] === 'confirm'), [['confirm', 'Ann', true]]);
  assert.deepEqual(J(m.seen.at(-1).people), [{ name: 'Ann', consent: true }]);
  const sel = find(m.el, e => e.attrs.class === 'fs-who' && e.attrs['data-track'] === 'b')[0];
  assert.equal(sel.value, '', 'never pre-selected');
  assert.deepEqual(find(sel, e => e.tag === 'option').map(o => o.attrs.value), ['', 'Ann'], 'only confirmed people are listed');
  await change(sel, 'Ann');
  assert.deepEqual(m.eng.calls.filter(c => c[0] === 'link'), [['link', 'b', 'Ann']]);
  const after = m.seen.at(-1);
  assert.equal(after.tracks.find(t => t.id === 'b').person, 'Ann'); assert.equal(after.tracks.find(t => t.id === 'b').kept, true);
  let tile = find(m.el, e => e.tag === 'li' && e.attrs['data-track'] === 'b')[0];
  assert.ok(tile.attrs.class.includes('is-sharp')); assert.match(text(tile), /sharp \(Ann\)/);
  assert.match(text(find(m.el, e => e.attrs.class === 'fs-summary')[0]), /3 faces: 1 sharp \(Ann\), 2 blurred\./);
  await click(find(m.el, e => e.attrs['data-withdraw'] === 'Ann')[0]);
  tile = find(m.el, e => e.tag === 'li' && e.attrs['data-track'] === 'b')[0];
  assert.ok(tile.attrs.class.includes('is-blurred'), 'withdrawing re-blurs every linked face at once');
  assert.match(text(find(m.el, e => e.attrs.class === 'fs-summary')[0]), /3 faces: 0 sharp, 3 blurred\./);
  assert.equal(JSON.stringify(spec), JSON.stringify(base()), 'the spec the page was given is untouched');
});

test('unlink puts a face back to blurred; a person with no OK is not in the Who is this list; a locked panel offers nothing', async () => {
  const spec = base(); spec.people = [{ name: 'Ann', consent: true }, { name: 'Bob', consent: false }]; spec.tracks[0].person = 'Ann'; spec.tracks[0].kept = true; spec.tracks[0].consent = true; spec.tracks[0].name = 'Ann';
  const m = await mount(spec);
  const sel = find(m.el, e => e.attrs.class === 'fs-who' && e.attrs['data-track'] === 'b')[0];
  assert.deepEqual(find(sel, e => e.tag === 'option').map(o => o.attrs.value), ['', 'Ann']);      // Bob has no OK
  assert.match(text(find(m.el, e => e.attrs.class === 'fs-people')[0]), /Bob.*OK withdrawn/);
  await click(find(m.el, e => e.attrs['data-unlink'] === 'a')[0]);
  assert.ok(find(m.el, e => e.tag === 'li' && e.attrs['data-track'] === 'a')[0].attrs.class.includes('is-blurred'));
  const locked = await mount(spec, { locked: true });
  assert.ok(find(locked.el, e => ['button', 'select', 'input'].includes(e.tag)).every(e => e.attrs.disabled === true));
});

test('nothing in the panel writes the engine\'s fields, matches faces, or builds HTML', () => {
  const src = read('assets/app-faces-sharp.js');
  assert.ok(!/\.(kept|consent|name|person|people)\s*=[^=]/.test(src.replace(/\/\/.*$/gm, '')), 'no assignment to a spec field');
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage|XMLHttpRequest/.test(src));
  assert.ok(!/recogni[sz]|similar|embedding|biometric/i.test(src.replace(/\/\/.*$/gm, '')), 'no face matching');
});

test('the words are marked DRAFT for Ryan and the attorney, and say what is not done', () => {
  const src = read('assets/app-faces-sharp.js');
  assert.match(src, /ALL WORDS BELOW ARE DRAFT FOR RYAN AND THE ATTORNEY/);
  assert.match(S.WORDS.miss, /Faces the finder misses stay sharp/);
});

test('a refused confirm keeps what the person typed and ticked, so they can fix one thing and press again', async () => {
  const m = await mount(base());
  const name = find(m.el, e => e.attrs.id === 'fs-name')[0];
  name.value = 'Ann'; for (const f of name.listeners.input) f();
  await click(find(m.el, e => e.attrs.id === 'fs-confirm')[0]);                       // no tick: refused
  assert.equal(m.seen.length, 0);
  const again = find(m.el, e => e.attrs.id === 'fs-name')[0];
  assert.equal(again, name, 'the panel was not redrawn over the person’s typing');
  const tick = find(m.el, e => e.attrs.id === 'fs-ok')[0]; tick.checked = true; for (const f of tick.listeners.change) f();
  await click(find(m.el, e => e.attrs.id === 'fs-confirm')[0]);
  assert.deepEqual(m.eng.calls.filter(c => c[0] === 'confirm'), [['confirm', 'Ann', false], ['confirm', 'Ann', true]]);
});
