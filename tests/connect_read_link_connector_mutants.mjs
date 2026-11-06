// Must-fail proof for tests/connect-read-link-connector.test.mjs (open_editor's signed read link): each mutant breaks ONE rule in a scratch copy of the connector code and the suites must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_read_link_connector_mutants.mjs   (exit 0 only when every mutant is caught)
// Not mutated, because they fail closed by themselves (an exception inside bundleLink is caught and means "no link"): a missing secret, a missing address or a missing owner hash all end in the same "no link".
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-rlconn');
const C = 'supabase/functions/connect-core/';
const E = C + 'editor_tools.ts', M = C + 'mcp.ts', F = C + 'fake.ts';
const SUITES = ['connect-read-link-connector.test.mjs', 'connect-chat-editor-server.test.mjs'];
const TAIL = 'return { url: base.replace(/[/]+$/, "") + "/" + token, expires_at };\n  } catch { return null; }';
const mutants = [
  ['a clip film gets a link too', [[E, 'const link = mode === "data" ? await bundleLink(ctx, id) : null;', 'const link = await bundleLink(ctx, id);']]],
  ['the link is put in the words the model reads', [[E, 'return link ? { ...opened, meta: { "ryagram/editor_bundle": link } } : opened;', 'return link ? { ...opened, text: opened.text + " " + link.url, meta: { "ryagram/editor_bundle": link } } : opened;']]],
  ['the link is put in the data the model may read', [[E, 'return link ? { ...opened, meta: { "ryagram/editor_bundle": link } } : opened;', 'return link ? { ...opened, data: { ...opened.data, link }, meta: { "ryagram/editor_bundle": link } } : opened;']]],
  ['a failing mint fails the whole call', [[E, TAIL, 'return { url: base.replace(/[/]+$/, "") + "/" + token, expires_at };\n  } catch (e) { throw e; }']]],
  ['every link carries the same id', [[E, 'jti: cfg.jti() }', 'jti: "jti-the-same-0001" }']]],
  ['the link is made at the wrong time', [[E, 'now: cfg.now(), jti', 'now: 0, jti']]],
  ['the result never reaches the app view', [[M, '      if (r.meta) result._meta = r.meta;\n', '']]],
  ['every answer carries a _meta', [[M, 'if (r.meta) result._meta = r.meta;', 'result._meta = r.meta ?? { x: 1 };']]],
  ['the link names someone else as the owner', [[F, '? await ownerHash(userId) : null', '? await ownerHash("someone-else") : null']]],
  ['the link is made without asking the database for the owner', [[E, 'const hash = await owner.call(ctx.data, projectId);', 'const hash = "0123456789abcdef0123456789abcdef";']]],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
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
  for (const [file, from, to] of edits) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; broken = true; break; }
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
