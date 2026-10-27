// Public film pages: the allowlisted summary built from a real receipt, and the film-page
// function's two callers (visitors reading, owners publishing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarize } from '../supabase/functions/film-page/summary.ts';
import { handle } from '../supabase/functions/film-page/page.ts';

const RECEIPT = JSON.parse(fs.readFileSync(new URL('./fixtures/film/receipt-obesity.json', import.meta.url), 'utf8'));
const STORY = { schema: 1, engine: 'sequence', name: 'obesity', sequence: { clips: [
  { kind: 'title', id: 'open', headline: 'Fast food and obesity', subhead: 'Same states? 48 states and DC, 2012-2023.' },
  { kind: 'render', id: 'main', dataset: 'state_obesity_fastfood', view: 'paired', start: '2012', end: '2023' }] } };

test('summary from a real receipt: sources, method and measures, and nothing private', () => {
  const s = summarize(RECEIPT, STORY, { uploaded: false });
  assert.equal(s.headline, 'Fast food and obesity');
  assert.deepEqual(s.window, { start: '2012', end: '2023' });
  assert.equal(s.area, 'US state (plus DC), Contiguous U.S.');
  assert.equal(s.datasets.length, 1);
  const d = s.datasets[0];
  assert.equal(d.label, 'Obesity and fast food by state (CDC + Census, annual)');
  assert.deepEqual(d.sources.map(x => [x.name, x.url]), [
    ['CDC, Behavioral Risk Factor Surveillance System (BRFSS)', 'https://data.cdc.gov/d/hn4x-zwk7'],
    ['U.S. Census Bureau, County Business Patterns (CBP)', 'https://www.census.gov/programs-surveys/cbp.html']]);
  assert.match(d.sources[0].license, /public domain/);
  assert.match(d.method, /NAICS 722513/);
  assert.equal(d.retrieved, '2026-09-23');
  assert.equal(d.values_are, 'partly derived');                      // "; see derivations" pointed at the receipt, so it's dropped
  assert.ok(d.derivations.length >= 1 && /minus 2011/.test(d.derivations[0].method));
  assert.ok(d.breaks.some(b => b.period === '2011'));
  assert.deepEqual(s.measures.map(m => m.label).slice(0, 2), ['Adult obesity prevalence', 'Net new limited-service restaurants since 2011']);
  assert.deepEqual(s.film, { seconds: 52, width: 1920, height: 1080, fps: 30 });
  assert.equal(s.engine.commit, '09446f20c754');

  const json = JSON.stringify(s);
  for (const secret of ['worker', 'C:\\\\', 'cache', 'reproduce', 'spec_sha', 'md5', 'band_counts', 'size_bytes']) {
    assert.ok(!json.includes(secret), `summary leaks ${secret}`);
  }
});

test('summary of a film from uploaded data names only the maker\u2019s own data', () => {
  const s = summarize(RECEIPT, STORY, { uploaded: true });
  assert.deepEqual(s.datasets.map(d => [d.label, d.sources.length, d.method]), [['The maker\u2019s own data', 0, '']]);
  assert.deepEqual(s.measures, []);
  assert.equal(s.area, '');
  assert.ok(!JSON.stringify(s).includes('CDC'));
});

test('summary of a hostile or broken receipt stays plain and bounded', () => {
  const evil = { clips: [{ kind: 'render', provenance: {
    dataset: { id: 'x', label: 'A\u202eB\u0000C' + 'x'.repeat(5000),
               sources: [{ name: 'Bad', url: 'javascript:alert(1)' }, { name: 'Creds', url: 'https://user:pw@example.com/' },
                         { name: 'Plain http', url: 'http://example.com/' }, { name: '', url: 'https://example.com/' },
                         ...Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, url: 'https://example.com/' }))],
               notes: 'Real method. See the sidecar for the rest. Also C:\\Users\\someone\\data.csv here.' },
    measures: [{ label: '<img src=x onerror=alert(1)>', unit: '%' }] } }], output: { seconds: 'NaN' }, inputs: { code: { commit: 'not hex' } } };
  const s = summarize(evil, { sequence: { clips: [{ kind: 'title', headline: 42 }] } }, { uploaded: false });
  const d = s.datasets[0];
  assert.ok(!/[\u0000\u202e]/.test(d.label));
  assert.ok(d.label.length <= 300);
  assert.deepEqual(d.sources.slice(0, 3).map(x => x.url), ['', '', '']);
  assert.equal(d.sources.length, 20);
  assert.equal(d.method, 'Real method.');
  assert.equal(s.measures[0].label, '<img src=x onerror=alert(1)>');   // kept as text; the page never uses innerHTML
  assert.equal(s.film.seconds, null);
  assert.equal(s.engine.commit, '');
  assert.equal(s.headline, '42');
  for (const junk of [null, 'x', [], { clips: 'no' }]) assert.ok(summarize(junk, null, { uploaded: false }));
});

// ---- the function --------------------------------------------------------------------------
const OWNER = '00000000-0000-4000-8000-000000000001';
const V = '11111111-1111-4111-8111-111111111111';
const SLUG = 'AbCdEfGhIjKlMnOpQrStUv';
function world(over = {}) {
  const published = [];
  return {
    published,
    deps: {
      allowedOrigins: ['https://uselai.com'], siteUrl: 'https://uselai.com',
      verifyUser: async jwt => (jwt === 'good' ? { id: OWNER } : null),
      publishContext: async () => ({ project_title: 'Obesity', story: STORY, uploaded_data: false,
                                     receipt_path: 'u/p/v/j/receipt.sequence.json', slug: null }),
      readFile: async () => JSON.stringify(RECEIPT),
      publish: async (owner, versionId, title, summary, confirmed) => { published.push({ owner, versionId, title, summary, confirmed }); return SLUG; },
      publicFilm: async slug => (slug === SLUG ? { title: 'Fast food and obesity', summary: { headline: 'x' }, published_at: '2026-10-01T00:00:00Z',
                                                   video_path: 'u/p/v/j/film.mp4', thumb_path: 'u/p/v/j/thumb.jpg' } : null),
      signedUrl: async (path, seconds) => `https://jxtk.supabase.co/storage/v1/object/sign/ryagram-artifacts/${path}?token=t&s=${seconds}`,
      ...over,
    }
  };
}
const get = (deps, slug) => handle(new Request(`https://x.supabase.co/functions/v1/film-page?s=${encodeURIComponent(slug)}`,
                                               { headers: { origin: 'https://uselai.com' } }), deps);
const post = (deps, body, { jwt = 'good', origin = 'https://uselai.com' } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/film-page', { method: 'POST', body: JSON.stringify(body),
    headers: { origin, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' } }), deps);

test('visitors get the page with hour-long signed links, and nothing for unknown or bad slugs', async () => {
  const { deps } = world();
  const res = await get(deps, SLUG);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  const page = await res.json();
  assert.match(page.video_url, /film\.mp4\?token=t&s=3600$/);
  assert.match(page.poster_url, /thumb\.jpg/);
  assert.equal(page.title, 'Fast food and obesity');
  assert.ok(!('video_path' in page));
  for (const bad of ['', 'short', SLUG + 'x', "AbCdEfGhIjKlMnOpQrSt'v", 'zzzzzzzzzzzzzzzzzzzzzz']) {
    assert.equal((await get(deps, bad)).status, 404, bad);
  }
  // Files gone (retention) or signing failing: the page still answers, without a video.
  const gone = world({ publicFilm: async () => ({ title: 't', summary: {}, published_at: 'x', video_path: null, thumb_path: null }) });
  assert.equal((await (await get(gone.deps, SLUG)).json()).video_url, null);
});

test('owners publish through the function; the summary is built server-side from the receipt', async () => {
  const w = world();
  let res = await post(w.deps, { version_id: V, title: '  My   film  ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { slug: SLUG, url: `https://uselai.com/film/?s=${SLUG}` });
  assert.equal(w.published[0].title, 'My film');
  assert.equal(w.published[0].summary.datasets[0].sources.length, 2);
  res = await post(w.deps, { version_id: V });
  assert.equal(w.published[1].title, 'Fast food and obesity');             // the film's own headline by default

  assert.equal((await post(w.deps, { version_id: V }, { jwt: 'bad' })).status, 401);
  assert.equal((await post(w.deps, { version_id: V }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(w.deps, { version_id: 'nope' })).status, 400);
  assert.equal(w.published.length, 2);

  const notYours = world({ publishContext: async () => { throw Object.assign(new Error('Version not found.'), { code: 'PT404' }); } });
  assert.equal((await post(notYours.deps, { version_id: V })).status, 404);
  const unfinished = world({ publishContext: async () => { throw Object.assign(new Error('Only a finished film can have a public page.'), { code: '42501' }); } });
  res = await post(unfinished.deps, { version_id: V });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /finished film/);
  const noReceipt = world({ readFile: async () => 'not json' });
  assert.equal((await post(noReceipt.deps, { version_id: V })).status, 409);
  assert.equal(noReceipt.published.length, 0);
});

test('the /film/?mock sample is what summarize() makes of the fixture receipt', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/film/page-sample.json', import.meta.url), 'utf8'));
  const story = { sequence: { clips: [{ kind: 'title', headline: 'Fast food and obesity', subhead: 'Same states? 48 states and DC, 2012-2023.' }] } };
  assert.deepEqual(sample.summary, JSON.parse(JSON.stringify(summarize(RECEIPT, story, { uploaded: false }))));
});

test('the summary reads exactly the fields in receipt-fields.json: none unlisted, none unused', async () => {
  const { USED } = await import('../supabase/functions/film-page/summary.ts');
  const fields = JSON.parse(fs.readFileSync(new URL('../supabase/functions/film-page/receipt-fields.json', import.meta.url), 'utf8'));
  USED.clear();
  summarize(RECEIPT, { sequence: { clips: [] } }, { uploaded: false });    // no story title: read the receipt's
  const listed = [...fields.top.map(f => `top:${f}`), ...fields.clip.map(f => `clip:${f}`)].sort();
  assert.deepEqual([...USED].sort(), listed);
  const d = summarize(RECEIPT, STORY, { uploaded: false }).datasets[0];
  assert.match(d.credit, /CDC|Census/);                                     // the film's own source line
});

// ---- opt-in, and films made from an upload (Ryan, 2026-10-13) -------------------------------------------------------------------------------
test('a film made from the owner\'s upload (every "Don\'t keep my data" project) is NOT published until the owner confirms, and nothing is read or written first', async () => {
  const touched = [];
  const { deps, published } = world({
    publishContext: async () => ({ project_title: 'My data', story: STORY, uploaded_data: true, receipt_path: 'u/p/v/j/receipt.sequence.json', slug: null }),
    readFile: async p => { touched.push(['read', p]); return JSON.stringify(RECEIPT); },
  });
  const refused = await post(deps, { version_id: V });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.code, 'confirm_uploaded');
  assert.equal(body.error, "This film was drawn from data you uploaded, so anyone with the link will see what it shows — your data's values and pattern, frame by frame. The page lists the film's sources, not your file. Publish it anyway?");
  assert.deepEqual([published.length, touched.length], [0, 0]);
  for (const wrong of [{ confirm_uploaded: 'true' }, { confirm_uploaded: 1 }, { confirm_uploaded: false }, {}])
    assert.equal((await post(deps, { version_id: V, ...wrong })).status, 409, JSON.stringify(wrong));
  assert.equal(published.length, 0);
  const ok = await post(deps, { version_id: V, confirm_uploaded: true });
  assert.equal(ok.status, 200);
  assert.equal(published.length, 1);
  assert.equal(published[0].confirmed, true);                      // the database backstop is told the owner confirmed
  const s = published[0].summary;
  assert.equal(s.uploaded_data, true);
  assert.deepEqual(s.datasets.map(d => [d.label, d.sources.length, d.method]), [['The maker’s own data', 0, '']]);        // the film and "own data", never the data's labels or notes
  assert.deepEqual(s.measures, []);
});

test('a film made from public data publishes without the extra question (the owner pressed Publish: that is the opt-in)', async () => {
  const { deps, published } = world();
  assert.equal((await post(deps, { version_id: V })).status, 200);
  assert.equal(published.length, 1);
});

test('nothing in this function can publish by itself: the only writer is the POST with a signed-in owner', async () => {
  const { deps, published } = world();
  assert.equal((await get(deps, SLUG)).status, 200);
  assert.equal((await get(deps, 'ZZZZZZZZZZZZZZZZZZZZZZ')).status, 404);
  assert.equal((await post(deps, { version_id: V }, { jwt: 'forged' })).status, 401);
  assert.equal((await post(deps, { version_id: V }, { origin: 'https://evil.example' })).status, 403);
  assert.equal(published.length, 0);
});

test('a film made from public data reaches the database with confirmed = false (the backstop stays armed); only boolean true counts', async () => {
  const { deps, published } = world();
  assert.equal((await post(deps, { version_id: V })).status, 200);
  assert.equal(published[0].confirmed, false);
  assert.equal((await post(deps, { version_id: V, confirm_uploaded: 'yes' })).status, 200);
  assert.equal(published[1].confirmed, false);
});
