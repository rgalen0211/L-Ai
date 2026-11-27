// Must-fail proof for tests/connect-perfect-city.test.mjs (CONNECT 2026-11-27): each mutant breaks ONE thing (or, where two layers check the same rule, both layers) in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run ALONE:  node tests/connect_perfect_city_mutants.mjs   (exit 0 only when every mutant is caught; 2 = the baseline failed, nothing proved)
// The scratch copy (.mut-pc/, untracked, never `git add` it) is made once (an existing one is written over, never deleted) and every mutant is written into it and then put back from the repo file: this runner deletes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end (' + (r.error ? r.error.code : 'a test timed out') + ')'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-pc');
const C = 'supabase/functions/connect-core/';
const P = C + 'perfect_city.ts', T = C + 'tools.ts', H = C + 'home_panel.ts', Y = C + 'types.ts', DB = 'supabase/functions/connect/db.ts';
const MIG = 'supabase/migrations/20261127000500_connect_perfect_city_summary.sql';
const SUITE = 'tests/connect-perfect-city.test.mjs';
const GATE = 'const g = await perfectCityGate(ctx);\n      if (!g.on) return g.result;';
const PLACEBIZ = 'const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);';
const mutants = [
  // the gate
  ['the switch is ignored (list tool works with the switch off)', [[P, 'async run(_a, ctx) {\n      ' + GATE, 'async run(_a, ctx) {\n      const g = { on: true } as const;']]],
  ['the switch is ignored (open tool works with the switch off)', [[P, GATE + '\n      ' + PLACEBIZ + '\n      const allowed', 'const g = { on: true } as const;\n      ' + PLACEBIZ + '\n      const allowed']]],
  ['the switch is ignored (summary tool works with the switch off)', [[P, GATE + '\n      ' + PLACEBIZ + '\n      const lat', 'const g = { on: true } as const;\n      ' + PLACEBIZ + '\n      const lat']]],
  ['the switch has the wrong name', [[P, 'export const PERFECT_CITY_SWITCH = "perfectCity";', 'export const PERFECT_CITY_SWITCH = "perfectcity";']]],
  ['an unreadable switch list is treated as on (fails open)', [[P, 'if (switches === null) return { on: false, result: refuse("Whether', 'if (switches === null) return { on: true };\n  if (false) return { on: false, result: refuse("Whether']]],
  ['a failed switch read is swallowed as an empty list', [[P, 'catch { switches = null; }', 'catch { switches = []; }']]],
  ['a working department opens it without the switch', [[P, 'if (switches.includes(PERFECT_CITY_SWITCH)) return { on: true };', 'if (switches.includes(PERFECT_CITY_SWITCH) || ((await ctx.data.departments().catch(() => [])) as { status: string }[]).some((r) => r.status === "working")) return { on: true };']]],
  ['the off words do not say owner-only', [[P, 'It is being tried by the account owner first (an owner-only switch), so it is not open to other accounts yet.', 'It is not open yet.']]],
  ['the off words do not say nothing was looked up', [[P, 'yet. Nothing was looked up.";', 'yet.";']]],
  // the tool definitions
  ['the list tool needs write permission', [[P, 'name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "read"', 'name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "write"']]],
  ['the open tool says it is not read-only', [[P, 'name: "open_perfect_city", title: "Send the person to Perfect City", scope: "read", readOnly: true', 'name: "open_perfect_city", title: "Send the person to Perfect City", scope: "read", readOnly: false']]],
  ['the summary tool needs write permission', [[P, 'name: "perfect_city_summary", title: "The Perfect City numbers for one spot", scope: "read"', 'name: "perfect_city_summary", title: "The Perfect City numbers for one spot", scope: "write"']]],
  ['the summary tool is unlisted', [[P, 'name: "perfect_city_summary", title: "The Perfect City numbers for one spot", scope: "read", readOnly: true, idempotent: true,', 'name: "perfect_city_summary", title: "The Perfect City numbers for one spot", scope: "read", readOnly: true, idempotent: true, listed: false,']]],
  ['the tools are not registered', [[T, 'openRyagramHome, ...makePerfectCityTools(friendlyError)]', 'openRyagramHome]']]],
  // the input of the summary tool
  ['the summary tool accepts any extra field (schema and run)', [[P, 'const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });', 'const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: true });'],
    [P, 'const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type" || k === "lat" || k === "lon");', 'const allowed = true;'],
    [P, 'const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");', 'const allowed = true;']]],
  ['place and kind ids are not pattern-checked (schema)', [[P, 'const ID = "^[a-z][a-z0-9_]{1,30}$";', 'const ID = "^.*$";']]],
  ['latitude and longitude are not range-checked (schema and run)', [[P, 'lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude of the spot, in degrees." },', 'lat: { type: "number", description: "Latitude of the spot, in degrees." },'],
    [P, 'lon: { type: "number", minimum: -180, maximum: 180, description: "Longitude of the spot, in degrees (west is negative)." },', 'lon: { type: "number", description: "Longitude of the spot, in degrees (west is negative)." },'],
    [P, 'lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {', 'lat === null || lon === null) {']]],
  ['a place that is not offered is accepted', [[P, 'if (!allowed || !place || !biz || lat === null', 'if (!allowed || !biz || lat === null']]],
  ['a kind not covered in the place is accepted (summary)', [[P, 'if (!place.business_types.includes(biz.id)) {', 'if (false) {']]],
  ['a kind not covered in the place is accepted (open)', [[P, 'const covered = !place || !biz || place.business_types.includes(biz.id);', 'const covered = true;']]],
  ['the bad-choice refusal does not list the real choices', [[P, 'const choices = () => `Places: ${PC_PLACES.map((p) => `${p.id} (${p.label})`).join("; ")}. Kinds of business: ${PC_BUSINESS_TYPES.map((b) => `${b.id} (${b.label})`).join("; ")}. Supermarkets (grocery) are covered in montgomery_oh only.`;', 'const choices = () => "";']]],
  ['the hourly limit is gone', [[P, 'if (!(await ctx.policy.hit(ctx.principal, "perfect_city", LIMITS.perfectCitySummariesPerHourPerUser, 3600))) {', 'if (false) {']]],
  ['the hourly limit is far too high', [[Y, 'perfectCitySummariesPerHourPerUser: 60,', 'perfectCitySummariesPerHourPerUser: 6000,']]],
  ['the database is asked with a rounded spot', [[P, 'ctx.data.perfectCitySummary({ county: place.id, kind: biz.id, lat, lon })', 'ctx.data.perfectCitySummary({ county: place.id, kind: biz.id, lat: Math.round(lat), lon })']]],
  // the database's refusals
  ['a missing database function is not said plainly', [[P, '        if (code === "unavailable") return unavailable();', '']]],
  ['a database that has no such call at all is not said plainly', [[P, 'if (!ctx.data.perfectCitySummary) return unavailable();', '']]],
  ['the "not available yet" and "switch is off" sentences are not passed on', [[P, '        if (code === "PT503" || code === "42501") return unavailable(friendlyError(e));', '']]],
  ['a refused spot or kind is not said plainly', [[P, '        if (code === "22023") return refuse(friendlyError(e) + " Nothing was looked up.", "args", { data: { ok: false, looked_up: false } });', '']]],
  ['the database sentence is passed on unscrubbed', [[P, 'if (code === "PT503" || code === "42501") return unavailable(friendlyError(e));', 'if (code === "PT503" || code === "42501") return unavailable((e as Error).message);']]],
  ['any other database fault is swallowed into a plain answer', [[P, '        throw e;\n      }\n      const s = readPerfectCitySummary', '        return unavailable();\n      }\n      const s = readPerfectCitySummary']]],
  // what the answer must keep
  ['a nearest distance not labelled calculated is shown', [[P, 'if (!isObj(n) || n.basis !== "calculated") return null;', 'if (!isObj(n)) return null;']]],
  ['a place count not labelled calculated is shown', [[P, 'if (r.places.basis !== BASIS_PLACES || r.people_about.basis !== BASIS_PEOPLE) return null;', 'if (r.people_about.basis !== BASIS_PEOPLE) return null;']]],
  ['a people number not labelled estimated is shown', [[P, 'if (r.places.basis !== BASIS_PLACES || r.people_about.basis !== BASIS_PEOPLE) return null;', 'if (r.places.basis !== BASIS_PLACES) return null;']]],
  ['a people number without its method is shown', [[P, ' || people > 1e10 || method === null) return null;', ' || people > 1e10) return null;']]],
  // GEO's real shape (11-27 compatibility fix)
  ['places loaded without its basis word is shown', [[P, 'if (!isObj(doc.places_loaded) || doc.places_loaded.basis !== BASIS_PLACES) return null;', 'if (!isObj(doc.places_loaded)) return null;']]],
  ['the place count is read from the old key (value)', [[P, 'const places = num(r.places.count), pv = r.people_about.value;', 'const places = num(r.places.value), pv = r.people_about.value;']]],
  ['places loaded is read as a bare number', [[P, 'const loaded = num(doc.places_loaded.count);', 'const loaded = num(doc.places_loaded);'], [P, 'if (!isObj(doc.places_loaded) || doc.places_loaded.basis !== BASIS_PLACES) return null;', '']]],
  ['a ring without a people figure is shown without its reason', [[P, '      if (note === null) return null;\n', '']]],
  ['a nearest rank that is not its place in the list is shown', [[P, 'if (n.rank !== undefined && n.rank !== i + 1) return null;', '']]],
  ['the daily cap (54000) is not said plainly', [[P, 'if (code === "54000") return refuse(', 'if (false) return refuse(']]],
  ['the daily cap words do not tell the AI to stop', [[P, 'Do not ask again today; tell the person to try tomorrow. ', '']]],
  ['the daily cap passes on the database sentence', [[P, 'refuse("Perfect City has answered all it gives this account for today.', 'refuse((e as Error).message + " Perfect City has answered all it gives this account for today.']]],
  ['the chicken kind is gone from the options', [[P, '  { id: "chicken", label: "Chicken places" },      // chicken, burger, pizza: GEO\'s page and database (migration 20261127000900) list them too\n', '']]],
  ['the pizza kind is not offered in Greene County', [[P, 'business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger", "pizza"]) },', 'business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger"]) },']]],
  ['an answer without its not-known sentences is shown', [[P, 'const notKnown = words(doc.not_known, 1)', 'const notKnown = words(doc.not_known, 0)']]],
  ['an answer without its credits is shown', [[P, 'credits = words(doc.credits, 1);', 'credits = words(doc.credits, 0);']]],
  ['nearest places out of order are shown', [[P, 'if (km === null || km < prev || km > 1000) return null;', 'if (km === null || km > 1000) return null;']]],
  ['more than five nearest places are shown', [[P, 'doc.nearest.length > 5 || ', '']]],
  ['a ring of another size is shown', [[P, 'if (!isObj(r) || r.km !== PC_RINGS_KM[i] || ', 'if (!isObj(r) || ']]],
  ['a different number of rings is shown', [[P, ' || doc.rings.length !== PC_RINGS_KM.length) return null;', ') return null;']]],
  ['a fractional place count is shown', [[P, 'places === null || !Number.isInteger(places) || ', 'places === null || ']]],
  ['a negative people number is shown', [[P, 'if (people === null || people < 0 || ', 'if (people === null || ']]],
  ['any schema name is accepted', [[P, 'doc.schema !== PERFECT_CITY_SUMMARY_SCHEMA || ', '']]],
  ['an answer for another place is accepted', [[P, ' || doc.place !== place || ', ' || ']]],
  ['an answer for another kind is accepted', [[P, ' || doc.business_type !== kind) return null;', ') return null;']]],
  ['a spot out of range is accepted', [[P, 'lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;', 'lat < -90) return null;']]],
  ['a nearest place with no places loaded is accepted', [[P, 'if (loaded === 0 && (nearest.length > 0 || rings.some((r) => r.places > 0))) return null;', '']]],
  // how it is said
  ['business names are shown unfenced', [[P, 'untrusted("place-name", n.name)', 'n.name']]],
  ['business names are not cut at 80 characters', [[P, 'const cut = v.trim().slice(0, 80);', 'const cut = v.trim();']]],
  ['a name that cannot be shown is shown anyway', [[P, 'return textOk(cut, 80) ? cut : "(name not shown)";', 'return cut;']]],
  ['the distances are rounded here', [[P, '${n.km} km`', '${Math.round(n.km)} km`']]],
  ['the people numbers are rounded here', [[P, 'about ${r.people} people (estimated)', 'about ${Math.round(r.people ?? 0)} people (estimated)']]],
  ['the place counts lose their basis word', [[P, '${r.places} similar places (calculated)', '${r.places} similar places']]],
  ['the people numbers lose their basis word', [[P, 'about ${r.people} people (estimated)', 'about ${r.people} people']]],
  ['the method sentence is not shown', [[P, 'for (const m of [...new Set(s.rings.map((r) => r.method).filter((m): m is string => m !== null))]) out.push(`How the people are estimated: ${untrusted("report-sentence", m)}`);', '']]],
  ['a ring with no people figure is not said plainly', [[P, 'people not given for this ring (', 'people (']]],
  ['a name the database sends is shown as a rank only text with no fence when absent is invented', [[P, 'if (v === undefined || v === null) return null;', 'if (v === undefined || v === null) return "Some Place";']]],
  ['the not-known sentences are not shown', [[P, 'out.push("What this does not know:", ...s.notKnown.map((n) => `  - ${untrusted("report-sentence", n)}`));', '']]],
  ['the credits are not shown', [[P, 'out.push("Where the data comes from:", ...s.credits.map((c) => `  - ${untrusted("report-sentence", c)}`));', '']]],
  ['no-places-loaded is not said plainly', [[P, 'The businesses for this place and kind are not loaded yet, so there is no distance and no count of businesses. The people numbers below do not depend on them.', 'No places.']]],
  ['no-places-loaded still shows distances and counts', [[P, 'if (s.placesLoaded === 0) {\n        out.push("The businesses', 'if (false) {\n        out.push("The businesses']]],
  ['a score is added to the words', [[P, 'Counts and distances only: no score, no ranking, no view on whether a business would do well.', 'A score of 7 out of 10: the best spot.']]],
  ['the answer says a score was given', [[P, 'score_given: false', 'score_given: true']]],
  ['the answer says a ranking was given', [[P, 'ranking_given: false', 'ranking_given: true']]],
  ['the answer does not tell the AI to give the words with each number', [[P, 'Tell the person each number with its word (calculated or estimated), the method, and what is not known. Do not add a score, a ranking or advice about where to open.', '']]],
  // the options and the page tool
  ['the income layer is labelled observed instead of estimated', [[P, 'id: "median_household_income", label: "Median household income in each small area", basis: "estimated"', 'id: "median_household_income", label: "Median household income in each small area", basis: "observed"']]],
  ['the density layer is labelled observed instead of calculated', [[P, 'id: "population_density", label: "People per square kilometre in each small area", basis: "calculated"', 'id: "population_density", label: "People per square kilometre in each small area", basis: "observed"']]],
  ['the people-in-rings measure is labelled calculated instead of estimated', [[P, 'id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "estimated"', 'id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "calculated"']]],
  ['a not-known sentence is gone', [[P, '  "There is no success score and no prediction. This shows what is there, not whether a business would do well.",\n', '']]],
  ['the straight-line sentence is gone', [[P, '  "Distances are straight lines, not drive or walk times.",\n', '']]],
  ['the kind ids are the old invented ones', [[P, '{ id: "restaurant", label: "Restaurants" },', '{ id: "food_places", label: "Restaurants" },']]],
  ['supermarkets are offered in Greene County', [[P, 'business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger", "pizza"]) },', 'business_types: Object.freeze(["fast_food", "restaurant", "chicken", "burger", "pizza", "grocery"]) },']]],
  ['a place is added that GEO did not announce', [[P, '  { id: "greene_oh", label: "Greene County, Ohio (Beavercreek, Xenia)",', '  { id: "paris_fr", label: "Paris", note: "x", business_types: Object.freeze(["fast_food"]) },\n  { id: "greene_oh", label: "Greene County, Ohio (Beavercreek, Xenia)",']]],
  ['an invented number about a place is added', [[P, '{ id: "montgomery_oh", label: "Montgomery County, Ohio (Dayton)", note: "The whole county, which includes Dayton.",', '{ id: "montgomery_oh", label: "Montgomery County, Ohio (Dayton)", people: 537309, note: "The whole county, which includes Dayton.",']]],
  ['the options say they show numbers here', [[P, 'numbers_tool: "perfect_city_summary",\n    shows_numbers_here: false,', 'numbers_tool: "perfect_city_summary",\n    shows_numbers_here: true,']]],
  ['the open answer says it chose for the person', [[P, 'chosen_for_the_person: false', 'chosen_for_the_person: true']]],
  ['a verdict word is added to the words', [[P, 'Straight line only, not a drive or a walk. The nearest five, within 5 km.', 'Straight line only, not a drive or a walk. This shows the best spot.']]],
  ['the page address is wrong', [[P, 'export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";', 'export const PERFECT_CITY_PAGE = "#/d/perfect_city";']]],
  ['the page address is a full link', [[P, 'export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";', 'export const PERFECT_CITY_PAGE = "https://example.test/#/d/geo_intelligence";']]],
  ['the open tool writes a place question', [[P, PLACEBIZ + '\n      const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");', PLACEBIZ + '\n      await ctx.data.askGeoShape({ shape: "where_to_go", category: "chicken" });\n      const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");']]],
  // the database layer and the migration
  ['the real call is named differently', [[DB, 'self.fn("connect_perfect_city_summary", ["text", "text", "text", "float8", "float8"], [h, q.county, q.kind, q.lat, q.lon])', 'self.fn("connect_perfect_city_summery", ["text", "text", "text", "float8", "float8"], [h, q.county, q.kind, q.lat, q.lon])']]],
  ['the real call passes the latitude as text', [[DB, '["text", "text", "text", "float8", "float8"], [h, q.county, q.kind, q.lat, q.lon])', '["text", "text", "text", "text", "float8"], [h, q.county, q.kind, q.lat, q.lon])']]],
  ['a missing function is not turned into "unavailable"', [[DB, 'if (code === "42883" || code === "PGRST202") throw Object.assign(new Error("Perfect City numbers are not available just now."), { code: "unavailable" });', '']]],
  ['the twin reads the token with the wrong scope', [[MIG, "ryagram_private.connect_actor(p_token_hash, 'read')", "ryagram_private.connect_actor(p_token_hash, 'write')"]]],
  ['the twin can be run by signed-in people', [[MIG, 'to connect_runner;', 'to connect_runner, authenticated;']]],
  ['the twin forgets to revoke the public', [[MIG, 'from public, anon, authenticated, service_role;', 'from anon;']]],
  ['the twin does not end with the gate', [[MIG, 'select ryagram_private.gate_apply();', 'select 1;']]],
  ['the twin writes a row', [[MIG, '  answer jsonb;\nbegin', '  answer jsonb;\nbegin\n  insert into public.account_settings (owner_id) values (me) on conflict do nothing;']]],
  ['the twin looks for another helper', [[MIG, "to_regprocedure('ryagram_private.perfect_city_summary_for(uuid, text, text, double precision, double precision)') is null", "to_regprocedure('ryagram_private.perfect_city_summary_of(uuid, text, text, double precision, double precision)') is null"]]],
  ['the twin does not say the helper is missing', [[MIG, "raise exception 'Perfect City is not available yet.' using errcode = 'PT503';", "return null;"]]],
  // the panel's own word
  ['the home panel still says Opportunity Map', [[H, 'geo_intelligence: { label: "Perfect City"', 'geo_intelligence: { label: "Opportunity Map"']]],
];

const sources = [...new Set(mutants.flatMap(([, edits]) => edits.map((e) => e[0])))];
function seed() {
  for (const d of ['supabase/migrations', 'supabase/rollbacks', 'supabase/live-steps', 'supabase/tests', 'assets', 'tests']) fs.mkdirSync(path.join(scratch, d), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  for (const f of [MIG, 'supabase/rollbacks/20261127000500_connect_perfect_city_summary_rollback.sql', 'supabase/live-steps/66b_connect_perfect_city_summary_check.sql', 'supabase/tests/test_connect_perfect_city_summary.py', 'assets/app-departments.js', SUITE]) {
    fs.copyFileSync(path.join(root, f), path.join(scratch, f));
  }
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
const restore = () => { for (const f of sources) fs.copyFileSync(path.join(root, f), path.join(scratch, f)); };
const run = () => noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', SUITE], { encoding: 'utf8', cwd: scratch, timeout: 300000, killSignal: 'SIGKILL' }));

seed();
if (run().status) { console.log('BASELINE FAILS (nothing proved)'); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, edits] of mutants) {
  restore();
  let broken = false;
  for (const [file, from, to] of edits) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const have = src.split(from).length - 1;
    if (have !== 1) { console.log(`BROKEN MUTANT (${have} copies of the text, expected 1): ${name}`); missed++; broken = true; break; }
    fs.writeFileSync(target, src.replace(from, () => to));
  }
  if (broken) continue;
  const caught = run().status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
restore();
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
