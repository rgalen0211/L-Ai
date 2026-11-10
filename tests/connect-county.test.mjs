// The county tools in the connector (CONNECT, 2026-11-09; BACKLOG CONNECT-4; contract proposals/CONNECT-COUNTY-TOOLS-CONTRACT-1109.md; the words are GEO's, proposals/GEO-LI-TOOL-WORDS-1109.md). Offline, against the connector's own code and its stand-in world.
// county_profile and compare_counties ASK (a request the house computer answers with GEO's tools); county_answer READS the answer back. They are unlisted, read-only, and off unless the county switch is wired (the real function wires none).
// The answers in these tests have the REAL shape of GEO's tools (tools/geo_county_profile.py on geo-li-connect-fields-1109: series with years, breaks, unit and note; a rule table; profiles in the order shown), with INVENTED numbers.
// Tested here: GEO's words are wired as they are; every refusal is GEO's sentence; nothing is asked while off; limits; and the lock on the way back: no series without a label, source and a reason for every missing year, no path on a computer, no banned claim,
// no sources added together, an order only under a stated rule that the table really follows. The SQL half is supabase/tests/test_county_requests.py. Must-fails: tests/connect_county_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp, toolList } from '../supabase/functions/connect-core/mcp.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { openApi } from '../supabase/functions/connect-core/rest.ts';
import { BANNED_WORDS, COMPARE_COUNTIES_DESCRIPTION, COMPARE_SCHEMA, COUNTY_LIST, COUNTY_PROFILE_DESCRIPTION, COUNTY_RULES, PATHISH, PROFILE_SCHEMA, SAY_COMPARE, SAY_LINES, SOURCES_NEVER_ADDED, checkCountyArgs, countyLines, plainWords, readCountyAnswer } from '../supabase/functions/connect-core/county.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { cases as sharedCases, G, M, series, yrs, CBP, SERIES, NOT_HELD_ITEMS, profile, rowOf, compare, PROFILE_ASK, COMPARE_ASK, mutate, BAD_PROFILES, cmp, BAD_COMPARES } from './fixtures/county/build-cases.mjs';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };

function server({ on = true, scopes = ['read'] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 100);
  w.invite(A.userId, A.clientId, scopes); w.invite(B.userId, B.clientId, scopes);
  w.issue('tok-a', A); w.issue('tok-b', B);
  const deps = { data: null, policy: w.policy(), deps: { compile, ...(on ? { county: { enabled: () => true } } : {}) }, verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource' };
  const rpc = async (method, params, token = 'tok-a') => JSON.parse(await (await handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps)).text());
  const call = async (name, args, token = 'tok-a') => (await rpc('tools/call', { name, arguments: args }, token)).result;
  return { w, rpc, call };
}

// ---- answers in the real shape of GEO's tools, with invented numbers
const wrap = (s) => `<<${s}>>`;

// ------------------------------------------------------------------------------------------------ GEO's words, as they are
test('the descriptions and the fixed lines are GEO\'s, word for word (proposals/GEO-LI-TOOL-WORDS-1109.md sections 2 and 3)', () => {
  assert.equal(COUNTY_PROFILE_DESCRIPTION, 'Every figure Ryagram already holds for one county and limited-service restaurants: counts of places and places per 10,000 residents, employees and payroll, QCEW jobs and wages paid where held, housing permits, and population. Each figure carries its label (Observed or Calculated) and its source. It never downloads, forecasts, scores or ranks. Version one covers Greene County, Ohio (39057) and Montgomery County, Ohio (39113).');
  assert.equal(COMPARE_COUNTIES_DESCRIPTION, 'The same figures for two or more counties side by side. With no rule they stay in the order asked. With a rule the person states (places per 10,000 residents, lowest or highest first, or the count of places, highest first) they are ordered by that rule only, in the latest year every county has a figure, or the year asked. It is not a ranking: if a county has no figure that year, nothing is ordered and the county is named.');
  assert.deepEqual([...SAY_LINES], ['Ryagram counts places, jobs, wages paid, permits and people. It has no sales data, so it cannot say where a business would do well.', 'These are counts of places, not of sales or customers.', 'An order shown here follows the stated rule only; it is not a ranking of better places.']);
  assert.equal(SAY_COMPARE, 'This order follows only the rule you stated. It is not a ranking, and it does not say where a restaurant would do well.');
  assert.equal(SOURCES_NEVER_ADDED, 'QCEW and County Business Patterns count differently; their figures are never added together or averaged.');
  assert.deepEqual(COUNTY_LIST, { 39057: 'Greene County, Ohio', 39113: 'Montgomery County, Ohio' });
  assert.deepEqual(Object.keys(COUNTY_RULES), ['per_10k_low_first', 'per_10k_high_first', 'count_high_first']);
  assert.equal(PROFILE_SCHEMA, 'ryagram.geo-county-profile/0'); assert.equal(COMPARE_SCHEMA, 'ryagram.geo-compare-counties/0');
});

const COVERS = 'Greene County, Ohio (39057) and Montgomery County, Ohio (39113)';
const KINDS = 'Kinds: limited_service (limited-service restaurants)';
const OFFLIST = (c) => `county ${c}: version one covers only ${COVERS}; every other county comes once per-county extracts exist. Nothing is guessed for it.`;
const REFUSALS = [
  ['profile', { county: '3905' }, "county '3905': a county is its 5-digit FIPS code (state + county), for example 39057"],
  ['profile', { county: 39057 }, "county '39057': a county is its 5-digit FIPS code (state + county), for example 39057"],
  ['profile', { county: '39049' }, OFFLIST('39049')],
  ['profile', { county: G, kind: 'food_drink' }, "kind 'food_drink' is not in version one: all of NAICS 722 also counts bars and drinking places (7224) and caterers and mobile food (7223), which are not restaurants. " + KINDS],
  ['profile', { county: G, kind: 'grocery' }, "kind 'grocery' is not in version one: grocery is not offered yet; version one covers restaurants only. " + KINDS],
  ['profile', { county: G, kind: 'pharmacy' }, "kind 'pharmacy' is not in version one: pharmacy is not offered yet; version one covers restaurants only. " + KINDS],
  ['profile', { county: G, kind: 'best_spot' }, "kind 'best_spot' is not one this tool knows; it is not guessed. " + KINDS],
  ['compare', { counties: '39057' }, "counties: give a list of 5-digit FIPS codes, for example ['39057', '39113']"],
  ['compare', { counties: [G, 7] }, "counties: give a list of 5-digit FIPS codes, for example ['39057', '39113']"],
  ['compare', { counties: [G] }, `counties ['39057']: a comparison needs two or more different counties; version one covers ${COVERS}`],
  ['compare', { counties: [G, G] }, `counties ['39057', '39057']: a comparison needs two or more different counties; version one covers ${COVERS}`],
  ['compare', { counties: [G, '39049'] }, OFFLIST('39049')],
  ['compare', { counties: [G, M], rule: 'best_first' }, "rule 'best_first' is not one this tool knows; an order is never guessed. Rules: per_10k_low_first (places per 10,000 residents, lowest first), per_10k_high_first (places per 10,000 residents, highest first), count_high_first (the count of places, highest first)"],
  ['compare', { counties: [G, M], year: 2023 }, 'a year chooses the year a stated rule orders by; with no rule the counties are shown side by side, in the order asked'],
  ['compare', { counties: [G, M], rule: 'count_high_first', year: 1990 }, 'year 1990: a 4-digit year from 1998 to 2024'],
  ['compare', { counties: [G, M], rule: 'count_high_first', year: 'x' }, 'year x: a 4-digit year from 1998 to 2024'],
  ['compare', { counties: [G, M], rule: 'count_high_first', year: 2025 }, 'year 2025: a 4-digit year from 1998 to 2024'],
];
const CAP = (n) => `counties: a comparison is for two or three counties at a time (${n} were given): more would make the answer longer than this connection can carry. Ask again with three or fewer.`;
test('a comparison is for two or three counties: a fourth is refused in words that say why, before the coverage check, and three are not refused for their number (CC1 07:56 11-10)', () => {
  assert.equal(checkCountyArgs('compare', { counties: [G, M, '39049', '39051'] }).refused, CAP(4));
  assert.equal(checkCountyArgs('compare', { counties: [G, M, '39049', '39051', '39053', '39055'] }).refused, CAP(6));
  assert.equal(checkCountyArgs('compare', { counties: [G, G, G, G] }).refused, CAP(4), 'the number counts before repeats are looked at');
  assert.equal(checkCountyArgs('compare', { counties: [G, M, '39049'] }).refused, OFFLIST('39049'), 'three is not refused for its number (it is refused for coverage, as before)');
  assert.ok(checkCountyArgs('compare', { counties: [G, M] }).ask, 'two are asked');
  assert.match(checkCountyArgs('compare', { counties: '39057' }).refused, /give a list of 5-digit FIPS codes/, 'a list that is not a list still says so first');
});

test('every refusal is GEO\'s sentence, exactly (and a value the person typed is echoed cleaned, never as it came)', () => {
  for (const [shape, args, want] of REFUSALS) assert.equal(checkCountyArgs(shape, args).refused, want, JSON.stringify(args));
  assert.equal(checkCountyArgs('profile', { county: "39057'; drop" }).refused, "county '39057?? drop': a county is its 5-digit FIPS code (state + county), for example 39057");
  assert.ok(checkCountyArgs('profile', { county: G, kind: 'x'.repeat(100) }).refused.startsWith(`kind '${'x'.repeat(24)}' is not`), 'echo is cut short');
  assert.ok(!/RYAGRAM_GEO|Ryan|Q528|D:|prototype/.test(REFUSALS.map((r) => r[2]).join(' ')), 'no variable name, no internal reference, no path');
});

test('what is accepted is the closed request and nothing else: Greene and Montgomery, limited_service, the three rules, 1998 to 2024', () => {
  assert.deepEqual(checkCountyArgs('profile', { county: G }), { ask: { shape: 'profile', counties: [G], kind: 'limited_service', rule: null, year: null } });
  assert.deepEqual(checkCountyArgs('profile', { county: M, kind: 'limited_service' }).ask.counties, [M]);
  assert.deepEqual(checkCountyArgs('compare', { counties: [M, G] }).ask, { shape: 'compare', counties: [M, G], kind: 'limited_service', rule: null, year: null });
  for (const rule of Object.keys(COUNTY_RULES)) for (const year of [1998, 2024]) assert.deepEqual(checkCountyArgs('compare', { counties: [G, M], rule, year }).ask.year, year);
  assert.equal(checkCountyArgs('compare', { counties: [G, M], rule: 'count_high_first', year: 2023.5 }).refused, 'year 2023.5: a 4-digit year from 1998 to 2024');
});

// ------------------------------------------------------------------------------------------------ the tools and their switch
test('the three tools are unlisted, read-only, scope read, take only their own fields, and are in the registry', () => {
  const t = Object.fromEntries(['county_profile', 'compare_counties', 'county_answer'].map((n) => [n, TOOLS.find((x) => x.name === n)]));
  for (const [n, x] of Object.entries(t)) { assert.ok(x, n); assert.equal(x.listed, false, n); assert.equal(x.readOnly, true, n); assert.equal(x.scope, 'read', n); assert.equal(x.inputSchema.additionalProperties, false, n); }
  assert.ok(t.county_profile.description.startsWith(COUNTY_PROFILE_DESCRIPTION));
  assert.ok(t.compare_counties.description.startsWith(COMPARE_COUNTIES_DESCRIPTION));
  assert.deepEqual(Object.keys(t.county_profile.inputSchema.properties), ['county', 'kind']);
  assert.deepEqual(Object.keys(t.compare_counties.inputSchema.properties), ['counties', 'kind', 'rule', 'year']);
  assert.deepEqual(Object.keys(t.county_answer.inputSchema.properties), ['id']);
  assert.ok(!toolList(true, true).some((x) => x.name.startsWith('county') || x.name === 'compare_counties'), 'not in the list the AI sees');
  assert.ok(!toolList().some((x) => x.name.startsWith('county') || x.name === 'compare_counties'));
});

test('OFF (no county switch wired, which is how the real function runs): every tool refuses in words, asks nothing, names no setting', async () => {
  const s = server({ on: false });
  for (const [name, args] of [['county_profile', { county: G }], ['compare_counties', { counties: [G, M] }], ['county_answer', { id: '00000000-0000-4000-8000-000000000001' }]]) {
    const r = await s.call(name, args);
    assert.equal(r.isError, true, name);
    assert.equal(r.content[0].text, 'County questions are not available yet. Nothing was looked up.');
    assert.equal(r.structuredContent.looked_up, false);
  }
  assert.equal(s.w.users.get(A.userId).counties.size, 0, 'nothing was written');
  const list = (await s.rpc('tools/list', {})).result.tools;
  assert.ok(!list.some((x) => /county|compare_counties/.test(x.name)));
});

test('ON: a good question writes ONE request, says so in words, asking again is the same request, and refusals write nothing', async () => {
  const s = server();
  const r = await s.call('county_profile', { county: G });
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.asked, true); assert.equal(r.structuredContent.state, 'asked'); assert.equal(r.structuredContent.looked_up, false);
  assert.match(r.content[0].text, /Ask county_answer with id /);
  assert.match(r.content[0].text, /Nothing was looked up here/);
  const again = await s.call('county_profile', { county: G });
  assert.equal(again.structuredContent.id, r.structuredContent.id); assert.equal(again.structuredContent.repeat, true);
  assert.equal(s.w.users.get(A.userId).counties.size, 1);
  for (const [name, args, want] of [['county_profile', { county: '39049' }, OFFLIST('39049')], ['compare_counties', { counties: [G, M], rule: 'x' }, null], ['county_profile', { county: G, kind: 'grocery' }, null]]) {
    const bad = await s.call(name, args);
    assert.equal(bad.isError, true); assert.equal(bad.structuredContent.asked, false);
    if (want) assert.equal(bad.content[0].text, want, 'GEO\'s words, as they are');
  }
  assert.equal(s.w.users.get(A.userId).counties.size, 1, 'refusals write nothing');
  const c = await s.call('compare_counties', { counties: [G, M], rule: 'per_10k_low_first', year: 2023 });
  assert.equal(c.isError, false);
  const row = [...s.w.users.get(A.userId).counties.values()].find((x) => x.shape === 'compare');
  assert.deepEqual([row.counties, row.kind, row.rule, row.year], [[G, M], 'limited_service', 'per_10k_low_first', 2023]);
});

test('a connection without the read permission is refused like every tool, and asks are limited to 30 an hour', async () => {
  const none = server({ scopes: ['write'] });
  const r = await none.call('county_profile', { county: G });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /not allowed to do that/);
  const s = server();
  let ok = 0, limited = null;
  const w = s.w.countyWorker(A.userId);
  for (let i = 0; i < LIMITS.countyQuestionsPerHourPerUser + 1; i++) {
    const q = await s.call('compare_counties', { counties: i % 2 ? [G, M] : [M, G], rule: ['per_10k_low_first', 'per_10k_high_first', 'count_high_first'][i % 3], year: 1998 + (i % 27) });
    if (q.isError) { limited = q; break; }
    ok++;
    const job = w.claim(); if (job) w.fail(job.request_id, 'county_not_held', '');
  }
  assert.equal(ok, LIMITS.countyQuestionsPerHourPerUser);
  assert.match(limited.content[0].text, /limit of 30 county questions an hour/);
  assert.equal(limited.structuredContent.retry_after_seconds, 3600);
});

// ------------------------------------------------------------------------------------------------ the lock on the way back
test('a good profile and a good comparison are read: the NAME is from our closed list (never the answer\'s), every series labelled and every missing year says why', () => {
  const p = readCountyAnswer(PROFILE_ASK, profile());
  assert.equal(p.shape, 'profile');
  assert.deepEqual(p.profiles.map((c) => [c.fips, c.name]), [[G, 'Greene County, Ohio']]);
  assert.deepEqual(p.profiles[0].series.map((s) => [s.measure, s.label]), [['establishments', 'Observed'], ['per_10k', 'Calculated'], ['payroll', 'Observed']]);
  const payroll = p.profiles[0].series[2];
  assert.equal(payroll.years[1].value, null, 'a year that is not held stays null, never zero'); assert.equal(payroll.years[1].note, 'not published for this county in 2022');
  assert.deepEqual(p.profiles[0].series[0].breaks, [2012], 'the series break is kept');
  assert.deepEqual(p.profiles[0].not_held, NOT_HELD_ITEMS); assert.equal(p.profiles[0].read_from, 'read from the per-county extract');
  const c = readCountyAnswer(COMPARE_ASK, compare());
  assert.deepEqual([c.shape, c.rule, c.rule_year, c.ordered], ['compare', 'per_10k_low_first', 2023, true]);
  assert.deepEqual(c.profiles.map((x) => x.name), ['Montgomery County, Ohio', 'Greene County, Ohio'], 'in the order shown');
  assert.deepEqual(c.table.map((r) => [r.fips, r.value]), [[M, 5.1], [G, 7.4]]);
  const noRule = readCountyAnswer({ shape: 'compare', counties: [G, M], rule: null, year: null }, compare({ counties: [{ county: G }, { county: M }], rule: null, ordered: false, rule_table: [], profiles: [profile(G), profile(M)], order_words: 'the order you asked; no rule was stated, so nothing is ordered' }));
  assert.equal(noRule.ordered, false);
  const gap = compare({ counties: [{ county: G }, { county: M }], ordered: false, rule_table: [rowOf(G, 'x', 7.4), rowOf(M, 'y', null, { note: 'not held for 2023' })], profiles: [profile(G), profile(M)], order_words: 'no order: Montgomery County, Ohio (39113) has no figure for places per 10,000 residents in 2023 (not held for 2023); an order is never made with a county left out or counted as zero' });
  assert.equal(readCountyAnswer(COMPARE_ASK, gap).ordered, false, 'a county with no figure: nothing is ordered, and the county is named');
});

test('GEO\'s own notes pass (they say "not sales" and "no sales data"); only a claim fails', () => {
  assert.equal(plainWords('Payroll, not sales.', 100), 'Payroll, not sales.');
  assert.equal(plainWords('It has no sales data, so it cannot say where a business would do well.', 200), null, 'the fixed line itself is never run through the check (it says "do well"), and would not pass it');
  assert.equal(plainWords('There is no demand data here.', 100), 'There is no demand data here.');
  assert.equal(plainWords('sales are rising', 100), null); assert.equal(plainWords('strong demand for chicken', 100), null);
});

test('the answer is read against the request: every one of these is NOT shown', () => {
  for (const [name, a] of Object.entries(BAD_PROFILES)) assert.equal(readCountyAnswer(PROFILE_ASK, a), null, name);
  assert.equal(readCountyAnswer(PROFILE_ASK, null), null); assert.equal(readCountyAnswer(PROFILE_ASK, []), null); assert.equal(readCountyAnswer(PROFILE_ASK, 'x'), null);
});

test('what is not held: the {source, why} items are used; a sentence that names a folder is left out and counted, never shown', () => {
  const withPath = profile(G, { not_held_items: undefined, not_held: ['BLS QCEW: files not used: x.zip: could not read D:\\Ryagram-cache\\qcew', 'County Business Patterns: the files for 2019 are not in the cache'] });
  const p = readCountyAnswer(PROFILE_ASK, withPath).profiles[0];
  assert.deepEqual(p.not_held, [{ source: 'County Business Patterns', why: 'the files for 2019 are not in the cache' }]);
  assert.equal(p.withheld, 1);
  const text = countyLines(readCountyAnswer(PROFILE_ASK, withPath), wrap).join('\n');
  assert.ok(text.includes('(1 source line was left out because it named a place on a computer.)') && !text.includes('Ryagram-cache'));
  const items = profile(G, { not_held_items: [{ source: 'BLS QCEW', why: 'a path D:\\x' }, { source: 'Census', why: 'not held' }] });
  const q = readCountyAnswer(PROFILE_ASK, items).profiles[0];
  assert.deepEqual([q.not_held.length, q.withheld], [1, 1]);
  const how = readCountyAnswer(PROFILE_ASK, profile(G, { read_how: 'national_files', read_from: 'read from D:\\Ryagram-cache\\national' })).profiles[0];
  assert.equal(how.read_from, 'read from the national files', 'the how-it-was-read words stand in for a sentence that names a folder');
  assert.equal(readCountyAnswer(PROFILE_ASK, profile(G, { read_how: undefined, read_from: 'read from D:\\Ryagram-cache\\national' })).profiles[0].read_from, null);
});

test('a comparison is read against the request: exactly the counties asked, an order only under the stated rule, and only when the table really follows it', () => {
  for (const [name, [ask, a]] of Object.entries(BAD_COMPARES)) assert.equal(readCountyAnswer(ask, a), null, name);
});

test('the words the connector refuses on are GEO\'s section 6 list, and a path is a drive, a share, a user folder or the cache', () => {
  for (const s of ['will do well', 'a profit', 'strong demand', 'sales are up', 'foot traffic', 'the best location', 'it is permitted', 'a food desert', 'under-served', 'underserved', 'saturated', 'lack access', 'too many here', 'too few here', 'not enough restaurants', 'room for another', 'room for more']) {
    assert.ok(BANNED_WORDS.some((re) => re.test(s)), s);
    assert.equal(plainWords(s, 100), null, s);
  }
  for (const s of ['places counted', 'County Business Patterns', 'no county file is held', 'limited-service restaurants', 'no sales data held']) assert.equal(plainWords(s, 100), s, s);
  for (const s of ['D:\\Ryagram-cache\\x', 'C:/Users/x', '\\\\server\\share', '/Users/ryan/x', '/home/x', '../up', 'the ryagram-cache folder', '%TEMP%']) assert.ok(PATHISH.test(s), s);
  assert.equal(plainWords('x'.repeat(300), 100), null); assert.equal(plainWords('', 10), null); assert.equal(plainWords(5, 10), null);
  assert.equal(plainWords('see https://example.org/x', 100), null, 'a URL looks like a place on a computer to the path check');
  assert.equal(plainWords('see ftp://example.org/x', 100), null);
});

test('the text the AI reads opens with GEO\'s fixed lines, shows each series with its latest year, label, source, years held and breaks, names what is not held, and ends with the sources line; free text is wrapped as data', () => {
  const p = countyLines(readCountyAnswer(PROFILE_ASK, profile()), wrap);
  assert.deepEqual(p.slice(1, 4), [...SAY_LINES]);
  assert.ok(p[0].startsWith('COUNTY PROFILE'));
  assert.ok(p.includes('Greene County, Ohio (39057), limited-service restaurants:'));
  assert.ok(p.some((l) => l.startsWith('  <<Limited-service restaurants (places)>>: 2023: 123 <<places>>. Observed; <<U.S. Census Bureau, County Business Patterns') && l.includes('Held 2021 to 2023 (3 years). Series break: 2012. <<Counts of places, not of sales.>>')));
  assert.ok(p.some((l) => l.startsWith('  <<Places per 10,000 residents>>: 2023: 7.4 <<places per 10,000 residents>>. Calculated;')));
  assert.ok(p.some((l) => l.startsWith('  <<Annual payroll>>: 2023: 5,600') && l.includes('Held 2021 to 2023 (2 years).')), 'a year that is not held is not counted as held');
  assert.ok(p.includes('Not held:') && p.includes('  <<BLS QCEW>>: <<no county file is held for county 39057>>'));
  assert.ok(p.includes('Read from: <<read from the per-county extract>>'));
  assert.equal(p.at(-1), SOURCES_NEVER_ADDED);
  const c = countyLines(readCountyAnswer(COMPARE_ASK, compare()), wrap);
  assert.deepEqual(c.slice(1, 5), [...SAY_LINES, SAY_COMPARE]);
  assert.ok(c.some((l) => l.startsWith('Order (places per 10,000 residents, lowest first, 2023): Montgomery County, Ohio (39113) 5.1, then Greene County, Ohio (39057) 7.4.')));
  const none = countyLines(readCountyAnswer({ shape: 'compare', counties: [G, M], rule: null, year: null }, compare({ counties: [{ county: G }, { county: M }], rule: null, ordered: false, rule_table: [], profiles: [profile(G), profile(M)], order_words: null })), wrap);
  assert.ok(none.includes('No order was made: the counties are shown in the order asked.'));
  const lastNull = profile(G, { series: [series('payroll', 'Annual payroll', 'Observed', CBP, 'thousand dollars', yrs([[2022, 5], [2023, null, 'not published for 2023']]))] });
  assert.ok(countyLines(readCountyAnswer(PROFILE_ASK, lastNull), wrap).some((l) => l.includes('2023: no figure (<<not published for 2023>>)')), 'the latest year not held says so and says why');
});

// ------------------------------------------------------------------------------------------------ county_answer
const ID0 = '00000000-0000-4000-8000-0000000000ff';
async function asked(s, name, args) { const r = await s.call(name, args); return r.structuredContent.id; }
test('county_answer: waiting says so (and after five minutes says the computer may be off), a good answer is shown, a failed one says why, and nobody else\'s request is found', async () => {
  const s = server();
  const id = await asked(s, 'county_profile', { county: G });
  const w = s.w.countyWorker(A.userId);
  const wait = await s.call('county_answer', { id });
  assert.equal(wait.structuredContent.state, 'asked'); assert.match(wait.content[0].text, /^Not answered yet\./); assert.equal(wait.structuredContent.do_not_poll, false);
  const job = w.claim();
  assert.deepEqual([job.shape, job.counties, job.kind, job.rule, job.year], ['profile', [G], 'limited_service', null, null]);
  assert.equal((await s.call('county_answer', { id })).structuredContent.state, 'claimed');
  [...s.w.users.get(A.userId).counties.values()][0].asked = Date.now() - 400000;
  const stuck = await s.call('county_answer', { id });
  assert.equal(stuck.structuredContent.do_not_poll, true); assert.match(stuck.content[0].text, /may be off or busy/);
  w.finish(job.request_id, profile());
  const done = await s.call('county_answer', { id });
  assert.equal(done.isError, false);
  const text = done.content[0].text;
  assert.ok(text.indexOf(SAY_LINES[0]) < text.indexOf('Greene County, Ohio (39057)'), 'the fixed lines come first');
  assert.ok(text.includes('<untrusted'), 'free text is marked as data');
  assert.deepEqual(done.structuredContent.say, [...SAY_LINES]);
  assert.equal(done.structuredContent.profiles[0].name, 'Greene County, Ohio');
  assert.equal(done.structuredContent.profiles[0].series[2].years[1].value, null);
  assert.deepEqual(done.structuredContent.labels, ['Observed', 'Calculated']);
  assert.ok(!text.includes('Atlantis'), 'the name is ours');
  const other = await s.call('county_answer', { id }, 'tok-b');
  assert.equal(other.isError, true); assert.match(other.content[0].text, /not found among yours/);
  assert.equal((await s.call('county_answer', { id: ID0 })).isError, true);
  const id2 = await asked(s, 'county_profile', { county: M });
  const job2 = w.claim(); w.fail(job2.request_id, 'county_not_held', 'no figure is held for 39113 in D:\\Ryagram-cache');
  const failed = await s.call('county_answer', { id: id2 });
  assert.equal(failed.isError, true); assert.match(failed.content[0].text, /^No figure is held for that county, so nothing is shown\. Nothing is guessed\. Nothing is shown\.$/, 'a reason that names a folder is left out whole');
  assert.equal(failed.structuredContent.fail_code, 'county_not_held');
});

test('county_answer: a comparison is shown with its order and its table, and an answer that is not usable is NOT shown, with words that say why in general terms', async () => {
  const s = server(), w = s.w.countyWorker(A.userId);
  const id = await asked(s, 'compare_counties', { counties: [G, M], rule: 'per_10k_low_first', year: 2023 });
  w.finish(w.claim().request_id, compare());
  const r = await s.call('county_answer', { id });
  assert.equal(r.isError, false);
  assert.ok(r.content[0].text.includes('Order (places per 10,000 residents, lowest first, 2023): Montgomery County, Ohio (39113) 5.1, then Greene County, Ohio (39057) 7.4.'));
  assert.equal(r.structuredContent.ordered, true); assert.deepEqual(r.structuredContent.table.map((t) => t.fips), [M, G]);
  let n = 0;
  for (const [name, bad] of Object.entries(BAD_PROFILES)) {
    const t = server(), tw = t.w.countyWorker(A.userId), county = ++n % 2 ? G : M;
    const tid = await asked(t, 'county_profile', { county });
    const job = tw.claim();
    try { tw.finish(job.request_id, bad); } catch { continue; }             // an answer of the wrong schema never gets past the database
    const x = await t.call('county_answer', { id: tid });
    assert.equal(x.isError, true, name); assert.equal(x.structuredContent.ok, false, name);
    assert.match(x.content[0].text, /^The answer was not in a shape this connection knows/, name);
    assert.ok(!/Atlantis|D:|Ryagram-cache|would do well|food desert|too few|room for another/.test(x.content[0].text), `${name}: nothing of the bad answer is shown`);
  }
  for (const [name, [ask, bad]] of Object.entries(BAD_COMPARES)) {
    const t = server(), tw = t.w.countyWorker(A.userId);
    const tid = await asked(t, 'compare_counties', { counties: ask.counties, ...(ask.rule ? { rule: ask.rule } : {}), ...(ask.year ? { year: ask.year } : {}) });
    const job = tw.claim();
    try { tw.finish(job.request_id, bad); } catch { continue; }
    const x = await t.call('county_answer', { id: tid });
    assert.equal(x.isError, true, name); assert.match(x.content[0].text, /^The answer was not in a shape this connection knows/, name);
  }
});

// ------------------------------------------------------------------------------------------------ the database layer
test('the database layer sends each county call to its own function with the token\'s hash first, the counties as an array and no owner', async () => {
  const { ConnectDb } = await import('../supabase/functions/connect/db.ts');
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push({ sql, params }); return [{ r: { state: 'asked' } }]; }, 'https://x.example/app/');
  const data = db.data({ tokenHash: 'h'.repeat(64) });
  await data.askCounty({ shape: 'compare', counties: [G, M], kind: 'limited_service', rule: 'count_high_first', year: 2022 });
  await data.getCounty('00000000-0000-4000-8000-0000000000a1');
  assert.match(seen[0].sql, /select public\.connect_county_ask\(\$1::text, \$2::text, \$3::text::text\[\], \$4::text, \$5::text, \$6::int\) as r/);
  assert.deepEqual(seen[0].params, ['h'.repeat(64), 'compare', '{"39057","39113"}', 'limited_service', 'count_high_first', 2022]);   // an array goes as a Postgres array literal, as the place questions' categories do
  assert.match(seen[1].sql, /select public\.connect_county_get\(\$1::text, \$2::uuid\) as r/);
  assert.deepEqual(seen[1].params, ['h'.repeat(64), '00000000-0000-4000-8000-0000000000a1']);
});

test('a database without the migration answers in words: the tools say county questions are not available', async () => {
  const s = server();
  const real = s.w.data.bind(s.w);
  s.w.data = (id) => { const d = real(id); delete d.askCounty; delete d.getCounty; return d; };
  for (const [name, args] of [['county_profile', { county: G }], ['county_answer', { id: ID0 }]]) {
    const r = await s.call(name, args);
    assert.equal(r.isError, true); assert.equal(r.content[0].text, 'County questions are not available yet. Nothing was looked up.');
  }
});

test('the registry and the OpenAPI document know the tools exactly as they know the place tools (unlisted, read-only)', () => {
  const doc = JSON.stringify(openApi('https://x.example/connect'));
  for (const n of ['county_profile', 'compare_counties', 'county_answer']) assert.ok(doc.includes(`/v1/tools/${n}`), n);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
});

test('the stand-in mirrors the database: 5 questions may wait at once, and a worker cannot store an answer that is not of its shape', async () => {
  const s = server();
  for (let i = 0; i < 5; i++) assert.equal((await s.call('compare_counties', { counties: [G, M], rule: 'count_high_first', year: 2000 + i })).isError, false);
  const sixth = await s.call('compare_counties', { counties: [G, M], rule: 'count_high_first', year: 2010 });
  assert.equal(sixth.isError, true); assert.match(sixth.content[0].text, /5 county questions waiting/);
  const w = s.w.countyWorker(A.userId), job = w.claim();
  assert.equal(job.shape, 'compare');
  for (const bad of [profile(), { schema: 'something.else' }, null, [], { ...compare(), pad: 'x'.repeat(70000) }]) assert.throws(() => w.finish(job.request_id, bad), (e) => e.code === '22023');
  assert.throws(() => w.fail(job.request_id, 'because', ''), (e) => e.code === '22023');
  assert.throws(() => w.finish('nope', compare()), (e) => e.code === 'PT404');
  w.finish(job.request_id, compare());
  assert.throws(() => w.finish(job.request_id, compare()), (e) => e.code === 'PT404', 'a request is answered once');
});

// ------------------------------------------------------------------------------------------------ GEO's nine REAL answers (public Census and BLS figures; handed over 11-09 19:15 from geo-li-connect-fields-1109 74af1feb; the files and their hashes are exactly as GEO made them)
import crypto from 'node:crypto';
import fs from 'node:fs';
const REAL = new URL('./fixtures/county-real/', import.meta.url);
const realFiles = fs.readdirSync(REAL).filter((f) => f.endsWith('.json')).sort();
const real = (f) => JSON.parse(fs.readFileSync(new URL(f, REAL), 'utf8'));

test('the nine real answers are exactly the files GEO made (the hashes are pinned, so a change to GEO\'s tool shows up here as a fixture diff, not silently)', () => {
  assert.equal(realFiles.length, 9);
  const sums = Object.fromEntries(fs.readFileSync(new URL('SHA256SUMS.txt', REAL), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { const m = /^([0-9a-f]{64}) \*(.+)$/.exec(l); return [m[2], m[1]]; }));
  assert.deepEqual(Object.keys(sums).sort(), realFiles);
  for (const f of realFiles) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(f, REAL))).digest('hex'), sums[f], f);
  for (const f of realFiles) assert.ok(!/[^\x20-\x7e\r\n]/.test(fs.readFileSync(new URL(f, REAL), 'utf8')), `${f}: plain ASCII`);
});

test('EVERY real answer is shown by the reader (a real shape the reader withholds fails here), with nothing of a place on a computer in what the AI reads', () => {
  for (const f of realFiles) {
    const { ask, answer } = real(f);
    const r = readCountyAnswer(ask, answer);
    assert.ok(r, `${f} is withheld`);
    assert.equal(r.shape, ask.shape, f);
    const text = countyLines(r, wrap).join('\n');
    assert.ok(!PATHISH.test(text), `${f}: a place on a computer in the words`);
    for (const p of r.profiles) { assert.ok(p.series.length >= 5, `${f}: series`); assert.ok(p.series.every((s) => s.label === 'Observed' || s.label === 'Calculated')); }
  }
});

test('the real answers say what they are: the names are ours, an order is only under a rule, the edge cases name what is not held without a folder', () => {
  const g = readCountyAnswer(real('greene_profile.json').ask, real('greene_profile.json').answer);
  assert.deepEqual([g.profiles[0].fips, g.profiles[0].name], [G, 'Greene County, Ohio']);
  const m = readCountyAnswer(real('montgomery_profile.json').ask, real('montgomery_profile.json').answer);
  assert.equal(m.profiles[0].name, 'Montgomery County, Ohio');
  const c = real('compare_per10k_low.json'), cr = readCountyAnswer(c.ask, c.answer);
  assert.equal(cr.ordered, true); assert.equal(cr.rule, 'per_10k_low_first'); assert.equal(cr.table.length, 2); assert.ok(cr.table[0].value <= cr.table[1].value);
  const h = real('compare_count_high_2015.json'), hr = readCountyAnswer(h.ask, h.answer);
  assert.deepEqual(hr.profiles.map((p) => p.fips).sort(), [G, M]); assert.equal(hr.rule_year, 2015); assert.ok(hr.table[0].value >= hr.table[1].value);
  const n = real('compare_norule.json'), nr = readCountyAnswer(n.ask, n.answer);
  assert.equal(nr.ordered, false); assert.deepEqual(nr.profiles.map((p) => p.fips), [G, M], 'the order asked');
  const q = real('edge_no_qcew.json'), qr = readCountyAnswer(q.ask, q.answer);
  assert.ok(qr.profiles[0].not_held.some((x) => /QCEW/.test(x.source)), 'BLS QCEW is named as not held');
  const pm = real('edge_no_permits.json'), pr = readCountyAnswer(pm.ask, pm.answer);
  assert.ok(pr.profiles[0].not_held.some((x) => /Building Permits/.test(x.source)));
  const x = real('edge_no_extract.json'), xr = readCountyAnswer(x.ask, x.answer);
  assert.equal(xr.profiles[0].read_from, 'read from the national files');
  const by = real('edge_bad_cbp_year.json'), br = readCountyAnswer(by.ask, by.answer);
  assert.ok(br.profiles[0].series.some((s) => s.years.some((y) => y.value === null && y.note)), 'a year that could not be read stays a missing year with its reason');
  for (const f of realFiles) { const d = real(f); const r = readCountyAnswer(d.ask, d.answer); for (const p of r.profiles) assert.equal(p.withheld, 0, `${f}: nothing was left out`); }
});

test('a real answer asked about the wrong county or with the wrong rule is NOT shown (the real shapes are checked against the request too)', () => {
  const { ask, answer } = real('greene_profile.json');
  assert.equal(readCountyAnswer({ ...ask, counties: [M] }, answer), null);
  const c = real('compare_per10k_low.json');
  assert.equal(readCountyAnswer({ ...c.ask, rule: 'count_high_first' }, c.answer), null);
  assert.equal(readCountyAnswer({ shape: 'compare', counties: [G, M], rule: null, year: null }, c.answer), null, 'a comparison with an order though no rule was asked');
});

test('a unit may be up to 80 characters (GEO\'s longest real unit is 50), and no longer', () => {
  const long = (n) => 'u'.repeat(n);
  const one = (n) => profile(G, { series: [series('establishments', 'Places', 'Observed', CBP, long(n), yrs([[2023, 5]]))] });
  assert.ok(readCountyAnswer(PROFILE_ASK, one(80)));
  assert.equal(readCountyAnswer(PROFILE_ASK, one(81)), null);
  const row = (n) => compare({ rule_table: [rowOf(M, 'y', 5.1, { unit: long(n) }), rowOf(G, 'x', 7.4)] });
  assert.ok(readCountyAnswer(COMPARE_ASK, row(80)));
  assert.equal(readCountyAnswer(COMPARE_ASK, row(81)), null);
});

test('a count of permits passes (it is a count of what was permitted); a claim that something is permitted, allowed or zoned does not', () => {
  for (const s of ['new housing units permitted', 'Housing units permitted per 1,000 residents', 'housing units (permits, not starts or completions)']) assert.equal(plainWords(s, 100), s, s);
  for (const s of ['permitted to open', 'a restaurant is permitted here', 'new places are permitted', 'allowed to build', 'allowed to open a shop', 'zoning allows it']) assert.equal(plainWords(s, 100), null, s);
});

// ------------------------------------------------------------------------------------------------ the SHARED answer cases (NEXT-CONNECT 203 finding 5)
test('the committed cases.json is exactly what build-cases.mjs makes, in plain ASCII (so WORKER and GEO read the cases this reader is tested with)', () => {
  const raw = fs.readFileSync(new URL('./fixtures/county/cases.json', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(sharedCases())));
  assert.ok(!/[^\x20-\x7e\r\n]/.test(raw), 'the file holds plain ASCII only (a hostile character is written as an escape)');
});

test('the reader shows every good shared case for its own ask and refuses every bad one (the cases the worker answer check and the GEO tool are held to as well)', () => {
  const cs = JSON.parse(fs.readFileSync(new URL('./fixtures/county/cases.json', import.meta.url), 'utf8'));
  assert.ok(cs.length >= 60 && cs.filter((c) => c.ok).length >= 5 && cs.filter((c) => !c.ok).length >= 55, 'the cases are not an empty promise');
  assert.equal(new Set(cs.map((c) => c.name)).size, cs.length, 'every case has its own name');
  for (const c of cs) assert.equal(readCountyAnswer(c.ask, c.answer) !== null, c.ok, c.name);
});
