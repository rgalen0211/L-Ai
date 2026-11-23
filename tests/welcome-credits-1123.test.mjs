// Q679 B (Ryan 11-23 15:46): a new account gets 8 welcome credits when its email is verified, once per email address. The PAGE words and states for an account that holds 8:
// a stranger is never told "0 credits / never a full film", and never offered what 8 credits cannot buy (a 10-credit film type, a 10-credit film request).
// Every sentence here fails on the old wording (proposals/WEB-WED-WELCOME-1123.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = (f, extra = {}) => { const win = { ...extra }; vm.runInNewContext(read(`assets/${f}`), { window: win, document: { querySelectorAll: () => [] }, setTimeout, clearTimeout }); return win; };
const C = load('app-credits.js').ryagramCredits;
const J = load('app-jobs.js').ryagramJobs;
const FREE = load('free-account-line.js').ryagramFreeAccountLine;
const lib = read('assets/app-library.js');
const sql = read('supabase/phase-2b/credits_ledger.sql');

// the price rows as the page reads them (data.filmPrices: final_* rows of credit_prices)
const TABLE = [{ code: 'final_line', credits: 6 }, { code: 'final_map', credits: 8 }, { code: 'final_paired', credits: 10 }];
const quote = (cost, available) => ({ price_code: cost === 6 ? 'final_line' : cost === 8 ? 'final_map' : 'final_paired', credits: cost, free_preview: false, available });

test('FACTS: the price table, the view prices and the request cost are what the sentences say', () => {
  for (const [code, n] of [['final_line', 6], ['final_map', 8], ['final_paired', 10]]) assert.match(sql, new RegExp(`\\('2026-09', '${code}', ${n}, null, false`));
  assert.match(sql, /\('line', 'final_line', 1\)/);
  assert.match(sql, /\('map', 'final_map', 2\), \('river', 'final_map', 2\), \('split', 'final_map', 2\)/);
  assert.match(sql, /\('paired', 'final_paired', 3\), \('bars', 'final_paired', 3\), \('panel', 'final_paired', 3\)/);
  assert.match(sql, /\('globe', 'final_paired', 3\)/);
  assert.match(read('supabase/migrations/20261016000200_creator_flow.sql'), /film_request_credits int not null default 10/);
  assert.match(sql, /preview_extra', 1,/);
});

test('THE TYPED NUMBERS (people who are not signed in cannot read the price table) match it: 6 to 10, and 8 welcome credits cover the smaller types only', () => {
  assert.ok(FREE.CLOSED.includes('A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones.'));
  assert.ok(FREE.CLOSED.startsWith('When you confirm your email you get 8 welcome credits, once for each email address. '));
  assert.ok(FREE.OPEN.startsWith('When you confirm your email you get 8 welcome credits, once for each email address. ') && FREE.OPEN.endsWith('Credits pay for full films.'));
  const lo = 6, mid = 8, hi = 10;
  assert.ok(mid >= lo && mid < hi, '8 covers some film types and not all');
  assert.ok(lib.includes("const FILM_COST_CLOSED = 'A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones.';"));
  assert.ok(lib.includes("const WELCOME_LINE = 'When you confirm your email you get 8 welcome credits, once for each email address.';"));
  assert.ok(!/never a full film|have 0 credits|0 credits, so/i.test(FREE.CLOSED + FREE.OPEN + lib), 'no "you have none" sentence is typed anywhere');
  assert.ok(!/A full film needs credits/.test(FREE.CLOSED + read('app/index.html') + read('help/index.html') + read('ryagram/index.html') + lib), 'the old "needs credits" closed sentence is gone');
});

test('THE CREDITS PAGE: the cost line follows the table; the balance sentence says what 0, 2, 6, 8, 10 credits cover (and nothing for a balance that covers every type)', () => {
  assert.equal(C.filmCostLine(TABLE), 'A full film costs between 6 and 10 credits, depending on the film type.');
  assert.equal(C.filmCoverLine(TABLE, 0), '');
  assert.equal(C.filmCoverLine(TABLE, 2), ' Your 2 credits do not cover a full film.');
  assert.equal(C.filmCoverLine(TABLE, 6), ' Your 6 credits cover only the cheapest film type.');
  assert.equal(C.filmCoverLine(TABLE, 8), ' Your 8 credits cover the smaller film types.');
  assert.equal(C.filmCoverLine(TABLE, 10), '');
  assert.equal(C.filmCoverLine(TABLE, 1), ' Your 1 credit does not cover a full film.', 'singular agrees');
  assert.equal(C.filmCoverLine([], 8), '', 'no price rows, no sentence');
  assert.equal(C.filmCoverLine(TABLE, null), '');
  // the numbers come from the rows: change the table, the sentence follows
  assert.equal(C.filmCoverLine([{ code: 'final_line', credits: 3 }, { code: 'final_map', credits: 20 }], 8), ' Your 8 credits cover only the cheapest film type.');
  assert.ok(lib.includes('C.filmCoverLine(filmRows, haveRows ?'));
});

test('FINAL-FILM BUTTON and the strip, by the film\'s OWN cost: credits 0, 2, 6, 8, 10 against each of 6, 8, 10', () => {
  const closed = { rows: TABLE, closed: true };
  for (const cost of [6, 8, 10]) {
    for (const have of [0, 2, 6, 8, 10]) {
      const q = quote(cost, have);
      const a = C.affordable(q, closed);
      const short = have < cost;
      assert.equal(a.ok, !short, `${have} credits against a ${cost}-credit film type`);
      assert.equal(C.filmVsBalance(q, short).startsWith(short ? ' The full film for this film type costs' : ' The full film uses'), true);
      if (short) {
        assert.ok(a.reason.startsWith(`This film type costs ${cost} credits and you have ${have === 1 ? '1 credit' : `${have} credit${have === 1 ? '' : 's'}`}.`), a.reason);
        assert.ok(a.reason.includes('Buying credits is not open yet.'), 'the next step: buying is closed');
        assert.doesNotMatch(a.reason, /Not enough credits/);
        const fits = TABLE.some(r => r.credits <= have && r.credits < cost);
        assert.equal(a.reason.includes('A film type that costs'), fits, `${have} against ${cost}: the "would fit" hint shows only when a cheaper type is covered`);
        if (fits) assert.ok(a.reason.endsWith(`A film type that costs ${have} credits or less would fit.`));
        assert.equal(C.filmVsBalance(q, true), ` The full film for this film type costs ${cost} credits and you have ${have} credit${have === 1 ? '' : 's'}, so it cannot be made yet.`.replace(`${have} credit${have === 1 ? '' : 's'},`, `${have} credit${have === 1 ? '' : 's'},`));
      } else {
        assert.equal(C.filmVsBalance(q, false), ` The full film uses ${cost} credits; you have ${have} credit${have === 1 ? '' : 's'}.`);
      }
    }
  }
  // the headline cases, word for word
  assert.equal(C.affordable(quote(10, 8), closed).reason, 'This film type costs 10 credits and you have 8 credits. Buying credits is not open yet. A film type that costs 8 credits or less would fit.');
  assert.equal(C.affordable(quote(8, 8), closed).ok, true);
  assert.equal(C.affordable(quote(6, 8), closed).ok, true);
  assert.equal(C.filmVsBalance(quote(8, 8), false), ' The full film uses 8 credits; you have 8 credits.');
  assert.equal(C.filmVsBalance(quote(6, 8), false), ' The full film uses 6 credits; you have 8 credits.');
  assert.equal(C.filmVsBalance(quote(10, 8), true), ' The full film for this film type costs 10 credits and you have 8 credits, so it cannot be made yet.');
  // buying open: no "not open" sentence; a previous caller without rows keeps the old words for contact sheets and previews
  assert.equal(C.affordable(quote(10, 8), { rows: TABLE, closed: false }).reason, 'This film type costs 10 credits and you have 8 credits. A film type that costs 8 credits or less would fit.');
  assert.equal(C.affordable({ price_code: 'preview_extra', credits: 1, available: 0 }).reason, 'This needs 1 credit and you have 0 credits.');
  assert.equal(C.affordable({ price_code: 'final_map', credits: 8, available: 2 }, { rows: [], closed: true }).reason, 'This film type costs 8 credits and you have 2 credits. Buying credits is not open yet.');
});

test('THE STRIP logic: short = this film\'s own quote against the balance, with buying closed; the strip reads the quote, not a constant', () => {
  assert.match(lib, /const cantBuy = !!q && typeof q\.credits === 'number' && \(q\.available \|\| 0\) < q\.credits && !buyingOn\(\);/);
  const strip = lib.slice(lib.indexOf('nextStrip.replaceChildren'), lib.indexOf('} else nextStrip.hidden = true;'));
  assert.ok(strip.includes('C.filmVsBalance(q, cantBuy)'));
  assert.ok(strip.includes("cantBuy ? 'You have a preview too.' : 'You have a preview too, so the full film is next.'"), 'the full-film sentence returns when the balance covers THIS film');
  assert.ok(strip.includes('BUYING_CLOSED_SHORT, C.fitsLine(q, filmRows)'));
  assert.ok(!/\b(6|8|10) credits\b/.test(strip), 'no cost is typed into the strip');
});

test('A REFUSAL after a press: insufficient credits is said in plain words with what it costs, what you have and the next step', () => {
  const closed = load('app-jobs.js', { ryagramConfig: { credits: true, payments: true, buyingOpen: false } }).ryagramJobs;
  const open = load('app-jobs.js', { ryagramConfig: { credits: true, payments: true, buyingOpen: true } }).ryagramJobs;
  assert.equal(closed.plainRefusal('Not enough credits: this needs 10, and 8 are available.'), 'This needs 10 credits and you have 8. Buying credits is not open yet.');
  assert.equal(closed.plainRefusal('Not enough credits: this needs 1, and 0 are available.'), 'This needs 1 credit and you have 0. Buying credits is not open yet.');
  assert.equal(open.plainRefusal('Not enough credits: this needs 10, and 8 are available.'), 'This needs 10 credits and you have 8. Buy credits, then try again.');
  assert.equal(closed.plainRefusal('Not enough credits for this job.'), 'You do not have enough credits for this. Buying credits is not open yet.');
  assert.doesNotMatch(closed.plainRefusal('Not enough credits: this needs 10, and 8 are available.'), /Not enough credits/);
});

test('HELP: the one swappable Q&A entry says 8 welcome credits and what they cover; the other places say the same number', () => {
  const at = lib.indexOf("qa('Why can\\u2019t I make a full film? How do I get credits?'");
  assert.ok(at > 0);
  const entry = lib.slice(at, lib.indexOf('\n', at));
  assert.ok(entry.includes("WELCOME_LINE + ' A free account can make free contact sheets. ' + FREE_PREVIEW_RULE + (buyingOn() ? ' Credits pay for full films.' : ' ' + FILM_COST_CLOSED + ' Buying credits is not open yet.')"));
  for (const f of ['app/index.html', 'ryagram/index.html', 'help/index.html']) assert.ok(read(f).includes(`>${FREE.CLOSED}</p>`), `${f} carries the CLOSED line word for word`);
  assert.equal((lib.match(/you get 8 welcome credits/g) || []).length, 1, 'one definition in the library');
});
