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
  assert.ok(FREE.CLOSED.startsWith('When you confirm your email you get 8 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. '));
  assert.ok(FREE.OPEN.startsWith('When you confirm your email you get 8 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. ') && FREE.OPEN.endsWith('Credits pay for full films.'));
  const lo = 6, mid = 8, hi = 10;
  assert.ok(mid >= lo && mid < hi, '8 covers some film types and not all');
  assert.ok(lib.includes("const FILM_COST_CLOSED = 'A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones.';"));
  assert.ok(lib.includes("const WELCOME_LINE = 'When you confirm your email you get 8 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead.';"));
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
    for (const have of [0, 2, 6, 7, 8, 9, 10]) {
      const q = quote(cost, have);
      const a = C.affordable(q, closed);
      const short = have < cost;
      assert.equal(a.ok, !short, `${have} credits against a ${cost}-credit film type`);
      assert.equal(C.filmVsBalance(q, short).startsWith(short ? ' The full film for this film type costs' : ' The full film uses'), true);
      if (short) {
        assert.ok(a.reason.startsWith(`This film type costs ${cost} credits and you have ${have === 1 ? '1 credit' : `${have} credit${have === 1 ? '' : 's'}`}.`), a.reason);
        assert.ok(a.reason.includes('Buying credits is not open yet.'), 'the next step: buying is closed');
        assert.doesNotMatch(a.reason, /Not enough credits/);
        const fits = have >= 6;      // the cheapest film type costs 6: the hint shows only when the balance covers it
        assert.equal(a.reason.includes('A cheaper film type would fit.'), fits, `${have} against ${cost}: the "would fit" hint shows only when the cheapest type is covered`);
        if (fits) assert.ok(a.reason.endsWith(' A cheaper film type would fit. Choose another film type in the builder.'), a.reason);
        assert.doesNotMatch(a.reason, /costs \d+ credits would fit/);
        assert.doesNotMatch(a.reason, /or less/);
        assert.equal(C.filmVsBalance(q, true), ` The full film for this film type costs ${cost} credits and you have ${have} credit${have === 1 ? '' : 's'}, so it cannot be made yet.`.replace(`${have} credit${have === 1 ? '' : 's'},`, `${have} credit${have === 1 ? '' : 's'},`));
      } else {
        assert.equal(C.filmVsBalance(q, false), ` The full film uses ${cost} credits; you have ${have} credit${have === 1 ? '' : 's'}.`);
      }
    }
  }
  // the headline cases, word for word
  assert.equal(C.affordable(quote(10, 8), closed).reason, 'This film type costs 10 credits and you have 8 credits. Buying credits is not open yet. A cheaper film type would fit. Choose another film type in the builder.');
  assert.equal(C.affordable(quote(8, 8), closed).ok, true);
  assert.equal(C.affordable(quote(6, 8), closed).ok, true);
  assert.equal(C.filmVsBalance(quote(8, 8), false), ' The full film uses 8 credits; you have 8 credits.');
  assert.equal(C.filmVsBalance(quote(6, 8), false), ' The full film uses 6 credits; you have 8 credits.');
  assert.equal(C.filmVsBalance(quote(10, 8), true), ' The full film for this film type costs 10 credits and you have 8 credits, so it cannot be made yet.');
  // buying open: no "not open" sentence; a previous caller without rows keeps the old words for contact sheets and previews
  assert.equal(C.affordable(quote(10, 8), { rows: TABLE, closed: false }).reason, 'This film type costs 10 credits and you have 8 credits. A cheaper film type would fit. Choose another film type in the builder.');
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

test('THE HINT names no price (a dataset may not offer it) and says where to change it: balances 0, 2, 5, 6, 7, 8, 9, 10, buying closed and open', () => {
  const where = ' Choose another film type in the builder.';
  const SAY = ' A cheaper film type would fit.' + where;
  const hint = (cost, have) => C.fitsLine(quote(cost, have), TABLE);
  for (const cost of [8, 10]) {
    for (const have of [0, 2, 5, 6, 7, 8, 9, 10]) {
      const short = have < cost;
      const h = hint(cost, have);
      assert.equal(h, short && have >= 6 ? SAY : '', `${cost}-credit type, ${have} credits`);
      assert.doesNotMatch(h, /\d/, 'the hint names no number');
      for (const closed of [true, false]) {
        const a = C.affordable(quote(cost, have), { rows: TABLE, closed });
        assert.equal(a.ok, !short);
        if (short) assert.equal(a.reason, `This film type costs ${cost} credits and you have ${have} credit${have === 1 ? '' : 's'}.${closed ? ' Buying credits is not open yet.' : ''}${h}`, `${cost}/${have}/${closed ? 'closed' : 'open'}`);
      }
    }
  }
  // the cheapest type (6) is never short of itself and nothing is cheaper
  assert.equal(hint(6, 5), '');
  assert.equal(hint(6, 0), '');
  assert.equal(C.affordable(quote(10, 10), { rows: TABLE, closed: true }).ok, true, 'a 10-credit balance covers a 10-credit type: not short, no hint');
  assert.equal(hint(10, 7), SAY, 'at 7 and 9 no price is named either');
  assert.equal(hint(10, 9), SAY);
  assert.equal(C.affordable(quote(10, 7), { rows: TABLE, closed: true }).reason, 'This film type costs 10 credits and you have 7 credits. Buying credits is not open yet.' + SAY);
  assert.equal(C.affordable(quote(10, 5), { rows: TABLE, closed: true }).reason, 'This film type costs 10 credits and you have 5 credits. Buying credits is not open yet.', 'below the cheapest price: no hint');
  assert.equal(C.affordable(quote(10, 2), { rows: TABLE, closed: true }).reason, 'This film type costs 10 credits and you have 2 credits. Buying credits is not open yet.', 'no type fits: no hint, as before');
  assert.equal(C.affordable(quote(10, 0), { rows: TABLE, closed: true }).reason, 'This film type costs 10 credits and you have 0 credits. Buying credits is not open yet.');
  assert.equal(C.fitsLine(quote(10, 8), []), '', 'no price rows read: no hint');
  // a ['bars', 'line'] dataset (cbp_mining_share_state, cbp_suppression: Bars 10, Line 6, no 8-credit type) at 8 credits: never "8 credits", says a cheaper type would fit
  const mining = C.affordable({ price_code: 'final_paired', credits: 10, free_preview: false, available: 8 }, { rows: TABLE, closed: true }).reason;
  assert.doesNotMatch(mining.slice(mining.indexOf('Buying credits')), /8 credits/);
  assert.ok(mining.endsWith('A cheaper film type would fit. Choose another film type in the builder.'), mining);
  // every dataset the builder offers keeps a line view, the cheapest price: so the hint is true for all of them (the block list never removes 'line')
  const block = JSON.parse(read('tools/data/engine-catalog-block-list-1123.json'));
  for (const [id, views] of Object.entries(block)) assert.ok(!views.includes('line'), `${id}: line is never blocked`);
  const cat = {}; new Function('window', read('assets/app-catalog-data.js'))(cat);
  const usable = cat.ryagramCatalogData.entries.filter(e => e.status === 'usable' || cat.ryagramCatalogData.allow.includes(e.id));
  assert.ok(usable.length >= 24);
  for (const e of usable) assert.ok((e.views || []).includes('line'), `${e.id} offers a line view`);
  assert.equal(Math.min(...TABLE.map(r => r.credits)), 6, 'line is the cheapest price');
  // the step it points at exists under that name
  assert.match(read('assets/app-builder.js'), /\['type', 'Film type'\]/);
});

test('THE INVITE CLAUSE (GAMES 16:12, FACES 16:09): every copy of the welcome line says an invite-code account gets the credits that code gives instead of the 8; the Credits page and Home do not carry it', () => {
  const clause = 'If you sign up with an invite code, you get the credits that code gives instead.';
  for (const f of ['app/index.html', 'ryagram/index.html', 'help/index.html']) assert.ok(read(f).includes(clause), f);
  assert.ok(FREE.CLOSED.includes(clause) && FREE.OPEN.includes(clause));
  assert.ok(lib.includes(`const WELCOME_LINE = 'When you confirm your email you get 8 welcome credits, once for each email address. ${clause}';`));
  const credits = lib.slice(lib.indexOf('async function creditsView'), lib.indexOf('async function creditsView') + 6000);
  assert.ok(!credits.includes('invite code'), 'the Credits page does not say it (phone height; it cannot know where a balance came from)');
  assert.ok(!credits.includes('These include your welcome credits'), 'FACES (b) not added: false for an invited account or a later buyer');
});
