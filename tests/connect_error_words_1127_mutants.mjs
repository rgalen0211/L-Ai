// Must-fail proof for tests/connect-error-words-1127.test.mjs (the plain words an AI is handed when the connector refuses): each mutant puts ONE old sentence back, or breaks one thing the new sentence must keep, in a scratch copy, and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_error_words_1127_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-errwords1127');
const SUITE = 'connect-error-words-1127.test.mjs';
const D = 'supabase/functions/connect-core/';
const TL = D + 'tools.ts', WL = D + 'words.ts';
const mutants = [
  // 1. out of credits and the preview limits
  ['the refused preview goes back to "would cost ... a connection cannot spend credits"', TL, '`${label} needs ${q.credits} credit${q.credits === 1 ? "" : "s"}, because the free previews are used up:', '`${label} would cost ${q.credits} credits: the free previews are used up:'],
  ['the refused preview no longer says that nothing was lost', TL, 'NOTHING was started, and nothing was lost: the saved story and the contact sheet are untouched. An AI cannot spend credits. ', 'NOTHING was started. A connection cannot spend credits. '],
  ['the refused preview no longer says the daily limit', TL, 'each person gets 15 free previews in any 24 hours.', 'each person gets 15 free previews.'],
  ['the refused preview gives a wrong per-project number', TL, 'each project gets 6 free previews,', 'each project gets 3 free previews,'],
  ['a person with no credits is sent to the button', TL, ', which is not enough, so nothing more can be made right now: tell them so plainly, and do not send them to the Ryagram app for it.`', ', so they can start it themselves: they press the button in the Ryagram app.`'],
  ['a person with credits is not told where the button is', TL, ', so they can start it themselves: they press the button in the Ryagram app.`', ', so it can be started.`'],
  ['one credit is written "1 credits" again', TL, 'The person has ${q.available} credit${q.available === 1 ? "" : "s"}, which is not enough', 'The person has ${q.available} credits, which is not enough'],
  ['the refused preview loses its code', TL, '"costs_credits", { credits: q.credits', '"rate", { credits: q.credits'],
  // 2. a full film asked from the AI
  ['the full-render refusal goes back to "a connection"', TL, 'An AI cannot start a full film render. Nothing was started and no credits were used.', 'A full render cannot be started from an AI connection. Nothing was started and no credits were used.'],
  ['the full-render refusal forgets who presses the button', TL, 'If they have credits, they press \'Render final film\' in the Ryagram app.', 'If they have credits they can use the app.'],
  ['the full-render refusal no longer says not to promise a film', TL, ', and do not promise one.";', '.";'],
  ['the full-render answer is no longer a refusal', TL, 'return { text: `${reason} ${what}`, refused: true, code: "not_available"', 'return { text: `${reason} ${what}`, refused: false, code: "not_available"'],
  ['the database\'s full-render refusal is shown as the database wrote it', WL, '"Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.": "An AI cannot start a full film render.', '"Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.": "A full render cannot be started from an AI connection.'],
  // 3. a dataset Ryagram does not have
  ['set_story names the catalog the old way', D + 'story_check.ts', 'which Ryagram does not have: it is not in the catalog, and not among the person\'s own uploaded data (list_my_data shows that). The datasets Ryagram can draw are:', 'which is not in the Ryagram catalog or among your own uploaded data (list_my_data). Allowed:'],
  ['set_story no longer tells the AI to say so plainly', D + 'story_check.ts', 'tell them plainly that Ryagram does not have it; do not swap in another dataset without saying so.`);', 'do not swap in another dataset without saying so.`);'],
  ['dataset_info says "the engine\'s records" again', TL, 'Ryagram has no dataset called "${id}".', 'There is no dataset "${id}" in the engine\'s records.'],
  ['a place question refused on data goes back to "only answered on example data"', TL, 'For now, place questions are answered only on made-up example data, and this place is not part of it, so there is no answer. Asking again will not change that.', 'Place questions are only answered on example data for now, and this one is not.'],
  ['a forecast refused on data goes back to "not switched on for real use"', TL, 'For now, forecasts are not available for real use, so there is no forecast. Asking again will not change that.', 'Forecasts are not switched on for real use yet.'],
  // 4. a sign-in that has ended, a removed connection, a missing permission, too big
  ['the MCP 401 goes back to "Sign in to Ryagram to use this connection."', D + 'mcp.ts', 'json(401, { error: SIGNED_OUT }', 'json(401, { error: "Sign in to Ryagram to use this connection." }'],
  ['the REST 401 goes back to the old words', D + 'rest.ts', 'json(401, { error: SIGNED_OUT }', 'json(401, { error: "Sign in to Ryagram to use this." }'],
  ['the 401 loses its sign-in challenge', D + 'mcp.ts', 'challenge(deps.resourceMetadataUrl, token ? "invalid_token" : undefined));\n\n  const declared', 'undefined);\n\n  const declared'],
  ['the new sign-in sentence forgets that nothing was lost', WL, 'Nothing was done, and nothing in the account was lost. To go on, connect Ryagram again', 'Nothing was done. To go on, connect Ryagram again'],
  ['a sign-in that ends mid-call shows the database\'s old sentence', TL, 'if (Object.hasOwn(SQL_WORDS, msg)) return SQL_WORDS[msg];', ''],
  ['the missing-permission refusal goes back to "was not allowed to do that"', D + 'dispatch.ts', 'refused(noPermission(tool.scope), "scope")', 'refused(`This connection was not allowed to do that (${tool.scope.replace("_", " ")}).`, "scope")'],
  ['the missing-permission words stop naming what the AI may not do', WL, '  write: "create projects and change film stories",', '  write: "do that",'],
  ['the removed-connection sentence loses where to go', WL, 'The person can open Account, then Connected AIs, in the Ryagram app to connect again;', 'The person can reconnect;'],
  ['the too-big sentence goes back to "too large"', WL, '`That request was too big for Ryagram to accept (the limit is ${Math.round(LIMITS.maxBodyBytes / 1024)} KB). Nothing was saved. Send less in one go.`', '"That request is too large."'],
  ['the too-big sentence says a wrong limit', WL, 'Math.round(LIMITS.maxBodyBytes / 1024)', '256'],
  ['the daily-credit-cap sentence keeps its code word', WL, '"daily_cap: you have reached today\'s credit limit. Try again tomorrow.": "The person has reached', '"daily_cap: you have reached today\'s credit limit. Try again tomorrow.": "daily_cap: The person has reached'],
  // 5. the two sentences every refused call can meet
  ['a call that does not fit goes back to "was not understood"', D + 'dispatch.ts', 'return refused(`Ryagram could not use those details, so nothing was done: ${problems.slice(0, 8).join(" ")}`', 'return refused(`The call was not understood: ${problems.slice(0, 8).join(" ")}`'],
  ['an unreadable forecast answer goes back to "not in a shape"', TL, 'if (!rep) return refuse("Ryagram got an answer back but could not trust it, so none of it is shown. Nothing was changed. Tell the person the answer could not be shown; do not guess at it.", "bad_report");\n    const fmt', 'if (!rep) return refuse("The answer was not in a shape this connection knows, so none of it is shown.", "bad_report");\n    const fmt'],
  ['an unreadable place answer no longer says not to guess', TL, 'if (!rep) return refuse("Ryagram got an answer back but could not trust it, so none of it is shown. Nothing was changed. Tell the person the answer could not be shown; do not guess at it.", "bad_report");\n    const example = /example data/i.test(rep.assumptions);', 'if (!rep) return refuse("Ryagram got an answer back but could not trust it, so none of it is shown.", "bad_report");\n    const example = /example data/i.test(rep.assumptions);'],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times, need 1): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
