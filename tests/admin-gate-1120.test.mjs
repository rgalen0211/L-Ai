// The admin pages stay admin-only after the site's one Admin page and Admin link (WEB web-site-1120; GAMES' second review 11-20 07:17:
// the new #/admin route and the top bar's Admin link had no unit pin, while every older admin page had one). Source checks over
// assets/app-library.js, each proved able to fail: the same check run on the source with the gate taken out must say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LIB = read('assets/app-library.js');

// every branch of the router that opens an admin page: `hash === '#/admin...'` on an `else if (...)` line
function adminRoutes(src) {
  return src.split('\n').filter(l => /^\s*(else )?if \(.*hash === '#\/admin[^']*'/.test(l));
}
// a route is gated when the SAME condition awaits the admin check before the view is made
const gated = line => /hash === '#\/admin[^']*' && await data\.isAppAdmin\(\)\)\s*view = /.test(line);

// the Admin link: added only inside the isAppAdmin() answer, after an early return for anything but a plain true
function linkGated(src) {
  const i = src.indexOf("h('a', { class: 'app-nav-link admin-link', href: '#/admin' }, 'Admin')");
  if (i < 0) return { found: false };
  const before = src.slice(Math.max(0, i - 400), i);
  return { found: true, asks: /data\.isAppAdmin\(\)\)\.then\(yes => \{\s*if \(!alive \|\| yes !== true\) return;/.test(before) };
}

test('EVERY ADMIN ROUTE asks isAppAdmin() in its own condition, the new #/admin page included', () => {
  const routes = adminRoutes(LIB);
  const names = routes.map(l => l.match(/hash === '(#\/admin[^']*)'/)[1]);
  assert.ok(names.includes('#/admin'), 'the Admin page route is there');
  for (const n of ['#/admin/waiting', '#/admin/waitlist', '#/admin/visits', '#/admin/ops', '#/admin/funnel', '#/admin/tester', '#/admin/renders']) assert.ok(names.includes(n), n);
  assert.deepEqual(routes.filter(l => !gated(l)).map(l => l.trim().slice(0, 120)), [], 'an admin route without the admin check');
});

test('MUST-FAIL: the route check notices an admin route whose admin check was taken out (the new #/admin page and an old one)', () => {
  for (const name of ['#/admin', '#/admin/visits']) {
    const line = adminRoutes(LIB).find(l => l.includes(`hash === '${name}'`));
    const broken = LIB.replace(line, line.replace(' && await data.isAppAdmin()', ''));
    assert.notEqual(broken, LIB, `the fault was planted for ${name}`);
    assert.equal(adminRoutes(broken).filter(l => !gated(l)).length, 1, `${name} without its check is found`);
  }
});

test('THE ADMIN LINK in the top bar is added only after isAppAdmin() answers true for this mount', () => {
  assert.deepEqual(linkGated(LIB), { found: true, asks: true });
});

test('MUST-FAIL: the link check notices a link added whatever the answer', () => {
  const broken = LIB.replace('if (!alive || yes !== true) return;', 'if (!alive) return;');
  assert.notEqual(broken, LIB, 'the fault was planted');
  assert.deepEqual(linkGated(broken), { found: true, asks: false });
});

test('THE ADMIN PAGE lists only the admin pages that are switched on (each row carries its own switch)', () => {
  const block = LIB.slice(LIB.indexOf('const adminPages = () => ['), LIB.indexOf('].filter', LIB.indexOf('const adminPages = () => [')) + 60);
  assert.match(block, /\]\.filter\(/, 'the list is filtered');
  const rows = block.split('\n').filter(l => /^\s*\['#\/admin\//.test(l));
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.filter(l => !/, (true|[a-zA-Z]+On\(\))\]/.test(l)).map(l => l.trim().slice(0, 60)), [], 'a row without its switch');
});
