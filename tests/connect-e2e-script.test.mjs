// The one-command connector check (NEXT-CONNECT 167, tools/connect-e2e.mjs): it must PASS on the real code, and each step must FAIL when the connector misbehaves in the way that step guards against.
// The misbehaviour is made by a tamper hook on the stand-in server (what it answers), so no connector code is changed. Everything runs on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRig, run, steps, parseArgs, client } from '../tools/connect-e2e.mjs';

const quiet = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

async function go({ tamper = null, other = true } = {}) {
  const rig = await localRig({ tamper });
  const q = quiet();
  try {
    const out = await run({ url: rig.url, token: rig.tokenA, tokenOther: other ? rig.tokenB : null, expectedTools: rig.expectedTools, goodStory: rig.goodStory, datasetId: rig.datasetId, local: true, log: q.log });
    assert.deepEqual(rig.serverErrors, [], 'the stand-in server itself failed (a fault was made wrongly, so a FAIL below would prove nothing)');
    return { ...out, lines: q.lines, rig };
  } finally { await rig.close(); }
}
const failed = (out) => out.results.filter((r) => r.status === 'FAIL').map((r) => r.name);
const json = (o, status = 200, headers = { 'content-type': 'application/json' }) => ({ status, headers, body: JSON.stringify(o) });
const rewrite = (out, fn) => { const j = JSON.parse(out.body); if (!j.result) return out; fn(j); return { ...out, body: JSON.stringify(j) }; };      // only a real result is rewritten (a 401 or an error is left alone)

test('on the real code every step passes (none skipped, none failed)', async () => {
  const out = await go();
  assert.deepEqual(failed(out), []);
  assert.equal(out.results.length, steps({ expectedTools: out.rig.expectedTools }).length);
  assert.ok(out.results.length >= 20, 'the first 20 steps are always there');
  assert.ok(out.results.every((r) => r.status === 'PASS'), out.lines.join('\n'));
  assert.match(out.lines.at(-1), new RegExp(`${out.results.length} passed, 0 failed, 0 skipped`));
});

test('without a second account the step that needs one is SKIPPED, not passed', async () => {
  const out = await go({ other: false });
  assert.deepEqual(failed(out), []);
  assert.deepEqual(out.results.filter((r) => r.status === 'SKIP').map((r) => r.name), ["refusal: another person's project (the stand-in has two people)"]);
});

test('MUST-FAIL: a 401 with no pointer to the sign-in page', async () => {
  const out = await go({ tamper: async (_r, o) => (o.status === 401 ? { ...o, headers: Object.fromEntries(Object.entries(o.headers).filter(([k]) => k !== 'www-authenticate')) } : o) });
  assert.ok(failed(out).includes('no token: the connector answers 401 and says where to sign in'));
});

test('MUST-FAIL: a wrong token that is let in', async () => {
  const out = await go({ tamper: async ({ token }, o) => (token === 'not-a-real-token' ? json({ jsonrpc: '2.0', id: 1, result: { tools: [] } }) : o) });
  assert.ok(failed(out).includes('a wrong token is refused as invalid_token'));
});

test('MUST-FAIL: the tool list lists the full-render tool, or loses a tool, or a hint', async () => {
  const name = 'tools/list: the tools this checkout lists, with titles and honest hints, and no full-render tool';
  let out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/list' ? rewrite(o, (j) => j.result.tools.push({ ...j.result.tools[0], name: 'request_full_render' })) : o) });
  assert.ok(failed(out).includes(name), 'full render listed');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/list' ? rewrite(o, (j) => { j.result.tools = j.result.tools.filter((t) => t.name !== 'set_story'); }) : o) });
  assert.ok(failed(out).includes(name), 'set_story lost');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/list' ? rewrite(o, (j) => { delete j.result.tools[0].annotations.readOnlyHint; }) : o) });
  assert.ok(failed(out).includes(name), 'a hint lost');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/list' ? rewrite(o, (j) => { j.result.tools[0].annotations.readOnlyHint = true; j.result.tools[0].annotations.destructiveHint = true; }) : o) });
  assert.ok(failed(out).includes(name), 'read-only and destructive at once');
});

test('MUST-FAIL: initialize that names another server, or offers resources', async () => {
  const name = 'initialize: the server names itself and keeps to tools';
  let out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'initialize' ? rewrite(o, (j) => { j.result.serverInfo.name = 'other'; }) : o) });
  assert.ok(failed(out).includes(name));
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'initialize' ? rewrite(o, (j) => { j.result.capabilities.resources = {}; }) : o) });
  assert.ok(failed(out).includes(name));
});

test('MUST-FAIL: create_project that makes a second project for the same title', async () => {
  let n = 0;
  const out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'create_project' && ++n === 2 ? rewrite(o, (j) => { j.result.structuredContent.project_id = '11111111-1111-4111-8111-111111111111'; }) : o) });
  assert.ok(failed(out).includes('create_project: a project; asking again with the same title returns the same one'));
});

test('MUST-FAIL: a wrong story is accepted', async () => {
  const out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'set_story' && sent.params.arguments.story?.not ? json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Saved the story as the working version.' }], isError: false, structuredContent: { ok: true } } }) : o) });
  assert.ok(failed(out).includes('set_story with a story that breaks the rules: refused, with the checks named, nothing saved'));
});

test('MUST-FAIL: the good story is refused', async () => {
  const out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'set_story' && !sent.params.arguments.story?.not ? json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Nothing was saved. 3 checks failed.' }], isError: true } }) : o) });
  assert.ok(failed(out).includes('set_story with a good story: saved'));
});

test('MUST-FAIL: the contact sheet is not free, a job that fails, a job that never moves', async () => {
  let out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'make_contact_sheet' && !JSON.parse(o.body).result.isError ? rewrite(o, (j) => { j.result.content[0].text = 'Queued. This costs 5 credits.'; }) : o) });
  assert.ok(failed(out).includes('make_contact_sheet: queued (free), then finished'), 'not free');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'job_status' ? rewrite(o, (j) => { j.result.structuredContent = { state: 'failed' }; }) : o) });
  assert.ok(failed(out).includes('make_contact_sheet: queued (free), then finished'), 'failed job');
});

test('MUST-FAIL: no links after the previews', async () => {
  const out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'get_film_link' && !JSON.parse(o.body).result.isError ? rewrite(o, (j) => { j.result.structuredContent = { links: [] }; }) : o) });
  assert.ok(failed(out).includes('get_film_link: the links to the sheet and the preview'));
});

test('MUST-FAIL: a full render starts; a confirm argument pushes a cost through; an 11-second preview is made', async () => {
  const ok = (extra = {}) => json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Started. A long enough sentence that says something.' }], isError: false, structuredContent: { started: true, job_id: '00000000-0000-4000-8000-0000000000aa', ...extra } } });
  let out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'request_full_render' ? ok() : o) });
  assert.ok(failed(out).includes('refusal: a final render cannot be asked for over the connector'), 'full render');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'make_preview' && sent.params.arguments.confirm === true ? ok() : o) });
  assert.ok(failed(out).includes('refusal: credits cannot be spent (a cost-bearing argument is not accepted)'), 'confirm');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'make_preview' && sent.params.arguments.end_seconds === 11 ? ok() : o) });
  assert.ok(failed(out).includes('refusal: a preview longer than 10 seconds'), '11 seconds');
});

test('MUST-FAIL: a project of nobody is accepted, another person reads the first person\'s project, an internal message leaks', async () => {
  let out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'make_contact_sheet' && sent.params.arguments.project_id && !sent.params.arguments.project_id.startsWith('00000000') && JSON.parse(o.body).result.isError ? rewrite(o, (j) => { j.result.isError = false; }) : o) });
  assert.ok(failed(out).includes("refusal: a project that is not this person's"), 'nobody');
  out = await go({ tamper: async ({ sent, token }, o) => (token === 'E2E-TOKEN-BOB' && sent?.method === 'tools/call' ? json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'links' }], isError: false, structuredContent: { links: [] } } }) : o) });
  assert.ok(failed(out).includes("refusal: another person's project (the stand-in has two people)"), 'other person');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'make_contact_sheet' && JSON.parse(o.body).result.isError ? rewrite(o, (j) => { j.result.content[0].text = 'error: relation "projects" does not exist (postgres)'; }) : o) });
  assert.ok(failed(out).includes("refusal: a project that is not this person's"), 'leak');
});

test('MUST-FAIL: bad JSON answered with a server error, an unknown tool accepted', async () => {
  let out = await go({ tamper: async ({ sent }, o) => (sent === null && o.status < 500 ? { status: 500, headers: { 'content-type': 'text/plain' }, body: 'boom' } : o) });
  assert.ok(failed(out).includes('refusal: an unknown tool and a bad request'), 'bad json');
  out = await go({ tamper: async ({ sent }, o) => (sent?.method === 'tools/call' && sent.params.name === 'no_such_tool' ? json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }], isError: false } }) : o) });
  assert.ok(failed(out).includes('refusal: an unknown tool and a bad request'), 'unknown tool');
});

test('the live way of running: a token from the environment, a loopback http address, no second account; the token is never printed', async () => {
  const rig = await localRig();
  const q = quiet();
  try {
    const a = parseArgs(['--url', rig.url, '--token-env', 'E2E_TEST_TOKEN', '--wait', '5'], { E2E_TEST_TOKEN: rig.tokenA });
    assert.equal(a.token, rig.tokenA);
    const out = await run({ url: a.url, token: a.token, expectedTools: rig.expectedTools, goodStory: rig.goodStory, datasetId: rig.datasetId, local: false, waitMs: a.wait * 1000, log: q.log });
    assert.deepEqual(failed(out), []);
    assert.equal(out.results.filter((r) => r.status === 'SKIP').length, 1);
    assert.ok(!q.lines.join('\n').includes(rig.tokenA), 'the token appears in the output');
  } finally { await rig.close(); }
});

test('the command line refuses what could leak a token or hit the wrong place', () => {
  const env = { T: 'x'.repeat(20), EMPTY: '' };
  assert.throws(() => parseArgs(['--token', 'abc']), /Do not put a token on the command line/);
  assert.throws(() => parseArgs(['--url', 'http://example.com/mcp', '--token-env', 'T'], env), /https/);
  assert.throws(() => parseArgs(['--url', 'ftp://example.com/mcp', '--token-env', 'T'], env), /https/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/mcp'], env), /--token-env/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/mcp', '--token-env', 'EMPTY'], env), /empty or not set/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/mcp', '--token-env', 'NOPE'], env), /empty or not set/);
  assert.throws(() => parseArgs(['--url', 'not a url', '--token-env', 'T'], env), /not an address/);
  assert.throws(() => parseArgs(['--token-env', 'T'], env), /only for --url/);
  assert.throws(() => parseArgs(['--wait', '99999']), /--wait/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.equal(parseArgs(['--url', 'https://example.com/mcp', '--token-env', 'T'], env).url, 'https://example.com/mcp');
  assert.equal(parseArgs(['--url', 'http://127.0.0.1:9/mcp', '--token-env', 'T'], env).url, 'http://127.0.0.1:9/mcp', 'loopback http is allowed (the local copy)');
  assert.equal(parseArgs([]).url, '');
});

test('the client sends the token only in the Authorization header', async () => {
  const seen = [];
  const rig = await localRig({ tamper: async ({ sent, token }, o) => { seen.push({ sent: JSON.stringify(sent), token }); return o; } });
  try {
    await client(rig.url, rig.tokenA).tool('whoami_and_credits');
    assert.ok(seen.length && seen.every((s) => s.token === rig.tokenA && !s.sent.includes(rig.tokenA)));
  } finally { await rig.close(); }
});
