// web-wed-v3-1123, GAMES third review (10:02) LOWs and CC1 10:00 findings: every check fails on the old wording or the old shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const goesRed = (check, oldText) => assert.throws(() => check(oldText), undefined, 'the check must fail on the old wording');

test('LOW a: the state label is the same, and true for both causes, on the jobs, library, orders and ops pages', () => {
  const check = src => assert.match(src, /editorial_action_required: 'Stopped'[,\s}]/);
  for (const f of ['assets/app-jobs.js', 'assets/app-library.js', 'assets/app-ops.js']) check(read(f));
  assert.equal((read('assets/app-jobs.js').match(/editorial_action_required: 'Stopped'/g) || []).length, 2, 'job states and order states');
  goesRed(check, "editorial_action_required: 'Stopped by our checks',");
  goesRed(check, "editorial_action_required: 'Needs a decision',");
  const all = ['assets/app-jobs.js', 'assets/app-library.js', 'assets/app-ops.js'].map(read).join('\n');
  assert.doesNotMatch(all, /Stopped by (our checks|a check)|Needs a decision/);
});

test('LOW b: the access check keeps its answer per call: two overlapping route calls each read their own', async () => {
  const lib = read('assets/app-library.js');
  const src = lib.match(/async function waitingGate\(gate\) \{[\s\S]*?\n    \}\n/)[0];
  assert.doesNotMatch(lib, /let gateUnknown/);
  let calls = 0, resolveFirst;
  const env = {
    waitingOn: () => true, activeSeen: false, location: { hash: '#/' },
    document: { body: { classList: { toggle() {} } } },
    window: { ryagramWaiting: { checkAccess: f => f(), pageFor: () => 'waiting' } },
    data: { myAccess: () => (calls++ ? Promise.resolve('waiting') : new Promise(r => { resolveFirst = () => r('unknown'); })) },
  };
  const gateFn = vm.runInNewContext(`(${src.replace('async function waitingGate', 'async function')})`, env);
  const a = {}, b = {};
  const first = gateFn(a);                       // the slow call: will answer 'unknown'
  const second = await gateFn(b);                // a fast route change: 'waiting', answered while the first still waits
  resolveFirst();
  await first;
  assert.equal(second, true);
  assert.equal(a.unknown, true, 'the first call keeps its own answer (unknown)');
  assert.equal(b.unknown, false, 'the second call keeps its own answer (waiting), not the first one\'s');
});

test('LOW c: the Industry warning says which sector views remain; the server template says why it has no flag', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /Line is open for all 18 and Map for the other 15/);
  assert.doesNotMatch(cfg, /or switch it to map\/line/);
  assert.match(read('supabase/functions/_shared/templates.ts'), /No flag here on purpose/);
});

test('LOW d: the launch smoke checks the hero button itself, not the page (the header also says Create an account)', () => {
  const py = read('tools/launch-smoke.py');
  assert.match(py, /hero_button = page\.locator\('\.rg-hero-cta a\.rg-btn'\)/);
  assert.match(py, /hero_button\.first\.inner_text\(\)\.strip\(\) == CREATOR_CTA/);
});

test('LOW e: the report page shows no film link example while film pages are off', () => {
  const html = read('report/index.html');
  assert.doesNotMatch(html, /film\/\?s=/);
  assert.match(html, /id="r-film" type="text" autocomplete="off" placeholder="The link you were sent"/);
});

test('CC1 finding 1: Coming soon keeps its own solid ground in the redesign CSS, so its contrast is the tag against that ground', () => {
  const css = read('assets/ryagram-ds.css');
  const rule = css.match(/body\.ryagram-ds\.ryagram-look \.soon-tag\{[^}]*\}/)[0];
  assert.match(rule, /color:#ffb27a;background:#10121a;opacity:1/);   // plain hex since 11-23 (tests/soon-tag-contrast.test.mjs)
  assert.match(css, /--bg-2:#10121a/);
  assert.match(css, /--accent-2:#ffb27a/);
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio('#ffb27a', '#10121a') >= 4.5);
  assert.ok(ratio('#c9a66b', '#fbfaf7') < 3, 'the old fallback colour on a pale ground is the 2.25:1 the check found');
});

test('CC1 finding 2: the waitlist check pins the words the /ryagram/ updates form answers now, not "on the list"', () => {
  const js = read('assets/ryagram.js');
  assert.match(js, /say\('Thanks\. We’ll keep you posted about Ryagram\.'\)/);
  const py = read('tools/check-waitlist-join.py');
  assert.match(py, /t == 'Thanks\. We’ll keep you posted about Ryagram\.' and 'on the list' not in t/);
  assert.doesNotMatch(py, /check\('on the list' in t/);
});

test('MEDIUM 1: the queue-wait page check pins the current words, and no stale queue sentence is left in tools/ or tests/', () => {
  const py = read('tools/check-queue-wait-1123.py');
  assert.match(py, /Number 4 in line\. We make one film at a time\. It may be working on another film right now\./);
  assert.match(py, /'few hours' not in txt/);
  const files = [['tools', /\.(py|mjs|js)$/], ['tests', /\.(mjs|cjs)$/]].flatMap(([d, re]) => fs.readdirSync(new URL(`../${d}/`, import.meta.url)).filter(n => re.test(n) && n !== 'wed-v3-fixes-1123.test.mjs').map(n => `${d}/${n}`));
  for (const f of files) assert.doesNotMatch(read(f), /The machine makes one film at a time/, f);
});
