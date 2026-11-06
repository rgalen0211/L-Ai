// Every Python page check serves on its OWN port (CC1 11-06 15:33): on Windows a second server can bind the same fixed port at once (address reuse), and then a page is served its files by whichever
// server answers, a dead one or ANOTHER session's tree: 0 to 335 findings on one head on a busy PC, and a "pass" that may have tested someone else's pages. So: no server in tools/ or tests/ binds a
// fixed port, none sets allow_reuse_address = True, and nobody hands aa.serve() a port. (desktop_maker.py sets allow_reuse_address = False on purpose: a busy port must be an error there.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// returns the problems found in one Python source text
export function problems(src) {
  const out = [];
  if (/allow_reuse_address\s*=\s*True/.test(src)) out.push('allow_reuse_address = True');
  for (const m of src.matchAll(/(?:TCPServer|HTTPServer)\(\s*\(\s*['"][^'"]+['"]\s*,\s*([^)\n]+?)\s*\)/g)) {
    if (m[1] !== '0') out.push(`a server bound to port ${m[1]}, not 0`);
  }
  if (/\baa\.serve\(\s*[^)\s]/.test(src)) out.push('aa.serve() given an argument');
  return out;
}

function pyFiles(dir) {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__pycache__' && e.name !== 'node_modules') found.push(...pyFiles(p)); }
    else if (e.name.endsWith('.py')) found.push(p);
  }
  return found;
}

test('no Python server in tools/ or tests/ binds a fixed port or turns address reuse on', () => {
  const bad = [];
  for (const dir of ['tools', 'tests']) {
    if (!fs.existsSync(path.join(root, dir))) continue;
    for (const f of pyFiles(path.join(root, dir))) {
      const p = problems(fs.readFileSync(f, 'utf8'));
      if (p.length) bad.push(`${path.relative(root, f)}: ${p.join('; ')}`);
    }
  }
  assert.deepEqual(bad, [], 'give the server port 0 and read srv.server_address[1]:\n' + bad.join('\n'));
});

test('MUST-FAIL: the scanner really catches each of the old patterns, and passes the new one', () => {
  assert.deepEqual(problems("srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)"), ['a server bound to port PORT, not 0']);
  assert.deepEqual(problems("srv = socketserver.ThreadingTCPServer((\"127.0.0.1\", 8185), H)"), ['a server bound to port 8185, not 0']);
  assert.deepEqual(problems("socketserver.TCPServer.allow_reuse_address = True"), ['allow_reuse_address = True']);
  assert.deepEqual(problems("Quiet.allow_reuse_address = True"), ['allow_reuse_address = True']);
  assert.deepEqual(problems("srv = aa.serve(8190)"), ['aa.serve() given an argument']);
  assert.deepEqual(problems("srv = ThreadingHTTPServer(('127.0.0.1', port), H)"), ['a server bound to port port, not 0']);
  assert.deepEqual(problems("srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)\nsrv = aa.serve()\nallow_reuse_address = False"), []);
});
