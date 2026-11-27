// Perfect City in the top bar (GEO 11-27): the per-account switch perfectCity is the ONLY key to the working page.
// With it, geo_intelligence is a working department; without it, it stays Coming soon even if the server's list says 'working'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const plain = (x) => JSON.parse(JSON.stringify({ working: x.working, soon: x.soon }));
const h = (tag, attrs, ...kids) => ({ tag, attrs, kids });

async function modelFor({ switchOn, rows }) {
  const win = {};                                  // a fresh page each time: the switch list is read once per page load
  for (const f of ['app-switches.js', 'app-departments.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
  win.ryagramConfig = { departments: true, aiFirst: true, connectAi: true, perfectCity: 'account' };
  await win.ryagramSwitches.load({ mySwitches: async () => (switchOn ? ['perfectCity'] : []) });
  win.ryagramPerfectCityPage = { view: async () => ['PERFECT CITY PAGE'] };
  const ui = win.ryagramDepartments.create({ h, data: { myDepartments: async () => rows, listProjects: async () => [], myDepartmentInterests: async () => [] } });
  return { ui, m: await ui.load() };
}
const SERVER = [{ id: 'data_films', status: 'working' }, { id: 'geo_intelligence', status: 'soon' }, { id: 'games', status: 'soon' }];

test('switch ON: Perfect City is a working department and #/d/geo_intelligence is its page', async () => {
  const { ui, m } = await modelFor({ switchOn: true, rows: SERVER });
  assert.deepEqual(plain(m), { working: ['data_films', 'geo_intelligence'], soon: ['games', 'forecasts'] });
  assert.deepEqual(await ui.pageView('geo_intelligence'), ['PERFECT CITY PAGE']);
});

test('switch OFF: Perfect City stays Coming soon, even when the server says working', async () => {
  for (const rows of [SERVER, SERVER.map((r) => (r.id === 'geo_intelligence' ? { ...r, status: 'working' } : r))]) {
    const { m } = await modelFor({ switchOn: false, rows });
    assert.ok(!m.working.includes('geo_intelligence') && m.soon.includes('geo_intelligence'), JSON.stringify(plain(m)));
  }
});

test('an admin account (the server lists nothing): the switch still decides', async () => {
  assert.ok((await modelFor({ switchOn: true, rows: [] })).m.working.includes('geo_intelligence'));
  assert.ok((await modelFor({ switchOn: false, rows: [] })).m.soon.includes('geo_intelligence'));
});

test('the shipping config holds perfectCity: \'account\' (named accounts only) and the page loads its scripts before the departments', () => {
  assert.match(read('assets/ryagram-config.js'), /^\s*perfectCity: 'account',/m);
  const html = read('app/index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('/assets/perfect-city-core.js?v=') > 0 && at('/assets/perfect-city-core.js') < at('/assets/app-perfect-city.js') && at('/assets/app-perfect-city.js') < at('/assets/app-departments.js'));
  assert.ok(at('/assets/perfect-city.css?v=') > 0);
});
