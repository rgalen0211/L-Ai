const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');
const code = fs.readFileSync(path.join(__dirname, '../assets/app-data.js'), 'utf8');

function load() {
  const window = {};
  vm.runInNewContext(code, { window });
  const client = createFakeClient();
  return { client, data: window.ryagramData(client) };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('2A-2 acceptance: create a project, make r2 from r1, and both keep their own story', async () => {
  const { data } = load();
  const { project, version: r1 } = await data.createProject('  Obesity and fast food  ');
  assert.equal(project.title, 'Obesity and fast food');
  assert.equal(r1.number, 1);
  await data.saveStory(r1.id, { schema: 1, name: 'first' });

  const r2 = await data.createVersion(project.id, r1.id);
  assert.equal(r2.number, 2);
  assert.equal(r2.parent_version_id, r1.id);
  await data.saveStory(r2.id, { schema: 1, name: 'second' });

  const one = await data.getVersion(r1.id);
  const two = await data.getVersion(r2.id);
  assert.deepEqual(plain(one.version.story_spec), { schema: 1, name: 'first' });
  assert.deepEqual(plain(two.version.story_spec), { schema: 1, name: 'second' });
  assert.equal(two.parent.number, 1);
  assert.equal(one.parent, null);

  const { versions } = await data.getProject(project.id);
  assert.deepEqual(versions.map(v => v.number), [1, 2]);
});

test('the project list shows each project’s newest version', async () => {
  const { data } = load();
  const a = await data.createProject('A');
  await data.createVersion(a.project.id, a.version.id);
  await data.createProject('B');
  const list = await data.listProjects();
  assert.deepEqual(list.map(p => [p.title, p.versionCount, p.latest.number]).sort(), [['A', 2, 2], ['B', 1, 1]]);
});

test('an archived project leaves the list and takes no new versions', async () => {
  const { data } = load();
  const { project } = await data.createProject('Gone');
  await data.archiveProject(project.id);
  assert.equal((await data.listProjects()).length, 0);
  await assert.rejects(data.createVersion(project.id), /Project not found/);
});

test('database refusals reach the view as readable errors', async () => {
  const { client, data } = load();
  const { version } = await data.createProject('Locked');
  client.db.versions[0].state = 'complete';
  await assert.rejects(data.saveStory(version.id, {}), /locked \(complete\)\. Make a new version/);
  await assert.rejects(data.setVersionState(version.id, 'draft'), /Cannot move a version from complete to draft/);
  assert.equal((await data.setVersionState(version.id, 'archived')).state, 'archived');
  await assert.rejects(data.getVersion('00000000-0000-4000-8000-999999999999'), /multiple \(or no\) rows|not found/i);
});

test('files open through short-lived signed links from the private bucket', async () => {
  const { client, data } = load();
  const url = await data.fileUrl('u/p/v/j/film.mp4');
  assert.match(url, /ryagram-artifacts\/u\/p\/v\/j\/film\.mp4/);
  const signed = client.log.find(e => e.signed);
  assert.equal(signed.bucket, 'ryagram-artifacts');
  assert.equal(signed.seconds, 900);
});
