// Must-fail proof for the games AI host contract checker (tools/games-host-contract.mjs, tested by tests/games-host-contract.test.mjs): each mutant takes ONE rule out of the checker in a scratch copy, and the tests must then FAIL
// (the planted bad case of that rule slips through). A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// Run:  node tests/games_host_contract_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-ghc');
const C = 'tools/games-host-contract.mjs';
const BS = String.fromCharCode(92);
const mutants = [
  ['a missing required tool is accepted', "for (const n of REQUIRED_TOOLS) if (!seen.has(n))", 'for (const n of REQUIRED_TOOLS) if (false)'],
  ['a tool listed twice is accepted', 'if (seen.has(n)) p.push(', 'if (false) p.push('],
  ['a tool that is not a games tool is accepted', '![...REQUIRED_TOOLS, ...OPTIONAL_TOOLS].includes(n)', 'false'],
  ['any tool name is accepted', 'const NAME = /^[a-z][a-z0-9_]{1,63}$/;', 'const NAME = /^.*$/;'],
  ['a tool that waits or watches is accepted', '/poll|wait|watch|stream|subscribe/.test(n)', 'false'],
  ['annotations need not be true or false', "['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].some((k) => typeof a[k] !== 'boolean')", 'false'],
  ['a tool may reach outside the room', 'if (a.openWorldHint !== false)', 'if (false)'],
  ['a reading tool need not be read-only', 'if (READ_ONLY.includes(n) && a.readOnlyHint !== true)', 'if (false)'],
  ['a changing tool may be read-only', 'if (!READ_ONLY.includes(n) && a.readOnlyHint === true)', 'if (false)'],
  ['remove and end_night need not be destructive', 'if (DESTRUCTIVE.includes(n) && a.destructiveHint !== true)', 'if (false)'],
  ['any tool may be destructive', 'if (!DESTRUCTIVE.includes(n) && a.destructiveHint === true)', 'if (false)'],
  ['a tool may be read-only and destructive', 'if (a.readOnlyHint === true && a.destructiveHint === true)', 'if (false)'],
  ['a description of any length is accepted', 'd.length < 20 || d.length > 600', 'false'],
  ['a description may hold a web address', 'if (/https?:' + BS + '/' + BS + '//i.test(d))', 'if (false)'],
  ['room_status need not mention changed_at', "if (n === 'room_status' && !/changed_at/.test(d))", 'if (false)'],
  ['a destructive tool need not say it only asks', "if (DESTRUCTIVE.includes(n) && !(/waiting/i.test(d) && /Confirm/.test(d)))", 'if (false)'],
  ['a reading tool need not say players\' words are data', "if (['room_status', 'scores', 'join_card', 'play'].includes(n) && !/quoted/.test(d))", 'if (false)'],
  ['an input need not be closed', "if (!isObj(s) || s.type !== 'object' || s.additionalProperties !== false)", 'if (false)'],
  ['an input may take an address or a file', 'if (/url|address|path|file|^ip$|host|link/i.test(k))', 'if (false)'],
  ['a text input need not have a limit', "if (isObj(v) && v.type === 'string' && !(Number.isInteger(v.maxLength)", "if (false && isObj(v) && v.type === 'string' && !(Number.isInteger(v.maxLength)"],
  ['a list input need not have a limit', "if (isObj(v) && v.type === 'array' && !Number.isInteger(v.maxItems))", 'if (false)'],
  ['an input may be a web address', "if (isObj(v) && v.format === 'uri')", 'if (false)'],
  ['the join card tool need not show the card', 'if (!ui || ui.resourceUri !== CARD_URI)', 'if (false)'],
  ['another tool may show a page', 'else if (ui && ui.resourceUri !== undefined)', 'else if (false)'],
  ['a result need not carry changed_at', 'if (!Number.isInteger(sc.changed_at) || sc.changed_at < 0)', 'if (false)'],
  ['a result need not carry refusal', "if (!('refusal' in sc) || !(sc.refusal === null || typeof sc.refusal === 'string'))", 'if (false)'],
  ['a refusal may be an error', 'if (r.isError === true && sc.refusal)', 'if (false)'],
  ['the words may be any length', "if (typeof text !== 'string' || text.length === 0 || text.length > 600)", 'if (false)'],
  ['the words may hold a control or direction character', 'else if (HIDDEN.test(text))', 'else if (false)'],
  ['a quoted entry may have any shape', "Object.keys(q).some((k) => !['from', 'text'].includes(k))", 'false'],
  ['a quoted entry may be any length', 'if (q.text.length > 200 || q.from.length > 40)', 'if (false)'],
  ['a quoted entry may hold a control or direction character', 'if (HIDDEN.test(q.text) || HIDDEN.test(q.from))', 'if (false)'],
  ['quoted text needs no reminder', '!text.startsWith(QUOTED_REMINDER)', 'false'],
  ['a player\'s words may sit in the tool\'s sentence', "if (typeof text === 'string' && text.replace(QUOTED_REMINDER, '').includes(t))", 'if (false)'],
  ['a player\'s words may sit outside quoted', "if (!w.isKey && typeof w.value === 'string' && w.value.includes(t))", 'if (false)'],
  ['where a file or the room is may be sent', 'if (ALWAYS_BANNED_KEYS.includes(w.key))', 'if (false)'],
  ['a secret may be sent before the reveal', 'else if (SECRET_KEYS.includes(w.key) && !revealed)', 'else if (false)'],
  ['an address or file name may sit in a result text', 'for (const [re, what] of BAD_VALUE) if (re.test(w.value))', 'for (const [re, what] of BAD_VALUE) if (false)'],
  ['an address or file name may sit in the words', "if (typeof text === 'string') for (const [re, what] of BAD_VALUE) if (re.test(text))", "if (typeof text === 'string') for (const [re, what] of BAD_VALUE) if (false)"],
  ['a secret is allowed at any time', "const revealed = e.phase === 'revealed' || e.phase === 'between_rounds_after_reveal';", 'const revealed = true;'],
  ['the join card need not carry the code', "if (tool === 'join_card' && !(typeof sc.code === 'string' && /^[A-Z]{4}$/.test(sc.code)))", 'if (false)'],
  ['remove and end_night may finish by themselves', "if (sc.state !== 'waiting' && !sc.refusal)", 'if (false)'],
  ['a waiting step need not carry an ask_id', "if (sc.state === 'waiting' && !(typeof sc.ask_id === 'string' && sc.ask_id.length >= 4))", 'if (false)'],
  ['a step may finish without the TV\'s Confirm', "if (sc.state === 'done' && sc.ask_id !== undefined && !confirmed.has(sc.ask_id))", 'if (false)'],
  ['asking again with nothing new may return the view', 'if (Number.isInteger(since) && since === sc.changed_at && !(sc.nothing_changed === true && sc.view === undefined))', 'if (false)'],
  ['changed_at may go backwards', 'if (lastChanged !== null && sc.changed_at < lastChanged)', 'if (false)'],
  ['scores in a round in play need not say they are the last reveal\'s', "if (sc.as_of !== 'last_reveal') p.push(", 'if (false) p.push('],
  ['scores in a round in play may be for the wrong round', 'if (lastRevealRound !== null && sc.round !== lastRevealRound)', 'if (false)'],
  ['scores in a round in play are not checked at all', "if (e.phase === 'round_in_play' || e.phase === 'writing' || e.phase === 'locked') {", 'if (false) {'],
  ['the last reveal\'s round is never remembered', "if (tool === 'reveal' && Number.isInteger(sc.round) && !sc.refusal) lastRevealRound = sc.round;", ''],
  ['a round the AI wrote need not say so', 'if (sc.written_by_ai !== true)', 'if (false)'],
  ['the AI\'s seat need not sit out a round it wrote', 'if (sc.ai_seat_sits_out !== true)', 'if (false)'],
  ['the AI may play a round it wrote', "if (tool === 'play' && isObj(e.args) && e.args.round_written_by_ai === true && !sc.refusal)", 'if (false)'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', path.join('tests', 'games-host-contract.test.mjs')], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['tools', 'tests']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, C);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
