// GAMES 11-27 (hold 2, names): assets/game-names.js, the one name rule for the live room. FACES' 41 reference cases (15 allowed, 26 refused) and key tests, ported from
// Ryagram-logs/proposals/FACES-test_game_name_filter-1127.py, plus the three additions (hidden letters, stacked marks, look-alike keys), the empty shipped list, the page wiring,
// and must-fail mutants (each planted fault in a copy of the source must turn a check red). All names here are invented; 'zorbo' and 'quibblex' are FACES' invented stand-ins
// for words on a real list. This file is plain ASCII: every other character is a \u escape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('assets/game-names.js');
// The vm build is a different realm, so its result objects are copied to plain ones before deepEqual (raw: the frozen API itself).
const J = x => JSON.parse(JSON.stringify(x));
function loadRaw(src = SRC) { const win = {}; vm.runInNewContext(src, { window: win }); return win.ryagramGameNames; }
function load(src = SRC) { const g = loadRaw(src); return { ...g, problem: (...a) => J(g.problem(...a)), WORDS: J(g.WORDS), RESERVED: [...g.RESERVED] }; }
const N = load();

const SLUR_1 = 'zorbo', SLUR_2 = 'quibblex';
function withLists(G = N) { G.setBlocked([SLUR_1], [SLUR_2]); return G; }

const ALLOW = [
  ['Ana', 'Ana'], ['Ben', 'Ben'], ['Mary-Jane', 'Mary-Jane'], ["O'Brien", "O'Brien"], ['Dr. Sam', 'Dr. Sam'],
  ['  Cy   Lee ', 'Cy Lee'], ['Zo\u00eb', 'Zo\u00eb'], ['Player 2', 'Player 2'], ['Ghost', 'Ghost'],
  ['Hostel Pete', 'Hostel Pete'], ['Scunthorpe', 'Scunthorpe'], ['Zorbonia', 'Zorbonia'],
  ['Szorbo', 'Szorbo'], ['Admiral Ann', 'Admiral Ann'], ['Sixteen Chars Ok', 'Sixteen Chars Ok'],
];
const REFUSE = [
  ['', 'empty'], ['   ', 'empty'], ['...', 'noletter'], ['!!!', 'noletter'], ['12', 'noletter'],
  ['www.example.com', 'web'], ['bob@mail.com', 'web'], ['Host', 'reserved'], ['ADMIN', 'reserved'],
  ['h o s t', 'reserved'], ['4dm1n', 'reserved'], ['a.d.m.i.n', 'reserved'],
  ['Bob\u200b', 'hidden'], ['Bo\u202eb', 'hidden'], ['Bo\u0007b', 'hidden'],
  ['Abcdefghijklmnopq', 'long'],
  ['Mia \u{1F600}', 'chars'], ['Mia_X', 'chars'], ['Call 5551234567', 'phone'],
  [SLUR_1, 'blocked'], ['Z0RB0', 'blocked'], ['z o r b o', 'blocked'], ['ZOOORBO', 'blocked'],
  ['Big ' + SLUR_1, 'blocked'], ['x ' + SLUR_2 + 'y', 'blocked'], ['p\u0430ul', 'script'],
];

// The suite run on any build of the file; returns the list of failures (so a mutant can be judged by it).
function suite(G) {
  const bad = [];
  const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  withLists(G);
  for (const [raw, want] of ALLOW) { eq(G.problem(raw), null, `allow ${JSON.stringify(raw)}`); eq(G.cleanName(raw), want, `clean ${JSON.stringify(raw)}`); }
  for (const [raw, key] of REFUSE) { eq(G.problem(raw), { why: 'name', words: G.WORDS[key] }, `refuse ${JSON.stringify(raw)}`); eq(G.cleanName(raw), null, `clean ${JSON.stringify(raw)}`); }
  G.setBlocked([]);
  return bad;
}

test('FACES reference cases: 15 allowed (cleaned as FACES says) and 26 refused with the exact words', () => {
  assert.equal(ALLOW.length, 15); assert.equal(REFUSE.length, 26); assert.ok(ALLOW.length + REFUSE.length >= 25);
  assert.equal([...'Sixteen Chars Ok'].length, 16);
  assert.deepEqual(suite(N), []);
});

test('the words are FACES section 2, word for word', () => {
  assert.deepEqual({ ...N.WORDS }, {
    empty: 'Type a name to join.', long: 'Use 16 letters or fewer.', hidden: 'That name has hidden characters. Type it again.',
    noletter: 'Use at least one letter in your name.', web: 'Leave out web addresses and email addresses.', phone: 'Leave out phone numbers.',
    chars: 'Use letters, numbers, spaces, apostrophes and dashes only.', script: 'Use one alphabet in each word.',
    reserved: 'That name belongs to the game. Pick another.', blocked: 'Please pick a different name.',
    taken: 'Someone in this room already has that name. Add a letter or pick another.',
  });
  for (const w of ['host', 'admin', 'moderator', 'system', 'ryagram', 'game', 'tv', 'everyone', 'staff', 'support']) {
    assert.ok(N.RESERVED.includes(w), w);
    assert.deepEqual(N.problem(w[0].toUpperCase() + w.slice(1)), { why: 'name', words: N.WORDS.reserved }, w);
  }
  const raw = loadRaw(); assert.ok(Object.isFrozen(raw) && Object.isFrozen(raw.RESERVED) && Object.isFrozen(raw.WORDS));
});

test('the blocked reason never names the word', () => {
  withLists();
  assert.ok(!N.problem(SLUR_1).words.toLowerCase().includes(SLUR_1));
  N.setBlocked([]);
});

test('not a string is refused', () => {
  assert.ok(N.problem(null)); assert.ok(N.problem(5)); assert.ok(N.problem(undefined));
  assert.equal(N.cleanName(null), null);
});

test('unique key: case, accents, spaces, dots ignored; different names stay different', () => {
  assert.equal(N.nameKey('Ana'), N.nameKey(' A.na '));
  assert.equal(N.nameKey('Zo\u00eb'), N.nameKey('zoe'));
  assert.notEqual(N.nameKey('Ana'), N.nameKey('Anna'));
  for (const n of ['ANA', 'A.na', 'An\u00e1', 'A-na']) assert.equal(N.nameKey(n), N.nameKey('Ana'), n);
});

test('THE LIST SHIPS EMPTY: with no lists only the shape rules apply, and the source holds no blocked words', () => {
  const fresh = load();
  assert.equal(fresh.problem(SLUR_1), null);
  assert.equal(fresh.problem('x ' + SLUR_2 + 'y'), null);
  assert.match(SRC, /let blocked = new Set\(\);/); assert.match(SRC, /let stems = \[\];/);
  // setBlocked replaces, and [] empties again
  fresh.setBlocked([SLUR_1]); assert.ok(fresh.problem(SLUR_1)); fresh.setBlocked([]); assert.equal(fresh.problem(SLUR_1), null);
  fresh.setBlocked(['  ZORBO  ', 5, null]); assert.ok(fresh.problem(SLUR_1), 'list words are trimmed and lower-cased; non-strings ignored');
});

test('taken: a name already in the room (by nameKey) is refused with the taken words; names or player objects both work', () => {
  const taken = { why: 'name', words: N.WORDS.taken };
  assert.deepEqual(N.problem('ana', ['Ana']), taken);
  assert.deepEqual(N.problem('A.N.A', [{ name: 'Ben' }, { name: 'Ana' }]), taken);
  assert.deepEqual(N.problem('An\u00e1', ['Ana']), taken);
  assert.equal(N.problem('Anna', ['Ana']), null);
  assert.equal(N.problem('Ana', 'not a list'), null);
  // a refused name gives its own reason first, not "taken"
  assert.deepEqual(N.problem('Host', ['Host']), { why: 'name', words: N.WORDS.reserved });
});

test('ADDITION a: letters and marks that show as nothing are hidden characters (a lone Hangul filler is not a name)', () => {
  for (const s of ['\u3164', 'Ana\u3164', '\uffa0Bo', 'A\u034fna', 'Ana\ufe0f', '\u115f\u1160', 'Ana\u{e0041}']) assert.deepEqual(N.problem(s), { why: 'name', words: N.WORDS.hidden }, JSON.stringify(s));
  assert.equal(N.problem('Ana\tLee'), null, 'a tab is a space');
  assert.equal(N.cleanName('Ana\tLee'), 'Ana Lee');
});

test('ADDITION b: more than 3 marks stacked on one letter is refused; ordinary accents and Indic vowel signs pass', () => {
  // q: no precomposed q-with-accent exists, so NFKC leaves every mark in place (an 'a' would absorb the first one)
  assert.deepEqual(N.problem('Zq\u0301\u0302\u0303\u0304'), { why: 'name', words: N.WORDS.chars });
  assert.equal(N.problem('Zq\u0301\u0302\u0303'), null);
  assert.equal(N.problem('\u092a\u094d\u0930\u093f\u092f\u093e'), null, 'a Devanagari name');
  assert.equal(N.problem('Nguy\u1ec5n'), null);
});

test('ADDITION c: nameKey maps Cyrillic and Greek look-alikes, so an all-Cyrillic copy of a seated name is taken', () => {
  const copy = '\u0420\u043e\u0440';          // all Cyrillic: passes the one-alphabet rule by itself
  assert.equal(N.problem(copy), null);
  assert.deepEqual(N.problem(copy, ['Pop']), { why: 'name', words: N.WORDS.taken });
});

test('more FACES rules: other alphabets pass, two alphabets in one word do not, digits and leetspeak', () => {
  for (const ok of ['\u0410\u043d\u043d\u0430', '\u039c\u03b1\u03c1\u03af\u03b1', '\u5c0f\u660e', 'Ana \u0410\u043d\u043d\u0430', 'Team 123', 'Ana 7', 'Ann.', '\uff21\uff4e\uff41'])
    assert.equal(N.problem(ok), null, JSON.stringify(ok));
  assert.equal(N.cleanName('\uff21\uff4e\uff41'), 'Ana', 'full-width letters are folded by NFKC');
  assert.deepEqual(N.problem('Team 1234'), { why: 'name', words: N.WORDS.phone });
  assert.deepEqual(N.problem('a://b'), { why: 'name', words: N.WORDS.web });
  assert.deepEqual(N.problem('Ana/Bo'), { why: 'name', words: N.WORDS.chars });
  assert.deepEqual(N.problem('H0ST'), { why: 'name', words: N.WORDS.reserved });
  assert.deepEqual(N.problem('hooost'), { why: 'name', words: N.WORDS.reserved });
  assert.deepEqual(N.problem('Ana\u2028Lee'), { why: 'name', words: N.WORDS.hidden });
  assert.deepEqual(N.problem('Ana\ue000'), { why: 'name', words: N.WORDS.hidden });
});

test('PAGES: game-names.js loads (version-stamped) before game-room.js on the app page and the phone page', () => {
  for (const f of ['app/index.html', 'game-phone/index.html']) {
    const html = read(f);
    const names = html.indexOf('<script src="/assets/game-names.js?v=20261127n1"></script>'), room = html.indexOf('src="/assets/game-room.js?v=');
    assert.ok(names > 0 && room > names, f);
    assert.equal(html.split('game-names.js').length, 2, `${f}: loaded once`);
  }
});

test('plain ASCII in assets/game-names.js and this test', () => {
  for (const f of ['assets/game-names.js', 'tests/game-names.test.mjs']) assert.ok(!/[^\x00-\x7f]/.test(read(f)), f);
});

// MUST-FAIL: each planted fault in a copy of the source must make the suite (or its named check) go red. A mutant whose pattern is not found exactly once is itself a failure.
const hit = (bad, raw) => bad.some(b => b.startsWith(`allow ${JSON.stringify(raw)}`) || b.startsWith(`refuse ${JSON.stringify(raw)}`));
const MUTANTS = [
  ['drop the leetspeak fold', [['tokens(useLeet ? leet(plain) : plain)', 'tokens(plain)']], G => hit(suite(G), 'Z0RB0') && hit(suite(G), '4dm1n')],
  ['drop the whole-word rule (match inside words: Hostel, Zorbonia refused)', [['if (RESERVED_SET.has(w))', 'if ([...RESERVED_SET].some(r => w.includes(r)))'], ['if (blocked.has(w))', 'if ([...blocked].some(r => w.includes(r)))']],
    G => hit(suite(G), 'Hostel Pete') && hit(suite(G), 'Zorbonia')],
  ['drop the mixed-alphabet rule', [["if (scripts.size > 1) return fail('script');", '']], G => hit(suite(G), 'p\u0430ul')],
  ['drop joining one-letter words', [['if (w.length === 1) run += w;', 'if (false) run += w;']], G => hit(suite(G), 'h o s t') && hit(suite(G), 'z o r b o')],
  ['drop the repeat squash', [["w.replace(/(.)\\1{2,}/g, '$1')", 'w']], G => hit(suite(G), 'ZOOORBO')],
  ['drop the hidden-character check', [["if (c !== '\\t' && HIDDEN.test(c)) return fail('hidden');", ';']], G => hit(suite(G), 'Bo\u0007b') && hit(suite(G), 'Bob\u200b')],
  ['drop the stem list', [["if (stems.some(s => joined.includes(s))) return fail('blocked');", '']], G => hit(suite(G), 'x quibblexy')],
  ['drop the look-alike map from nameKey', [['return i >= 0 ? LOOK_TO[i] : c;', 'return c;']], G => G.problem('\u0420\u043e\u0440', ['Pop']) === null],
  ['drop Default_Ignorable from hidden', [['\\p{Zp}\\p{Default_Ignorable_Code_Point}', '\\p{Zp}']], G => G.problem('\u3164') === null],
];

for (const [what, swaps, caught] of MUTANTS) {
  test(`MUST-FAIL: ${what} is caught`, () => {
    let src = SRC;
    for (const [from, to] of swaps) { assert.equal(src.split(from).length, 2, `mutant pattern not found once in the source: ${from}`); src = src.replace(from, () => to); }
    assert.notEqual(src, SRC);
    assert.equal(caught(load(src)), true, `${what} was NOT caught`);
  });
}

test('MUST-FAIL baseline: no judge fires on the unbroken source', () => {
  for (const [what, , caught] of MUTANTS) assert.equal(caught(load()), false, `${what}: the judge fires on the real source, so it proves nothing`);
});
