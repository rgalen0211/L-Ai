// Credits in the app (2B): how prices, balances and a job's credits read to the person.
// The ledger (supabase/phase-2b/credits_ledger.sql) decides everything; this only words it.
(() => {
  const plural = n => `${n} credit${n === 1 ? '' : 's'}`;

  // A price label for a button, from credit_quote: { price_code, credits, free_preview, available }.
  function priceLabel(quote) {
    if (!quote) return '';
    if (quote.free_preview) return 'free preview';
    return quote.credits === 0 ? 'free' : plural(quote.credits);
  }

  // The prices of a full film by film type, from the price table's final_* rows (data.filmPrices); [] when unread.
  const filmPriceList = rows => (rows || []).map(r => r.credits).filter(c => typeof c === 'number' && c > 0);

  // ' A cheaper film type would fit. Choose another film type in the builder.' when the balance covers the CHEAPEST full-film price in the rows (6, the line view, which every dataset the builder offers keeps) and this film's
  // own type costs more than the balance; '' otherwise (no hint below the cheapest price). No number is named: a dataset may not offer a type at the dearest price the balance covers (mining at 8 credits has Bars 10 and Line 6, no 8).
  // The builder's step is called 'Film type' (STEPS in assets/app-builder.js). The strip, the final button's title and the refusal all read this one function.
  function fitsLine(quote, rows) {
    const have = Math.max(0, quote.available || 0);
    const prices = filmPriceList(rows);
    return prices.length && Math.min(...prices) <= have && quote.credits > have ? ' A cheaper film type would fit. Choose another film type in the builder.' : '';
  }

  // Whether the person can afford it, and if not, why (a negative balance blocks every hold).
  // A FULL FILM that costs more than the balance (Q679 B: 8 welcome credits pay for a 6 or 8 film, not a 10 one) says which film type costs what, that buying is not open yet when it is not,
  // and which cost would fit (read from the price rows when given, never typed). opts = { rows: filmPrices, closed: buying is not open }.
  function affordable(quote, opts) {
    if (!quote || quote.credits === 0 || quote.free_preview) return { ok: true };
    if (quote.available >= quote.credits) return { ok: true };
    const have = Math.max(0, quote.available);
    if (opts && /^final_/.test(String(quote.price_code || ''))) {
      return { ok: false, reason: `This film type costs ${plural(quote.credits)} and you have ${plural(have)}.${opts.closed ? ' Buying credits is not open yet.' : ''}${fitsLine(quote, opts.rows)}` };
    }
    return { ok: false, reason: `This needs ${plural(quote.credits)} and you have ${plural(have)}.` };
  }

  // The first-picture strip's cost sentence, by THE FILM'S OWN quote (q.credits is this version's view price, from credit_quote): what it uses when the balance covers it, and when it does
  // not (buying closed) that this film type cannot be made yet, never 'the full film is next'.
  function filmVsBalance(quote, short) {
    const have = Math.max(0, quote.available || 0);
    return short ? ` The full film for this film type costs ${plural(quote.credits)} and you have ${plural(have)}, so it cannot be made yet.` : ` The full film uses ${plural(quote.credits)}; you have ${plural(have)}.`;
  }

  // What the balance covers of the film prices (the Credits page): nothing when it covers every type or there is no balance to speak of.
  function filmCoverLine(rows, available) {
    const n = [...new Set(filmPriceList(rows))].sort((a, b) => a - b);
    if (!n.length || typeof available !== 'number' || available <= 0 || n.length === 1 && available >= n[0]) return '';
    if (available >= n[n.length - 1]) return '';
    const covered = n.filter(c => c <= available).length;
    if (!covered) return ` Your ${plural(available)} ${available === 1 ? 'does' : 'do'} not cover a full film.`;
    return covered === 1 ? ` Your ${plural(available)} cover only the cheapest film type.` : ` Your ${plural(available)} cover the smaller film types.`;
  }

  // What happened to a job's credits, from job_accounting.
  function jobCredits(a) {
    if (!a) return '';
    if (a.free_preview) return 'Free preview';
    if (!a.credits_quoted) return 'Free';
    if (a.refunded) return `${plural(a.captured)} spent, ${plural(a.refunded)} refunded`;
    if (a.released) return `${plural(a.released)} returned`;
    if (a.captured) return `${plural(a.captured)} spent`;
    if (a.held) return `${plural(a.held)} held until it finishes`;
    return plural(a.credits_quoted);
  }

  // The sentence under a failed or stopped job: only when the ledger says credits were released and none were spent.
  function returnedNote(a) {
    if (!a || a.free_preview || !a.credits_quoted || !a.released || a.captured) return '';
    return a.released === 1 ? 'Your credit was returned.' : `Your ${a.released} credits were returned.`;
  }

  // The balance line: available now, and how much is held by jobs in flight.
  function balanceLine(rows) {
    const available = rows.reduce((s, r) => s + r.available, 0);
    const held = rows.reduce((s, r) => s + r.held, 0);
    if (available < 0) return `Your balance is ${available} after a refund, so paid renders are paused until credits are added. Free sheets and previews still work.`;
    return `${plural(available)} available${held ? `, ${held} held by jobs in progress` : ''}`;
  }

  // Packs and plans (Stripe). Prices come from credit_prices; these only word them.
  const NAMES = { pack_starter: 'Starter', pack_maker: 'Maker', pack_studio: 'Studio', sub_creator: 'Creator', sub_pro: 'Pro' };
  const offerName = code => NAMES[code] || code;
  const money = cents => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  const offerLine = p => (p.monthly ? `${plural(p.credits)} a month, ${money(p.price_cents)} a month`
                                    : `${plural(p.credits)} for ${money(p.price_cents)}`);

  // What a full film costs, from the price table's final_* rows (data.filmPrices): one number, or a range when it depends on the film type. DRAFT FOR RYAN: the words.
  function filmCostLine(rows) {
    const n = (rows || []).map(r => r.credits).filter(c => typeof c === 'number' && c > 0);
    if (!n.length) return '';
    const lo = Math.min(...n), hi = Math.max(...n);
    return lo === hi ? `A full film costs ${plural(lo)}.` : `A full film costs between ${lo} and ${hi} credits, depending on the film type.`;
  }

  // A person's plan, from stripe_subscriptions; null when there's nothing to show.
  function planLine(plan, when = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })) {
    if (!plan) return null;
    const name = `Your plan: ${offerName(plan.price_code)}.`;
    switch (plan.status) {
      case 'active':
      case 'trialing':
        if (plan.cancel_at_period_end && plan.current_period_end) return `${name} It ends on ${when(plan.current_period_end)}. Credits you already have stay.`;
        return plan.current_period_end ? `${name} It renews on ${when(plan.current_period_end)}.` : name;
      case 'past_due':
      case 'unpaid':
        return `${name} The last payment didn’t go through. Update your card in Manage plan.`;
      case 'incomplete':
        return `${name} It’s being set up; this can take a minute.`;
      default:
        return null;                                   // canceled, incomplete_expired, paused
    }
  }
  const hasPlan = plan => !!plan && ['incomplete', 'trialing', 'active', 'past_due', 'unpaid'].includes(plan.status);

  window.ryagramCredits = { returnedNote, priceLabel, affordable, fitsLine, filmVsBalance, filmCoverLine, jobCredits, balanceLine, filmCostLine, plural, offerName, money, offerLine, planLine, hasPlan };
})();
