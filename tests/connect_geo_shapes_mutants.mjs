// Must-fail proof for tests/connect-geo-shapes.test.mjs (GEO question shapes): each mutant breaks ONE thing (or, where two layers check the same rule, both layers) in a scratch copy of the connector code and the suites must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_geo_shapes_mutants.mjs   (exit 0 only when every mutant is caught)
// place_question shares code and text with what_is_within; where a snippet occurs twice, `second()` breaks the first copy harmlessly (so the edit that follows lands on the second, the new tool's).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-geoshapes');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', I = 'supabase/functions/connect/index.ts', D = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-geo-shapes.test.mjs', 'connect-geo-within.test.mjs'];
const HEAD = 'name: "place_question", title: "Ask a question about places", scope: "read", readOnly: true, listed: false,';
const GATE = 'if (!sw || !(await sw.enabled())) return refuse("Questions about places are not available yet. Nothing was looked up.", "not_available", { data: { ok: false, looked_up: false } });\n    const shape = a.shape;';
const HIT = 'if (!(await ctx.policy.hit(ctx.principal, "geo", LIMITS.geoQuestionsPerHourPerUser, 3600))) {';
const LOOKED = 'looked_up: false, do_not_poll: false, poll_after_s: 20 });';
const STOP = 'deleted after 7 days." + GEO_STOP,';
const ASSUMED = 'lines.push(`Assumed, not measured: ${untrusted("report-sentence", rep.assumptions)}`);';
/** two edits: break the FIRST copy of `from` in a way that no longer matches it, then change the SECOND */
// The marker goes right AFTER `anchor`, which must end at a token boundary (a space, a comma, `${`): an anchor that cuts an identifier or a string in two (the old fixed 12 characters did) breaks the PARSER, and the suites then
// "catch" the fault for the wrong reason. The break must also leave the suites green; both are proved by hand for every use below (11-20 audit).
const second = (from, to, anchor = from.slice(0, 12)) => [[T, from, from.replace(anchor, () => anchor + '/*1*/')], [T, from, to]];
// each mutant: [name, [[file, from, to], ...]]
const mutants = [
  ['the tool is listed', [[T, HEAD, HEAD.replace(' listed: false,', '')]]],
  ['the tool needs write permission', [[T, HEAD, HEAD.replace('scope: "read"', 'scope: "write"')]]],
  ['the tool says it is not read-only', [[T, HEAD, HEAD.replace('readOnly: true', 'readOnly: false')]]],
  ['the switch is ignored (the tool works with nothing wired)', [[T, GATE, 'const shape = a.shape;']]],
  ['a switch that says no is ignored', [[T, GATE, GATE.replace('!sw || !(await sw.enabled())', '!sw')]]],
  ['the real function wires a geo switch', [[I, 'deps: { compile }', 'deps: { compile, geo: undefined as never }']]],
  ['an unknown shape is accepted (schema and run)', [[T, 'enum: ["compare_sites", "verdict", "where_to_go"], description:', 'description:'], [T, 'if (shape !== "compare_sites" && shape !== "verdict" && shape !== "where_to_go") return refuse(', 'if (false) return refuse(']]],
  ['fields that belong to another shape are accepted', [[T, ' || (!wantA && has("site_a")) || (!wantB && has("site_b")) || (!wantCat && has("category")) || (!wantTown && has("town"))', '']]],
  ['the same point twice is compared', [[T, 'if (siteA && siteB && Math.round', 'if (false && Math.round']]],
  ['a town name is not checked (schema and run)', [[T, 'town: { type: "string", pattern: "^[A-Za-z][A-Za-z .\'-]{0,39}$", description', 'town: { type: "string", description'], [T, 'const GEO_TOWN = /^[A-Za-z][A-Za-z .\'-]{0,39}$/;', 'const GEO_TOWN = /^.*$/;']]],
  ['a site is not range-checked (schema and run)', [[T, 'lat: { type: "number", minimum: -90, maximum: 90 }, lon: { type: "number", minimum: -180, maximum: 180 } }, ["lat", "lon"]),\n    site_b', 'lat: { type: "number" }, lon: { type: "number" } }, ["lat", "lon"]),\n    site_b'],
    [T, 'lat: { type: "number", minimum: -90, maximum: 90 }, lon: { type: "number", minimum: -180, maximum: 180 } }, ["lat", "lon"]),\n    category', 'lat: { type: "number" }, lon: { type: "number" } }, ["lat", "lon"]),\n    category'],
    [T, 'return lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180 ? null : { lat, lon };', 'return lat === null || lon === null ? null : { lat, lon };']]],
  ['the category is not checked', [[T, 'category: { type: "string", pattern: "^[a-z][a-z0-9_]{1,30}$", description: "One kind', 'category: { type: "string", description: "One kind'], [T, 'typeof a.category === "string" && GEO_CATEGORY.test(a.category) ? a.category : null', 'typeof a.category === "string" ? a.category : null']]],
  ['the shared hourly limit is gone', second(HIT, 'if (false) {')],
  ['place questions have their own hourly bucket (not shared with what_is_within)', second('"geo", LIMITS.geoQuestionsPerHourPerUser, 3600))) {', '"geo_shapes", LIMITS.geoQuestionsPerHourPerUser, 3600))) {', '"geo", ')],
  ['the question is written with a place name as well', [[T, 'askGeoShape({ shape, ...(siteA ? { a: siteA } : {})', 'askGeoShape({ shape, place: String(a.place ?? ""), ...(siteA ? { a: siteA } : {})']]],
  ['the ask claims a lookup was made', second(LOOKED, 'looked_up: true, do_not_poll: false, poll_after_s: 20 });', 'looked_up: false, ')],
  ['the ask does not tell the AI to stop checking', second(STOP, 'deleted after 7 days.",', 'deleted after 7 days." ')],
  ['the ask does not say a verdict will not be a yes or no, or that no place will be picked', [[T, 'const note = shape === "verdict" ? " This will not be a yes or no." : shape === "where_to_go" ? " This will not pick a place." : "";', 'const note = "";']]],
  ['geo_answer does not route the new shapes', [[T, 'if (row.shape !== undefined && row.shape !== "within_minutes") return showShapeAnswer(row);', '']]],
  ['a row with no shape field is read as a new shape', [[T, 'if (row.shape !== undefined && row.shape !== "within_minutes")', 'if (row.shape !== "within_minutes")']]],
  ['any schema name is accepted', [[T, 'doc.schema !== ASK_SCHEMA ||', '']]],
  ['an answer for another question is accepted', [[T, ' || doc.shape !== ASK_SHAPE_ID[shape]', '']]],
  ['a refused result is shown', [[T, 'if (doc.refused !== undefined && doc.refused !== null) return null;', '']]],
  ['the assumptions are not checked for markup or control characters', [[T, 'const assumptions = str(doc.assumptions, 1600);\n  if (assumptions === null || !Array.isArray(doc.answers)', 'const assumptions = typeof doc.assumptions === "string" ? doc.assumptions : null;\n  if (assumptions === null || !Array.isArray(doc.answers)']]],
  ['no answers, or any number of them, is accepted', [[T, 'doc.answers.length < 1 || doc.answers.length > 40 ||', '']]],
  ['any number of statements is accepted', [[T, ' || doc.statements.length > 8', '']]],
  ['any label is accepted', [[T, '!ASK_LABELS.has(it.label) ||', '']]],
  ['Observed and Simulated numbers are accepted', [[T, 'new Set(["Calculated", "Estimated"])', 'new Set(["Calculated", "Estimated", "Observed", "Simulated"])']]],
  ['a label that does not match the end of the text is accepted', [[T, '!text.endsWith(`(${it.label})`) ||', '']]],
  ['a recommending or predicting answer line is shown', [[T, ' || CLAIM_WORDS.test(text)', '']]],
  ['an answer value of any type is accepted', [[T, 'else return null;\n    items.push', 'else value = null;\n    items.push']]],
  ['a value list may have a non-text member', [[T, 'typeof x === "string" ? str(x, 60) : null', 'typeof x === "string" ? str(x, 60) : "ok"']]],
  ['a list of any length is accepted', [[T, 'it.value.length <= 50', 'true']]],
  ['answer lines are not checked for markup, control characters or folders', [[T, 'const text = str(it.text, 300), source = str(it.source, 300), note = str(it.note, 1600);', 'const text = typeof it.text === "string" ? it.text : null, source = typeof it.source === "string" ? it.source : null, note = typeof it.note === "string" ? it.note : null;']]],
  ['statements are not checked for markup or control characters', [[T, 'const t = str(st, 600); if (t === null) return null;', 'const t = typeof st === "string" ? st : null; if (t === null) return null;']]],
  ['example data from the assumptions is not announced', [[T, '/example data/i.test(assumptions) || ', '']]],
  ['example data from a statement is not announced', [[T, 'statements.some((t) => /example data/i.test(t)) || ', '']]],
  ['example data from the flag is not announced', [[T, ' || doc.example_data === true', '']]],
  ['the example-data banner is not shown', [[T, 'if (rep.example) lines.push(', 'if (false) lines.push(']]],
  ['a verdict question is not told, first, that no yes or no is given', [[T, 'lines.push(FIXED_VERDICT, ', 'lines.push(']]],
  ['the words of the verdict refusal are changed to a yes', [[T, 'const FIXED_VERDICT = "No yes or no is given.', 'const FIXED_VERDICT = "Yes, it would do well.']]],
  ['a where-to-go question is not told that no place is picked', [[T, 'lines.push(FIXED_WHERE, ', 'lines.push(']]],
  ['the town is shown unfenced', [[T, '${untrusted("town", row.town)}', '${row.town}']]],
  ['the town is not said to leave the counts unchanged', [[T, ' was named, but these counts are for the whole of the data given: the town is not singled out.', ' was named.']]],
  ['the comparison does not say there is no winner', [[T, ' There is no score and no winner: picking one would need sales data, and none is used.`', '`']]],
  ['the answer lines are shown unfenced', [[T, 'for (const it of rep.items) lines.push(`  ${untrusted("report-sentence", it.text)}`);', 'for (const it of rep.items) lines.push(`  ${it.text}`);']]],
  ['the answer statements are shown unfenced', [[T, 'for (const st of rep.statements) lines.push(untrusted("report-sentence", st));', 'for (const st of rep.statements) lines.push(st);']]],
  ['the assumptions are shown unfenced', [[T, ASSUMED, 'lines.push(`Assumed, not measured: ${rep.assumptions}`);']]],
  ['the sources are not shown', [[T, 'lines.push(`Sources: ${[...new Set(rep.items.map((i) => i.source))].map((x) => untrusted("report-sentence", x)).join("; ")}.`);', '']]],
  ['the structured answer claims a verdict was given', [[T, 'verdict_given: false', 'verdict_given: true']]],
  ['the structured answer claims a place was picked', [[T, 'place_picked: false', 'place_picked: true']]],
  ['the real function names a database call that does not exist', [[D, '"connect_geo_ask_shape"', '"connect_geo_asks_shape"']]],
  ['the database call carries the wrong argument types', [[D, '["text", "text", "float8", "float8", "float8", "float8", "text", "text"]', '["text", "text", "float8", "float8", "float8", "text", "text"]']]],
];

// How many copies of each fault's "from" text its target file has today (11-20 audit, CC1 MEDIUM 2). The planted fault replaces the FIRST copy, so a later copy could move it to another tool; a fault whose count is not what is written here (default 1) is refused as BROKEN, in words, and must be looked at.
const COPIES = {
  "the shared hourly limit is gone": [3,3],
  "place questions have their own hourly bucket (not shared with what_is_within)": [3,3],
  "the ask claims a lookup was made": [3,3],
  "the ask does not tell the AI to stop checking": [2,2],
  "the assumptions are shown unfenced": [2],
};
const wantCopies = (name, i) => { const w = COPIES[name]; return Array.isArray(w) ? w[i] : (w ?? 1); };
const copiesProblem = (src, from, name, i) => { const have = src.split(from).length - 1, want = wantCopies(name, i); return have === want ? null : (have ? `BROKEN MUTANT (${have} copies of the text, expected ${want}): ${name}` : `BROKEN MUTANT (text not found): ${name}`); };
function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
function cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); }          // the scratch copy sits inside the repo, so node finds the repo's node_modules by itself; nothing is linked
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); cleanup(); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, edits] of mutants) {
  cleanup(); fresh();
  let broken = false;
  for (const [i, [file, from, to]] of edits.entries()) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const problem = copiesProblem(src, from, name, i);
    if (problem) { console.log(problem); missed++; broken = true; break; }
    fs.writeFileSync(target, src.replace(from, () => to));
  }
  if (broken) continue;
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
cleanup();
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
