// The public film page (film/index.html + assets/film.js) and its sample (the Interstate film): what a page shows, what it must never show, where its
// "Make your own data film" button goes, and the link target a film's "Made with Ryagram · View sources" mark points to (/film/?s=<slug>#sources).
// film.js runs here against a tiny fake DOM, so the page's real rendering code is what is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const sample = JSON.parse(read('film/samples/interstate.json'));
const filmJs = read('assets/film.js');
const SLUG = 'AbCdEfGhIjKlMnOpQrStUv';

// ---- a fake DOM: enough for film.js's own h() helper ----------------------------------------------------------------------------------------
class Node_ {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  querySelector(sel) { return sel === 'h1' ? find(this, n => n.tag === 'h1') : null; }
}
const walk = (n, f) => { if (!n || n.text !== undefined) return; f(n); n.children.forEach(c => walk(c, f)); };
const find = (n, pred) => { let hit = null; walk(n, x => { if (!hit && pred(x)) hit = x; }); return hit; };
const findAll = (n, pred) => { const out = []; walk(n, x => { if (pred(x)) out.push(x); }); return out; };
const textOf = n => (n.text !== undefined ? n.text : n.children.map(textOf).join(''));

async function renderPage({ search = '', hash = '', page = null, status = 200, sampleJson = null } = {}) {
  const els = { film: new Node_('main'), 'cta-top': new Node_('a') };
  const head = new Node_('head');
  const calls = [];
  const document = {
    getElementById: id => (id === 'sources' ? find(els.film, n => n.attrs.id === 'sources') : id === 'sources-title' ? find(els.film, n => n.attrs.id === 'sources-title') : els[id] || null),
    createElement: tag => new Node_(tag), head, title: ''
  };
  const fetch = async url => {
    calls.push(url);
    if (url.startsWith('/film/samples/')) return { ok: !!sampleJson, status: sampleJson ? 200 : 404, json: async () => sampleJson };
    return { ok: status === 200, status, json: async () => page };
  };
  const ctx = { window: { ryagramConfig: { supabaseUrl: 'https://p.supabase.co' } }, document, location: { search, hash, hostname: 'uselai.com' }, URLSearchParams, URL, fetch,
                Date, isNaN, encodeURIComponent, String, Number, Array, Object, JSON, Promise, Error };
  vm.createContext(ctx);
  vm.runInContext(filmJs, ctx);
  await new Promise(r => setTimeout(r, 30));
  return { root: els.film, head, ctaTop: els['cta-top'], calls, document };
}
const PUBLISHED = { title: 'Fast food and obesity', published_at: '2026-10-01T00:00:00Z', video_url: 'https://jxtk.supabase.co/v.mp4', poster_url: 'https://jxtk.supabase.co/p.jpg',
  summary: { headline: 'Fast food and obesity', subhead: '', window: { start: '2011', end: '2023' }, area: 'States', uploaded_data: false, measures: [{ label: 'Obesity rate', unit: '%' }],
             datasets: [{ label: 'CDC', credit: 'Source: CDC', sources: [{ name: 'CDC adult obesity', url: 'https://www.cdc.gov/obesity/', license: 'Public domain' }], method: 'Survey data.', retrieved: '2026-09-30', values_are: 'measured', derivations: [], breaks: [] }],
             film: { seconds: 30, width: 1920, height: 1080, fps: 30 }, engine: { commit: 'abcdef123456', drawn_at: '2026-10-01' } } };

// ---- the sample ----------------------------------------------------------------------------------------------------------------------------------
test('the sample is the Interstate film with its REAL source and receipt, made by the live allowlist, and carries nothing private', () => {
  assert.equal(sample.sample, true);
  assert.equal(sample.title, 'Rise of the Interstate Highway, 1956–1993');                 // the film's public title
  const d = sample.summary.datasets[0];
  assert.match(d.label, /Interstate network by opening year \(Brooks & Liscow/);
  assert.equal(d.sources[0].url, 'https://doi.org/10.3886/E144281V1');
  assert.match(d.sources[0].license, /^CC BY 4\.0/);
  assert.match(d.credit, /Brooks & Liscow \(2023\), DOI 10\.3886\/E144281V1 \(CC BY 4\.0\)/);
  assert.deepEqual(plain(sample.summary.window), { start: '1956', end: '1993' });
  assert.match(sample.summary.engine.commit, /^[0-9a-f]{12}$/);
  assert.equal(sample.summary.uploaded_data, false);
  assert.equal(sample.published_at, null);                         // a sample has no publish date
  assert.equal(sample.video_url, null);                            // and no video file: the film is not published
  assert.equal(JSON.stringify(sample).match(/C:\\|\/Users\/|\/home\/|sidecar|cache|reproduce|\.json"|\.py/i), null);
  const reference = JSON.parse(read('tests/fixtures/film/page-sample.json'));
  assert.deepEqual(Object.keys(sample.summary).sort(), Object.keys(reference.summary).sort());      // exactly the allowlisted summary's keys
  assert.deepEqual(Object.keys(sample.summary.datasets[0]).sort(), Object.keys(reference.summary.datasets[0]).sort());
});
const plain = x => JSON.parse(JSON.stringify(x));

test('the sample\'s poster is a real JPEG of the film\'s last frame, small enough for a phone', () => {
  const file = path.join(root, 'film/samples/interstate-final-frame.jpg');
  const bytes = fs.readFileSync(file);
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xff, 0xd8, 0xff]);
  assert.ok(bytes.length > 50_000 && bytes.length < 450_000, `${bytes.length} bytes`);
  assert.equal(sample.poster_url, '/film/samples/interstate-final-frame.jpg');
});

// ---- the page, rendered by film.js ------------------------------------------------------------------------------------------------------------
test('THE SAMPLE PAGE: title, sample note, poster, "Made with Ryagram · View sources", the real source linked, the receipt, noindex, and no video', async () => {
  const r = await renderPage({ search: '?sample=interstate', sampleJson: sample });
  const text = textOf(r.root);
  assert.deepEqual(r.calls, ['/film/samples/interstate.json']);
  assert.match(text, /Rise of the Interstate Highway, 1956–1993/);
  assert.match(text, /Contiguous United States 39,279 Miles Constructed/);                    // the film's own title card line, as its subhead
  assert.match(text, /This is a sample page\./);
  assert.match(text, /AI-assisted \(Ryagram\) · Made with Ryagram · View sources/);              // Ryan 2026-10-18: the same label as the delivery page
  assert.match(text, /Brooks & Liscow \(2023\), Infrastructure Costs, replication package/);
  assert.match(text, /Engine versionb17561adead5/);
  assert.match(text, /This pageA sample, to show what a Ryagram film page contains/);
  assert.doesNotMatch(text, /Published/);
  assert.ok(findAll(r.root, n => n.tag === 'img' && n.attrs.src === '/film/samples/interstate-final-frame.jpg').length === 1);
  assert.equal(findAll(r.root, n => n.tag === 'video').length, 0);
  assert.ok(findAll(r.root, n => n.tag === 'a' && n.attrs.href === 'https://doi.org/10.3886/E144281V1').length === 1);
  assert.deepEqual(findAll(r.head, n => n.tag === 'meta').map(n => [n.name, n.content]), [['robots', 'noindex, nofollow']]);
});

test('"Make your own data film" goes to the WAITLIST while Ryagram is coming soon, tagged for counting, in the header and in the page', async () => {
  const sampleR = await renderPage({ search: '?sample=interstate', sampleJson: sample });
  const live = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  for (const [r, campaign] of [[sampleR, 'sample_interstate'], [live, SLUG]]) {
    const btn = findAll(r.root, n => n.tag === 'a' && textOf(n) === 'Make your own data film')[0];
    assert.equal(btn.attrs.href, `/ryagram/?utm_source=film_page&utm_medium=referral&utm_campaign=${campaign}#waitlist`);
    assert.equal(r.ctaTop.attrs.href, btn.attrs.href);
    assert.match(textOf(r.root), /opening by invitation\. Join the waitlist/);
  }
});

test('A PUBLISHED FILM: the film, "Made with Ryagram · View sources" pointing at #sources, the sources and method, the receipt; no sample note, indexable', async () => {
  const r = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  const text = textOf(r.root);
  assert.deepEqual(r.calls, [`https://p.supabase.co/functions/v1/film-page?s=${SLUG}`]);
  assert.equal(findAll(r.root, n => n.tag === 'video').length, 1);
  const cap = find(r.root, n => n.tag === 'figcaption');
  assert.equal(textOf(cap), 'AI-assisted (Ryagram) · Made with Ryagram · View sources');
  assert.equal(find(cap, n => n.tag === 'a').attrs.href, '#sources');
  assert.match(text, /Sources and method/);
  assert.match(text, /CDC adult obesity/);
  assert.match(text, /Published/);
  assert.doesNotMatch(text, /sample page/i);
  assert.equal(findAll(r.head, n => n.tag === 'meta').length, 0);
});

test('a film with no separate subhead shows no stray "null" (replaceChildren(null) prints the word)', async () => {
  const r = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  assert.doesNotMatch(textOf(r.root), /null|undefined/);
  const withSub = await renderPage({ search: `?s=${SLUG}`, page: { ...PUBLISHED, summary: { ...PUBLISHED.summary, subhead: 'A subhead' } } });
  assert.match(textOf(withSub.root), /A subhead/);
});

test('THE LINK TARGET for exported films: /film/?s=<slug>#sources lands on the sources section (and the heading, not the title, takes focus)', async () => {
  const r = await renderPage({ search: `?s=${SLUG}`, hash: '#sources', page: PUBLISHED });
  const section = find(r.root, n => n.attrs.id === 'sources');
  assert.equal(section.scrolled, true);
  assert.equal(find(r.root, n => n.attrs.id === 'sources-title').focused, true);
  assert.notEqual(find(r.root, n => n.tag === 'h1').focused, true);
  const plainOpen = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  assert.equal(find(plainOpen.root, n => n.attrs.id === 'sources').scrolled, undefined);
});

test('NOT PUBLISHED, UNKNOWN OR BAD: "No film here" and nothing else; a made-up slug never reaches the server; an unknown sample says no film', async () => {
  const gone = await renderPage({ search: `?s=${SLUG}`, status: 404 });
  assert.match(textOf(gone.root), /No film here/);
  assert.match(textOf(gone.root), /doesn’t exist, or its maker has stopped sharing it/);
  const bad = await renderPage({ search: '?s=short' });
  assert.match(textOf(bad.root), /No film here/);
  assert.deepEqual(bad.calls, []);
  const nope = await renderPage({ search: '?sample=nope' });
  assert.match(textOf(nope.root), /No film here/);
  const weird = await renderPage({ search: '?sample=../../etc/passwd' });
  assert.deepEqual(weird.calls, []);                                                       // a sample name is letters, digits and hyphens only
  assert.match(textOf(weird.root), /No film here/);
});

test('A FILM MADE FROM THE OWNER\'S UPLOAD names only "the maker\'s own data": no source labels, links, notes or values appear', async () => {
  const page = { ...PUBLISHED, summary: { ...PUBLISHED.summary, uploaded_data: true, measures: [],
                  datasets: [{ label: 'The maker’s own data', credit: '', sources: [], method: '', retrieved: '', values_are: '', derivations: [], breaks: [] }] } };
  const r = await renderPage({ search: `?s=${SLUG}`, page });
  const text = textOf(r.root);
  assert.match(text, /made from data its maker uploaded\. The data itself isn’t published here\./);
  assert.match(text, /The maker’s own data/);
  assert.doesNotMatch(text, /CDC|Survey data|Obesity rate/);
});

test('the film page file loads the sample and the page script, under a policy that allows only its own files and the project\'s storage', () => {
  const html = read('film/index.html');
  assert.match(html, /film\.js\?v=20261018a/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src 'self' https:\/\/jxtkfishqfxuptwjzczz\.supabase\.co/);
  assert.doesNotMatch(csp, /unsafe/);
});

// ---- the app's publish flow (assets/app-data.js: publishFilmWithConfirm) ----------------------------------------------------------------------
function appData(responses) {
  const calls = [];
  const w = {};
  const ctx = { window: w, Array, Number, String, Object, RegExp, Promise, Error, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('assets/app-data.js'), ctx);
  const client = { functions: { invoke: async (name, opts) => {
    calls.push({ name, body: opts.body });
    const next = responses.shift();
    if (next.error) return { data: null, error: { context: { json: async () => { if (next.notJson) throw new Error('not json'); return next.error; } } } };
    return { data: next.data, error: null };
  } } };
  return { data: w.ryagramData(client), calls };
}
const UPLOAD_409 = { error: { code: 'confirm_uploaded', error: "This film was drawn from data you uploaded, so anyone with the link will see what it shows — your data's values and pattern, frame by frame. The page lists the film's sources, not your file. Publish it anyway?" } };

test('APP FLOW: public data publishes with ONE request and no question', async () => {
  const { data, calls } = appData([{ data: { slug: SLUG, url: 'u' } }]);
  let asked = 0;
  const out = await data.publishFilmWithConfirm('v1', 'My title', () => { asked++; return true; });
  assert.equal(out.slug, SLUG);
  assert.deepEqual([calls.length, asked], [1, 0]);
  assert.equal('confirm_uploaded' in calls[0].body, false);
});

test('APP FLOW: an upload film asks once with the server\'s words, and only a yes sends the second request with confirm_uploaded: true and the SAME title', async () => {
  const { data, calls } = appData([UPLOAD_409, { data: { slug: SLUG, url: 'u' } }]);
  const title = { value: 'First title' };
  const messages = [];
  const out = await data.publishFilmWithConfirm('v1', title.value, m => { messages.push(m); title.value = 'Changed while the question was open'; return true; });
  assert.equal(out.slug, SLUG);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /drawn from data you uploaded.*frame by frame.*sources, not your file/);
  assert.deepEqual(calls.map(c => [c.body.title, c.body.confirm_uploaded]), [['First title', undefined], ['First title', true]]);
});

test('APP FLOW: saying NO sends no second request and publishes nothing (cancelled, not an error)', async () => {
  const { data, calls } = appData([UPLOAD_409]);
  const out = await data.publishFilmWithConfirm('v1', 't', () => false);
  assert.deepEqual(plain(out), { cancelled: true });
  assert.equal(calls.length, 1);
});

test('APP FLOW: any OTHER error is thrown at once and never retried, a non-JSON error too (a broken answer can never turn into a confirmed publish)', async () => {
  for (const [resp, re] of [[{ error: { code: 'other', error: 'Only a finished film can have a public page.' } }, /Only a finished film/], [{ error: { error: 'Sign in first.' } }, /Sign in first/],
                            [{ error: {}, notJson: true }, /Couldn’t publish just now/]]) {
    const { data, calls } = appData([resp]);
    let asked = 0;
    await assert.rejects(data.publishFilmWithConfirm('v1', 't', () => { asked++; return true; }), re);
    assert.deepEqual([calls.length, asked], [1, 0]);
  }
});

test('APP FLOW: the Publish button uses this one function (no second copy of the retry logic)', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /data\.publishFilmWithConfirm\(v\.id, title\.value, message => confirm\(message\)\)/);
  assert.doesNotMatch(lib, /confirmUploaded: true/);
});

// ---- film.js: the review's lower findings -----------------------------------------------------------------------------------------------------------
test('a preview link must be a path on this site: a protocol-relative "//evil.example" is never rendered as a link', async () => {
  for (const bad of ['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '/a b']) {
    const r = await renderPage({ search: '?sample=interstate', sampleJson: { ...sample, preview_url: bad } });
    assert.equal(findAll(r.root, n => n.tag === 'a' && /evil|javascript/.test(n.attrs.href || '')).length, 0, bad);
    assert.doesNotMatch(textOf(r.root), /Drag through the film/, bad);
  }
  const ok = await renderPage({ search: '?sample=interstate', sampleJson: sample });
  assert.match(textOf(ok.root), /Drag through the film/);
});

test('the video and its poster are https links only (a signed storage link): anything else is dropped', async () => {
  const r = await renderPage({ search: `?s=${SLUG}`, page: { ...PUBLISHED, video_url: 'javascript:alert(1)', poster_url: 'http://insecure.example/p.jpg' } });
  const v = findAll(r.root, n => n.tag === 'video')[0];
  assert.equal(v.attrs.src, undefined);
  assert.equal(v.attrs.poster, undefined);
  const good = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  assert.equal(findAll(good.root, n => n.tag === 'video')[0].attrs.src, 'https://jxtk.supabase.co/v.mp4');
});

test('focus: #sources moves focus to the sources heading; a failed load (even with #sources) focuses its heading; the Sources link target can take focus', async () => {
  const ok = await renderPage({ search: `?s=${SLUG}`, hash: '#sources', page: PUBLISHED });
  assert.equal(find(ok.root, n => n.attrs.id === 'sources-title').focused, true);
  assert.equal(find(ok.root, n => n.attrs.id === 'sources-title').attrs.tabindex, '-1');
  const failed = await renderPage({ search: `?s=${SLUG}`, hash: '#sources', status: 404 });
  assert.equal(find(failed.root, n => n.tag === 'h1').focused, true);
  const plainLoad = await renderPage({ search: `?s=${SLUG}`, page: PUBLISHED });
  assert.equal(find(plainLoad.root, n => n.attrs.id === 'sources-title').attrs.tabindex, '-1');
  assert.equal(find(plainLoad.root, n => n.tag === 'h1').focused, true);
});

test('THE SAMPLE IS BUILT FROM THE PUBLIC FILM: its title, final engine, draw date, length, the one real source and a real last-frame poster are served from /film/samples/', () => {
  assert.ok(fs.existsSync(path.join(root, 'film/samples/interstate.json')));
  assert.ok(fs.existsSync(path.join(root, 'film/samples/interstate-final-frame.jpg')));
  assert.equal(sample.title, 'Rise of the Interstate Highway, 1956–1993');                 // the film's public title (youtu.be/UC4j77KYVQ8)
  assert.deepEqual(sample.summary.film, { seconds: 119.5, width: 1920, height: 1080, fps: 30 });
  assert.deepEqual(sample.summary.engine, { commit: 'b17561adead5', drawn_at: '2026-10-15' });   // the FINAL film's sidecar, not the 10-10 draft's
  assert.equal(sample.published_at, null);                                                     // a sample, not a published page
  assert.equal(sample.summary.datasets[0].sources[0].url, 'https://doi.org/10.3886/E144281V1');
});
