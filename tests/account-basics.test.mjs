// Account basics (consumer audit, queue item 2): change email, download my data, a visible Help line. Delete my account already exists (behind accountTools) and is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
vm.runInNewContext(read('assets/app-account.js'), { window: win });
const A = win.ryagramAccount;
const plain = v => JSON.parse(JSON.stringify(v));

test('CHANGE EMAIL: bad, empty and unchanged addresses are refused in plain words before anything is sent', () => {
  assert.equal(A.emailProblem('', 'a@b.co'), 'Type the new email address.');
  assert.match(A.emailProblem('not-an-email', 'a@b.co'), /doesn.t look like an email/);
  assert.match(A.emailProblem('A@B.co', 'a@b.co'), /already your email/);
  assert.equal(A.emailProblem(' new@example.com ', 'a@b.co'), null);
  assert.match(A.sentLine('new@example.com'), /changes when you press the button.*keep signing in with your current one/);
});

test('DOWNLOAD: the file carries every part, says what it leaves out, and names a part it could not read', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const file = A.buildExport({ projects: [{ id: 'p1' }], jobs: [], credit_ledger: { error: 'permission denied' }, account_settings: null }, { email: 'me@example.com', now });
  assert.equal(file.exported_at, '2026-10-17T10:00:00.000Z');
  assert.equal(file.account.email, 'me@example.com');
  assert.deepEqual(plain(file.projects), [{ id: 'p1' }]);
  assert.deepEqual(plain(file.credit_ledger), [], 'an unreadable part is empty, not missing');
  assert.deepEqual(plain(file.account_settings), []);
  assert.ok(file.not_in_this_file.some(l => /rendered films/.test(l)) && file.not_in_this_file.some(l => /uploaded|Spreadsheets/.test(l)));
  assert.ok(file.not_in_this_file.some(l => /credit_ledger: permission denied/.test(l)), 'the gap is named in the file');
  assert.equal(A.fileName(now), 'ryagram-my-data-2026-10-17.json');
});

test('WIRING: the account page loads the module, shows Email after Password, Download and Help; the data layer reads only existing tables; the mock accepts an email change', () => {
  const html = read('app/index.html');
  assert.ok(html.indexOf('/assets/app-account.js') < html.indexOf('/assets/app-library.js'), 'account module loads before the library');
  const lib = read('assets/app-library.js');
  assert.match(lib, /sections\.splice\(4, 0, await acct\.changeEmailSection\(email\)\)/);
  assert.match(lib, /acct\.exportSection\(email\)/);
  assert.match(lib, /if \(helpSection\) sections\.push\(helpSection\)/, 'Help comes last, after Delete');
  const data = read('assets/app-data.js');
  assert.match(data, /client\.auth\.updateUser\(\{ email \}\)/);
  const tables = [...data.slice(data.indexOf('async collectMyData')).slice(0, 1500).matchAll(/\['([a-z_]+)', /g)].map(m => m[1]);
  assert.deepEqual(tables.sort(), ['account_settings', 'credit_balances', 'credit_ledger', 'film_requests', 'jobs', 'projects', 'render_orders', 'versions']);
  assert.match(read('tests/fake-supabase.js'), /emailChangeRequested/);
});
