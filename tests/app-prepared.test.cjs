// "Prepared by your AI" (assets/app-prepared.js, CONNECT 2026-11-20, Q634): the person's side of a table their AI handed over. What it guarantees: nothing is sent before a button is pressed; the AI's words (label, sources,
// licence, units, notes, change log) are shown as TEXT only and a source address is never a link; the years with no rows are named; Accept takes the text, runs the app's own upload path (startUpload) and only then records
// the acceptance; a failed upload records nothing and the buttons come back; Discard removes it. A tiny element stand-in records what the page would draw.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-prepared.js'), 'utf8');
function load() { const window = {}; vm.runInNewContext(src, { window, File, Date }); return window.ryagramPrepared; }
const P = load();
const plain = v => JSON.parse(JSON.stringify(v));

// the stand-in for h(): a node records its tag, props and children; strings are kept as TEXT (nothing is parsed)
function h(tag, props, ...kids) {
  const n = { tag, props: props || {}, kids: kids.flat(Infinity).filter(k => k != null), disabled: false, hidden: !!(props && props.hidden), textContent: '', className: '' };
  return n;
}
function text(n) { return typeof n === 'string' ? n : [n.textContent, ...n.kids.map(text)].join(' '); }
function walk(n, f) { if (typeof n === 'string') return; f(n); n.kids.forEach(k => walk(k, f)); }
function find(n, pred) { const out = []; walk(n, x => { if (pred(x)) out.push(x); }); return out; }
// replaceChildren is on the section node the module creates; give every node the method the module calls
const origH = h;
function hh(tag, props, ...kids) { const n = origH(tag, props, ...kids); n.replaceChildren = (...ks) => { n.kids = ks.flat(Infinity).filter(k => k != null); }; return n; }

const ITEM = {
  id: '00000000-0000-4000-8000-0000000000a1', label: 'Median age by US state, ACS 1-year', ai_name: 'Claude', created_at: '2026-11-20T15:00:00Z', expires_at: '2026-11-27T15:00:00Z',
  sources: { urls: ['https://data.census.gov/table?q=B01002'], publisher: 'U.S. Census Bureau', licence: 'Public domain (U.S. government work)', units: 'median age in years', notes: 'No standard 2020 one-year release' },
  change_log: ['kept table B01002 estimate 001', 'one row per state and year'],
  measured: { rows: 26, columns: 3, places: 2, first_period: 2010, last_period: 2023, periods_found: 13, periods_missing: [2020] },
  preview_lines: ['place,year,value', 'Alabama,2010,37.9', 'Alabama,2011,38.1'], trust_label: 'unverified_user',
};
function world(items = [ITEM], opts = {}) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'my_prepared_data') return { data: opts.listError ? null : items.slice(), error: opts.listError ? { message: 'function does not exist' } : null };
      if (name === 'my_prepared_data_csv') return { data: 'place,year,value\nAlabama,2010,37.9\n', error: null };
      if (name === 'mark_prepared_accepted') return { data: { accepted: true }, error: null };
      if (name === 'discard_prepared_data') { items.length = 0; return { data: { discarded: true }, error: null }; }
      return { data: null, error: { message: 'unknown' } };
    },
  };
  const uploads = [];
  const data = { async startUpload(file, o) { uploads.push([file, o]); if (opts.uploadFails) throw new Error('The file didn’t upload. Check your connection and try again.'); return '00000000-0000-4000-8000-0000000000d1'; } };
  let changed = 0;
  const made = P.create({ h: hh, client, data, onChange: async () => { changed += 1; } });
  return { made, calls, uploads, get changed() { return changed; } };
}
const settle = () => new Promise(r => setTimeout(r, 5));

test('the measured sentence says what Ryagram found and NAMES the years with no rows (missing stays missing)', () => {
  assert.match(P.measuredWords(ITEM.measured), /26 rows and 3 columns; 2 places; years 2010 to 2023 \(13 found; NO rows for 2020\)/);
  assert.match(P.measuredWords({ rows: 4, columns: 2 }), /no year could be found/);
  assert.equal(P.TRUST_LABEL, 'Unverified, user-supplied');
});

test('nothing is sent but the read until a button is pressed; with nothing waiting the section is hidden; a database without the SQL shows nothing', async () => {
  const w = world();
  await settle();
  assert.deepEqual(w.calls.map(c => c[0]), ['my_prepared_data']);
  assert.equal(w.made.el.hidden, false);
  const none = world([]); await settle(); assert.equal(none.made.el.hidden, true);
  const nosql = world([ITEM], { listError: true }); await settle(); assert.equal(nosql.made.el.hidden, true);
});

test('the AI\'s words are TEXT: markup in a label or a source stays text, a source address is words and never a link, nothing uses innerHTML', async () => {
  const evil = { ...ITEM, label: '<img src=x onerror=alert(1)>', sources: { ...ITEM.sources, urls: ['https://evil.example/a" onclick="x'], notes: '<script>1</script>' }, change_log: ['<b>did a thing</b>'] };
  const w = world([evil]); await settle();
  const all = text(w.made.el);
  assert.ok(all.includes('<img src=x onerror=alert(1)>') && all.includes('<script>1</script>'), 'the markup is on the page as words');
  assert.equal(find(w.made.el, n => n.tag === 'a').length, 0, 'no link anywhere');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src), 'the module never parses markup');
  assert.ok(!/href/.test(src), 'and never builds a link');
});

test('Accept: it takes the text, runs the app\'s own upload path, records the acceptance only after the upload, and redraws the data cards', async () => {
  const w = world(); await settle();
  const accept = find(w.made.el, n => n.tag === 'button' && /Accept/.test(text(n)))[0];
  assert.ok(accept, 'the button is there');
  await accept.onclick(); await settle();
  assert.deepEqual(w.calls.map(c => c[0]), ['my_prepared_data', 'my_prepared_data_csv', 'mark_prepared_accepted', 'my_prepared_data']);
  assert.deepEqual(plain(w.calls[2][1]), { p_id: ITEM.id, p_dataset: '00000000-0000-4000-8000-0000000000d1' });
  assert.equal(w.uploads.length, 1);
  const [file, o] = w.uploads[0];
  assert.equal(file.name, 'Median-age-by-US-state-ACS-1-year.csv'); assert.equal(file.type, 'text/csv');
  assert.deepEqual(plain(o), { label: 'Median age by US state, ACS 1-year', ext: 'csv', contentType: 'text/csv', retention: null });
  assert.equal(w.changed, 1);
});

test('MUST-FAIL: when the upload fails nothing is recorded as accepted, the buttons come back and the person is told in words', async () => {
  const w = world([ITEM], { uploadFails: true }); await settle();
  const accept = find(w.made.el, n => n.tag === 'button' && /Accept/.test(text(n)))[0];
  await accept.onclick(); await settle();
  assert.ok(!w.calls.some(c => c[0] === 'mark_prepared_accepted'), 'the acceptance is never recorded');
  assert.equal(accept.disabled, false);
  assert.match(text(w.made.el), /The file didn’t upload/);
});

test('Discard removes it from Ryagram and from the page', async () => {
  const w = world(); await settle();
  const discard = find(w.made.el, n => n.tag === 'button' && /Discard/.test(text(n)))[0];
  await discard.onclick(); await settle();
  assert.ok(w.calls.some(c => c[0] === 'discard_prepared_data' && c[1].p_id === ITEM.id));
  assert.equal(w.made.el.hidden, true);
});

test('the card says the honest things: unverified, not checked by Ryagram, nothing is used until you accept, the tick comes after', async () => {
  const w = world(); await settle();
  const all = text(w.made.el);
  for (const t of ['Unverified, user-supplied', 'Ryagram has not checked this', 'not checked by Ryagram', 'Nothing uses this table until you accept it', 'tick “use it anyway”', 'NO rows for 2020', 'Licence: Public domain', 'Units: median age in years']) assert.ok(all.includes(t), t);
});
