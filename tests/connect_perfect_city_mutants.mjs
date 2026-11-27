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
const P = C + 'perfect_city.ts', T = C + 'tools.ts', H = C + 'home_panel.ts', DB = 'supabase/functions/connect/db.ts';
const SUITE = 'tests/connect-perfect-city.test.mjs';
const mutants = [
  // the gate
  ['the switch is ignored (list tool works with the switch off)', [[P, 'async run(_a, ctx) {\n    const g = await perfectCityGate(ctx);\n    if (!g.on) return g.result;', 'async run(_a, ctx) {\n    const g = { on: true } as const;']]],
  ['the switch is ignored (open tool works with the switch off)', [[P, 'async run(a, ctx) {\n    const g = await perfectCityGate(ctx);\n    if (!g.on) return g.result;', 'async run(a, ctx) {\n    const g = { on: true } as const;']]],
  ['the switch has the wrong name', [[P, 'export const PERFECT_CITY_SWITCH = "perfectCity";', 'export const PERFECT_CITY_SWITCH = "perfectcity";']]],
  ['an unreadable switch list is treated as on (fails open)', [[P, 'if (switches === null) return { on: false, result: refuse("Whether', 'if (switches === null) return { on: true };\n  if (false) return { on: false, result: refuse("Whether']]],
  ['a failed switch read is swallowed as an empty list', [[P, 'catch { switches = null; }', 'catch { switches = []; }']]],
  ['any department working opens it', [[P, 'r.id === PERFECT_CITY_DEPARTMENT && r.status === "working"', 'r.status === "working"']]],
  ['a soon department opens it', [[P, 'r.id === PERFECT_CITY_DEPARTMENT && r.status === "working"', 'r.id === PERFECT_CITY_DEPARTMENT']]],
  ['the public flip is not honoured', [[P, 'rows.some((r) => r && r.id === PERFECT_CITY_DEPARTMENT && r.status === "working")', 'false']]],
  ['the off words do not say owner-only', [[P, 'It is being tried by the account owner first (an owner-only switch), so it is not open to other accounts yet.', 'It is not open yet.']]],
  ['the off words do not say nothing was looked up', [[P, 'yet. Nothing was looked up.";', 'yet.";']]],
  ['the switch is checked after the input (an off account learns the options)', [[P, 'const g = await perfectCityGate(ctx);\n    if (!g.on) return g.result;\n    const place = pick', 'const place = pick']]],
  // the tool definitions
  ['the list tool needs write permission', [[P, 'name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "read"', 'name: "list_perfect_city_options", title: "What Perfect City can look at today", scope: "write"']]],
  ['the open tool says it is not read-only', [[P, 'name: "open_perfect_city", title: "Send the person to Perfect City", scope: "read", readOnly: true', 'name: "open_perfect_city", title: "Send the person to Perfect City", scope: "read", readOnly: false']]],
  ['the tools are unlisted', [[P, 'scope: "read", readOnly: true, idempotent: true,\n  description: "Perfect City is Ryagram', 'scope: "read", readOnly: true, idempotent: true, listed: false,\n  description: "Perfect City is Ryagram']]],
  ['the tools are not registered', [[T, 'openRyagramHome, ...perfectCityTools]', 'openRyagramHome]']]],
  ['the open tool accepts any extra field (schema and run)', [[P, 'description: "Optional: a kind-of-business id from list_perfect_city_options." },\n  }),', 'description: "Optional: a kind-of-business id from list_perfect_city_options." },\n  }, [], true),'], [P, 'const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });', 'const obj = (properties: Record<string, unknown> = {}, required: string[] = [], extra = false) => ({ type: "object", properties, required, additionalProperties: extra });'], [P, 'const allowed = Object.keys(a).every((k) => k === "place" || k === "business_type");', 'const allowed = true;']]],
  ['place and kind-of-business ids are not pattern-checked (schema)', [[P, 'const ID = "^[a-z][a-z0-9_]{1,30}$";', 'const ID = "^.*$";']]],
  ['a place that is not offered is accepted', [[P, 'typeof v === "string" ? (list.find((x) => x.id === v) ?? null) : null', 'typeof v === "string" ? (list.find((x) => x.id === v) ?? undefined) : null']]],
  ['a kind of business that is not offered is accepted', [[P, 'if (!allowed || place === null || biz === null) {', 'if (!allowed || place === null) {']]],
  ['the refusal for a bad choice does not list the real choices', [[P, 'Places: ${PC_PLACES.map((p) => `${p.id} (${p.label})`).join("; ")}. Kinds of business: ${PC_BUSINESS_TYPES.map((b) => `${b.id} (${b.label})`).join("; ")}. Nothing was opened or looked up.', 'Nothing was opened or looked up.']]],
  // the words and what they promise
  ['the income layer is labelled observed instead of estimated', [[P, 'label: "Median household income in each small area", basis: "estimated"', 'label: "Median household income in each small area", basis: "observed"']]],
  ['the density layer is labelled observed instead of calculated', [[P, 'id: "population_density", label: "People per square kilometre in each small area", basis: "calculated"', 'id: "population_density", label: "People per square kilometre in each small area", basis: "observed"']]],
  ['the people-in-rings measure is labelled calculated instead of estimated', [[P, 'id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "estimated"', 'id: "people_within_rings", label: "About how many people live within 1, 2 and 5 kilometres of the spot", basis: "calculated"']]],
  ['the no-sales-data line is gone', [[P, '  "It has no sales or customer data, so it cannot say whether a business would do well at a spot.",\n', '']]],
  ['the no-score line is gone', [[P, '  "There is no success score and no ranking of spots or places.",\n', '']]],
  ['the straight-line line is gone', [[P, '  "Distances are straight lines. There are no drive times or walking times.",\n', '']]],
  ['the points-may-not-be-loaded line is gone', [[P, '  "The business points come from a private source that may not be loaded yet; when they are not, the page says so and shows no businesses.",\n', '']]],
  ['the text does not tell the AI it cannot see the numbers', [[P, 'Do not say more than this about what the page shows, and never give a number for a place: you cannot see the page\'s numbers.', 'Do not say more than this.']]],
  ['the answer says it shows numbers here', [[P, 'page: PERFECT_CITY_PAGE,\n    shows_numbers_here: false,', 'page: PERFECT_CITY_PAGE,\n    shows_numbers_here: true,']]],
  ['the open answer says it chose for the person', [[P, 'chosen_for_the_person: false', 'chosen_for_the_person: true']]],
  ['an invented number about a place is added', [[P, '{ id: "montgomery_oh", label: "Dayton and Montgomery County, Ohio", note: "The whole county, which includes Dayton." }', '{ id: "montgomery_oh", label: "Dayton and Montgomery County, Ohio", note: "The whole county, which includes Dayton.", people: 537309 } as never']]],
  ['a verdict word is added to the words', [[P, 'Straight line only, not a drive or a walk.', 'Straight line only, not a drive or a walk. This shows the best spot.']]],
  ['a place is added that GEO did not announce', [[P, '  { id: "greene_oh", label: "Greene County, Ohio",', '  { id: "paris_fr", label: "Paris", note: "x" },\n  { id: "greene_oh", label: "Greene County, Ohio",']]],
  ['the page address is wrong', [[P, 'export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";', 'export const PERFECT_CITY_PAGE = "#/d/perfect_city";']]],
  ['the page address is a full link', [[P, 'export const PERFECT_CITY_PAGE = "#/d/geo_intelligence";', 'export const PERFECT_CITY_PAGE = "https://example.test/#/d/geo_intelligence";']]],
  // what it touches
  ['the open tool writes a place question', [[P, 'const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);', 'const place = pick(PC_PLACES, a.place), biz = pick(PC_BUSINESS_TYPES, a.business_type);\n    await ctx.data.askGeoShape({ shape: "where_to_go", category: "chicken" });']]],
  ['a real database call for Perfect City is named in db.ts', [[DB, 'switches: () => self.fn("connect_my_switches", ["text"], [h]),', 'switches: () => self.fn("connect_my_switches", ["text"], [h]),\n      perfectCity: () => self.fn("connect_perfect_city", ["text"], [h]),']]],
  // the panel's own word
  ['the home panel still says Opportunity Map', [[H, 'geo_intelligence: { label: "Perfect City"', 'geo_intelligence: { label: "Opportunity Map"']]],
];

const sources = [P, T, H, DB];
function seed() {
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.copyFileSync(path.join(root, 'assets/app-departments.js'), path.join(scratch, 'assets/app-departments.js'));
  fs.copyFileSync(path.join(root, SUITE), path.join(scratch, SUITE));
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
