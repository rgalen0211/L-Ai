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

  // Whether the person can afford it, and if not, why (a negative balance blocks every hold).
  function affordable(quote) {
    if (!quote || quote.credits === 0 || quote.free_preview) return { ok: true };
    if (quote.available >= quote.credits) return { ok: true };
    return { ok: false, reason: `This needs ${plural(quote.credits)} and you have ${plural(Math.max(0, quote.available))}.` };
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

  window.ryagramCredits = { priceLabel, affordable, jobCredits, balanceLine, plural, offerName, money, offerLine, planLine, hasPlan };
})();
