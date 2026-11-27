// BUILDER 11-27 (Claude's 08:05 last stretch): the stranger's limits, the words the page shows for each. The server answers are proven on a local Postgres by
// supabase/tests/test_stranger_limits.py (live main's code); this file turns those exact answers into the page's words with the page's own functions. Table: proposals/BUILDER-STRANGER-LIMITS-1127.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = src => { const win = {}; vm.runInNewContext(src, { window: win, setTimeout, clearTimeout }); return win.ryagramJobs; };
const jobsSrc = read('assets/app-jobs.js');
const J = load(jobsSrc);
const DAILY_CAP_SERVER = "daily_cap: you have reached today's credit limit. Try again tomorrow.";                 // pipe1_orders submit_job, errcode PTCAP
const DAILY_CAP_WORDS = 'This did not start because you reached today’s credit limit. Nothing was charged. You can try again after 24 hours.';
const st = (state, code, q = 8) => ({ state, error_code: code, stages: [{ stage: 'final_render', credits_quoted: q }] });

test('the daily cap on a paid preview reads as the cap, not as "Something went wrong"', () => {
  assert.equal(J.plainRefusal(DAILY_CAP_SERVER), DAILY_CAP_WORDS);
  assert.doesNotMatch(J.plainRefusal(DAILY_CAP_SERVER), /Something went wrong|tomorrow|daily_cap/);
  const old = load(jobsSrc.replace("    if (/^daily_cap\\b/.test(text)) return DAILY_CAP_WORDS;\n", ''));
  assert.equal(old.plainRefusal(DAILY_CAP_SERVER), 'Something went wrong. Please try again, or ask us to help.', 'PLANTED: without the line the stranger gets the generic error (live main today)');
});

test('0 credits: a paid preview says what it needs and what there is', () => {
  assert.equal(J.plainRefusal('Not enough credits: this needs 1, and 0 are available.'), 'This needs 1 credit and you have 0. Buying credits is not open yet.');
});

test('the full-film order lines: no credits, the daily cap, declined, never decided, waiting', () => {
  assert.equal(J.orderLine(st('failed', 'insufficient_credits')), 'The full render did not start because you do not have enough credits. Nothing was charged. Buying credits is not open yet.');
  assert.equal(J.orderLine(st('failed', 'daily_cap')), 'The full render did not start because you reached today’s credit limit. Nothing was charged. You can request it again after 24 hours.');
  assert.equal(J.orderLine(st('declined', 'declined')), 'The full render was not approved, so nothing was rendered and your credits were returned.');
  assert.equal(J.orderLine(st('expired', 'approval_expired')), 'The full render was not approved in time, so it was cancelled and your credits were returned.');
  assert.equal(J.orderLine(st('awaiting_approval', null)), 'Your full render is waiting for approval. We approve each one by hand for now. 8 credits are held. They come back if it is not approved.');
});

test('the free previews and the sign-up cap say their limits in plain words', () => {
  assert.equal(J.FREE_PREVIEW_USED, 'Your free previews are used up: each project gets 6, and 15 across all projects in any 24 hours. Start a new project if this one used its 6, or try again later.');
  assert.match(read('supabase/functions/join/join.ts'), /export const FULL_WORDS = "Sign-up is full for now\. Please try again later\.";/);
  assert.match(read('supabase/functions/join/join.ts'), /if \(r\.reason === "full"\) return reply\(429, \{ error: FULL_WORDS \}\);/);
  assert.match(read('assets/app-data.js'), /if \(status === 409\) text = /, 'only 409 and 503 are reworded by the page; a 429 shows the server sentence');
});
