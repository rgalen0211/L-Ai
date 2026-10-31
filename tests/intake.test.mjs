// NEXT-WEB 173: the website intake. One basic question first, then only the questions that fit; every address it makes is from a closed list; the builder reads only that closed list back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8');
const ctx = { Math, Number, String, Object, Array, JSON, decodeURIComponent, Error }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('assets/app-intake.js'), ctx);
const I = ctx.ryagramIntake, J = x => JSON.parse(JSON.stringify(x));

test('one basic question first; a compilation and a coming-soon idea have no second question', () => {
  assert.deepEqual(J(I.next({})), { screen: 'kind' });
  assert.deepEqual(J(I.next(undefined)), { screen: 'kind' });
  assert.deepEqual(J(I.next({ kind: 'nonsense' })), { screen: 'kind' });
  assert.equal(I.next({ kind: 'compilation' }).screen, 'compilation');
  assert.deepEqual(J(I.next({ kind: 'compilation', about: 'map' })), { screen: 'compilation' });
  const soon = I.next({ kind: 'soon' });
  assert.equal(soon.screen, 'soon'); assert.deepEqual(J(soon.ids), ['geo_intelligence', 'games', 'animation_studio']);
  assert.deepEqual(J(I.next({ kind: 'data' })), { screen: 'about' });
  assert.deepEqual(J(I.next({ kind: 'data', about: 'x' })), { screen: 'about' });
});

test('a data film asks what it is about, and each answer lands on the right first screen; the globe is coming soon, not a dead end', () => {
  assert.equal(I.next({ kind: 'data', about: 'map' }).href, '#/build?type=map&q=county');
  assert.equal(I.next({ kind: 'data', about: 'bars' }).href, '#/build?type=bars');
  assert.equal(I.next({ kind: 'data', about: 'line' }).href, '#/build?type=line');
  const g = I.next({ kind: 'data', about: 'globe' });
  assert.equal(g.screen, 'soon'); assert.deepEqual(J(g.ids), ['geo_intelligence']); assert.ok(!('href' in g));
  assert.ok(I.Q2.find(q => q.id === 'globe').blurb.includes('Not built yet'));
});

test('the builder reads only a known type and a short plain search word from the address; everything else is ignored', () => {
  assert.deepEqual(J(I.parseBuildQuery('#/build')), {});
  assert.deepEqual(J(I.parseBuildQuery('#/build?type=map&q=county')), { type: 'map', q: 'county' });
  assert.deepEqual(J(I.parseBuildQuery('#/build?type=bars')), { type: 'bars' });
  assert.deepEqual(J(I.parseBuildQuery('#/build?type=evil&q=%3Cscript%3E')), {});
  assert.deepEqual(J(I.parseBuildQuery('#/build?q=' + 'a'.repeat(31))), {});
  assert.deepEqual(J(I.parseBuildQuery('#/build?q=state+map')), { q: 'state map' });
  assert.equal(I.parseBuildQuery('#/builder'), null); assert.equal(I.parseBuildQuery('#/account'), null);
  assert.equal(I.buildHref('paired'), '#/build?type=paired'); assert.equal(I.buildHref('x'), '#/build');
});

test('wiring: behind a switch that is OFF, the route and the link exist only when it is on, the script loads before the library, and the page builds nothing from a person', () => {
  const cfg = read('assets/ryagram-config.js'), lib = read('assets/app-library.js'), html = read('app/index.html'), src = read('assets/app-intake.js');
  assert.match(cfg, /\n  intake: false,/);
  assert.match(lib, /const intakeOn = \(\) => window\.ryagramConfig\?\.intake === true;/);
  assert.match(lib, /intakeOn\(\) && window\.ryagramIntake && hash === '#\/new'/);
  assert.match(lib, /const intakeLink = intakeOn\(\) && window\.ryagramIntake/);
  assert.ok(html.indexOf('/assets/app-intake.js') > html.indexOf('/assets/app-builder.js') && html.indexOf('/assets/app-intake.js') < html.indexOf('/assets/app-library.js'));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(|localStorage/.test(src));
});
