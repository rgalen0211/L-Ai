// The DRAFT film page for "The Price of a Home vs. a Paycheck" (/film/?sample=housing-value-to-income): a sample page, noindex, with an empty video slot, the how-to-read block,
// the sources block and a small static chart of four summary shares. The numbers are the data handoff's (pending the R2 recheck) and NO other number is on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const sample = JSON.parse(read('film/samples/housing-value-to-income.json'));
const filmJs = read('assets/film.js');

class Node_ {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  focus() {}
  scrollIntoView() {}
  querySelector(sel) { return sel === 'h1' ? find(this, n => n.tag === 'h1') : null; }
}
const walk = (n, f) => { if (!n || n.text !== undefined) return; f(n); n.children.forEach(c => walk(c, f)); };
const find = (n, pred) => { let hit = null; walk(n, x => { if (!hit && pred(x)) hit = x; }); return hit; };
const findAll = (n, pred) => { const out = []; walk(n, x => { if (pred(x)) out.push(x); }); return out; };
const textOf = n => (n.text !== undefined ? n.text : n.children.map(textOf).join(''));

async function render(page) {
  const els = { film: new Node_('main'), 'cta-top': new Node_('a') };
  const head = new Node_('head');
  const document = {
    getElementById: id => (id === 'sources' ? find(els.film, n => n.attrs.id === 'sources') : id === 'sources-title' ? find(els.film, n => n.attrs.id === 'sources-title') : els[id] || null),
    createElement: tag => new Node_(tag), createElementNS: (ns, tag) => new Node_(tag), head, title: ''
  };
  const fetch = async () => ({ ok: true, status: 200, json: async () => page });
  const ctx = { window: { ryagramConfig: {} }, document, location: { search: '?sample=housing-value-to-income', hash: '', hostname: 'uselai.com' }, URLSearchParams, URL, fetch,
                Date, isNaN, isFinite, encodeURIComponent, String, Number, Array, Object, JSON, Promise, Error, Math };
  vm.createContext(ctx);
  vm.runInContext(filmJs, ctx);
  await new Promise(r => setTimeout(r, 30));
  return { root: els.film, head };
}

test('the draft page is a sample (so noindex), titled DRAFT, with no video and no publish date', () => {
  assert.equal(sample.sample, true);
  assert.match(sample.title, /^DRAFT: /);
  assert.equal(sample.video_url, null);
  assert.equal(sample.video_pending, true);
  assert.equal(sample.published_at, null);
});

test('THE NUMBERS: exactly the four window shares from the handoff, marked pending the R2 recheck, and no other figure in the chart or the page text', () => {
  const c = sample.summary.chart;
  assert.deepEqual(c.items.map(x => [x.label, x.value]), [['2005-2009', 4.6], ['2010-2014', 2.6], ['2015-2019', 2.9], ['2020-2024', 6.1]]);
  assert.match(c.note, /pending the R2 recheck/);
  assert.match(c.note, /counties, not of people or homes/);
  // every number with a decimal point or a percent sign anywhere on the page is one of those four
  const all = JSON.stringify(sample.summary).replace(/https?:\/\/[^"\s]+/g, '');
  const pct = [...all.matchAll(/\b(\d+\.\d+)\b/g)].map(m => m[1]);
  assert.deepEqual(pct.sort(), ['2.6', '2.9', '4.6', '6.1']);
});

test('the how-to-read block says what Ryan approved: owners\' estimate, all households, five-year windows, 5x is ours, hatched grey, counts counties', () => {
  const t = sample.summary.read.join(' ');
  for (const re of [/owners' own estimate/, /not a sale price/, /median for all households/, /five-year survey window/, /5x is our storytelling line, not an official standard/,
                    /Hatched grey \(diagonal lines\)/, /never coloured by a band/, /not a share of Americans or of homes/, /pandemic/]) assert.match(t, re);
  assert.doesNotMatch(t, /faded/i);                              // CC1's ruling: an uncertain county is hatched, never a faded band colour
});

test('the sources block cites Census ACS B25077 and B19013 for the four windows, public domain, https only, with the Connecticut and Alaska break named', () => {
  const d = sample.summary.datasets[0];
  assert.match(d.credit, /B25077 and B19013/);
  const urls = d.sources.map(s => s.url);
  for (const y of ['2009', '2014', '2019', '2024']) assert.ok(urls.includes(`https://api.census.gov/data/${y}/acs/acs5`), y);
  assert.ok(urls.every(u => u.startsWith('https://') && /(^|\.)census\.gov\//.test(new URL(u).host + '/')));
  assert.match(d.sources[0].license, /Public domain \(17 USC 105\)/);
  assert.match(d.breaks[0].what, /Connecticut.*nine planning regions/);
  assert.match(d.breaks[0].what, /Valdez-Cordova/);
});

test('RENDERED: the title, an empty video slot, how to read this, the chart with four bars and its text, sources, and no video element', async () => {
  const r = await render(sample);
  const text = textOf(r.root);
  assert.match(text, /DRAFT: How Many Years of Income Is a Home Worth\?/);
  assert.match(text, /The film will appear here when it is published\./);
  assert.equal(find(r.root, n => n.tag === 'video'), null);
  assert.match(text, /How to read this/);
  assert.match(text, /Hatched grey/);
  const rects = findAll(r.root, n => n.tag === 'rect');
  assert.equal(rects.length, 4);
  const widths = rects.map(x => Number(x.attrs.width));
  assert.ok(widths[3] > widths[0] && widths[0] > widths[2] && widths[2] > widths[1], `bar widths follow the values ${widths}`);
  const chart = find(r.root, n => n.tag === 'svg');
  assert.match(chart.attrs['aria-label'], /2005-2009: 4\.6%; 2010-2014: 2\.6%; 2015-2019: 2\.9%; 2020-2024: 6\.1%/);
  assert.match(text, /Sources and method/);
  assert.equal(find(r.root, n => n.tag === 'a' && n.attrs.href === 'https://api.census.gov/data/2024/acs/acs5') !== null, true);
  assert.equal(r.head.children.some(n => n.name === 'robots' && /noindex/.test(n.content)), true);
});

test('MUST-FAIL: a chart item that is not a finite number is dropped, never drawn as a bar or a zero', async () => {
  const bad = JSON.parse(JSON.stringify(sample));
  bad.summary.chart.items[1].value = 'n/a';
  bad.summary.chart.items[2].value = Infinity === 0 ? 0 : null;
  const r = await render(bad);
  assert.equal(findAll(r.root, n => n.tag === 'rect').length, 2);
});

test('film.js puts every value in as text (no HTML sinks) and the page and its assets carry the new cache-bust', () => {
  assert.doesNotMatch(filmJs.replace(/\/\/.*$/gm, ''), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  const html = read('film/index.html');
  assert.match(html, /film\.js\?v=20261019a/);
  assert.match(html, /film\.css\?v=20261019a/);
});
