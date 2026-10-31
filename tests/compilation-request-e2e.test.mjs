// A compilation END TO END through the connector (NEXT-BUILDER 58): the connector's own set_compilation_request, against its in-memory stand-in world,
// stores a request; the engine's draft step (Ryagram ryagram/local/from_request.py, run by its tests/request_draft_harness.py on a tiny made-up library with
// a stand-in transcriber) turns that STORED request into a draft edit list. Nothing is rendered and nothing leaves the computer.
// Needs the engine: set RYAGRAM_ENGINE to a Ryagram checkout that has tests/request_draft_harness.py (and PYTHON if `python` is not the one).
// Without it the engine half is reported SKIPPED, never passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const ENGINE = process.env.RYAGRAM_ENGINE;
const python = process.env.PYTHON || 'python';
const HARNESS = ENGINE ? path.join(ENGINE, 'tests', 'request_draft_harness.py') : '';
const SKIP = (!ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed') || (!fs.existsSync(HARNESS) && `${HARNESS} is not in that engine tree (its branch is not merged): SKIPPED, not passed`);

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

async function stored(args) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  w.invite(A.userId, A.clientId);
  const call = (name, a) => callTool(name, a, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });
  const id = (await call('create_project', { title: 'Friday cut' })).data.project_id;
  const r = await call('set_compilation_request', { project_id: id, ...args });
  assert.equal(r.isError, undefined, r.text);
  const u = w.users.get(A.userId);
  assert.deepEqual([u.jobs.length, u.credits], [0, 100], 'the connector built nothing and spent nothing');
  return u.requests.get(id).request;
}

function draft(request) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-e2e-'));
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
  const out = path.join(dir, 'draft.json');
  const r = spawnSync(python, ['-I', '-B', HARNESS, path.join(dir, 'request.json'), out], { encoding: 'utf8', timeout: 300000 });
  return { rc: r.status, err: r.stderr || '', draft: r.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

test('MUST-FAIL: the AI asks through the connector, the engine drafts the edit list from the STORED request: every place, both folders, the texts', { skip: SKIP }, async () => {
  const request = await stored({ phrase: 'great news', folders: ['My Videos', 'Old Clips'], search: 'every',
    texts: [{ text: 'Good news!', start_s: 0, length_s: 2, position: 'top', size: 'large' }] });
  const { rc, err, draft: d } = draft(request);
  assert.equal(rc, 0, err);
  assert.equal(d.schema, 'ryagram.request-draft/0');
  assert.equal(d.edit.schema, 'ryagram.maker-edit/0');
  assert.deepEqual(d.edit.clips.map((c) => c.file_name), ['mine/one.mp4', 'mine/one.mp4', 'old/two.mp4'], 'every place it is said, in folder then time order');
  assert.ok(d.edit.clips.every((c) => c.words.length && c.words[0].w === 'great' && c.in_s < c.out_s), 'each clip holds the words');
  assert.deepEqual(d.folders.map((f) => f.name), ['My Videos', 'Old Clips'], 'the folder NAMES the AI wrote, mapped on this computer');
  assert.deepEqual(d.edit.texts, [{ text: 'Good news!', start_s: 0, length_s: 2, position: 'top', size: 'large' }]);
  assert.equal(d.found, 3);
});

test('MUST-FAIL: what the draft cannot do it says, through the same path: a song is refused; picture rules wait; clean cuts are not made yet', { skip: SKIP }, async () => {
  const song = draft(await stored({ phrase: 'great news', folders: ['My Videos'], song: true }));
  assert.equal(song.rc, 2);
  assert.match(song.err, /needs the song tools/);
  const { rc, err, draft: d } = draft(await stored({ phrase: 'great news', folders: ['My Videos', 'Old Clips'], clean_cuts: true,
    rules: [{ phrase: 'great news', picture: 'cheer.png', seconds: 2, mode: 'full' }] }));
  assert.equal(rc, 0, err);
  assert.deepEqual(d.edit.rules, [], 'no picture is put in the list for the person');
  assert.equal(d.waiting.length, 1);
  assert.ok(d.notes.some((n) => /picture rule\(s\) wait for you/.test(n)) && d.notes.some((n) => /Clean cuts .* not made yet/.test(n)));
});

test('MUST-FAIL: words nobody in the folders says: the connector stores the request, the engine refuses in words (no empty draft)', { skip: SKIP }, async () => {
  const { rc, err } = draft(await stored({ phrase: 'zebra crossing', folders: ['My Videos'] }));
  assert.equal(rc, 2);
  assert.match(err, /Your videos do not say .zebra crossing./);
});
