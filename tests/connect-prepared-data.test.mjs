// AI-prepared data, the connector's half (CONNECT, 2026-11-20; Q634, Ryan's ChatGPT walk "median age by US state 2010-2023"): the tools submit_prepared_data and list_my_data through the REAL dispatch, scope gate and argument
// check, against the stand-in world, plus the CSV reader that measures what the AI hands over. The honesty rules, each with a must-fail: nothing the AI sends is a dataset until the PERSON accepts it (no tool does that), a
// story may name only THIS person's accepted uploads, a table with a missing year says so, and a bad table is refused before anything is stored. The database half: supabase/migrations/20261120000500_prepared_data.sql (text tests below).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { TOOLS, TOOL_BY_NAME, PREPARED_WHERE } from '../supabase/functions/connect-core/tools.ts';
import { toolList, preparedDataOn, handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { authorizationServerMetadata, openIdShapedMetadata, protectedResourceDoc } from '../supabase/functions/connect-core/oauth.ts';
import { openApi } from '../supabase/functions/connect-core/rest.ts';
import { parseCsv, measure, describeMeasured } from '../supabase/functions/connect-core/prepared.ts';
import { TEMPLATES, build } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const ALL = ['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data'];
function world() {
  const w = new FakeWorld();
  const mk = (id, scopes) => { w.addUser(id, id + '@example.test', 100); w.invite(id, 'client-' + id, scopes); return { tokenHash: 'h-' + id, userId: id, clientId: 'client-' + id }; };
  const A = mk('u-a', ALL), B = mk('u-b', ALL), OLD = mk('u-old', ['read', 'write', 'render_free', 'edit', 'fetch_data']);
  const call = (p, tool, args = {}) => callTool(tool, args, p, { data: w.data(p.userId), policy: w.policy(), deps: { compile }, preparedData: true });      // the connector's own switch (CONNECT_PREPARED_DATA) is ON here; the OFF state is the last tests of this file
  return { w, A, B, OLD, call };
}
// the film in Ryan's walk: median age by state, 2010 to 2023, with NO row for 2020 (the Census did not publish standard 2020 one-year estimates)
const STATES = ['Alabama', 'Alaska', 'Arizona'];
function censusCsv(years) { const rows = ['place,year,value']; for (const s of STATES) for (const y of years) rows.push(`${s},${y},${(35 + (y % 7) / 3).toFixed(1)}`); return rows.join('\n') + '\n'; }
const YEARS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023];
const SOURCES = { urls: ['https://data.census.gov/table?q=B01002'], publisher: 'U.S. Census Bureau, American Community Survey 1-year', licence: 'Public domain (U.S. government work)', units: 'median age in years' };
const args = (csv = censusCsv(YEARS), extra = {}) => ({ label: 'Median age by US state, ACS 1-year', csv_text: csv, sources: SOURCES, change_log: ['kept table B01002 estimate 001', 'one row per state and year'], ...extra });
const goodStory = (dataset) => { const t = TEMPLATES[0]; const s = build(t.id, t.datasets[0], 'Test headline'); for (const c of s.sequence.clips) if (c.kind === 'render') c.dataset = dataset; return s; };

// ---------------------------------------------------------------------------------------------- the reader
test('the reader measures a long table, finds the years that really are there and names the one that is MISSING', () => {
  const p = parseCsv(censusCsv(YEARS));
  assert.ok(p.ok);
  const m = measure(p);
  assert.equal(m.shape, 'long'); assert.equal(m.rows, STATES.length * YEARS.length); assert.equal(m.places, STATES.length);
  assert.equal(m.first_period, 2010); assert.equal(m.last_period, 2023); assert.equal(m.periods_found, 13); assert.deepEqual(m.periods_missing, [2020]);
  assert.equal(m.place_column, 'place'); assert.equal(m.period_column, 'year'); assert.equal(m.value_column, 'value');
  assert.match(describeMeasured(m), /NO rows for 2020/);
});

test('the reader measures a wide table (one column per year) and a table with quoted cells', () => {
  const w = measure(parseCsv('state,2010,2011,2013\n"Alabama, the state",37.9,38.1,38.6\nAlaska,33.8,33.9,34.2\n'));
  assert.equal(w.shape, 'wide'); assert.equal(w.first_period, 2010); assert.equal(w.last_period, 2013); assert.deepEqual(w.periods_missing, [2012]); assert.equal(w.places, 2);
  const q = parseCsv('place,year,value\n"Washington, D.C.",2010,"33.5"\n"The ""Big"" Apple",2011,36\n');
  assert.ok(q.ok); assert.equal(q.rows[0][0], 'Washington, D.C.'); assert.equal(q.rows[1][0], 'The "Big" Apple');
});

test('MUST-FAIL: a ragged row, an unclosed quote, a control character, no header, one column, too many rows, a huge table and a cell that is a paragraph are all refused in plain words', () => {
  const bad = (t) => { const r = parseCsv(t); assert.equal(r.ok, false, t.slice(0, 40)); return r.problem; };
  assert.match(bad('place,year,value\nA,2010,1\nB,2011\nC,2012,3\n'), /Row 3 of the table has 2 cells but the header has 3/);
  assert.match(bad('place,year,value\n"A,2010,1\nB,2011,2\nC,2012,3\n'), /never closed/);
  assert.match(bad('place,year,value\nA,2010,1\nB,2011,2\u0000\nC,2012,3\n'), /control characters/);
  assert.match(bad('place,year,value\n'), /header row and at least 2 data rows/);
  assert.match(bad('place\nA\nB\nC\n'), /at least 2 columns/);
  assert.match(bad('place,year,value\n' + Array.from({ length: 5001 }, (_, i) => `A${i},2010,1`).join('\n')), /most is 5000/);
  assert.match(bad('place,year,value\nA,2010,' + 'x'.repeat(205000) + '\nB,2011,2\nC,2012,3\n'), /200 KB/);
  assert.match(bad('place,year,value\nA,2010,' + 'x'.repeat(400) + '\nB,2011,2\nC,2012,3\n'), /cell of more than 300/);
});

// ---------------------------------------------------------------------------------------------- the tools
test('the two tools are listed with honest annotations, in the right scopes, and the words promise nothing the AI cannot do', () => {
  const list = Object.fromEntries(toolList(false, false, false, true).map((t) => [t.name, t]));
  assert.equal(list.submit_prepared_data.annotations.readOnlyHint, false); assert.equal(list.submit_prepared_data.annotations.destructiveHint, false); assert.equal(list.submit_prepared_data.annotations.idempotentHint, false);
  assert.equal(list.list_my_data.annotations.readOnlyHint, true);
  assert.equal(TOOL_BY_NAME.get('submit_prepared_data').scope, 'submit_data'); assert.equal(TOOL_BY_NAME.get('list_my_data').scope, 'read');
  const d = list.submit_prepared_data.description;
  assert.match(d, /waits for the PERSON/); assert.match(d, /you cannot accept, confirm or use it/); assert.match(d, /Unverified, user-supplied/); assert.match(d, /never fill a missing year/);
  assert.ok(!/call it first|you must|read it before/i.test(d));
});

test('no connector tool can accept, confirm, attach or use a prepared table: the tool list has none, and a staged table is not a dataset', () => {
  for (const t of TOOLS) assert.ok(!/accept|confirm_dataset|attach_upload|approve/i.test(t.name), t.name);
  assert.ok(!TOOLS.some((t) => t.name === 'accept_prepared_data' || t.name === 'confirm_mapping'));
});

test('the AI hands over the Census table: it is measured, it WAITS, the label is unverified, the missing year is named, and the person has not accepted anything', async () => {
  const { w, A, call } = world();
  const r = await call(A, 'submit_prepared_data', args());
  assert.ok(!r.isError, r.text);
  assert.equal(r.data.state, 'waiting'); assert.equal(r.data.where, PREPARED_WHERE);          // 11-22 (RENDERER LOW): the structured answer carries the app's own words too, never the database's 'Your data'
  assert.match(r.text, /39 rows and 3 columns; 3 places; years 2010 to 2023 \(13 found; NO rows for 2020\)/);
  assert.match(r.text, /Unverified, user-supplied/); assert.match(r.text, /you cannot accept it/); assert.match(r.text, /NOTE: no rows for 2020: say so to the person and do not fill them/);
  assert.deepEqual(r.data.measured.periods_missing, [2020]);
  const held = w.preparedFor('u-a');
  assert.equal(held.length, 1); assert.equal(held[0].state, 'waiting'); assert.deepEqual(held[0].changeLog, ['kept table B01002 estimate 001', 'one row per state and year']);
  const l = await call(A, 'list_my_data');
  assert.equal(l.data.datasets.length, 0, 'a waiting table is not a dataset'); assert.equal(l.data.waiting_for_you, 1);
});

test('MUST-FAIL: a story cannot name a waiting table, a made-up u_ name, or ANOTHER person\'s accepted upload; only this person\'s accepted upload is allowed, and the existing tools then work', async () => {
  const { w, A, B, call } = world();
  const pid = (await call(A, 'create_project', { title: 'Median Age by US State 2010-2023' })).data.project_id;
  const sub = await call(A, 'submit_prepared_data', args());
  assert.ok(!sub.isError, sub.text);
  const made = 'u_' + 'a'.repeat(24);
  let r = await call(A, 'set_story', { project_id: pid, story: goodStory(made) });
  assert.equal(r.isError || r.data?.saved === false || r.refused === true, true, 'a made-up name is refused'); assert.match(r.text, /which Ryagram does not have: it is not in the catalog, and not among the person's own uploaded data/);
  const mine = w.acceptPrepared('u-a', w.preparedFor('u-a')[0].id);
  r = await call(A, 'set_story', { project_id: pid, story: goodStory(mine) });
  assert.ok(!r.isError && r.data.saved === true, r.text);
  const l = await call(A, 'list_my_data');
  assert.equal(l.data.datasets.length, 1); assert.equal(l.data.datasets[0].name, mine); assert.equal(l.data.datasets[0].trust_label, 'unverified_user'); assert.equal(l.data.datasets[0].prepared_by_ai, true); assert.equal(l.data.waiting_for_you, 0);
  const pidB = (await call(B, 'create_project', { title: 'Someone else' })).data.project_id;
  const rb = await call(B, 'set_story', { project_id: pidB, story: goodStory(mine) });
  assert.equal(rb.isError || rb.data?.saved === false || rb.refused === true, true, 'another person cannot name this upload'); assert.match(rb.text, /which Ryagram does not have: it is not in the catalog, and not among the person's own uploaded data/);
  assert.equal((await call(B, 'list_my_data')).data.datasets.length, 0, 'another person sees none of it');
});

test('MUST-FAIL: a connection that was made before the scope existed cannot hand anything over; bad labels, sources and tables are refused with nothing stored', async () => {
  const { w, A, OLD, call } = world();
  const r = await call(OLD, 'submit_prepared_data', args());
  assert.equal(r.isError, true); assert.equal(r.code, 'scope'); assert.equal(w.preparedFor('u-old').length, 0);
  for (const [bad, why] of [[args(censusCsv(YEARS), { sources: { urls: ['http://x.org/a'], licence: 'l', units: 'u' } }), 'a source that is not https'], [args(censusCsv(YEARS), { sources: { urls: ['https://93.184.216.34/a'], licence: 'l', units: 'u' } }), 'a source that is a bare IP number'], [args(censusCsv(YEARS), { sources: { urls: ['https://x.org/a'], units: 'u' } }), 'no licence'],
    [args('place,value\nA,1\nB,2\nC,3\n'), 'no year anywhere'], [args('place,year,value\nA,2010,1\nB,2011\nC,2012,3\n'), 'a ragged row'], [args(censusCsv(YEARS), { change_log: Array.from({ length: 13 }, (_, i) => 'step ' + i) }), 'a 13-step change log']]) {
    const x = await call(A, 'submit_prepared_data', bad);
    assert.equal(x.isError, true, why);
  }
  assert.equal(w.preparedFor('u-a').length, 0, 'nothing was stored by any refused call');
});

test('the limits: the 6th waiting table is refused in words, and the AI is told where the person decides', async () => {
  const { A, call } = world();
  for (let i = 0; i < 5; i += 1) assert.ok(!(await call(A, 'submit_prepared_data', args(censusCsv(YEARS), { label: 'Table ' + i }))).isError);
  const x = await call(A, 'submit_prepared_data', args());
  assert.equal(x.isError, true); assert.match(x.text, /already 5 tables waiting for the person to accept/);
});

// ---------------------------------------------------------------------------------------------- the database half, read as text (the real run is the pg lane)
test('the migration: a closed staging table, connector-only functions, app-only functions, the scope, no owner argument, a measured shape, an unverified label that no caller can change', () => {
  const m = fs.readFileSync(new URL('../supabase/migrations/20261120000500_prepared_data.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(m, /create table public\.prepared_data/); assert.match(m, /revoke all on public\.prepared_data from public, anon, authenticated, service_role, connect_runner/);
  assert.match(m, /octet_length\(csv_text\) <= 204800/); assert.match(m, /jsonb_array_length\(change_log\) <= 12/);
  assert.match(m, /grant execute on function public\.connect_submit_prepared_data\(text, text, text, jsonb, jsonb, jsonb, text\), public\.connect_list_my_data\(text\) to connect_runner/);
  assert.match(m, /grant execute on function public\.my_prepared_data\(\), public\.my_prepared_data_csv\(uuid\), public\.discard_prepared_data\(uuid\), public\.mark_prepared_accepted\(uuid, uuid\) to authenticated/);
  assert.match(m, /connect_actor\(p_token_hash, 'submit_data'\)/); assert.match(m, /connect_actor\(p_token_hash, 'read'\)/);
  assert.match(m, /array\['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data'\]/);
  assert.equal((m.match(/require_signed_in\(\)/g) || []).length, 4, 'all four app functions name the signed-in person');
  assert.ok(!/p_owner|p_user/.test(m), 'no function takes an owner from the caller');
  assert.equal((m.match(/'trust_label', 'unverified_user'/g) || []).length, 2, 'the label is a constant in both reads, never a parameter');
  assert.ok(!/create function public\.connect_[a-z_]*(accept|confirm|attach)/.test(m), 'no connector function accepts, confirms or attaches');
  assert.match(m, /pg_advisory_xact_lock\(hashtextextended\('prepared:'/);
  assert.match(m, /waiting >= 5/); assert.match(m, /today >= 10/);
  assert.match(m, /mark_prepared_accepted[\s\S]*d\.created_at < now\(\) - interval '2 hours'/);
});

test('MUST-FAIL (the review HIGH): every key the connector measures is a key the database accepts, and the other way round; the fake enforces the same list, so a new key can never again reach the database refused', async () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261120000500_prepared_data.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = /m\) x where x not in \(([^)]*)\)\) then return false/.exec(sql);
  assert.ok(m, 'the closed list of measured keys is in the migration');
  const allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  const measured = measure(parseCsv(censusCsv(YEARS)));
  assert.deepEqual(Object.keys(measured).sort(), allowed, 'what measure() returns is exactly what the database allows');
  const { A, call } = world();
  const r = await call(A, 'submit_prepared_data', args());
  assert.ok(!r.isError, r.text);                                                                         // the fake refuses any key outside the list: this passing is what the real database would do
});

test('MUST-FAIL: a cell a spreadsheet would run as a formula, text after a closing quote, and a very long column title are refused; a negative number and a lone dash are fine', () => {
  const bad = (t) => { const r = parseCsv(t); assert.equal(r.ok, false, t.slice(0, 50)); return r.problem; };
  for (const cell of ['=1+1', '+1', '@SUM(A1)', '-cmd', '-Alabama', '-1+1', '-2+cmd', ' =1', '\t=1', '-1.5.3']) assert.match(bad('place,year,value\nA,2010,1\nB,2011,' + cell + '\nC,2012,3\n'), /spreadsheet formula/, cell);
  assert.match(bad('place,year,value\n"A"x,2010,1\nB,2011,2\nC,2012,3\n'), /text after its closing quote/);
  assert.match(bad('place,year,' + 'v'.repeat(61) + '\nA,2010,1\nB,2011,2\nC,2012,3\n'), /longer than 60 characters/);
  assert.match(bad('=place,year,value\nA,2010,1\nB,2011,2\nC,2012,3\n'), /column title starts with/);
  assert.match(bad('place,year,value\nA"x,2010,1\nB,2011,2\nC,2012,3\n'), /quote appears inside a cell/);
  assert.ok(parseCsv('place,year,value\nA,2010,-1.5\nB,2011,-\nC,2012,"-1,234"\n').ok, 'a negative number and a lone dash are not formulas');
  assert.ok(parseCsv('place,year,value\n"A, B",2010,1\nC,2011,"2"\nD,2012,3\n').ok, 'quoted cells still work');
});

// ------------------------------------------------------------------------------------------------ the connector's own switch (GAMES 11-21): the hand-over exists only while CONNECT_PREPARED_DATA is on
// Why: the Accept card is built only when the site's uploads flag is on. A table handed over before that waits 7 days in a card nobody can see. So until Ryan sets the secret (in the same step as the site push that turns uploads on),
// the two tools are not in any list, a call is "no such tool", nothing is stored, and the scope is not advertised, so no consent page offers it.
const NAMES = ['submit_prepared_data', 'list_my_data'];
test('SWITCH OFF (the default): neither tool is in the MCP list, the REST list or the OpenAPI document, and the connector says so for the same reason everywhere', () => {
  for (const n of NAMES) {
    assert.ok(TOOL_BY_NAME.get(n).preparedData === true, n + ' carries the switch');
    assert.ok(!toolList().some((x) => x.name === n), n + ' is not in the default list');
    assert.ok(!toolList(true, true, true).some((x) => x.name === n), n + ' stays out whatever the app switches say');
    assert.ok(toolList(false, false, false, true).some((x) => x.name === n), n + ' is listed once the switch is on');
  }
  assert.equal(preparedDataOn(undefined), false); assert.equal(preparedDataOn({ enabled: true }), false); assert.equal(preparedDataOn({ enabled: false, preparedData: true }), true, 'independent of the MCP App face');
  const doc = JSON.stringify(openApi('https://example.test/connect'));
  for (const n of NAMES) assert.ok(!doc.includes('/v1/tools/' + n), n + ' is not in the OpenAPI document');
});

test('SWITCH OFF: a call is "no such tool", stores nothing, and the person is not left with a table nobody can see', async () => {
  const { w, A } = world();
  const off = (tool, a) => callTool(tool, a, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });      // no preparedData: the default
  const r = await off('submit_prepared_data', args());
  assert.equal(r.isError, true); assert.equal(r.code, 'unknown_tool'); assert.match(r.text, /no tool called/i);
  assert.equal((await off('list_my_data', {})).code, 'unknown_tool');
  const on = await callTool('list_my_data', {}, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile }, preparedData: true });
  assert.equal(on.isError, undefined, 'and with the switch on the same call answers');
  const waiting = await callTool('submit_prepared_data', args(), A, { data: w.data(A.userId), policy: w.policy(), deps: { compile }, preparedData: true });
  assert.equal(waiting.isError, undefined, waiting.text);
});

test('SWITCH OFF: the submit_data scope is not advertised in either metadata document (so no consent page offers a tool that is not there); ON: it is, in all three', () => {
  const BASE = 'https://example.test/connect';
  for (const doc of [authorizationServerMetadata(BASE), openIdShapedMetadata(BASE), protectedResourceDoc(BASE)]) {
    assert.ok(!doc.scopes_supported.includes('submit_data'), 'off: not advertised');
    assert.deepEqual(doc.scopes_supported, ['read', 'write', 'render_free', 'edit', 'fetch_data'], 'the others are unchanged');
  }
  for (const doc of [authorizationServerMetadata(BASE, false, true), openIdShapedMetadata(BASE, false, true), protectedResourceDoc(BASE, true)]) assert.ok(doc.scopes_supported.includes('submit_data'), 'on: advertised');
});

test('the function reads the switch only when CONNECT_PREPARED_DATA is exactly "on", and hands it to BOTH the tool list and the OAuth metadata', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/connect/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const preparedDataOn = \(Deno\.env\.get\("CONNECT_PREPARED_DATA"\) \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "on";/);
  assert.match(src, /preparedData: preparedDataOn,\n/, 'the OAuth deps (the metadata documents)');
  assert.match(src, /probe: Deno\.env\.get\("CONNECT_MAP_PROBE"\) === "on", preparedData: preparedDataOn,/, 'and the MCP config (the tool list and the call gate)');
});

test('over the real MCP face: tools/list and tools/call follow the switch (off: absent and "no tool called"; on: listed and answering), whether or not the MCP App face is on', async () => {
  const mcp = (mcpApp) => {
    const { w, A } = world();
    w.issue('tok-a', A);
    const deps = { data: null, policy: w.policy(), deps: { compile }, verifyToken: w.verifyToken, dataFor: () => w.data(A.userId), resourceMetadataUrl: 'http://127.0.0.1:1/.well-known/oauth-protected-resource', ...(mcpApp === undefined ? {} : { mcpApp }) };
    return async (method, params) => JSON.parse(await (await handleMcp(new Request('http://127.0.0.1:1/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer tok-a' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), deps)).text());
  };
  for (const off of [undefined, { enabled: true }, { enabled: true, chatEditor: true, homePanel: true }, { enabled: false, preparedData: false }]) {
    const rpc = mcp(off);
    const names = (await rpc('tools/list')).result.tools.map((x) => x.name);
    for (const n of NAMES) assert.ok(!names.includes(n), n + ' is not listed: ' + JSON.stringify(off));
    const r = (await rpc('tools/call', { name: 'submit_prepared_data', arguments: args() })).result;
    assert.equal(r.isError, true); assert.match(r.content[0].text, /no tool called/i);
  }
  for (const on of [{ enabled: false, preparedData: true }, { enabled: true, preparedData: true }]) {
    const rpc = mcp(on);
    const names = (await rpc('tools/list')).result.tools.map((x) => x.name);
    for (const n of NAMES) assert.ok(names.includes(n), n + ' is listed: ' + JSON.stringify(on));
    const r = (await rpc('tools/call', { name: 'list_my_data', arguments: {} })).result;
    assert.equal(r.isError, false, JSON.stringify(r));
  }
});

test('the OAuth handler gives the switch to all three metadata documents (source), so a route cannot advertise what the tool list hides', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/connect-core/oauth.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.includes('authorizationServerMetadata(d.baseUrl, !!d.cimd, !!d.preparedData)'));
  assert.ok(src.includes('openIdShapedMetadata(d.baseUrl, !!d.cimd, !!d.preparedData)'));
  assert.ok(src.includes('protectedResourceDoc(d.baseUrl, !!d.preparedData)'));
});
