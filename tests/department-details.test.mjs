// NEXT-WEB 200: more honest words on the Opportunity Map and Games Coming soon pages, behind departmentDetails (OFF). Only those two departments, only when the switch is exactly true,
// and the words say what is coming, how numbers and people are treated, and what is NOT built yet, with no price, no date and no promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: {}, setTimeout, clearTimeout });
const Dp = win.ryagramDepartments, J = x => JSON.parse(JSON.stringify(x));

test('shown only for geo_intelligence and games, and only when the switch is exactly true', () => {
  for (const cfg of [undefined, null, {}, { departmentDetails: false }, { departmentDetails: 'true' }, { departmentDetails: 1 }]) assert.equal(Dp.detailsFor('geo_intelligence', cfg), null, JSON.stringify(cfg));
  const on = { departmentDetails: true };
  assert.ok(Dp.detailsFor('geo_intelligence', on) && Dp.detailsFor('games', on));
  for (const id of ['data_films', 'compilations', 'animation_studio', 'nope', '__proto__', 'constructor']) assert.equal(Dp.detailsFor(id, on), null, id);
  assert.deepEqual(J(Dp.SECTIONS.map(s => s[0])), ['building', 'rules', 'notYet']);
  assert.match(read('assets/ryagram-config.js'), /\n  departmentDetails: false,/);
});

test('every section is filled for both departments, and the not-built-yet part says so plainly with no price and no date', () => {
  for (const id of ['geo_intelligence', 'games']) {
    const d = Dp.detailsFor(id, { departmentDetails: true });
    for (const [key] of Dp.SECTIONS) assert.ok(Array.isArray(d[key]) && d[key].length >= (id === 'games' && key === 'building' ? 1 : 2), `${id}.${key}`);      // Games' building part is ONE sentence now (the games it lists exist, WEB-8)
    assert.ok(d.notYet.some(t => /no price and no date/i.test(t)), `${id}: says there is no price and no date`);
  }
  assert.ok(Dp.DETAILS.games.notYet.some(t => /Testers are playing an early version on their own computers/.test(t)) && !Dp.DETAILS.games.notYet.some(t => /No game can be played yet/.test(t)), 'the games exist now (WEB-8): said as existing, for testers');
  assert.ok(Dp.DETAILS.geo_intelligence.notYet.some(t => /not built/.test(t)) && Dp.DETAILS.geo_intelligence.notYet.some(t => /straight-line rings/.test(t)));
});

test('the words keep the brief\'s rules: labels on numbers, no invented points, no success score without data, consent for faces, own or licensed clips only', () => {
  const geo = Dp.DETAILS.geo_intelligence.rules.join(' '), games = Dp.DETAILS.games.rules.join(' ');
  assert.match(geo, /labelled observed, calculated, estimated or simulated/); assert.match(geo, /No made-up points/); assert.match(geo, /No success score unless real data/); assert.match(geo, /No conclusions about people from their background/);
  assert.match(games, /Only your own clips, or clips you have the right to use/); assert.match(games, /consent/); assert.match(games, /labelled as AI-altered/); assert.match(games, /checked against the transcripts/); assert.match(games, /but not anyone.s names, art or characters/);
});

test('nothing is promised: no price, no date, no absolute or boasting word, no outside link, no company name', () => {
  const all = Object.values(Dp.DETAILS).flatMap(d => Object.values(d).flat()).join('\n');
  assert.ok(!/[$\u00a3\u20ac]\s?\d|\b(20\d\d|Q[1-4]|January|February|March|April|June|July|August|September|October|November|December)\b/.test(all), 'no price or date');
  assert.ok(!/\b(guarantee|always|never|best|fastest|perfect|revolutionary|will definitely)\b/i.test(all), 'no absolute or boasting word');
  assert.ok(!/https?:|@/.test(all)); assert.ok(!/(Mafia|Pictionary)\b/.test(all), 'no other company game names'); const named = all.match(/(Guess Who|Old Maid)/g) || []; assert.ok(named.length <= 2, 'Guess Who and Old Maid are named only in the one sentence that lists the games Ryagram deals today (a trademark row is with the attorney: LEGAL-QUESTIONS-FOR-ATTORNEY)');
});

test('the page code shows the draft note and the three sections only through detailsFor, and the other Coming soon pages are untouched', () => {
  const code = read('assets/app-departments.js');
  assert.match(code, /const more = detailsFor\(id, window\.ryagramConfig\)/); assert.match(code, /Draft wording, not yet approved\./);
  assert.match(code, /k\.picture === 'phrase' \? phrasePicture\(\) : null, id === 'geo_intelligence' && locationPreviewOn\(window\.ryagramConfig\) \? locationPicture\(\) : null, stillsBlock\(id\), \.\.\.moreEls, id === 'games' && gameNightOn\(window\.ryagramConfig\) \? gameNightBox\(\) : null, area, msg/);      // (the made-up location picture, behind locationPreview OFF: tests/location-preview.test.mjs)
  assert.equal(J(Dp.KNOWN.compilations).line.startsWith('Say a phrase.'), true); assert.ok(J(Dp.KNOWN.games).line.startsWith('Game night on your own TV:'));      // the 10-26 placeholder line is gone (WEB-8, GEO's reviewed line)
});
