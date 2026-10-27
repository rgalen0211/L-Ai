// Download plans, the connector's half (NEXT-CONNECT 152): the tools request_download and list_my_downloads through the REAL dispatch, scope gate and argument check, against the stand-in world.
// The AI can only WRITE a plan and READ its state: it never receives a file, a file name or a place on the person's computer, and a plan is data the person's own app shows for them to approve.
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { TOOLS, downloadUrlProblem } from '../supabase/functions/connect-core/tools.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';

const SCOPES = ['read', 'write', 'render_free', 'edit', 'fetch_data'];
const compile = makeCompile(Ajv2020);

function world() {
  const w = new FakeWorld();
  const mk = (id, scopes) => { w.addUser(id, id + '@example.test', 100); w.invite(id, 'client-' + id, scopes); return { tokenHash: 'h-' + id, userId: id, clientId: 'client-' + id }; };
  const A = mk('u-a', SCOPES), B = mk('u-b', SCOPES), R = mk('u-r', ['read', 'write', 'render_free', 'edit']);
  const spy = { requested: [] };
  const env = (p) => { const d = w.data(p.userId); const orig = d.requestDownload; d.requestDownload = (...args) => { spy.requested.push(args); return orig(...args); }; return { data: d, policy: w.policy(), deps: { compile } }; };
  const call = (p, tool, args = {}) => callTool(tool, args, p, env(p));
  return { w, A, B, R, call, spy };
}
const URL_OK = 'https://www.census.gov/data/counties.csv';

test('the two tools are listed with honest annotations', () => {
  const list = Object.fromEntries(toolList().map((t) => [t.name, t]));
  assert.equal(list.request_download.annotations.readOnlyHint, false);
  assert.equal(list.request_download.annotations.destructiveHint, false);
  assert.equal(list.request_download.annotations.idempotentHint, false);
  assert.equal(list.list_my_downloads.annotations.readOnlyHint, true);
  assert.ok(TOOLS.find((t) => t.name === 'request_download').scope === 'fetch_data' && TOOLS.find((t) => t.name === 'list_my_downloads').scope === 'read');
  for (const n of ['request_download', 'list_my_downloads']) assert.ok(!/call it first|you must|read it before/i.test(list[n].description), n);
});

test('a plan is written, and it says nothing was downloaded', async () => {
  const { A, call } = world();
  const r = await call(A, 'request_download', { url: URL_OK, why: 'the county table for your map', folder: 'Census' });
  assert.ok(!r.isError, r.text);
  assert.equal(r.data.state, 'waiting'); assert.equal(r.data.host, 'www.census.gov');
  assert.match(r.text, /Nothing is downloaded until they press Download/);
  assert.match(r.text, /<untrusted source="download-host">\nwww\.census\.gov/);
  const l = await call(A, 'list_my_downloads');
  assert.equal(l.data.downloads.length, 1);
  assert.equal(l.data.downloads[0].state, 'waiting');
  assert.match(l.text, /<untrusted/);                                                                       // the host comes from outside: wrapped as data
});

test('the reason is cleaned before it goes on: control characters and runs of spaces are gone', async () => {
  const { A, call, spy } = world();
  const r = await call(A, 'request_download', { url: URL_OK, why: '  the   county\u0007 table\n for the map ' });
  assert.ok(!r.isError, r.text);
  assert.equal(spy.requested[0][1], 'the county table for the map');
});

test('the scope gate: a connection without fetch_data cannot write a plan but can list', async () => {
  const { R, A, call } = world();
  await call(A, 'request_download', { url: URL_OK, why: 'x' });
  const r = await call(R, 'request_download', { url: URL_OK, why: 'x' });
  assert.equal(r.isError, true); assert.equal(r.code, 'scope');
  const l = await call(R, 'list_my_downloads');
  assert.ok(!l.isError); assert.equal(l.data.downloads.length, 0);                              // and sees only its own person's plans (none)
});

test('MUST-FAIL: addresses and texts that are not allowed are refused and nothing is written', async () => {
  const { A, call, spy } = world();
  const bad = {
    http: 'http://www.census.gov/a.csv', user: 'https://user:pw@www.census.gov/a.csv', at: 'https://www.census.gov@evil.example/a.csv', ip: 'https://93.184.216.34/a.csv', port: 'https://www.census.gov:8443/a.csv',
    nodot: 'https://localhost/a.csv', file: 'file:///C:/x.csv', space: 'https://www.census.gov/a b.csv', ctl: 'https://www.census.gov/a\u0001.csv', nonascii: 'https://www.census.gov/\u00e9.csv',
    long: 'https://x.example.org/' + 'a'.repeat(2100), ftp: 'ftp://x.example.org/a', data: 'data:text/csv,a,b',
  };
  for (const [k, u] of Object.entries(bad)) {
    const r = await call(A, 'request_download', { url: u, why: 'x' });
    assert.equal(r.isError, true, k);
  }
  assert.equal(spy.requested.length, 0, 'a refused address never reached the data layer (the tool checks it itself, before the database)');
  for (const why of ['', 'x'.repeat(301), 'see https://evil.example', 'save to C:\\Users\\me', '<b>x</b>']) {
    const r = await call(A, 'request_download', { url: URL_OK, why });
    assert.equal(r.isError, true, why);
  }
  for (const folder of ['C:\\Users', '../up', '..', 'a/b', 'x'.repeat(61)]) {
    const r = await call(A, 'request_download', { url: URL_OK, why: 'x', folder });
    assert.equal(r.isError, true, folder);
  }
  assert.equal((await call(A, 'list_my_downloads')).data.downloads.length, 0);
  for (const u of Object.values(bad)) assert.ok(downloadUrlProblem(u), u);
  assert.equal(downloadUrlProblem(URL_OK), null);
});

test('five waiting at once, then the AI is told in words; nobody else is affected', async () => {
  const { A, B, call } = world();
  for (let i = 0; i < 5; i++) assert.ok(!(await call(A, "request_download", { url: `https://www.census.gov/f${i}.csv`, why: "x" })).isError);
  const r = await call(A, 'request_download', { url: URL_OK, why: 'one more' });
  assert.equal(r.isError, true); assert.equal(r.code, 'rate'); assert.match(r.text, /5 download requests waiting/);
  assert.ok(!(await call(B, "request_download", { url: URL_OK, why: "mine" })).isError);              // control: another person has their own allowance
  assert.equal((await call(B, 'list_my_downloads')).data.downloads.length, 1);
});

test('the tools take no file, no path and no owner: unknown arguments are refused', async () => {
  const { A, call } = world();
  for (const extra of [{ path: 'C:\\x' }, { owner: 'u-b' }, { file: 'x.csv' }, { confirm: true }]) {
    const r = await call(A, 'request_download', { url: URL_OK, why: 'x', ...extra });
    assert.equal(r.isError, true, JSON.stringify(extra));
  }
  const r = await call(A, 'list_my_downloads', { owner: 'u-b' });
  assert.equal(r.isError, true);
});
