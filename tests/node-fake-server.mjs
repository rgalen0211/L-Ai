// A TEST-ONLY HTTP server around the REAL `node` function logic (supabase/functions/node-core/router.ts) and its in-memory database stand-in (fake.ts), so the
// desktop app (Python) can be tested end to end against the code that will run on Supabase, not against a second copy of the contract.
// Not part of any deploy. Prints one line, "READY <port>", then serves:
//   /node/...            the function (handleNode)
//   /__upload/<path>     the "storage": PUT stores the bytes (a signed address from this server is what the function hands out)
//   /__admin/<what>      POST JSON: user, approve, deny, addjob, jobs, uploads, clock, removeall   (what the person on the website, and the world, would do)
import http from 'node:http';
import crypto from 'node:crypto';
import { handleNode } from '../supabase/functions/node-core/router.ts';
import { FakeNodeWorld } from '../supabase/functions/node-core/fake.ts';

const world = new FakeNodeWorld();
let offset = 0;
world.now = () => Date.now() + offset;
const uploads = [];
let PORT = 0;
const deps = {
  db: world, approvalBase: 'http://127.0.0.1:0/app', salt: 'test-salt', maxFileBytes: 100_000_000,
  storage: { size: async p => { const u = [...uploads].reverse().find(x => x.path === p); return u ? u.bytes : null; }, signUpload: async p => `http://127.0.0.1:${PORT}/__upload/${p}?token=signed-${crypto.randomBytes(6).toString('hex')}` },
};
const readBody = req => new Promise(res => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => res(Buffer.concat(c))); });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = await readBody(req);
  const send = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
  if (u.pathname.startsWith('/__upload/')) {
    if (req.method !== 'PUT' || !u.searchParams.get('token')?.startsWith('signed-')) return send(403, { error: 'no' });
    uploads.push({ path: decodeURIComponent(u.pathname.slice('/__upload/'.length)), bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), type: req.headers['content-type'], auth: req.headers.authorization ?? null });
    return send(200, { ok: true });
  }
  if (u.pathname.startsWith('/__admin/')) {
    const what = u.pathname.slice('/__admin/'.length), b = body.length ? JSON.parse(body.toString()) : {};
    if (what === 'user') { world.addUser(b.id, b.email, !!b.local_compute, !!b.worker); return send(200, { ok: true }); }
    if (what === 'approve') return send(200, { ok: world.approve(b.user_code, b.owner) });
    if (what === 'deny') return send(200, { ok: world.deny(b.user_code) });
    if (what === 'addjob') { world.addJob(b); return send(200, { ok: true }); }
    if (what === 'jobs') return send(200, [...world.jobs.values()].map(j => ({ id: j.id, state: j.state, owner_id: j.owner_id, run_on: j.run_on })));
    if (what === 'uploads') return send(200, uploads);
    if (what === 'clock') { offset = b.offset_ms; return send(200, { ok: true }); }
    if (what === 'removeall') { world.removeAll(); return send(200, { ok: true }); }
    if (what === 'calls') return send(200, world.calls);
    return send(404, { error: 'no' });
  }
  const m = /^\/node(\/.*)?$/.exec(u.pathname);
  if (!m) return send(404, { error: 'not_found' });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const r = await handleNode(new Request(u.href, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), m[1] ?? '/', { ...deps, approvalBase: `http://127.0.0.1:${PORT}/app` });
  const out = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
  res.end(out);
});
srv.listen(0, '127.0.0.1', () => { PORT = srv.address().port; console.log(`READY ${PORT}`); });
