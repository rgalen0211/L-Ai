// The creator beta flow in the app: "Request a film" (people) and the invite + queue sections on #/admin/ops (Ryan). The database half (credits spent and refunded,
// who can see what, welcome credits on sign-up) is supabase/tests/test_creator_flow.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function loadAssets(file) { const window = {}; vm.runInNewContext(read(`assets/${file}`), { window }); return window; }
const O = loadAssets('app-ops.js').ryagramOps;
const ryagramData = loadAssets('app-data.js').ryagramData;
import { compose } from '../supabase/functions/send-invite/send.ts';
const QUESTION = 'Which states built the most apartments between 2015 and 2024?';

test('REQUEST: the form checks the question before asking the database, in plain sentences', () => {
  assert.equal(O.checkRequest({ question: QUESTION, notes: '' }), null);
  assert.match(O.checkRequest({ question: 'short' }), /at least a few words/);
  assert.match(O.checkRequest({ question: '   ' }), /at least a few words/);
  assert.match(O.checkRequest({ question: 'x'.repeat(1001) }), /too long/);
  assert.match(O.checkRequest({ question: QUESTION, notes: 'n'.repeat(1001) }), /notes/);
});

test('REQUEST: the page says what a request costs and that credits come back if we cannot make it', () => {
  assert.equal(O.requestCostLine(10), 'A film request costs 10 credits. If we cannot make it, you get them back.');
  assert.equal(O.requestCostLine(1), 'A film request costs 1 credit. If we cannot make it, you get them back.');
  assert.equal(O.requestCostLine(null), 'A film request costs credits.');
  assert.equal(O.REQUEST_STATUS_WORDS.declined, 'Declined, your credits were returned');
});

test('REQUEST: data layer: a request costs 10 credits and lands in the queue; three open at most; a decline returns the credits; delivered keeps them spent', async () => {
  const client = createFakeClient({ credits: 25 });
  const data = ryagramData(client);
  assert.equal(await data.filmRequestCost(), 10);
  const id = await data.requestFilm(QUESTION, ' notes ');
  assert.equal(id, 1);
  assert.equal((await data.creditBalances())[0].available, 15);
  const mine = await data.myFilmRequests();
  assert.deepEqual([mine[0].status, mine[0].credits, mine[0].question], ['new', 10, QUESTION]);
  await data.requestFilm(QUESTION + ' again');
  await assert.rejects(data.requestFilm(QUESTION + ' third'), /Not enough credits: this needs 10, and 5 are available/);
  const q = await data.adminFilmRequests();
  assert.deepEqual([q.waiting, q.items.map(r => r.id)], [2, [1, 2]]);
  await assert.rejects(data.adminFilmRequestSet(1, 'delivered', '', 'http://insecure.example/f'), /https link/);
  await data.adminFilmRequestSet(1, 'delivered', 'Here it is', 'https://youtu.be/abc');
  assert.equal((await data.creditBalances())[0].available, 5);                     // delivered: stays spent
  await data.adminFilmRequestSet(2, 'declined', 'Not possible', null);
  assert.equal((await data.creditBalances())[0].available, 15);                    // declined: given back
  await assert.rejects(data.adminFilmRequestSet(2, 'declined'), /already declined/);
  const after = await data.adminFilmRequests();
  assert.deepEqual([after.waiting, after.recent.map(r => r.status).sort()], [0, ['declined', 'delivered']]);
  await assert.rejects(data.requestFilm('short'), /question/);
});

test('REQUEST: three open requests at most (the mock mirrors the database rule)', async () => {
  const data = ryagramData(createFakeClient({ credits: 100 }));
  for (let i = 0; i < 3; i++) await data.requestFilm(`${QUESTION} ${i}`);
  await assert.rejects(data.requestFilm(QUESTION + ' four'), /already have 3 film requests waiting/);
});

test('INVITE: the email Ryagram sends carries the code, the sign-up steps, the welcome credits and the free-credits disclosure (the words are in send-invite; tests/send-invite.test.mjs holds the rest)', () => {
  const body = compose({ to: 'maya@example.com', name: 'Maya Ortiz', credits: 20, expires_at: '2026-11-26T15:00:00Z', sends: 1 }, 'RYA-K7M2-9QPX', 'https://uselai.com').body;
  assert.match(body, /^Hi Maya,/);
  assert.match(body, /Your invite code is RYA-K7M2-9QPX\./);
  assert.match(body, /Have an invite code\?/);
  assert.match(body, /20 beta credits will be waiting/);
  assert.match(body, /Beta credits are free, in exchange for your feedback\. If you talk about or promote Ryagram/);
  const none = compose({ to: 'a@b.co', name: '', credits: 0, expires_at: '2026-11-26T15:00:00Z', sends: 1 }, 'RYA-AAAA-BBBB', 'https://uselai.com').body;
  assert.doesNotMatch(none, /beta credits? will be waiting|^Hi ,/);
  assert.match(none, /^Hi there,/);
});

test('INVITE: data layer asks the database to approve and invite (the only way a code is made over the API) and the mock refuses a second invite', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const before = await data.adminCreatorBeta();
  const code = await data.adminCreatorInvite(before.items[0].id, null);
  assert.match(code, /^RYA-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await data.adminCreatorBeta()).waiting, before.waiting - 1);
  await assert.rejects(data.adminCreatorInvite(before.items[0].id, null), /already made/);
});

test('SCREEN: the request page and its link exist only behind the filmRequests flag; the queue and the invite panel are on #/admin/ops', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /const requestsOn = \(\) => window\.ryagramConfig\?\.filmRequests === true \|\| !!window\.ryagramMock;/);
  assert.match(src, /else if \(requestsOn\(\) && hash === '#\/request'\) view = await requestView\(\);/);
  assert.match(src, /const requestLink = requestsOn\(\) \? h\('p', \{ class: 'meta' \}, h\('a', \{ href: '#\/request' \}, 'Request a film'\)\) : null;/);
  assert.match(src, /try \{ fr = await data\.adminFilmRequests\(\); \} catch \{ fr = null; \}/);                // the rest of the screen works without the SQL
  assert.match(src, /queueSection\(fr, now\),/);
  for (const call of ['adminFilmRequestSet(r.id, \'in_progress\'', 'adminFilmRequestSet(r.id, \'delivered\'', 'adminFilmRequestSet(r.id, \'declined\'', 'adminCreatorInvite(a.id, null)']) assert.ok(src.includes(call), call);
  assert.match(src, /O\.checkDelivery\(url\.value\)/);
  assert.match(src, /button\(`Decline \(returns \$\{r\.credits\} credits\)`/);
  assert.match(src, /\(shown once; copy it now\)/);
  assert.match(src, /rel: 'noopener noreferrer'/);
  assert.match(read('assets/ryagram-config.js'), /filmRequests: true,/);                        // ON for the launch block (SQL 20261016000200 applied, invite-only test mode)
});

test('SCREEN: nothing in the flow takes payment or talks to a mail provider: the invite goes through the send-invite function, the film is sent by Ryan', () => {
  const lib = read('assets/app-library.js');
  const flowScreens = lib.slice(lib.indexOf('async function requestView()'), lib.indexOf('// --- #/admin/ops  Ryan only:')) + lib.slice(lib.indexOf('// --- the invite just made'), lib.indexOf('// --- Costs: every'));
  const ops = read('assets/app-ops.js'); const flowWords = ops.slice(ops.indexOf('// ---- The creator beta flow'), ops.indexOf('// ---- Costs on the Operations screen'));
  const dat = read('assets/app-data.js'); const flowData = dat.slice(dat.indexOf('// Creator beta flow (SQL 20261016000200)'), dat.indexOf('// Cost ledger (SQL 20261016000100)'));
  for (const part of [flowScreens, flowWords, flowData]) { assert.ok(part.length > 300); assert.doesNotMatch(part, /api\.resend|smtp|sendMail|inviteUserByEmail|api\.stripe|checkout\.stripe/i); }
});

// ---- Ryan (2026-10-16): 10 credits a film request and 20 welcome credits are LOCKED IN; a credit has NO dollar value yet (until costmeter has measured real render costs)
test('LOCKED: a film request costs 10 credits and the welcome grant is 20, in the database defaults, the mock and the words on the page', async () => {
  const sql = read('supabase/migrations/20261016000200_creator_flow.sql');
  assert.match(sql, /film_request_credits int not null default 10 check/);
  assert.match(sql, /invite_credits int not null default 20 check/);
  assert.match(sql, /CONFIRMED by Ryan, 2026-10-16/);
  assert.equal(await ryagramData(createFakeClient({ credits: 100 })).filmRequestCost(), 10);
  assert.equal(O.requestCostLine(10), 'A film request costs 10 credits. If we cannot make it, you get them back.');
  assert.match(read('supabase/README.md'), /confirmed by Ryan \(2026-10-16\): 10 credits per film request and 20 welcome credits/);
  assert.doesNotMatch(sql + read('supabase/README.md'), /a suggestion/i);                    // no longer "suggestions"
});

test('NO PRICE PER CREDIT: nothing in the creator flow stores, computes or shows a dollar value for a credit', () => {
  const sql = read('supabase/migrations/20261016000200_creator_flow.sql');
  const code = sql.replace(/--.*$/gm, '');                                                  // (the comments may explain the rule; the CODE must not mention a price)
  for (const word of ['usd', 'dollar', 'cents', 'per_credit', 'credit_value', 'unit_price', 'price']) assert.ok(!code.toLowerCase().includes(word), `the flow's SQL mentions ${word}`);
  const screens = [read('assets/app-library.js'), read('assets/app-ops.js')].join('\n');
  const flow = screens.slice(screens.indexOf('async function requestView()'), screens.indexOf('// --- #/admin/ops  Ryan only:'));
  assert.ok(flow.length > 500);
  assert.doesNotMatch(flow, /\$\d|price|per credit|dollar|usd|cents/i);     // (no "$5"; the code's own ${...} interpolations are fine)                        // the Request a film page shows credits only
  const o = read('assets/app-ops.js');
  const start = o.indexOf('// ---- The creator beta flow'); const flowWords = o.slice(start, o.indexOf('// ---- Costs on the Operations screen'));        // (the cost ledger's own wording, right after, is about dollars of COSTS, not credits)
  assert.doesNotMatch(flowWords, /\$\d|price|per credit|dollar|usd/i);   // nor the queue and invite wording (the invite mail says credits, never dollars)
  assert.doesNotMatch(compose({ to: 'a@b.co', name: 'A B', credits: 20, expires_at: '2026-11-26T15:00:00Z', sends: 1 }, 'RYA-AAAA-BBBB', 'https://uselai.com').body, /\$|price|dollar|per credit/i);
  // and no screen anywhere computes a per-credit price from a pack (price / credits)
  for (const f of ['assets/app-credits.js', 'assets/app-library.js', 'assets/app-ops.js', 'assets/ryagram.js', 'assets/creator-beta.js', 'assets/film.js']) {
    assert.doesNotMatch(read(f), /price_cents\s*\/\s*[a-z.]*credits|credits\s*\/\s*[a-z.]*price|per[ _-]?credit|\/\s*credit\b|usd[_ ]per/i, f);
  }
  for (const f of ['ryagram/index.html', 'film/index.html', 'help/index.html', 'report/index.html']) {
    if (fs.existsSync(new URL(`../${f}`, import.meta.url))) assert.doesNotMatch(read(f).replace(/<[^>]+>/g, ' '), /per credit|a credit (is|costs)|each credit|credit is worth|\$\s?\d[\d.]*\s*(\/|per|a)\s*credit/i, f);
  }
});
