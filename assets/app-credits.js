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

  window.ryagramCredits = { priceLabel, affordable, jobCredits, balanceLine, plural };
})();
