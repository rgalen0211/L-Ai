// The test bench for 'Ask my AI' end to end (NEXT-CONNECT 145): ONE shared draft (the editor stand-in tests/fake-editor-rpcs.js) with two doors.
//   * the PAGE's door: GET /live, /live.js, /live.css (WEB's real editor page, pinned in tools/maker-live/) and POST /api/live/rpc (the five editor functions), exactly as the desktop maker serves them;
//   * the CONNECTED AI's door: POST /__ai {tool, args} runs the connector's REAL tool (connect-core: the same dispatch, scope gate, argument check and untrusted wrapping an assistant meets) for a person who
//     connected an assistant with the edit scope, against a Data layer whose editor functions read and write that same shared draft.
// Nothing leaves 127.0.0.1. Started by tools/check-ask-my-ai.py:  node tests/ask-my-ai-server.mjs <port> <project id> <token>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { opProblem, LOOK_KEYS } from '../supabase/functions/connect-core/edit_state.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { createEditorRpcs } = createRequire(import.meta.url)('./fake-editor-rpcs.js');
const [port, PROJECT, TOKEN] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const SUMMARY = { schema: 'ryagram.edit-tracks/0', duration: 12, lanes: ['video', 'text'], limits: { text_chars: 60 }, clips: [
  { id: 'v1', track: 'video', start: 0, len: 4, label: 'Beach day', source: 'beach.mp4', source_start: 2, min_len: 0.3, max_len: 20 },
  { id: 'v2', track: 'video', start: 4, len: 3, label: 'Dinner', source: 'dinner.mp4', source_start: 0, min_len: 0.3, max_len: 9 },
  { id: 't1', track: 'text', start: 0.5, len: 3, label: 'Title', text: 'Summer', min_len: 0.5, max_len: 30 }] };

const stand = createEditorRpcs({ check: opProblem, projects: [PROJECT] });
stand.app.post(PROJECT, { mirror: true, aiVisible: true, summary: SUMMARY });           // the person's app mirrored the film and the person ticked "Let my AI see my track list"

// ---- the connected AI's Data layer: the connector's real tools, over the shared draft
const world = new FakeWorld();
const USER = 'u-test', CLIENT = 'client-claude', PRINCIPAL = { tokenHash: 'h-test', userId: USER, clientId: CLIENT };
world.addUser(USER, 'person@example.test', 100);
world.invite(USER, CLIENT, ['read', 'write', 'render_free', 'edit']);
const base = world.data(USER);
const fail = (e) => Object.assign(new Error(e.message), { code: e.code });
const live = (project, mode) => { const t = stand.draft(project, mode).editor_seen_at; return t !== null && Date.now() - t < 120_000; };
const data = {
  ...base,
  editState: async (pid) => {
    const project = pid ?? [['data', PROJECT], ['compilation', PROJECT]].filter(([m, p]) => live(p, m)).map(([, p]) => p)[0] ?? null;
    if (project === null) return { open_editor: false };
    if (project !== PROJECT) return null;
    const dd = stand.draft(PROJECT, 'data'), dc = stand.draft(PROJECT, 'compilation');
    const undone = stand.ops.filter((o) => (o.status === 'undone' || o.status === 'rejected') && o.ended_by === 'person' && o.undone_at !== null && Date.now() - o.undone_at < 600_000);
    return JSON.parse(JSON.stringify({
      project_id: PROJECT, saved_story_sha256: 'a'.repeat(64),
      look_keys: LOOK_KEYS.map((k) => ({ key: k.key, kind: k.kind, choices: k.choices ?? null, min: k.min ?? null, max: k.max ?? null })),
      data: { revision: dd.revision, look: dd.state.look, editor_open: live(PROJECT, 'data') },
      compilation: { revision: dc.revision, shared: dc.ai_visible, tracks: dc.ai_visible ? dc.state : null, pending: stand.ops.filter((o) => o.mode === 'compilation' && o.status === 'pending').length, editor_open: live(PROJECT, 'compilation') },
      recently_undone: undone.map((o) => ({ mode: o.mode, op: o.op, at: new Date(o.undone_at).toISOString() })),
    }));
  },
  editOps: async (pid, mode, baseRevision, ops) => {
    const r = stand.ai.apply(pid, mode, baseRevision, ops, 'Claude');
    if (r.error) throw fail(r.error);
    return r.data;
  },
  editUndoAi: async (pid, mode) => { const r = stand.ai.undoLast(pid, mode); if (r.error) throw fail(r.error); return r.data; },
};
// the person's projects: the stand-in knows the project; the world needs it to exist for the tools' ownership check
world.users.get(USER).projects.push({ id: PROJECT, title: 'Summer film', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
world.users.get(USER).versions.push({ id: '00000000-0000-4000-8000-0000000000f1', project_id: PROJECT, number: 1, state: 'draft', story_spec: {}, story_sha256: 'a'.repeat(64) });
const compile = makeCompile(Ajv2020);
const env = { data, policy: world.policy(), deps: { compile } };

const FILES = { '/live': ['live.html', 'text/html; charset=utf-8'], '/live.js': ['live.js', 'text/javascript; charset=utf-8'], '/live.css': ['live.css', 'text/css; charset=utf-8'] };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
  try {
    if (req.method === 'GET' && FILES[u.pathname]) return send(200, fs.readFileSync(path.join(here, '..', 'tools', 'maker-live', FILES[u.pathname][0])), FILES[u.pathname][1]);
    if (u.pathname === '/api/live/frame' || u.pathname === '/api/live/text-rules') return send(404, { error: 'not here' });
    if (req.method === 'POST' && u.pathname === '/api/live/rpc') {
      if (req.headers['x-maker-token'] !== TOKEN) return send(403, { error: 'no' });
      const b = JSON.parse(await body(req));
      if (!stand.rpcs[b.name]) return send(200, { data: null, error: { code: '22023', message: 'That call is not one the editor makes.' } });
      return send(200, stand.rpcs[b.name](b.args));
    }
    if (req.method === 'POST' && u.pathname === '/__ai') {
      const b = JSON.parse(await body(req));
      return send(200, await callTool(b.tool, b.args ?? {}, PRINCIPAL, env));
    }
    if (u.pathname === '/__state') return send(200, { revision: stand.draft(PROJECT, 'compilation').revision, state: stand.draft(PROJECT, 'compilation').state, ops: stand.ops });
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: String(e && e.message) }); }
}).listen(port, '127.0.0.1', () => console.log('ready'));
