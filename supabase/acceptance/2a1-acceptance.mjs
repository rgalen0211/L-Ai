// 2A-1 acceptance test against the live Supabase project. No dependencies:
// Node 18+ and its built-in fetch.
//
//   node supabase/acceptance/2a1-acceptance.mjs            run it
//   node supabase/acceptance/2a1-acceptance.mjs --dry-run  list the checks, touch nothing
//
// It proves:
//   A. Ryan can sign in.
//   B. Anonymous visitors get nothing (no rows, no functions, no files).
//   C. A second person sees none of Ryan's rows or files and can't change them.
//   D. The worker account can call only its own functions.
//
// Needs three accounts made in the dashboard (Authentication -> Users -> Add
// user, Auto Confirm): Ryan, a second test person, and the worker (listed in
// public.workers). Values come from environment variables, or it asks:
//   RYAGRAM_SUPABASE_URL, RYAGRAM_SUPABASE_KEY (publishable key)
//   RYAN_EMAIL, RYAN_PASSWORD, OTHER_EMAIL, OTHER_PASSWORD, WORKER_EMAIL, WORKER_PASSWORD
// Passwords are asked for with hidden typing and are never printed or logged.
//
// It leaves behind, all clearly named "acceptance-<time>": one archived
// project with r1, one finished preview job, and one 16-byte file in Storage.
// Run it BEFORE the render worker is started (or with D:\RyagramWorker\STOP
// present): it plays the worker's part itself and stops if the queue isn't empty.

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const DRY = process.argv.includes('--dry-run');
const BUCKET = 'ryagram-artifacts';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function skip(name, why) {
  results.push({ name, ok: null });
  console.log(`SKIP  ${name}  (${why})`);
}

async function ask(question, hidden) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
  const answer = await new Promise(resolve => rl.question(question, resolve));
  rl.close();
  if (hidden) process.stdout.write('\n');
  return answer.trim();
}
async function setting(name, question, hidden = false) {
  return process.env[name] || (DRY ? `<${name}>` : ask(question, hidden));
}

// --- HTTP helpers. `token` null = anonymous (publishable key only).
let URL_, KEY;
function headers(token, extra = {}) {
  const h = { apikey: KEY, ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  else if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;   // legacy anon JWT
  return h;
}
async function call(method, path, token, body, extra = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: headers(token, body instanceof Uint8Array ? extra : { 'Content-Type': 'application/json', ...extra }),
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}
const rows = (token, table, query = 'select=*') => call('GET', `/rest/v1/${table}?${query}`, token);
const rpc = (token, fn, args = {}) => call('POST', `/rest/v1/rpc/${fn}`, token, args);
const refused = r => !r.ok;
const empty = r => r.ok && Array.isArray(r.json) && r.json.length === 0;
const nothing = r => refused(r) || empty(r);

async function signIn(email, password) {
  const r = await call('POST', '/auth/v1/token?grant_type=password', null, { email, password });
  return r.ok && r.json?.access_token ? r.json.access_token : null;
}

const TABLES = ['projects', 'versions', 'jobs', 'artifacts', 'job_metering', 'datasets', 'workers', 'control', 'ryagram_waitlist'];
const PLAN = [
  'A1 Ryan signs in with email and password',
  'A2 Ryan can create a project and r1, and read them back',
  'B1 Anonymous: every table returns nothing',
  'B2 Anonymous: person and worker functions are refused',
  'B3 Anonymous: Storage lists and signs nothing',
  'C1 Second person signs in and sees none of Ryan\'s rows',
  'C2 Second person cannot rename, edit, copy, submit to or cancel Ryan\'s things',
  'C3 Second person cannot list, sign or download Ryan\'s file',
  'D1 Worker sees no rows and cannot write tables directly',
  'D2 Worker cannot create projects, versions or jobs of its own',
  'D3 Worker runs one job through its functions: claim, states, register, upload, metering, complete',
  'D4 Ryan and the second person cannot call worker functions',
  'D5 Ryan can read the finished file; worker can no longer touch it'
];

async function main() {
  if (DRY) {
    console.log('Dry run. Checks this script makes:\n');
    PLAN.forEach(p => console.log(`  ${p}`));
    console.log('\nNothing was sent anywhere.');
    return;
  }
  URL_ = (await setting('RYAGRAM_SUPABASE_URL', 'Project URL: ')).replace(/\/+$/, '');
  KEY = await setting('RYAGRAM_SUPABASE_KEY', 'Publishable key: ');
  if (/^sb_secret_/.test(KEY) || /service_role/.test(Buffer.from((KEY.split('.')[1] || ''), 'base64').toString())) {
    console.log('That is a secret key. This test must use the publishable key. Stopping.');
    process.exit(2);
  }
  const ryanEmail = await setting('RYAN_EMAIL', 'Ryan\'s email: ');
  const ryanPassword = await setting('RYAN_PASSWORD', 'Ryan\'s password (hidden): ', true);
  const otherEmail = await setting('OTHER_EMAIL', 'Second test person\'s email: ');
  const otherPassword = await setting('OTHER_PASSWORD', 'Second person\'s password (hidden): ', true);
  const workerEmail = await setting('WORKER_EMAIL', 'Worker account email: ');
  const workerPassword = await setting('WORKER_PASSWORD', 'Worker password (hidden): ', true);
  const tag = `acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  console.log(`\nRunning against ${URL_} as ${tag}\n`);

  // --- A: Ryan
  const ryan = await signIn(ryanEmail, ryanPassword);
  record('A1 Ryan signs in', !!ryan);
  if (!ryan) return;
  const created = await call('POST', '/rest/v1/projects', ryan, { title: tag }, { Prefer: 'return=representation' });
  const project = created.json?.[0];
  const version = project && (await rpc(ryan, 'create_version', { p_project_id: project.id })).json;
  const story = { schema: 1, engine: 'sequence', name: 'acceptance', sequence: { clips: [] } };
  const edited = version && await call('PATCH', `/rest/v1/versions?id=eq.${version.id}`, ryan, { story_spec: story }, { Prefer: 'return=representation' });
  const readBack = project && await rows(ryan, 'projects', `select=id,title&id=eq.${project.id}`);
  record('A2 Ryan creates a project and r1 and reads them back',
         !!(project && version?.number === 1 && edited?.ok && readBack?.json?.[0]?.title === tag));
  if (!project || !version) return;

  // --- B: anonymous
  const anonTables = await Promise.all(TABLES.filter(t => t !== 'ryagram_waitlist').map(t => rows(null, t)));
  const anonWaitlist = await rows(null, 'ryagram_waitlist');
  record('B1 Anonymous: every table returns nothing', anonTables.every(nothing) && nothing(anonWaitlist),
         anonTables.map((r, i) => `${TABLES[i]} ${r.status}`).join(', '));
  const anonRpcs = await Promise.all([
    rpc(null, 'create_version', { p_project_id: project.id }),
    rpc(null, 'submit_job', { p_version_id: version.id, p_job_type: 'preview' }),
    rpc(null, 'queue_position', { p_job_id: version.id }),
    rpc(null, 'claim_next_job'),
    rpc(null, 'heartbeat', { p_job_id: version.id })
  ]);
  record('B2 Anonymous: functions refused', anonRpcs.every(refused), anonRpcs.map(r => r.status).join(', '));

  // --- D (part 1): the worker before any job exists
  const worker = await signIn(workerEmail, workerPassword);
  if (!worker) { record('D  Worker signs in', false); return; }
  const workerTables = await Promise.all(['projects', 'versions', 'jobs', 'artifacts', 'workers', 'control'].map(t => rows(worker, t)));
  const workerWrites = await Promise.all([
    call('PATCH', `/rest/v1/jobs?id=eq.${version.id}`, worker, { state: 'complete' }, { Prefer: 'return=representation' }),
    call('PATCH', `/rest/v1/control?id=eq.true`, worker, { claims_enabled: false }, { Prefer: 'return=representation' }),
    call('POST', '/rest/v1/workers', worker, { user_id: version.id, name: 'x' })
  ]);
  record('D1 Worker sees no rows and cannot write tables directly',
         workerTables.every(nothing) && workerWrites.every(nothing));
  const workerAsPerson = await Promise.all([
    call('POST', '/rest/v1/projects', worker, { title: `${tag}-worker` }, { Prefer: 'return=representation' }),
    rpc(worker, 'create_version', { p_project_id: project.id }),
    rpc(worker, 'submit_job', { p_version_id: version.id, p_job_type: 'preview' })
  ]);
  record('D2 Worker cannot create projects, versions or jobs of its own', workerAsPerson.every(refused),
         workerAsPerson.map(r => r.status).join(', '));

  // --- D3: one job through the worker functions, if the queue is ours alone
  const job = (await rpc(ryan, 'submit_job', { p_version_id: version.id, p_job_type: 'preview', p_params: { window_s: [0, 5] } })).json;
  const position = job && (await rpc(ryan, 'queue_position', { p_job_id: job.id })).json;
  let objectPath = null;
  const bytes = new TextEncoder().encode('ryagram-accept-1');          // 16 bytes
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (!job || position !== 1) {
    skip('D3 Worker runs one job', position ? `queue not empty (position ${position}); stop the worker and retry` : 'could not submit a job');
  } else {
    const claimed = (await rpc(worker, 'claim_next_job')).json?.[0];
    if (claimed?.id !== job.id) {
      skip('D3 Worker runs one job', 'another worker took it first: create D:\\RyagramWorker\\STOP and retry');
    } else {
      const steps = [];
      steps.push(await rpc(worker, 'report_state', { p_job_id: job.id, p_state: 'running', p_engine_commit: '0000000', p_engine_dirty: false }));
      steps.push(await rpc(worker, 'heartbeat', { p_job_id: job.id, p_progress: 0.5, p_note: 'acceptance' }));
      steps.push(await rpc(worker, 'report_state', { p_job_id: job.id, p_state: 'validating' }));
      steps.push(await rpc(worker, 'report_state', { p_job_id: job.id, p_state: 'uploading' }));
      const registered = await rpc(worker, 'register_artifact', { p_job_id: job.id, p_kind: 'preview', p_bytes: bytes.length, p_sha256: sha });
      steps.push(registered);
      objectPath = registered.json;
      const traversal = await call('POST', `/storage/v1/object/${BUCKET}/${String(objectPath).replace(/[^/]+$/, '')}..%2F..%2Fescape.mp4`,
                                   worker, bytes, { 'Content-Type': 'video/mp4' });
      steps.push(await call('POST', `/storage/v1/object/${BUCKET}/${objectPath}`, worker, bytes, { 'Content-Type': 'video/mp4' }));
      steps.push(await rpc(worker, 'write_metering', { p_job_id: job.id, p_attempt: 1, p_metrics: { notes: { acceptance: tag } } }));
      const done = await rpc(worker, 'report_state', { p_job_id: job.id, p_state: 'complete' });
      steps.push(done);
      record('D3 Worker runs one job through its functions', steps.every(s => s.ok) && done.json?.state === 'complete' && refused(traversal),
             steps.map(s => s.status).join(' ') + ` / traversal upload ${traversal.status}`);
    }
  }

  // --- D4: people can't use worker functions
  const other = await signIn(otherEmail, otherPassword);
  const notWorkers = await Promise.all([
    rpc(ryan, 'claim_next_job'),
    rpc(ryan, 'heartbeat', { p_job_id: job?.id ?? version.id }),
    other ? rpc(other, 'report_state', { p_job_id: job?.id ?? version.id, p_state: 'failed', p_error_code: 'crash' }) : { ok: true },
    other ? rpc(other, 'register_artifact', { p_job_id: job?.id ?? version.id, p_kind: 'preview', p_bytes: 1, p_sha256: sha }) : { ok: true }
  ]);
  record('D4 Ryan and the second person cannot call worker functions', notWorkers.every(refused), notWorkers.map(r => r.status).join(', '));

  // --- C: the second person
  record('C0 Second person signs in', !!other);
  if (other) {
    const seen = await Promise.all(['projects', 'versions', 'jobs', 'artifacts', 'job_metering'].map(t => rows(other, t, `select=id&or=(id.eq.${project.id},id.eq.${version.id},id.eq.${job?.id ?? version.id})`)));
    const all = await Promise.all(['projects', 'versions', 'jobs', 'artifacts', 'job_metering'].map(t => rows(other, t, 'select=owner_id')));
    const leaks = all.flatMap(r => (r.json || []).filter(x => x.owner_id && x.owner_id === project.owner_id));
    record('C1 Second person sees none of Ryan\'s rows', seen.every(nothing) && leaks.length === 0 && all.every(r => r.ok),
           `${leaks.length} of Ryan's rows visible`);
    const tamper = await Promise.all([
      call('PATCH', `/rest/v1/projects?id=eq.${project.id}`, other, { title: 'taken' }, { Prefer: 'return=representation' }),
      call('PATCH', `/rest/v1/versions?id=eq.${version.id}`, other, { note: 'taken' }, { Prefer: 'return=representation' }),
      rpc(other, 'create_version', { p_project_id: project.id, p_from_version_id: version.id }),
      rpc(other, 'submit_job', { p_version_id: version.id, p_job_type: 'contact_sheet' }),
      job ? rpc(other, 'cancel_job', { p_job_id: job.id }) : { ok: false },
      job ? rpc(other, 'queue_position', { p_job_id: job.id }) : { ok: false }
    ]);
    // queue_position answers null for jobs that aren't yours, rather than an error.
    const qp = tamper[5];
    const tamperOk = tamper.slice(0, 5).every(nothing) && (refused(qp) || qp.json === null);
    record('C2 Second person cannot change or use Ryan\'s things', tamperOk, tamper.map(r => r.status).join(', '));
    if (objectPath) {
      const [list, sign, download] = await Promise.all([
        call('POST', `/storage/v1/object/list/${BUCKET}`, other, { prefix: String(objectPath).split('/')[0], limit: 100 }),
        call('POST', `/storage/v1/object/sign/${BUCKET}/${objectPath}`, other, { expiresIn: 60 }),
        call('GET', `/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, other)
      ]);
      record('C3 Second person cannot list, sign or download Ryan\'s file',
             nothing(list) && refused(sign) && refused(download), `${list.status} ${sign.status} ${download.status}`);
      const anonFiles = await Promise.all([
        call('POST', `/storage/v1/object/list/${BUCKET}`, null, { prefix: '', limit: 100 }),
        call('POST', `/storage/v1/object/sign/${BUCKET}/${objectPath}`, null, { expiresIn: 60 })
      ]);
      record('B3 Anonymous: Storage lists and signs nothing', nothing(anonFiles[0]) && refused(anonFiles[1]),
             anonFiles.map(r => r.status).join(', '));
    } else {
      skip('C3 Second person cannot read Ryan\'s file', 'no file was made (D3 skipped)');
      skip('B3 Anonymous: Storage', 'no file was made (D3 skipped)');
    }
  }

  // --- D5: Ryan reads his file; the worker has let go of it
  if (objectPath) {
    const signed = await call('POST', `/storage/v1/object/sign/${BUCKET}/${objectPath}`, ryan, { expiresIn: 60 });
    const signedPath = signed.json?.signedURL || signed.json?.signedUrl;
    const got = signedPath ? await fetch(`${URL_}/storage/v1${signedPath.replace(/^\/storage\/v1/, '')}`) : null;
    const body = got?.ok ? new Uint8Array(await got.arrayBuffer()) : null;
    const workerAfter = await call('POST', `/storage/v1/object/${BUCKET}/${objectPath}`, worker, bytes,
                                   { 'Content-Type': 'video/mp4', 'x-upsert': 'true' });
    const beatAfter = await rpc(worker, 'heartbeat', { p_job_id: job.id });
    record('D5 Ryan downloads his file intact; the worker can no longer touch it',
           !!body && createHash('sha256').update(body).digest('hex') === sha && refused(workerAfter) && refused(beatAfter),
           `download ${got?.status ?? 'none'}, worker re-upload ${workerAfter.status}, heartbeat ${beatAfter.status}`);
  } else {
    skip('D5 Ryan reads his file', 'no file was made (D3 skipped)');
  }

  // Tidy: archive the test project (nothing can be deleted through the API).
  await call('PATCH', `/rest/v1/projects?id=eq.${project.id}`, ryan, { archived_at: new Date().toISOString() });
}

main()
  .catch(err => { console.log(`FAIL  the script itself stopped: ${err.message}`); results.push({ ok: false }); })
  .finally(() => {
    if (DRY) return;
    const failed = results.filter(r => r.ok === false).length;
    const skipped = results.filter(r => r.ok === null).length;
    console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped.`);
    process.exitCode = failed ? 1 : 0;
  });
