// The connector end to end, one command (NEXT-CONNECT 167): walks the ChatGPT punch-list flow over the real MCP wire (JSON-RPC over HTTP) and prints PASS or FAIL for each step.
//
//   node tools/connect-e2e.mjs                       the LOCAL copy: the real router and tools in this checkout, on an in-memory stand-in for the database and the render worker, on 127.0.0.1.
//                                                    Nothing leaves this computer. This is what the tests run.
//   node tools/connect-e2e.mjs --url https://<host>/functions/v1/connect/mcp --token-env RYAGRAM_E2E_TOKEN [--wait 120]
//                                                    the LIVE connector, with a bearer token of a TEST account kept in that environment variable (never typed on the command line, never printed).
//                                                    Ryan or CC1 runs this; CONNECT does not (a live call is a Ryan row). Steps that need the stand-in (a second person, a forced failure) are skipped and said so;
//                                                    jobs are polled for --wait seconds (default 120) and reported "still waiting" rather than failed. It makes a project named "E2E check <date>" on that account.
//   node tools/connect-e2e.mjs --list                the step names only
//
// A step is PASS, FAIL (with the reason in plain words) or SKIP (with why). Exit code 0 only when nothing FAILED. The token is only ever sent in the Authorization header of requests to --url.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const EXPECTED_TOOLS_NOTE = 'the list is compared with the tools this checkout lists (supabase/functions/connect-core/mcp.ts toolList), so a deployed connector that is behind the code fails the step';

// ------------------------------------------------------------------------------------------------ the wire
export function client(url, token) {
  let id = 0;
  const post = async (body, { auth = true } = {}) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  };
  const rpc = async (method, params) => (await post({ jsonrpc: '2.0', id: ++id, method, params })).json;
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (r?.error) return { rpcError: r.error.message, isError: true, text: r.error.message, data: null };
    const res = r?.result ?? {};
    return { isError: !!res.isError, text: (res.content ?? []).map((c) => c.text ?? '').join('\n'), data: res.structuredContent ?? null };
  };
  return { post, rpc, tool };
}

// ------------------------------------------------------------------------------------------------ the steps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, why) => { if (!ok) throw new Error(why); };
const skip = (why) => { const e = new Error(why); e.skip = true; throw e; };

async function untilDone(c, jobId, ctx) {
  const deadline = Date.now() + ctx.waitMs;
  let last = null;
  for (let i = 0; ; i++) {
    last = await c.tool('job_status', { job_id: jobId });
    need(!last.isError, `job_status failed: ${last.text.slice(0, 160)}`);
    const state = last.data?.state;
    if (state === 'complete') return last;
    need(!['failed', 'cancelled'].includes(state), `the job ended as ${state}: ${last.text.slice(0, 160)}`);
    if (Date.now() > deadline) { const e = new Error(`still ${state} after ${Math.round(ctx.waitMs / 1000)} s (not a failure: run again with a longer --wait)`); e.skip = true; throw e; }
    if (ctx.local) continue; else await sleep(Math.min(15000, 2000 * (i + 1)));       // the stand-in moves one step per look; a real job is polled gently (the tool asks for 15 s)
  }
}

// Tools newer than the first punch list. A step exists only for a tool THIS checkout lists (ctx.expectedTools), so the same command works on an older tree and on the combined one; a deployed connector that
// lacks one of them already FAILS the tools/list step above, and these steps then say what that tool answers. Run against a live connector they are the post-deploy checks of NEXT-CONNECT 155.
function optionalSteps(ctx) {
  const has = (n) => (ctx.expectedTools ?? []).includes(n);
  const scopeWords = /not allowed to do that|can change what this connection may do/i;
  const out = [];
  if (has('get_story')) out.push(['get_story: the saved story and its list of versions come back', async (c) => {
    need(ctx.project, 'no project (an earlier step failed)');
    const r = await c.tool('get_story', { project_id: ctx.project });
    need(!r.isError, `refused: ${r.text.slice(0, 200)}`);
    need(r.data && (r.data.story || r.data.version_number != null || Array.isArray(r.data.versions)), 'the answer holds no story and no version list');
  }]);
  if (has('dataset_info')) out.push(['dataset_info: what a catalogue dataset is, from the engine record', async (c) => {
    need(ctx.datasetId, 'no dataset id to ask about');
    const r = await c.tool('dataset_info', { dataset_id: ctx.datasetId });
    need(!r.isError && r.text.length > 100, `refused or empty: ${r.text.slice(0, 200)}`);
    const bad = await c.tool('dataset_info', { dataset_id: 'no_such_dataset_zz' });
    need(bad.isError || /not|unknown|no dataset/i.test(bad.text), 'an unknown dataset was described');
  }]);
  if (has('suggest_next_step')) out.push(['suggest_next_step: the one next question, from what the person already said', async (c) => {
    const r = await c.tool('suggest_next_step', { kind: 'data_film', scale: 'county' });
    need(!r.isError && r.text.length > 20, `refused or empty: ${r.text.slice(0, 200)}`);
  }]);
  if (has('get_cost_estimate')) out.push(['get_cost_estimate: what a step costs and what is left, and nothing is started', async (c) => {
    need(ctx.project, 'no project (an earlier step failed)');
    const before = await c.tool('whoami_and_credits');
    const r = await c.tool('get_cost_estimate', { project_id: ctx.project, step: 'final_render' });
    need(!r.isError && r.data?.started === false && r.data?.connection_can_start === false && typeof r.data?.credits === 'number', `unexpected answer: ${r.text.slice(0, 200)}`);
    const sheet = await c.tool('get_cost_estimate', { project_id: ctx.project, step: 'contact_sheet' });
    need(!sheet.isError && sheet.data?.credits === 0, 'the contact sheet is not priced as free');
    const after = await c.tool('whoami_and_credits');
    need(before.text === after.text, 'asking for an estimate changed the account');
  }]);
  if (has('get_edit_state')) out.push(['get_edit_state: the open editor, or a refusal in words when the connection may not edit', async (c) => {
    need(ctx.project, 'no project (an earlier step failed)');
    const r = await c.tool('get_edit_state', { project_id: ctx.project });
    need(!r.isError || scopeWords.test(r.text) || /editor|open|draft/i.test(r.text), `an unclear answer: ${r.text.slice(0, 200)}`);
  }]);
  if (has('list_my_downloads')) out.push(['list_my_downloads: the download plans, or a refusal in words when the connection may not fetch', async (c) => {
    const r = await c.tool('list_my_downloads');
    need(!r.isError || scopeWords.test(r.text), `an unclear answer: ${r.text.slice(0, 200)}`);
  }]);
  return out;
}

export function steps(ctx) {
  return [
    ['no token: the connector answers 401 and says where to sign in', async (c) => {
      const r = await c.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { auth: false });
      need(r.status === 401, `expected 401 without a token, got ${r.status}`);
      need(/resource_metadata="https?:\/\//.test(r.headers.get('www-authenticate') ?? ''), 'the 401 has no WWW-Authenticate resource_metadata pointer (assistants find the sign-in page through it)');
    }],
    ['a wrong token is refused as invalid_token', async (c) => {
      const r = await client(ctx.url, 'not-a-real-token').post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      need(r.status === 401, `expected 401 for a wrong token, got ${r.status}`);
      need(/invalid_token/.test(r.headers.get('www-authenticate') ?? ''), 'the 401 for a wrong token does not say invalid_token');
    }],
    ['initialize: the server names itself and keeps to tools', async (c) => {
      const r = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
      need(r?.result?.serverInfo?.name === 'ryagram', `serverInfo.name is ${JSON.stringify(r?.result?.serverInfo?.name)}`);
      need(r.result.capabilities?.tools && !r.result.capabilities.resources && !r.result.capabilities.prompts, 'the server should offer tools only');
      need(typeof r.result.instructions === 'string' && r.result.instructions.length > 100, 'no usage instructions came back');
    }],
    ['tools/list: the tools this checkout lists, with titles and honest hints, and no full-render tool', async (c) => {
      const r = await c.rpc('tools/list', {});
      const got = r?.result?.tools ?? [];
      need(got.length > 0, 'no tools came back');
      const want = ctx.expectedTools;
      const names = got.map((t) => t.name).sort();
      const missing = want.filter((n) => !names.includes(n)), extra = names.filter((n) => !want.includes(n));
      need(!missing.length && !extra.length, `this connector's tool list differs from the code in this checkout (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
      need(!names.includes('request_full_render'), 'request_full_render is listed (a directory reviewer would reject an always-refusing tool)');
      for (const t of got) {
        need(t.title && t.annotations && ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].every((h) => typeof t.annotations[h] === 'boolean'), `${t.name} lacks a title or one of the four hints`);
        need(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), `${t.name} is read-only and destructive at once`);
      }
      ctx.listed = names;
    }],
    ['whoami_and_credits: who this connection is and its credits', async (c) => {
      const r = await c.tool('whoami_and_credits');
      need(!r.isError, `refused: ${r.text.slice(0, 160)}`);
      need(/credit/i.test(r.text), 'the answer does not mention credits');
      ctx.credits = r.text;
    }],
    ['get_story_schema: the story format and the catalogue', async (c) => {
      const r = await c.tool('get_story_schema');
      need(!r.isError && r.text.length > 200, `refused or empty: ${r.text.slice(0, 160)}`);
    }],
    ['create_project: a project; asking again with the same title returns the same one', async (c) => {
      const title = ctx.title;
      const a = await c.tool('create_project', { title });
      need(!a.isError && a.data?.project_id, `no project came back: ${a.text.slice(0, 160)}`);
      const b = await c.tool('create_project', { title });
      need(b.data?.project_id === a.data.project_id, 'the same title made a second project (not idempotent)');
      ctx.project = a.data.project_id;
    }],
    ['list_projects: the new project is in the list', async (c) => {
      need(ctx.project, 'no project (the step before failed)');
      const r = await c.tool('list_projects');
      need(!r.isError && JSON.stringify(r.data ?? r.text).includes(ctx.project), 'the new project is not listed');
    }],
    ['set_story with a story that breaks the rules: refused, with the checks named, nothing saved', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('set_story', { project_id: ctx.project, story: { not: 'a story' } });
      need(r.isError || r.data?.ok === false, 'a wrong story was accepted');
      need(r.text.length > 30, 'the refusal says nothing in words');
    }],
    ['set_story with a good story: saved', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('set_story', { project_id: ctx.project, story: ctx.goodStory() });
      need(!r.isError && r.data?.ok !== false, `the good story was refused: ${r.text.slice(0, 200)}`);
    }],
    ['make_contact_sheet: queued (free), then finished', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('make_contact_sheet', { project_id: ctx.project });
      need(!r.isError && r.data?.started === true && r.data?.job_id, `not queued: ${r.text.slice(0, 200)}`);
      need(/free/i.test(r.text), 'the answer does not say it is free');
      ctx.sheetJob = r.data.job_id;
      await untilDone(c, ctx.sheetJob, ctx);
    }],
    ['make_preview: queued, then finished', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('make_preview', { project_id: ctx.project });
      need(!r.isError && r.data?.started === true && r.data?.job_id, `not queued: ${r.text.slice(0, 200)}`);
      await untilDone(c, r.data.job_id, ctx);
    }],
    ['get_film_link: the links to the sheet and the preview', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('get_film_link', { project_id: ctx.project });
      need(!r.isError && Array.isArray(r.data?.links) && r.data.links.length >= 1, `no links: ${r.text.slice(0, 200)}`);
      for (const l of r.data.links) need(!l.url || /^https?:\/\//.test(l.url), 'a link is not an http(s) address');
    }],
    ['refusal: a final render cannot be asked for over the connector', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('request_full_render', { project_id: ctx.project });
      need(r.isError || r.data?.started !== true, 'a full render was started');
      need(r.text.length > 20, 'the refusal does not say where the render button is');
    }],
    ['refusal: credits cannot be spent (a cost-bearing argument is not accepted)', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('make_preview', { project_id: ctx.project, confirm: true });
      need(r.isError, 'make_preview accepted a confirm=true argument (a connection must not be able to push a cost through)');
    }],
    ['refusal: a preview longer than 10 seconds', async (c) => {
      need(ctx.project, 'no project (an earlier step failed)');
      const r = await c.tool('make_preview', { project_id: ctx.project, start_seconds: 0, end_seconds: 11 });
      need(r.isError, 'an 11-second preview was accepted');
    }],
    ['refusal: a project that is not this person\'s', async (c) => {
      const r = await c.tool('make_contact_sheet', { project_id: crypto.randomUUID() });                 // a random id: the stand-in numbers its own ids from 1, so a fixed one could be a real project
      need(r.isError, 'a project of nobody was accepted');
      need(!/stack|exception|sql|postgres/i.test(r.text), 'the refusal leaks an internal message');
    }],
    ['refusal: another person\'s project (the stand-in has two people)', async (c) => {
      if (!ctx.other) skip('needs a second account; only the local copy has one');
      const r = await ctx.other.tool('get_film_link', { project_id: ctx.project });
      need(r.isError, "the second person could read the first person's project");
    }],
    ['refusal: an unknown tool and a bad request', async (c) => {
      const u = await c.tool('no_such_tool', {});
      need(u.isError, 'an unknown tool was accepted');
      const p = await c.post('{ this is not json');
      need(p.json?.error && p.status < 500, `bad JSON did not come back as a JSON-RPC error (status ${p.status})`);
    }],
    ...optionalSteps(ctx),
    ['read-only tools change nothing: asking twice gives the same project list', async (c) => {
      const a = await c.tool('list_projects'), b = await c.tool('list_projects');
      need(JSON.stringify(a.data) === JSON.stringify(b.data), 'two reads of the project list differ');
    }],
  ];
}

// ------------------------------------------------------------------------------------------------ the local copy
export async function localRig({ tamper = null } = {}) {                  // tamper: tests only; it changes what the stand-in server answers, to prove that a step FAILS when the connector misbehaves
  const [{ default: Ajv2020 }, { makeCompile }, { FakeWorld }, { handleMcp, toolList }, { build, TEMPLATES }] = await Promise.all([
    import('ajv/dist/2020.js'), import('../supabase/functions/connect-core/ajv_adapter.ts'), import('../supabase/functions/connect-core/fake.ts'),
    import('../supabase/functions/connect-core/mcp.ts'), import('../supabase/functions/_shared/templates.ts')]);
  const serverErrors = [];
  const w = new FakeWorld();
  const A = { tokenHash: 'h-e2e-alice', userId: 'u-e2e-alice', clientId: 'client-e2e' }, B = { tokenHash: 'h-e2e-bob', userId: 'u-e2e-bob', clientId: 'client-e2e' };
  w.addUser(A.userId, 'e2e-alice', 100); w.addUser(B.userId, 'e2e-bob', 100);
  w.invite(A.userId, A.clientId); w.invite(B.userId, B.clientId);
  w.issue('E2E-TOKEN-ALICE', A); w.issue('E2E-TOKEN-BOB', B);
  const deps = { data: null, policy: w.policy(), deps: { compile: makeCompile(Ajv2020) }, verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId), resourceMetadataUrl: 'http://127.0.0.1/.well-known/oauth-protected-resource' };
  const server = http.createServer(async (req, res) => { try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
    const r = await handleMcp(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body }), deps);
    let out = { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()).toString('utf8') };
    if (tamper) {
      let sent = null; try { sent = JSON.parse(body?.toString('utf8') ?? ''); } catch { /* not JSON */ }
      out = (await tamper({ sent, token: (req.headers.authorization ?? '').replace(/^Bearer /, '') }, out)) ?? out;
    }
    delete out.headers['content-length'];
    res.writeHead(out.status, out.headers); res.end(out.body);
  } catch (e) { serverErrors.push(String(e?.message ?? e)); res.writeHead(500, { 'content-type': 'text/plain' }); res.end('stand-in server error: ' + String(e?.message ?? e).slice(0, 200)); } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const t = TEMPLATES[0];
  return { url, serverErrors, datasetId: t.datasets[0], tokenA: 'E2E-TOKEN-ALICE', tokenB: 'E2E-TOKEN-BOB', expectedTools: toolList().map((x) => x.name).sort(), goodStory: () => build(t.id, t.datasets[0], 'E2E headline'), close: () => new Promise((ok) => server.close(ok)) };
}

export async function run({ url, token, tokenOther = null, expectedTools, goodStory, datasetId, local, waitMs = 120000, title = `E2E check ${new Date().toISOString().slice(0, 10)}`, log = console.log }) {
  const ctx = { url, local, waitMs, title, expectedTools, goodStory, datasetId };
  const c = client(url, token);
  if (tokenOther) ctx.other = client(url, tokenOther);
  const results = [];
  for (const [name, fn] of steps(ctx)) {
    let status = 'PASS', why = '';
    try { await fn(c); } catch (e) { if (e.skip) { status = 'SKIP'; why = e.message; } else { status = 'FAIL'; why = e.message; } }
    results.push({ name, status, why });
    log(`${status.padEnd(4)}  ${name}${why ? '\n        ' + why : ''}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  log(`\n${n('PASS')} passed, ${n('FAIL')} failed, ${n('SKIP')} skipped`);
  return { results, failed: n('FAIL') };
}

// ------------------------------------------------------------------------------------------------ the command line
export function parseArgs(argv, env = process.env) {
  const a = { url: '', tokenEnv: '', wait: 120, list: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i] ?? '';
    else if (k === '--token-env') a.tokenEnv = argv[++i] ?? '';
    else if (k === '--wait') a.wait = Number(argv[++i]);
    else if (k === '--list') a.list = true;
    else if (k === '--token') throw new Error('Do not put a token on the command line (it would be kept in the shell history): put it in an environment variable and use --token-env NAME.');
    else throw new Error(`Unknown option ${k}. Options: --url, --token-env, --wait, --list.`);
  }
  if (a.url) {
    let u; try { u = new URL(a.url); } catch { throw new Error('--url is not an address.'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('--url must start with https:// (a token is never sent over plain http except to this computer).');
    if (!a.tokenEnv) throw new Error('--url needs --token-env NAME (the environment variable that holds a TEST account\'s bearer token).');
    a.token = env[a.tokenEnv];
    if (!a.token) throw new Error(`The environment variable ${a.tokenEnv} is empty or not set.`);
  } else if (a.tokenEnv) throw new Error('--token-env is only for --url (the local copy needs no token).');
  if (!Number.isFinite(a.wait) || a.wait < 0 || a.wait > 3600) throw new Error('--wait is a number of seconds, 0 to 3600.');
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (args.list) { const l = await localRig(); await l.close(); for (const [n] of steps({ expectedTools: l.expectedTools })) console.log(n); process.exit(0); }
  let rig = null, out;
  try {
    if (args.url) {
      const rigLive = await localRig();                                   // only to read this checkout's tool list and a good story; its server is closed at once
      await rigLive.close();
      out = await run({ url: args.url, token: args.token, expectedTools: rigLive.expectedTools, goodStory: rigLive.goodStory, datasetId: rigLive.datasetId, local: false, waitMs: args.wait * 1000 });
    } else {
      rig = await localRig();
      out = await run({ url: rig.url, token: rig.tokenA, tokenOther: rig.tokenB, expectedTools: rig.expectedTools, goodStory: rig.goodStory, datasetId: rig.datasetId, local: true });
    }
  } finally { if (rig) await rig.close(); }
  process.exit(out.failed ? 1 : 0);
}
