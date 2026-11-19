// The shared county-answer cases (CONNECT, 2026-11-10; NEXT-CONNECT 203 finding 5). ALL INVENTED. cases.json is built from this file (node tests/fixtures/county/build-cases.mjs --write) and a test fails if the two differ,
// so the cases WORKER's check_answer and GEO's tool can read are exactly the ones the connector's reader (county.ts readCountyAnswer) is tested with. Each case: { name, ok, why, ask, answer }.
// ok = the answer must be shown for that ask; otherwise it must be refused. The same builders feed tests/connect-county.test.mjs, so there is one copy of every answer.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPARE_SCHEMA, PROFILE_SCHEMA, SAY_COMPARE, SAY_LINES } from '../../../supabase/functions/connect-core/county.ts';

export const G = '39057', M = '39113';

export const series = (measure, title, label, source, unit, years, extra = {}) => ({ measure, title, label, source, unit, breaks: [], note: '', years, ...extra });
export const yrs = (pairs) => pairs.map(([year, value, note]) => ({ year, value, note: note ?? '' }));
export const CBP = 'U.S. Census Bureau, County Business Patterns, bulk county files (public domain)';
export const SERIES = (places = 123, per10k = 7.4) => [
  series('establishments', 'Limited-service restaurants (places)', 'Observed', CBP, 'places', yrs([[2021, 110], [2022, 118], [2023, places]]), { breaks: [2012], note: 'Counts of places, not of sales.' }),
  series('per_10k', 'Places per 10,000 residents', 'Calculated', CBP + ' and U.S. Census Bureau population estimates', 'places per 10,000 residents', yrs([[2021, 7.0], [2022, 7.2], [2023, per10k]]), { note: 'Arithmetic on the published count and the published population.' }),
  series('payroll', 'Annual payroll', 'Observed', CBP, 'thousand dollars', yrs([[2021, 5000], [2022, null, 'not published for this county in 2022'], [2023, 5600]]), { note: 'Payroll, not sales.' }),
];
export const NOT_HELD_ITEMS = [{ source: 'BLS QCEW', why: 'no county file is held for county 39057' }];
export const KIND_TITLES = { limited_service: 'limited-service restaurants', grocery: 'supermarkets and other grocery stores', pharmacy: 'pharmacies and drug stores', eating_places: 'restaurants and other eating places' };
// one county's figures inside a SLIM comparison (schema /1): only the series the rules order by, what is not held, and a pointer to the full profile
export const figures = (fips = G, over = {}) => {
  const { kind = 'limited_service', series: given, ...rest } = over;
  return { county: fips, name: fips === G ? 'Greene County, Ohio' : 'Montgomery County, Ohio', read_how: 'per_county_extract',
    series: (given ?? SERIES()).filter((x) => x.measure === 'establishments' || x.measure === 'per_10k'), not_held_items: NOT_HELD_ITEMS,
    full_profile: { tool: 'county_profile', county: fips, kind, words: 'every other figure for this county (employees, payroll, QCEW, permits, population) is in its full county profile' }, ...rest };
};
export const profile = (fips = G, over = {}) => ({ schema: PROFILE_SCHEMA, county: fips, kind: 'limited_service', kind_title: 'limited-service restaurants', series: SERIES(), not_held: ['BLS QCEW: no county file is held for county ' + fips],
  say: [...SAY_LINES], labels: { Observed: 'as published by the source' }, forecast: 'none: this tool gives held figures only', read_from: 'read from the per-county extract made 2026-11-09',
  county_name: 'Atlantis County', read_how: 'per_county_extract', not_held_items: NOT_HELD_ITEMS, ...over });
export const rowOf = (fips, name, value, over = {}) => ({ county: fips, name, year: 2023, value, label: 'Calculated', source: CBP, unit: 'places per 10,000 residents', note: '', ...over });
// Greene 7.4, Montgomery 5.1 (per 10,000): lowest first = Montgomery then Greene
export const compare = (over = {}) => ({ schema: COMPARE_SCHEMA, kind: 'limited_service', kind_title: 'limited-service restaurants',
  counties: [{ county: M, name: 'Montgomery County, Ohio' }, { county: G, name: 'Greene County, Ohio' }],
  rule: { id: 'per_10k_low_first', words: 'places per 10,000 residents, lowest first', measure: 'per_10k', year: 2023 }, ordered: true,
  order_words: 'ordered by places per 10,000 residents, lowest first, in 2023, as you asked; equal values keep the order you gave',
  rule_table: [rowOf(M, 'Montgomery County, Ohio', 5.1), rowOf(G, 'Greene County, Ohio', 7.4)],
  county_figures: [figures(M, { series: SERIES(90, 5.1) }), figures(G)], say: [...SAY_LINES, SAY_COMPARE], forecast: 'none: this tool gives held figures only', ...over });
export const PROFILE_ASK = { shape: 'profile', counties: [G], kind: 'limited_service', rule: null, year: null };
export const COMPARE_ASK = { shape: 'compare', counties: [G, M], kind: 'limited_service', rule: 'per_10k_low_first', year: 2023 };
export const mutate = (f) => { const p = profile(); f(p); return p; };
export const BAD_PROFILES = {
  'a series with no label': mutate((p) => { delete p.series[0].label; }),
  'an Estimated series': mutate((p) => { p.series[0].label = 'Estimated'; }),
  'a series with no source': mutate((p) => { p.series[0].source = ''; }),
  'a missing year with no reason': mutate((p) => { p.series[2].years[1].note = ''; }),
  'a negative value': mutate((p) => { p.series[0].years[0].value = -1; }),
  'a value that is not a number': mutate((p) => { p.series[0].years[0].value = '12'; }),
  'a year that is not a year': mutate((p) => { p.series[0].years[0].year = 'x'; }),
  'two sources added into one series': mutate((p) => { p.series[0].source = 'BLS QCEW plus County Business Patterns'; }),
  'a drive path in a source': mutate((p) => { p.series[0].source = 'D:\\Ryagram-cache\\cbp\\cbp23co.zip'; }),
  'a drive path in a series note': mutate((p) => { p.series[0].note = 'from C:/Users/x/file.csv'; }),
  'a drive path in a year note': mutate((p) => { p.series[2].years[1].note = 'file D:\\Ryagram-cache\\x is missing'; }),
  'a web address in a note': mutate((p) => { p.series[0].note = 'see https://example.org/x'; }),
  'a hidden character': mutate((p) => { p.series[0].note = 'a' + String.fromCharCode(0x202e) + 'b'; }),
  'a banned claim: would do well': mutate((p) => { p.series[0].note = 'a restaurant here would do well'; }),
  'a banned claim: food desert': mutate((p) => { p.series[0].note = 'this looks like a food desert'; }),
  'a banned claim: too few': mutate((p) => { p.series[0].note = 'there are too few of them'; }),
  'a banned claim: room for another': mutate((p) => { p.series[0].note = 'room for another one'; }),
  'sales rising': mutate((p) => { p.series[0].note = 'sales are rising'; }),
  'a forecast': mutate((p) => { p.forecast = 'a forecast for 2030: 150'; }),
  'no forecast field': mutate((p) => { delete p.forecast; }),
  'a county that was not asked about': profile(M),
  'a county that is not on the list': profile('39049'),
  'another schema': profile(G, { schema: COMPARE_SCHEMA }),
  'the old flat schema': profile(G, { schema: 'ryagram.county-profile/0' }),
  'another kind': profile(G, { kind: 'grocery' }),
  'too many series': profile(G, { series: Array.from({ length: 21 }, () => SERIES()[0]) }),
  'a measure that is not plain': mutate((p) => { p.series[0].measure = '<b>x</b>'; }),
  'a break that is not a year': mutate((p) => { p.series[0].breaks = ['soon']; }),
  'not_held that is not a list': profile(G, { not_held: 'none', not_held_items: undefined }),
};
export const cmp = (over) => [COMPARE_ASK, compare(over)];
export const BAD_COMPARES = {
  'an order with no rule stated': [{ shape: 'compare', counties: [G, M], kind: 'limited_service', rule: null, year: null }, compare()],
  'a rule that is not the one asked': cmp({ rule: { id: 'count_high_first', words: 'x', measure: 'establishments', year: 2023 } }),
  'a year that is not the one asked': cmp({ rule: { id: 'per_10k_low_first', words: 'x', measure: 'per_10k', year: 2020 } }),
  'no rule in the answer though one was asked': cmp({ rule: null }),
  'an order that does not follow the rule': cmp({ counties: [{ county: G }, { county: M }], rule_table: [rowOf(G, 'x', 7.4), rowOf(M, 'y', 5.1)], county_figures: [figures(G), figures(M, { series: SERIES(90, 5.1) })] }),
  'the opposite rule order': cmp({ rule: { id: 'per_10k_high_first', words: 'x', measure: 'per_10k', year: 2023 } }),
  'a table that does not match the profiles': cmp({ rule_table: [rowOf(M, 'y', 4.0), rowOf(G, 'x', 7.4)] }),
  'an order with a county left out of the table': cmp({ rule_table: [rowOf(M, 'y', 5.1)] }),
  'an order made with a missing figure': cmp({ rule_table: [rowOf(M, 'y', null, { note: 'not held' }), rowOf(G, 'x', 7.4)] }),
  'a table in another year than the rule': cmp({ rule_table: [rowOf(M, 'y', 5.1, { year: 2022 }), rowOf(G, 'x', 7.4)] }),
  'equal values out of the order asked': cmp({ rule_table: [rowOf(M, 'y', 5.1), rowOf(G, 'x', 5.1)], county_figures: [figures(M, { series: SERIES(90, 5.1) }), figures(G, { series: SERIES(123, 5.1) })] }),
  'the counties in a different order with no order made': cmp({ ordered: false, rule_table: [] }),
  'a county left out': cmp({ counties: [{ county: G }], county_figures: [figures(G)] }),
  'a county added': cmp({ counties: [{ county: G }, { county: M }, { county: '39049' }], county_figures: [figures(G), figures(M), figures('39049')] }),
  'a county listed twice': cmp({ counties: [{ county: G }, { county: G }], county_figures: [figures(G), figures(G)] }),
  'a profile for another county than the one shown': cmp({ county_figures: [figures(G), figures(G)] }),
  'order words with a path': cmp({ order_words: 'read from D:\\x' }),
  'order words with a banned claim': cmp({ order_words: 'Montgomery is the best location' }),
  'a profile answer to a comparison': [COMPARE_ASK, profile()],
  'a bad series inside a profile': cmp({ county_figures: [figures(M, { series: [series('establishments', 't', 'Estimated', CBP, 'u', yrs([[2023, 1]]))] }), figures(G)] }),
  'a forecast in a comparison': cmp({ forecast: 'a forecast' }),
  'a rule table for another year than the one asked (all else consistent)': [COMPARE_ASK, compare({ rule: { id: 'per_10k_low_first', words: 'x', measure: 'per_10k', year: 2020 }, rule_table: [rowOf(M, 'y', 4.0, { year: 2020 }), rowOf(G, 'x', 6.0, { year: 2020 })],
    county_figures: [figures(M, { series: SERIES(90, 5.1).map((s, i) => (i === 1 ? { ...s, years: [{ year: 2020, value: 4.0, note: '' }, ...s.years] } : s)) }), figures(G, { series: SERIES().map((s, i) => (i === 1 ? { ...s, years: [{ year: 2020, value: 6.0, note: '' }, ...s.years] } : s)) })] })],
  'no rule in the answer though one was asked, and no order made': cmp({ rule: null, ordered: false, rule_table: [], counties: [{ county: G }, { county: M }], county_figures: [figures(G), figures(M)] }),
  'an order though no rule was asked or given': [{ shape: 'compare', counties: [G, M], kind: 'limited_service', rule: null, year: null }, compare({ rule: null, ordered: true, counties: [{ county: G }, { county: M }], rule_table: [rowOf(G, 'x', 7.4), rowOf(M, 'y', 5.1)], county_figures: [figures(G), figures(M)] })],
  'a table figure that is missing with no reason': cmp({ ordered: false, counties: [{ county: G }, { county: M }], county_figures: [figures(G), figures(M)], rule_table: [rowOf(G, 'x', 7.4), rowOf(M, 'y', null, { note: '' })] }),
  'one county listed twice with a consistent-looking table': cmp({ counties: [{ county: G }, { county: G }], county_figures: [figures(G), figures(G)], rule_table: [rowOf(G, 'x', 7.4), rowOf(G, 'x', 7.4)] }),
  'a table row with no label': cmp({ rule_table: [{ ...rowOf(M, 'y', 5.1), label: undefined }, rowOf(G, 'x', 7.4)] }),
};

const ask = (shape, counties, rule = null, year = null, kind = 'limited_service') => ({ shape, counties, kind, rule, year });
const GOOD = [
  ['a good profile', 'every series labelled, sourced and dated, a missing year with its reason, nothing predicted', PROFILE_ASK, profile()],
  ['a profile with several things not held', 'what is not held is listed as {source, why}', PROFILE_ASK, profile(G, { not_held_items: [{ source: 'BLS QCEW', why: 'no county file is held' }, { source: 'County permits', why: 'not held' }] })],
  ['a good ordered comparison, lowest first', 'an order only under the stated rule, and the table follows it', COMPARE_ASK, compare()],
  ['a good ordered comparison, highest first', 'the same counties under the other direction of the same rule',
    ask('compare', [G, M], 'per_10k_high_first', 2023),
    compare({ rule: { id: 'per_10k_high_first', words: 'places per 10,000 residents, highest first', measure: 'per_10k', year: 2023 }, counties: [{ county: G, name: 'Greene County, Ohio' }, { county: M, name: 'Montgomery County, Ohio' }],
      rule_table: [rowOf(G, 'Greene County, Ohio', 7.4), rowOf(M, 'Montgomery County, Ohio', 5.1)], county_figures: [figures(G), figures(M, { series: SERIES(90, 5.1) })],
      order_words: 'ordered by places per 10,000 residents, highest first, in 2023, as you asked; equal values keep the order you gave' })],
  ['a comparison with no rule: the counties stay in the order asked', 'no rule, no order made, no table', ask('compare', [G, M]),
    compare({ rule: null, ordered: false, rule_table: [], counties: [{ county: G, name: 'Greene County, Ohio' }, { county: M, name: 'Montgomery County, Ohio' }], county_figures: [figures(G), figures(M, { series: SERIES(90, 5.1) })], order_words: null })],
];
const kindProfile = (kind) => profile(G, { kind, kind_title: KIND_TITLES[kind] });
const kindCompare = (kind, rule, extra = {}) => compare({ kind, kind_title: KIND_TITLES[kind], county_figures: [figures(M, { kind, series: SERIES(90, 5.1) }), figures(G, { kind })],
  ...(rule ? {} : { rule: null, ordered: false, rule_table: [], order_words: null, counties: [{ county: G, name: 'Greene County, Ohio' }, { county: M, name: 'Montgomery County, Ohio' }], county_figures: [figures(G, { kind }), figures(M, { kind, series: SERIES(90, 5.1) })] }), ...extra });
GOOD.push(
  ['a good grocery profile', 'the kind is the one asked: supermarkets and other grocery stores', ask('profile', [G], null, null, 'grocery'), kindProfile('grocery')],
  ['a good pharmacy profile', 'the kind is the one asked: pharmacies and drug stores', ask('profile', [G], null, null, 'pharmacy'), kindProfile('pharmacy')],
  ['a good eating places profile', 'the kind is the one asked: restaurants and other eating places', ask('profile', [G], null, null, 'eating_places'), kindProfile('eating_places')],
  ['a good grocery comparison, ordered', 'a slim comparison of the kind asked, ordered by the stated rule', ask('compare', [G, M], 'per_10k_low_first', 2023, 'grocery'), kindCompare('grocery', true)],
  ['a good pharmacy comparison, no rule', 'a slim comparison with no rule keeps the counties in the order asked', ask('compare', [G, M], null, null, 'pharmacy'), kindCompare('pharmacy', false)],
  ['a good eating places comparison, ordered', 'a slim comparison of the kind asked, ordered by the stated rule', ask('compare', [G, M], 'per_10k_low_first', 2023, 'eating_places'), kindCompare('eating_places', true)],
);
const BAD_KIND_CASES = [
  ['a restaurants answer for a grocery ask (profile)', 'the answer must be of the kind asked', ask('profile', [G], null, null, 'grocery'), profile()],
  ['a grocery answer for a restaurants ask (profile)', 'the answer must be of the kind asked', PROFILE_ASK, kindProfile('grocery')],
  ['a pharmacy comparison for a grocery ask', 'the answer must be of the kind asked', ask('compare', [G, M], 'per_10k_low_first', 2023, 'grocery'), kindCompare('pharmacy', true)],
  ['a comparison whose own kind is another one than the kind asked (its pointers say the kind asked)', 'the answer must be of the kind asked, at the top as well', ask('compare', [G, M], 'per_10k_low_first', 2023, 'grocery'), kindCompare('grocery', true, { kind: 'pharmacy', kind_title: KIND_TITLES.pharmacy })],
  ['an ask of a kind that is not one of the four', 'the kinds are a closed list', ask('profile', [G], null, null, 'food_drink'), profile(G, { kind: 'food_drink' })],
  ['the old comparison shape: whole profiles, schema 0', 'a comparison is the slim shape, schema 1, with county_figures', COMPARE_ASK, { ...compare(), schema: 'ryagram.geo-compare-counties/0', county_figures: undefined, profiles: [profile(M), profile(G)] }],
  ['profiles in place of county_figures', 'a comparison carries county_figures', COMPARE_ASK, { ...compare(), county_figures: undefined, profiles: [profile(M), profile(G)] }],
  ['county figures with a pointer to another county', 'the pointer names the county it sits in', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1), full_profile: { tool: 'county_profile', county: G, kind: 'limited_service', words: 'the full profile' } }), figures(G)] })],
  ['county figures with a pointer to another kind', 'the pointer names the kind asked', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1), full_profile: { tool: 'county_profile', county: M, kind: 'grocery', words: 'the full profile' } }), figures(G)] })],
  ['county figures with a pointer to another tool', 'the pointer names county_profile and nothing else', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1), full_profile: { tool: 'compare_counties', county: M, kind: 'limited_service', words: 'the full profile' } }), figures(G)] })],
  ['county figures with no pointer', 'the pointer is required', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1), full_profile: undefined }), figures(G)] })],
  ['county figures whose pointer words hold a path', 'no path on a computer anywhere', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1), full_profile: { tool: 'county_profile', county: M, kind: 'limited_service', words: 'see D:' + String.fromCharCode(92) + 'Ryagram-cache' + String.fromCharCode(92) + 'x' } }), figures(G)] })],
  ['county figures for one county of two asked', 'one entry per county asked', COMPARE_ASK, compare({ county_figures: [figures(M, { series: SERIES(90, 5.1) })] })],
  ['county figures in another order than the counties shown', 'the figures follow the counties shown, in order', COMPARE_ASK, compare({ county_figures: [figures(G), figures(M, { series: SERIES(90, 5.1) })] })],
  ['county figures with an unlabelled series', 'every series is labelled, sourced and dated, in a comparison too', COMPARE_ASK, compare({ county_figures: [figures(M, { series: [{ ...SERIES(90, 5.1)[0], label: undefined }, SERIES(90, 5.1)[1]] }), figures(G)] })],
];
const BAD_PROFILE_CASES = Object.entries(BAD_PROFILES).map(([name, a]) => [name, 'a profile answer the connector must not show', PROFILE_ASK, a]);
const BAD_COMPARE_CASES = Object.entries(BAD_COMPARES).map(([name, [k, a]]) => [name, 'a comparison answer the connector must not show', k, a]);
const BAD_SHAPES = [
  ['an answer that is null', 'not an object', PROFILE_ASK, null],
  ['an answer that is a list', 'not an object', PROFILE_ASK, []],
  ['an answer that is text', 'not an object', PROFILE_ASK, 'x'],
];

export function cases() {
  const out = (ok) => ([name, why, k, a]) => ({ name, ok, why, ask: k, answer: a });
  return [...GOOD.map(out(true)), ...BAD_PROFILE_CASES.map(out(false)), ...BAD_COMPARE_CASES.map(out(false)), ...BAD_KIND_CASES.map(out(false)), ...BAD_SHAPES.map(out(false))];
}

if (process.argv[2] === '--write') {
  const dest = fileURLToPath(new URL('./cases.json', import.meta.url));
  const BS = String.fromCharCode(92);
  // every character that is not plain printable ASCII is written as a backslash-u escape, so the file holds no invisible or direction character (tests/source-hygiene.test.cjs)
  const text = JSON.stringify(cases(), null, 1).replace(/[^\x20-\x7e\n]/g, (c) => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(dest, text + '\n');
  console.log('wrote', dest);
}
