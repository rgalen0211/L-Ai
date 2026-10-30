// The live editor's transcript view with corrections (assets/app-editor-transcript.js, NEXT-BUILDER 39): a corrected word is shown as corrected with what was heard on
// hover and in its accessible name, Undo hands back exactly its at_ms, nothing goes in as HTML, and no page loads the file yet (off until WEB and CONNECT wire it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-editor-transcript.js'), { window: win });
const T = win.ryagramTranscript;
const plain = x => JSON.parse(JSON.stringify(x));

// A stand-in element builder: plain objects, children kept as given (strings stay strings, i.e. text nodes).
const h = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat().filter(c => c != null) });
const all = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.children.forEach(c => all(c, out)); } return out; };
const text = el => (typeof el === 'string' ? el : el.children.map(text).join(''));

// The shape ryagram.library.corrections.transcript returns (Ryagram tests/stt_corrections.py checks the same words).
const WORDS = [
  { w: 'the', start_ms: 1000, end_ms: 1200, corrected: false, heard: null, at_ms: null },
  { w: 'quick', start_ms: 1230, end_ms: 1520, corrected: true, heard: 'quick', at_ms: 1250 },
  { w: 'brown', start_ms: 1600, end_ms: 1900, corrected: false, heard: null, at_ms: null },
  { w: 'fox', start_ms: 2000, end_ms: 2300, corrected: true, heard: 'fax', at_ms: 2000 },
  { w: 'jumped', start_ms: 2400, end_ms: 2800, corrected: false, heard: null, at_ms: null }
];

test('CORRECTED: a corrected word is marked, says what was heard on hover and in its accessible name; the others are plain', () => {
  const v = view();
  const words = all(v).filter(e => e.tag === 'span' && /le-tr-word/.test(e.attrs.class));
  assert.deepEqual(words.map(text), ['the', 'quick', 'brown', 'fox', 'jumped']);
  const fox = words[3];
  assert.equal(fox.attrs.class, 'le-tr-word is-corrected');
  assert.equal(fox.attrs.title, 'Heard: fax');
  assert.equal(fox.attrs['aria-label'], 'fox (corrected; the transcriber heard “fax”)');
  assert.equal(words[0].attrs.class, 'le-tr-word');
  assert.equal(words[0].attrs.title, undefined, 'an uncorrected word has no hover text');
  assert.equal(text(all(v).find(e => e.tag === 'p' && e.attrs.class === 'meta')), '2 words corrected by you.');
  function view() { return T.view(h, WORDS); }
});

test('UNDO: one button per corrected word, each handing back exactly its at_ms; no handler means read-only (no buttons)', () => {
  const got = [];
  const v = T.view(h, WORDS, { onUndo: at => got.push(at) });
  const buttons = all(v).filter(e => e.tag === 'button');
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map(b => b.attrs['aria-label']), ['Undo the correction of “quick” (back to “quick”)', 'Undo the correction of “fox” (back to “fax”)']);
  buttons[1].attrs.onclick();
  buttons[0].attrs.onclick();
  assert.deepEqual(got, [2000, 1250]);
  assert.equal(all(T.view(h, WORDS)).filter(e => e.tag === 'button').length, 0);
});

test('NOT FORGED: a word flagged corrected without what was heard or a whole-number at_ms is shown plain, with no Undo', () => {
  const odd = [{ w: 'a', start_ms: 0, end_ms: 100, corrected: true, heard: null, at_ms: 5 }, { w: 'b', start_ms: 200, end_ms: 300, corrected: true, heard: 'x', at_ms: '7' },
               { w: 'c', start_ms: 400, end_ms: 500, corrected: true, heard: '  ', at_ms: 9 }];
  const v = T.view(h, odd, { onUndo: () => {} });
  assert.ok(all(v).every(e => !/is-corrected/.test(e.attrs.class || '')));
  assert.equal(all(v).filter(e => e.tag === 'button').length, 0);
  assert.equal(T.counts(odd), 'No corrections in this transcript.');
});

test('LINES: a new line after a long silence or a long run of words; each line starts with its time', () => {
  const ws = [0, 300, 600, 4000, 4300].map((s, i) => ({ w: `w${i}`, start_ms: s, end_ms: s + 200, corrected: false, heard: null, at_ms: null }));
  assert.deepEqual(plain(T.lines(ws).map(l => l.map(w => w.w))), [['w0', 'w1', 'w2'], ['w3', 'w4']]);
  const many = Array.from({ length: 30 }, (_, i) => ({ w: `w${i}`, start_ms: i * 100, end_ms: i * 100 + 80 }));
  assert.deepEqual(plain(T.lines(many).map(l => l.length)), [14, 14, 2]);
  assert.deepEqual(plain(T.lines([])), []);
  const v = T.view(h, ws);
  assert.deepEqual(all(v).filter(e => /le-tr-time/.test(e.attrs.class || '')).map(text), ['0:00', '0:04']);
  assert.equal(T.mmss(61500), '1:01');
  assert.equal(text(all(T.view(h, [])).find(e => e.tag === 'p' && /meta/.test(e.attrs.class) && /No words/.test(text(e)))), 'No words in this clip.');
});

test('TEXT ONLY: words and heard words go in as text nodes; the file builds no HTML and reads no storage', () => {
  const bad = [{ w: '<img src=x onerror=alert(1)>', start_ms: 0, end_ms: 1, corrected: true, heard: '<b>x</b>', at_ms: 0 }];
  const v = T.view(h, bad, { onUndo: () => {} });
  const word = all(v).find(e => /is-corrected/.test(e.attrs.class || ''));
  assert.deepEqual(word.children, ['<img src=x onerror=alert(1)>'], 'the word is one text child');
  assert.equal(word.attrs.title, 'Heard: <b>x</b>', 'an attribute value, never markup');
  const src = read('assets/app-editor-transcript.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
});

test('OFF: no page and no generated editor file loads it yet (wiring and the undo call are WEB\'s and CONNECT\'s)', () => {
  for (const f of ['app/index.html', 'index.html']) if (fs.existsSync(new URL(`../${f}`, import.meta.url))) assert.doesNotMatch(read(f), /app-editor-transcript\.js/, f);
  const live = new URL('../tools/maker-live/live.js', import.meta.url);
  if (fs.existsSync(live)) assert.doesNotMatch(fs.readFileSync(live, 'utf8'), /ryagramTranscript/);
});
