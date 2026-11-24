// BUYING OPEN (WEB 11-21, Ryan's 11:30 decisions): one switch, ryagramConfig.buyingOpen (default false while live payments are off), ties every Buy / Subscribe button and "Buy credits" link.
// Closed: Credits shows the balance and what credits are for, with NO packs, plans or prices (CC1 ruling 11-23 08:34: no price a stranger cannot pay during the preview), no button and no
// test-card text; a render short of credits says buying is not open yet.
// Open: today's page exactly (Buy/Subscribe buttons, the test-card text while stripeTestMode is true). The Credits page's real code runs here against a tiny fake DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lib = read('assets/app-library.js');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.className = ''; this.listeners = {}; this._text = null; this.value = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, f) { this.listeners[k] = f; }
  append(...k) { for (const x of k) this.kids.push(x); }
  set textContent(v) { this._text = String(v); this.kids = []; }
  get textContent() { return this._text ?? this.kids.map(k => (typeof k === 'string' ? k : k.textContent)).join(''); }
}
const all = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.kids.forEach(k => all(k, out)); return out; };
const flat = view => view.flat(Infinity).filter(Boolean);
const elements = view => flat(view).flatMap(n => (typeof n === 'string' ? [] : all(n)));
const textOf = view => flat(view).map(n => (typeof n === 'string' ? n : n.textContent)).join(' | ');

const OFFERS = [
  { code: 'pack_starter', credits: 10, price_cents: 1200, monthly: false },
  { code: 'sub_creator', credits: 30, price_cents: 2400, monthly: true },
  { code: 'sub_pro', credits: 100, price_cents: 6900, monthly: true }];

async function credits({ config = {}, mock = false, search = '', source = lib, prices = null, plan = null, checkout = null } = {}) {
  const document = { createElement: t => new El(t) };
  const win = { ryagramConfig: { credits: true, payments: true, stripeTestMode: true, ...config } };
  if (mock) win.ryagramMock = {};
  const Cmod = {}; vm.runInNewContext(read('assets/app-credits.js'), { window: Cmod });
  win.ryagramCredits = Cmod.ryagramCredits;
  win.ryagramFlip = { create: ({ sections }) => ({ el: sections.map(s => s.el) }) };
  const data = { shopOffers: async () => { credits.shopCalls++; return OFFERS; }, myPlan: async () => plan, creditBalances: async () => [{ available: 22, held: 0 }], startCheckout: async (code, answers) => { if (checkout) checkout.push([code, answers]); return '#'; }, openBillingPortal: async () => '#',
                 filmPrices: async () => prices || [] };
  const a = source.indexOf('  const creditsOn ='), b = source.indexOf('  const BUYING_CLOSED_SHORT'), helpers = source.slice(a, source.indexOf('\n', b));
  const body = source.slice(source.indexOf('    async function creditsView('), source.indexOf('    // --- #/p/<id>'));
  const h0 = source.indexOf('  function h(tag'), hSrc = source.slice(h0, source.indexOf('\n  }\n', h0) + 5);
  const code = `(function (window, document, location, history, setInterval, clearInterval, data) { ${hSrc}
    const errorLine = () => h('p', { class: 'form-note app-error', hidden: true });
    const showError = () => {}; const busy = async (b, l, fn) => { await fn(); };
    ${helpers}
    ${body}
    return creditsView(undefined, () => {}); })`;
  const fn = vm.runInNewContext(code, { document });
  const view = await fn(win, document, { search, hash: '#/credits', pathname: '/app/', assign() {} }, { replaceState() {} }, () => 0, () => {}, data);
  await new Promise(r => setTimeout(r, 5));
  return view;
}
credits.shopCalls = 0;
// What must be true of the closed state; the planted-fault test runs the closed state with open markup and expects violations.
const closedViolations = view => {
  const text = textOf(view), bad = [];
  if (elements(view).some(e => e.tag === 'button' && /^(Buy|Subscribe)$/.test(e.textContent))) bad.push('a Buy/Subscribe button');
  if (/4242/.test(text)) bad.push('the test card');
  if (/Test mode/i.test(text)) bad.push('Test mode text');
  if (!/Buying credits is not open yet\. Contact sheets are free\. Each project gets 6 free previews \(15 across all projects in any 24 hours\); then 1 credit each\. A failed free one caused by your story still counts\./.test(text)) bad.push('the closed line is missing');
  if (/\$\d/.test(text) || /Credit packs|Monthly plans|credits for \$|a month, \$/.test(text)) bad.push('packs, plans or prices are listed');
  if (elements(view).some(e => e.className === 'offer-list')) bad.push('an offer list is on the page');
  if (!/22 credits available/.test(text)) bad.push('the balance is missing');
  return bad;
};

test('CLOSED (the default config): Credits has no Buy or Subscribe button, no test card, no Test mode text, and says buying is not open yet; no packs, plans or prices; the balance still shows', async () => {
  assert.equal(vm.runInNewContext(`${read('assets/ryagram-config.js')}; window.ryagramConfig.buyingOpen`, { window: {} }), false, 'the committed config has buyingOpen false');
  assert.deepEqual(closedViolations(await credits({ config: { buyingOpen: false } })), []);
  assert.deepEqual(closedViolations(await credits({})), [], 'a missing switch is closed');
});

test('OPEN (buyingOpen true): today\'s page, Buy and Subscribe buttons, the test card and the Test mode label while stripeTestMode is true', async () => {
  const view = await credits({ config: { buyingOpen: true } });
  const labels = elements(view).filter(e => e.tag === 'button').map(e => e.textContent);
  assert.equal(labels.filter(l => l === 'Buy').length, 1);
  assert.equal(labels.filter(l => l === 'Subscribe').length, 2);
  const text = textOf(view);
  assert.match(text, /Use the card 4242 4242 4242 4242/);
  assert.match(text, /Test mode — prices are placeholders, no real charge\./);
  assert.match(text, /Payments are handled by Stripe/);
  assert.doesNotMatch(text, /Buying credits is not open yet/);
  assert.ok(/10 credits for \$12/.test(text) && /30 credits a month, \$24 a month/.test(text) && /100 credits a month, \$69 a month/.test(text), 'open: the packs and plans are listed with their prices');
  assert.deepEqual(closedViolations(view).filter(v => /packs, plans or prices|offer list/.test(v)).length, 2, 'the closed check really sees the open lists (it is not blind)');
});

test('MOCK mode is open (so the checkout checks keep their meaning) and ?buyingclosed shows the closed page there', async () => {
  const open = await credits({ config: { buyingOpen: false }, mock: true });
  assert.match(textOf(open), /Mock mode: nothing goes to Stripe/);
  assert.ok(elements(open).some(e => e.tag === 'button' && e.textContent === 'Buy'));
  assert.deepEqual(closedViolations(await credits({ mock: true, search: '?mock&buyingclosed' })), []);
});

test('NO PRICES ON THE WIRE (CC1 17:48): the closed Credits page makes no shop-offers request, so no pack or plan price travels in its network answer; open and mock still ask once', async () => {
  for (const args of [{ config: { buyingOpen: false } }, {}, { mock: true, search: '?buyingclosed' }]) {
    credits.shopCalls = 0;
    await credits(args);
    assert.equal(credits.shopCalls, 0, 'closed: no shop-offers request ' + JSON.stringify(args));
  }
  for (const args of [{ config: { buyingOpen: true } }, { mock: true }]) {
    credits.shopCalls = 0;
    await credits(args);
    assert.equal(credits.shopCalls, 1, 'open: one shop-offers request ' + JSON.stringify(args));
  }
  // planted fault: the old unconditional call is caught
  credits.shopCalls = 0;
  await credits({ config: { buyingOpen: false }, source: lib.replace('buyingOn() ? data.shopOffers() : []', 'data.shopOffers()') });
  assert.equal(credits.shopCalls, 1, 'the planted fault (always ask) is seen by the counter');
});

// BEFORE STRIPE (CC1 plan 11-24, Ohio sales tax): the first Buy asks business or personal use and where; nothing is asked while buying is closed; the answers ride with the checkout call.
const click = async el => { el.listeners.click({ currentTarget: el }); await new Promise(r => setTimeout(r, 3)); };
const byId = (view, id) => elements(view).find(e => e.attrs.id === id);
const buyButton = view => elements(view).find(e => e.tag === 'button' && /^Buy$/.test(e.textContent));
test('BEFORE STRIPE: closed = no question anywhere; open = the question is hidden until Buy is pressed, then it names its fields and sends the answers with the checkout call', async () => {
  const closed = await credits({ config: { buyingOpen: false } });
  assert.equal(elements(closed).filter(e => e.attrs.id === 'use-ask-title').length, 0, 'closed: no question on the page at all');
  const calls = [];
  const view = await credits({ config: { buyingOpen: true }, checkout: calls });
  const box = elements(view).find(e => e.className === 'use-ask');
  assert.ok(box && box.attrs.hidden !== undefined && box.hidden !== false, 'the question starts hidden: the page is no taller');
  await click(buyButton(view));
  assert.equal(box.hidden, false, 'Buy opens the question');
  assert.equal(calls.length, 0, 'nothing is sent before the answers');
  const go = elements(view).find(e => e.tag === 'button' && e.textContent === 'Continue to Stripe');
  const err = () => elements(view).find(e => e.className === 'form-note app-error' && e.attrs.role === 'alert');
  await click(go); assert.match(err().textContent, /Choose business or personal use\./);
  byId(view, 'use-business').listeners.change({}); await click(go); assert.match(err().textContent, /Choose where you use Ryagram\./);
  const country = byId(view, 'use-country'); country.value = 'US'; country.listeners.change({});
  await click(go); assert.match(err().textContent, /state as two letters/);
  const state = byId(view, 'use-state'); state.value = 'oh'; state.listeners.input({});
  await click(go); assert.match(err().textContent, /five-digit Ohio ZIP/);
  const z0 = byId(view, 'use-zip'); z0.value = '90210'; await click(go); assert.match(err().textContent, /Ohio ZIP/); assert.equal(calls.length, 0, 'a California ZIP is not an Ohio ZIP');
  const s0 = byId(view, 'use-state'); s0.value = 'xx'; s0.listeners.input({}); await click(go); assert.match(err().textContent, /state as two letters/); s0.value = 'oh'; s0.listeners.input({});
  const zip = byId(view, 'use-zip'); zip.value = '43215';
  await click(go);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['pack_starter', { use: 'business', country: 'US', state: 'OH', zip: '43215' }]]);
  // the second Buy in the same visit does not ask again
  await click(buyButton(view));
  assert.equal(calls.length, 2); assert.equal(calls[1][0], 'pack_starter'); assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), JSON.parse(JSON.stringify(calls[0][1])));
});
test('BEFORE STRIPE: personal use outside the US sends no state and no ZIP; a US state other than Ohio sends a state and no ZIP', async () => {
  for (const [country, st, want] of [['OTHER', '', { use: 'personal', country: 'OTHER' }], ['US', 'tx', { use: 'personal', country: 'US', state: 'TX' }]]) {
    const calls = [];
    const view = await credits({ config: { buyingOpen: true }, checkout: calls });
    await click(buyButton(view));
    byId(view, 'use-personal').listeners.change({});
    const c = byId(view, 'use-country'); c.value = country; c.listeners.change({});
    const s = byId(view, 'use-state'); s.value = st; s.listeners.input({});
    await click(elements(view).find(e => e.tag === 'button' && e.textContent === 'Continue to Stripe'));
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['pack_starter', want]]);
  }
});

test('PLANTED FAULT: the open-state markup in the closed state is caught', async () => {
  const faulty = lib.replace('const open = buyingOn();', 'const open = true;');
  assert.notEqual(faulty, lib);
  assert.ok(closedViolations(await credits({ config: { buyingOpen: false }, source: faulty })).length >= 2);
  const faulty2 = lib.replace('const buyingOn = () => paymentsOn() && (window.ryagramConfig?.buyingOpen === true', 'const buyingOn = () => paymentsOn() && (true');
  assert.notEqual(faulty2, lib);
  assert.ok(closedViolations(await credits({ config: { buyingOpen: false }, source: faulty2 })).length >= 2);
});

test('EVERY Buy site is tied to the one switch: no Buy/Subscribe label or #/credits Buy link in app-library.js outside buyingOn()', () => {
  const lines = lib.split('\n');
  const links = lines.filter(l => /'Buy credits'/.test(l));
  assert.equal(links.length, 2, 'the home chip and the render strip are the two Buy credits links');
  for (const l of links) assert.match(l, /buyingOn\(\)/);
  const at = lib.lastIndexOf('startCheckout(');
  assert.ok(lib.lastIndexOf("!open ? null : h('button'", at) > lib.lastIndexOf('const offerItem', at), 'the checkout button is inside the open-only branch');
  assert.equal(lib.split('startCheckout(').length, 3, 'two checkout calls in the whole library: Buy after the question was answered, and Continue to Stripe');
  assert.equal((lib.match(/paymentsOn\(\) \? \[/g) || []).length, 0, 'no Buy link is gated by paymentsOn alone any more');
  assert.match(lib, /if \(!can\.ok && !isFinal && paymentsOn\(\) && !buyingOn\(\)\) can\.reason \+= ` \$\{BUYING_CLOSED_SHORT\}`/, 'a preview short of credits says buying is not open yet (a full film says it inside its own reason: affordable(q, { closed }))');
  assert.match(lib, /closed: paymentsOn\(\) && !buyingOn\(\)/);
  assert.match(lib, /: paymentsOn\(\) && \(q\.available \|\| 0\) < q\.credits \? \[' ', BUYING_CLOSED_SHORT, C\.fitsLine\(q, filmRows\)\]/, 'the next-step strip says so too');
  assert.match(lib, /DRAFT FOR RYAN/);
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\n  buyingOpen: false,/);
  assert.match(cfg, /OWNER DECISION: the open sign-up flip does NOT touch this switch[\s\S]*flips to true only when live payments are on/);
  for (const f of fs.readdirSync(new URL('../assets/', import.meta.url)).filter(f => /^app-.*\.js$/.test(f) && f !== 'app-library.js' && f !== 'app-data.js')) {
    assert.doesNotMatch(read(`assets/${f}`), /startCheckout\(|'Buy credits'|'Subscribe'/, `${f} has no Buy site of its own`);
  }
});

// ---- what a credit buys (WEB 11-21, task 2): the sentence reads the price table's final_* rows --------------------------------------------------------
const TABLE = [{ code: 'final_line', credits: 6 }, { code: 'final_map', credits: 8 }, { code: 'final_paired', credits: 10 }];
test('WHAT A FILM COSTS: Credits says it from the price table, closed and open; one number when every type costs the same; nothing invented when the table is unreadable', async () => {
  for (const config of [{ buyingOpen: false }, { buyingOpen: true }]) {
    assert.match(textOf(await credits({ config, prices: TABLE })), /Credits pay for full films\. A full film costs between 6 and 10 credits, depending on the film type\./);
  }
  assert.match(textOf(await credits({ prices: [{ code: 'final_map', credits: 8 }, { code: 'final_line', credits: 8 }] })), /A full film costs 8 credits\./);
  assert.doesNotMatch(textOf(await credits({ prices: [] })), /A full film costs/);
  assert.doesNotMatch(textOf(await credits({ prices: [{ code: 'final_map', credits: 0 }] })), /A full film costs/);
  // the numbers are the table's, not a constant in the page: change the table, the sentence follows
  assert.match(textOf(await credits({ prices: [{ code: 'final_map', credits: 12 }, { code: 'final_paired', credits: 15 }] })), /between 12 and 15 credits/);
  assert.doesNotMatch(read('assets/app-credits.js'), /A full film costs[^`'\n]*\d/, 'no number is typed into the sentence');
});

test('WHAT A FILM COSTS: the data layer reads the CURRENT price versions final_* rows (the same table the ledger charges from)', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { createFakeClient } = req('./fake-supabase.js');
  const win = {}; vm.runInNewContext(read('assets/app-data.js'), { window: win });
  const client = createFakeClient({ credits: 0 });
  client.db.credit_prices.push({ price_version: '2099-01', code: 'final_map', credits: 99, price_cents: null, monthly: false, effective_from: '2099-01-01T00:00:00Z' });   // not in effect yet
  const rows = await win.ryagramData(client).filmPrices();
  assert.deepEqual(rows.map(r => [r.code, r.credits]).sort(), [['final_line', 6], ['final_map', 8], ['final_paired', 10]]);
  const sql = read('supabase/phase-2b/credits_ledger.sql');
  for (const [code, n] of [['final_line', 6], ['final_map', 8], ['final_paired', 10]]) assert.match(sql, new RegExp(`'${code}', ${n}, null`), `the ledger's table says ${code} is ${n}`);
});

// ---- GAMES' 13:05 review (WEB 11-21 bg) ---------------------------------------------------------------------------------------------------------------
test('M1: no page says previews are always free; both states say contact sheets are free and so are the FIRST previews', async () => {
  for (const config of [{ buyingOpen: false }, { buyingOpen: true }]) {
    const text = textOf(await credits({ config, prices: TABLE }));
    assert.match(text, /Contact sheets are free\. Each project gets 6 free previews \(15 across all projects in any 24 hours\); then 1 credit each\. A failed free one caused by your story still counts\./);
    assert.doesNotMatch(text, /always free|previews are free/i);
  }
  assert.doesNotMatch(lib, /always free|Contact sheets and previews are free/);
  assert.match(lib, /Your free previews are used up for now, so this one costs/, 'the paid preview still says it costs credits');
  const planted = lib.replace(/const FREE_PREVIEW_RULE = '[^']*';/, "const FREE_PREVIEW_RULE = 'Free contact sheets and previews are always free.';");
  assert.notEqual(planted, lib);
  assert.match(textOf(await credits({ source: planted })), /always free/, 'the planted untrue sentence is visible to the check');
});

test('LOW 1: "Cancel any time from Manage plan." is shown only when there is a plan (and so a Manage plan button)', async () => {
  const PLAN = { price_code: 'sub_creator', status: 'active', current_period_end: '2099-01-01T00:00:00Z' };
  for (const config of [{ buyingOpen: false }, { buyingOpen: true }]) {
    assert.doesNotMatch(textOf(await credits({ config })), /Manage plan/);
    const withPlan = textOf(await credits({ config, plan: PLAN }));
    assert.match(withPlan, /Manage plan/, 'a plan holder always has the Manage plan button');
    if (config.buyingOpen) assert.match(withPlan, /Cancel any time from Manage plan\./);
    else assert.doesNotMatch(withPlan, /Monthly plans/, 'closed: the plan list (and its note) is hidden even for a plan holder');
  }
  const planted = lib.replace("${current || plan ? ' Cancel any time from Manage plan.' : ''}", " Cancel any time from Manage plan.");
  assert.notEqual(planted, lib);
  assert.match(textOf(await credits({ config: { buyingOpen: true }, source: planted })), /Manage plan/, 'the planted always-on sentence is caught');
});

test('LOW 2: a paid preview with too few credits and buying closed says buying is not open yet, before any confirm or server call', () => {
  const ok = src => { const g = src.indexOf("&& paymentsOn() && !buyingOn() && (q.available || 0) < q.credits) {"), c = src.indexOf('await askConfirm(previewButton'); return g > 0 && c > g && src.slice(g, c).includes('BUYING_CLOSED_SHORT'); };
  assert.ok(ok(lib), 'the shortfall line comes before the confirm');
  assert.ok(!ok(lib.replace('&& paymentsOn() && !buyingOn() && (q.available || 0) < q.credits) {', '&& false) {')), 'the planted removal of the guard is caught');
});
