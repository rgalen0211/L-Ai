// Must-fail proof for tests/connect-county.test.mjs (the county tools: GEO's words, the closed request rules, the answer reader that is the lock on the way back, the three tools and their switch, the stand-in world and the database layer):
// each mutant breaks ONE rule in a scratch copy and the suite must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// The SQL half has its own runner: tests/county_sql_mutants.py.
// Run:  node tests/connect_county_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-county');
const CT = 'supabase/functions/connect-core/county.ts', TL = 'supabase/functions/connect-core/tools.ts', FK = 'supabase/functions/connect-core/fake.ts', TY = 'supabase/functions/connect-core/types.ts', DB = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-county.test.mjs'];
const BS = String.fromCharCode(92);
const PERM = '/' + BS + 'bpermitted to' + BS + 'b|' + BS + 'b(?:is|are|be|being) permitted' + BS + 'b|allowed to (open|build)|zoning allows/i,';
const mutants = [
  // ---- the closed request rules and GEO's words
  ['a third county is offered', CT, '"39113": "Montgomery County, Ohio" });', '"39113": "Montgomery County, Ohio", "39049": "Another County, Ohio" });'],
  ['any kind is accepted', CT, 'if (kind !== "limited_service") {', 'if (false) {'],
  ['any rule is accepted', CT, 'if (rule !== null && (typeof rule !== "string" || !(rule in COUNTY_RULES))) {', 'if (false) {'],
  ['a year is accepted with no rule', CT, 'if (rule === null) return { refused: "a year chooses', 'if (false) return { refused: "a year chooses'],
  ['any year is accepted', CT, 'if (typeof year !== "number" || !Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return { refused:', 'if (false) return { refused:'],
  ['a comparison of one county is accepted', CT, 'if (list.length < 2 ||', 'if (list.length < 1 ||'],
  ['a county may be listed twice', CT, 'new Set(list).size !== list.length', 'false'],
  ['a value the person typed is echoed as it came', CT, 'String(v ?? "").replace(/[^A-Za-z0-9 _.-]/g, "?").slice(0, 24)', 'String(v ?? "")'],
  ['a missing kind is refused instead of meaning the only kind', CT, 'a.kind === undefined ? "limited_service" : a.kind', 'a.kind'],
  // ---- the lock on the way back: a series
  ['a series may have no label or an Estimated one', CT, 'if (v.label !== "Observed" && v.label !== "Calculated") return null;', ''],
  ['two sources may be added into one series', CT, 'if (/QCEW/i.test(source) && /County Business Patterns|' + BS + 'bCBP' + BS + 'b/i.test(source)) return null;', ''],
  ['a missing year need not say why (it may be read as zero)', CT, 'if (yn === "bad" || (value === null && yn === null)) return null;', 'if (yn === "bad") return null;'],
  ['a negative or non-numeric value is accepted', CT, 'if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return null;\n    const yn', 'const yn'],
  ['a series unit may be any length', CT, 'plainWords(v.unit, 80)', 'plainWords(v.unit, 8000)'],
  ['a table unit may be any length', CT, 'plainWords(r.unit, 80)', 'plainWords(r.unit, 8000)'],
  ['a claim that a place is permitted to open is shown', CT, PERM, PERM.replace(BS + 'bpermitted to' + BS + 'b|', '')],
  ['a claim that new places are permitted is shown', CT, PERM, PERM.replace(BS + 'b(?:is|are|be|being) permitted' + BS + 'b|', '')],
  ['a claim that zoning allows it is shown', CT, PERM, PERM.replace('|zoning allows', '')],
  ['a claim that something is allowed to be built is shown', CT, PERM, PERM.replace('allowed to (open|build)|', '')],
  ['a series with no source is accepted', CT, 'if (!measure || !title || !source || unit === null || note === "bad") return null;', 'if (!measure || !title || unit === null || note === "bad") return null;'],
  ['a series note with a path or a claim is accepted', CT, 'const note = optWords(v.note, 600);', 'const note = typeof v.note === "string" ? v.note : null;'],
  ['any number of series is accepted', CT, 'if (!Array.isArray(v.series) || v.series.length > 20) return null;', 'if (!Array.isArray(v.series)) return null;'],
  // ---- the lock on the way back: a profile
  ['a path on a computer may be shown', CT, ' || PATHISH.test(s)', ''],
  ['a banned claim may be shown', CT, ' || BANNED_WORDS.some((re) => re.test(s))', ''],
  ['a hidden character may be shown', CT, 'hidden(s) || ', ''],
  ['an answer that forecasts is shown (profile)', CT, 'if (typeof v.forecast !== "string" || !v.forecast.startsWith("none")) return null;', ''],
  ['an answer for another county is shown', CT, '(expect !== null && v.county !== expect)', 'false'],
  ['the county name comes from the answer', CT, 'return { fips: v.county, name: COUNTY_LIST[v.county], series,', 'return { fips: v.county, name: String(v.county_name), series,'],
  ['an answer of another schema is shown', CT, 'v.schema !== PROFILE_SCHEMA || v.kind !== "limited_service"', 'false'],
  ['a not-held item with a path is shown', CT, 'const source = isObj(e) ? plainWords(e.source, 100) : null, why = isObj(e) ? plainWords(e.why, 300) : null;', 'const source = isObj(e) ? String(e.source) : null, why = isObj(e) ? String(e.why) : null;'],
  ['a not-held sentence with a path is shown', CT, 'for (const t of v.not_held) { const w = plainWords(t, 400);', 'for (const t of v.not_held) { const w = typeof t === "string" ? t : null;'],
  ['a read-from sentence with a folder is shown', CT, ': (plainWords(v.read_from, 300));', ': (typeof v.read_from === "string" ? v.read_from : null);'],
  // ---- the lock on the way back: a comparison
  ['a comparison of other counties than the ones asked, or one twice, is shown', CT, 'if ([...shown].sort().join() !== [...ask.counties].sort().join()) return null;', ''],
  ['an answer for another rule is shown', CT, 'answer.rule.id !== ask.rule || ask.rule === null', 'false'],
  ['an answer for another year is shown', CT, 'if (ask.year !== null && rule_year !== null && rule_year !== ask.year) return null;', ''],
  ['a rule asked for may be missing from the answer', CT, '} else if (ask.rule !== null) return null;', '}'],
  ['an order may leave a county out or use another year', CT, 'if (table.length !== got.length || !sameList(table.map((r) => r.fips), shown) || table.some((r) => r.value === null || r.year !== rule_year)) return null;', ''],
  ['an order need not follow the rule', CT, 'if (rev ? a < b : a > b) return null;', ''],
  ['equal values may break the order asked', CT, 'if (a === b && ask.counties.indexOf(table[i - 1].fips) > ask.counties.indexOf(table[i].fips)) return null;', ''],
  ['the table need not match the profiles', CT, 'if (!s || !y || y.value !== r.value) return null;', ''],
  ['no order made may still reorder the counties', CT, '} else if (!sameList(shown, ask.counties)) return null;', '}'],
  ['a comparison that forecasts is shown', CT, 'answer.kind !== "limited_service" || typeof answer.forecast !== "string" || !answer.forecast.startsWith("none")) return null;', 'answer.kind !== "limited_service") return null;'],
  ['a table row with no label is accepted', CT, '|| (r.label !== "Observed" && r.label !== "Calculated")) return null;', ') return null;'],
  ['a missing table figure need not say why', CT, 'if (!source || unit === null || note === "bad" || (value === null && note === null)) return null;', 'if (!source || unit === null || note === "bad") return null;'],
  // ---- the words
  ['the fixed lines are missing from the answer', CT, ', ...SAY_LINES, ...(r.shape === "compare" ? [SAY_COMPARE] : [])];', ', ...(r.shape === "compare" ? [SAY_COMPARE] : [])];'],
  ['a fixed line is reworded', CT, '"These are counts of places, not of sales or customers.",', '"These are counts of places, and a sign of sales or customers.",'],
  ['the sources line is missing', CT, 'lines.push(SOURCES_NEVER_ADDED);', ''],
  ['the series break is not said', CT, 'const brk = s.breaks.length ?', 'const brk = false ?'],
  ['a latest year that is not held is shown as zero', CT, 'last.value === null ? `${last.year}: no figure (${wrap(last.note as string)})` : `${last.year}: ${fmt(last.value)}${unit}`', '`${last.year}: ${fmt(last.value ?? 0)}${unit}`'],
  ['words that name a folder are shown in the not-held count line', CT, 'if (p.withheld) lines.push(', 'if (false) lines.push('],
  // ---- the tools
  ['asks are written with the switch off', TL, 'if (!sw || !(await sw.enabled()) || !ctx.data.askCounty) return refuse(COUNTY_OFF', 'if (false) return refuse(COUNTY_OFF'],
  ['answers are read with the switch off', TL, 'if (!sw || !(await sw.enabled()) || !ctx.data.getCounty) return refuse(COUNTY_OFF', 'if (false) return refuse(COUNTY_OFF'],
  ['asks are not limited per hour', TL, 'if (!(await ctx.policy.hit(ctx.principal, "county", LIMITS.countyQuestionsPerHourPerUser, 3600))) {', 'if (false) {'],
  ['GEO\'s refusal is replaced by other words', TL, 'return refuse(c.refused, "args",', 'return refuse("That was not accepted.", "args",'],
  ['the profile tool is listed to the AI', TL, 'name: "county_profile", title: "A county\'s restaurant figures", scope: "read", readOnly: true, listed: false,', 'name: "county_profile", title: "A county\'s restaurant figures", scope: "read", readOnly: true,'],
  ['the answer tool needs the edit scope', TL, 'name: "county_answer", title: "Read the answer to a county question", scope: "read",', 'name: "county_answer", title: "Read the answer to a county question", scope: "edit",'],
  ['a failed reason that names a folder is shown', TL, 'const detail = row.fail_detail ? plainWords(row.fail_detail, 300) : null;', 'const detail = row.fail_detail ? row.fail_detail : null;'],
  ['free text is not marked as data', TL, 'countyLines(rep, (s) => untrusted("report-sentence", s))', 'countyLines(rep, (s) => s)'],
  ['an unusable answer is shown', TL, 'if (!rep) return refuse("The answer was not in a shape this connection knows (a figure', 'if (false) return refuse("The answer was not in a shape this connection knows (a figure'],
  ['the ask tool leaves the description unlike GEO\'s', TL, 'description: COUNTY_PROFILE_DESCRIPTION + " Read the answer with county_answer.",', 'description: "Looks up a county. Read the answer with county_answer.",'],
  ['the hourly limit is far too high', TY, 'countyQuestionsPerHourPerUser: 30,', 'countyQuestionsPerHourPerUser: 3000,'],
  // ---- the database layer and the stand-in
  ['the ask goes to the read function', DB, 'askCounty: (q) => self.fn("connect_county_ask"', 'askCounty: (q) => self.fn("connect_county_get"'],
  ['the read goes to the ask function', DB, 'getCounty: (id) => self.fn("connect_county_get"', 'getCounty: (id) => self.fn("connect_county_ask"'],
  ['the stand-in lets many requests wait', FK, 'c.state === "claimed").length >= 5) throw err("There are already 5 county questions', 'c.state === "claimed").length >= 500) throw err("There are already 5 county questions'],
  ['the stand-in worker may store an answer of any schema', FK, 'o.schema !== (c.shape === "profile" ? "ryagram.geo-county-profile/0" : "ryagram.geo-compare-counties/0")', 'false'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
