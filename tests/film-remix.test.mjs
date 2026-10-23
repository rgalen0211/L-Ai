// "See your county" (NEXT-WEB 131): the gate that keeps a customer's own data out of it, what a remix request may carry, and the funnel steps. The page itself in real Chrome: tools/check-film-remix.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

const win = {};
vm.runInNewContext(read('assets/film-remix.js'), { window: win, matchMedia: undefined, setTimeout });
const R = win.ryagramFilmRemix;
const ON = { seeYourCounty: true };
const PUBLIC = () => ({ title: 'T', summary: { uploaded_data: false, datasets: [] }, remix: { version: 1, public: true, kind: 'county', film_ref: 'interstate', places: 'interstate-practice' } });

test('THE GATE: only a film made from public data, that says it can be remixed, with the flag on, gets the button', () => {
  assert.equal(R.eligible(PUBLIC(), ON), true);
  assert.equal(R.eligible(PUBLIC(), {}), false, 'flag off');
  assert.equal(R.eligible(PUBLIC(), { seeYourCounty: 'true' }), false, 'only a real true');
  assert.equal(R.eligible(PUBLIC(), null), false);
});

test('MUST-FAIL: a film made from a customer\'s own uploaded data shows NO button, whatever else the page says', () => {
  const priv = PUBLIC(); priv.summary.uploaded_data = true;
  assert.equal(R.eligible(priv, ON), false, 'uploaded data');
  const unknown = PUBLIC(); delete unknown.summary.uploaded_data;
  assert.equal(R.eligible(unknown, ON), false, 'not stated: not public');
  const strange = PUBLIC(); strange.summary.uploaded_data = 'false';
  assert.equal(R.eligible(strange, ON), false, 'only a real false');
  const nosum = PUBLIC(); delete nosum.summary;
  assert.equal(R.eligible(nosum, ON), false);
  const norem = PUBLIC(); delete norem.remix;
  assert.equal(R.eligible(norem, ON), false, 'a film the maker has not opened to remix');
  for (const f of [r => { r.public = false; }, r => { r.version = 2; }, r => { r.kind = 'state'; }, r => { r.film_ref = 'A/../b'; }]) {
    const x = PUBLIC(); f(x.remix); assert.equal(R.eligible(x, ON), false);
  }
});

test('MUST-FAIL: the places file is named, not addressed: only a plain name, so it can only be a fixed public file on this site', () => {
  for (const u of ['https://evil.example/x', '//evil.example/x', '../../app/x', 'a/b', 'a.json', 'a?x=1', 'javascript:alert(1)', 'A', '', 'x'.repeat(41)]) {
    const x = PUBLIC(); x.remix.places = u; assert.equal(R.eligible(x, ON), false, u);
  }
});

test('MUST-FAIL: a remix never reads the source film\'s private values; the request is built from named fields only', () => {
  const p = PUBLIC();
  p.summary.private_rows = [{ secret: 'CANARY-ROW-9' }]; p.summary.owner_email = 'CANARY-EMAIL'; p.private_values = 'CANARY-VALUES'; p.video_url = 'https://x/CANARY-VIDEO.mp4';
  p.remix.private_note = 'CANARY-NOTE';
  const spec = R.buildSpec(p, { state_fips: '48', county_fips: '201', name: 'CANARY-NAME', series: [1, 2] });
  assert.deepEqual(plain(spec), { v: 1, film_ref: 'interstate', state_fips: '48', county_fips: '201' });
  assert.ok(!JSON.stringify(spec).includes('CANARY'));
  assert.equal(R.buildSpec(p, { state_fips: '4', county_fips: '201' }), null);
  assert.equal(R.buildSpec(p, { state_fips: '48', county_fips: '20x' }), null);
  assert.equal(R.buildSpec(p, null), null);
  assert.equal(R.buildSpec({ remix: { film_ref: 'bad ref' } }, { state_fips: '48', county_fips: '201' }), null);
});

test('THE SOURCE FILM IS UNTOUCHED: the sample page opts in, its places file is labelled practice, and no private field is named in the code', () => {
  const sample = JSON.parse(read('film/samples/interstate.json'));
  assert.equal(R.eligible(sample, ON), true);
  assert.equal(R.eligible(sample, {}), false);
  const places = JSON.parse(read('film/remix/interstate-practice.json'));
  assert.equal(places.practice, true);
  assert.match(places.note, /PRACTICE NUMBERS/);
  for (const s of places.states) for (const c of s.counties) assert.equal(c.series.length, places.years.length, `${s.name} ${c.name}`);
  const code = read('assets/film-remix.js');
  assert.ok(!/uploaded_rows|owner_email|private_values|video_url|poster_url/.test(code.replace(/\/\/.*$/gm, '')), 'the remix code never touches those fields');
});

test('THE FLAG IS OFF in the shipped config', () => {
  assert.match(read('assets/ryagram-config.js'), /seeYourCounty:\s*false/);
});

// ------------------------------------------------------------------------------ the funnel steps
function funnelPage({ config = { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'sb_publishable_x', funnelTracking: true }, nav = {}, search = '' } = {}) {
  const fetches = [];
  const window = { ryagramConfig: config, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  vm.runInNewContext(read('assets/funnel.js'), {
    window, URLSearchParams, URL, JSON, Promise, navigator: { userAgent: 'Mozilla/5.0 Chrome', ...nav },
    location: { search, pathname: '/film/', hostname: 'uselai.com' }, document: { referrer: '', readyState: 'complete', addEventListener() {} },
    fetch: (u, init) => { fetches.push(JSON.parse(init.body)); return Promise.resolve({}); } });
  return { F: window.ryagramFunnel, fetches };
}

test('FUNNEL: film_view, remix_click and preview_created are sent as anonymous steps with the visit\'s source and nothing else; any other name is refused', () => {
  const t = funnelPage({ search: '?utm_source=YouTube&utm_campaign=oct' });
  for (const n of ['film_view', 'remix_click', 'preview_created']) t.F.filmEvent(n);
  t.F.filmEvent('purchase'); t.F.filmEvent('landing_view'); t.F.filmEvent('x');
  assert.deepEqual(t.fetches.map(b => b.p_event), ['film_view', 'remix_click', 'preview_created']);
  assert.deepEqual(Object.keys(t.fetches[0]).sort(), ['p_event', 'p_referrer', 'p_utm_campaign', 'p_utm_medium', 'p_utm_source']);
  assert.equal(t.fetches[0].p_utm_source, 'youtube');
});

test('FUNNEL: nothing is sent when tracking is off, for Do Not Track, Global Privacy Control or an automated browser', () => {
  for (const o of [{ config: { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'k' } }, { nav: { doNotTrack: '1' } }, { nav: { globalPrivacyControl: true } }, { nav: { webdriver: true } }]) {
    const t = funnelPage(o); t.F.filmEvent('remix_click'); assert.deepEqual(t.fetches, []);
  }
});

test('THE FILM PAGE loads the remix code before film.js, with one new cache stamp', () => {
  const html = read('film/index.html');
  assert.ok(html.indexOf('film-remix.js') > 0 && html.indexOf('film-remix.js') < html.indexOf('film.js?'));
  assert.match(html, /funnel\.js\?v=20261023b/);
  assert.match(read('assets/film.js'), /remixSection\(page\)/);
});
