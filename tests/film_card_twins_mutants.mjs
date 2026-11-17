// Must-fail proof for tests/film-card-twins.test.mjs (CONNECT, 2026-11-17): each mutant breaks ONE rule in ONE twin of the site's / the connector's film look card functions, in a scratch copy, and the twin test has to FAIL.
// Rules: the unbroken copy passes FIRST; each text occurs exactly once in its file; a mutant counts as caught only when the test itself reports a failure (a crash of the runner is "ran badly", not a catch).
// Run from the repo root:  node tests/film_card_twins_mutants.mjs   (exit 0 only when every mutant is caught). ONE runner at a time in a tree; the scratch folder .mut-twins is removed at the end.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const scratch = path.join(root, '.mut-twins');
const SITE = 'supabase/migrations/20261113000500_my_film_cards.sql';
const CONN = 'supabase/migrations/20261109000100_film_cards.sql';

const mutants = [
  // the limits and the retry rule, one twin at a time
  ['the site ask lets six pictures wait', SITE, 'if waiting >= 5 then', 'if waiting >= 6 then'],
  ['the connector ask lets four pictures wait', CONN, 'if waiting >= 5 then', 'if waiting >= 4 then'],
  ['the site ask allows 101 pictures a day', SITE, 'if today >= 100 then', 'if today >= 101 then'],
  ['the connector ask allows 99 pictures a day', CONN, 'if today >= 100 then', 'if today >= 99 then'],
  ['the site ask retries after five minutes', SITE, "same.finished_at < now() - interval '10 minutes'", "same.finished_at < now() - interval '5 minutes'"],
  ['the connector ask retries after an hour', CONN, "same.finished_at < now() - interval '10 minutes'", "same.finished_at < now() - interval '1 hour'"],
  // the lock: the same key, or a chat ask and a site ask at the same instant stop being counted one after the other
  ['the site ask takes its own lock key', SITE, "hashtextextended('film_card:' || me::text, 0)", "hashtextextended('site_card:' || me::text, 0)"],
  ['the connector ask takes its own lock key', CONN, "hashtextextended('film_card:' || me::text, 0)", "hashtextextended('chat_card:' || me::text, 0)"],
  // whose film: the ask must never reach another person's film or an archived one
  ['the site ask takes another person\'s film', SITE, "where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then\n    raise exception", "where ver.project_id = p_project and p.archived_at is null order by ver.number desc limit 1;\n  if not found then\n    raise exception"],
  ['the connector read shows another person\'s film', CONN, "where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then return null; end if;", "where ver.project_id = p_project and p.archived_at is null order by ver.number desc limit 1;\n  if not found then return null; end if;"],
  // the answer's columns
  ['the site read no longer says a card is stale', SITE, "'stale', ok.story_sha256 <> cur,", "'stale', false,"],
  ['the connector read renames the built story column', CONN, "'built_sha256', ok.story_sha256", "'built_sha', ok.story_sha256"],
  ['the site read drops the failure words', SITE, "'fail_detail', r.fail_detail, ", ''],
  ['the connector read forgets how long it waited', CONN, "'waited_s', floor(extract(epoch from (ok.finished_at - ok.asked_at)))::int);", "'waited_s', 0);"],
  // who the person is, and what the caller may type
  ['the site ask reads the person from a token', SITE, `me uuid := ryagram_private.require_signed_in();\n  v public.versions;`, `me uuid := ryagram_private.connect_actor(p_token_hash, 'read');\n  v public.versions;`],
  ['the connector ask takes the person from the session', CONN, `me uuid := ryagram_private.connect_actor(p_token_hash, 'read');\n  v public.versions;`, `me uuid := ryagram_private.require_signed_in();\n  v public.versions;`],
  ['the connector read takes the person from the session', CONN, `me uuid := ryagram_private.connect_actor(p_token_hash, 'read');\n  cur text;`, `me uuid := ryagram_private.require_signed_in();\n  cur text;`],
  ['the site ask lets the caller type the story', SITE, 'create function public.my_film_card_ask(p_project uuid) returns jsonb', 'create function public.my_film_card_ask(p_project uuid, p_story text) returns jsonb'],
];

function run(cwd) {
  const r = spawnSync(process.execPath, ['--test', path.join('tests', 'film-card-twins.test.mjs')], { encoding: 'utf8', cwd });
  const out = r.stdout + r.stderr;
  return { status: r.status, failed: /^ℹ fail [1-9]/m.test(out), ranOk: /^ℹ tests \d+/m.test(out), out };
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'migrations'), path.join(scratch, 'supabase', 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', 'film-card-twins.test.mjs'), path.join(scratch, 'tests', 'film-card-twins.test.mjs'));
}

fresh();
const base = run(scratch);
if (base.status !== 0 || base.failed || !base.ranOk) { console.log('BASELINE FAILS: the unbroken copy does not pass, so no mutant means anything\n' + base.out.slice(-600)); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
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
  const caught = r.status !== 0 && r.failed;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}${caught || r.ranOk ? '' : ' (the runner crashed: ran badly)'}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) NOT caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
