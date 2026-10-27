// Ryan's admin view helpers (Waitlist by film). Pure functions over waitlist_by_film() rows:
// { day: 'YYYY-MM-DD', campaign: text | null, utm_source: text | null, signups: int }.
(() => {
  // Totals per film link and source, biggest first; a signup with no film link sorts last.
  function byFilm(rows) {
    const m = new Map();
    for (const r of rows || []) {
      const key = `${r.campaign ?? ''}\u0000${r.utm_source ?? ''}`;
      const t = m.get(key) || { campaign: r.campaign ?? null, utm_source: r.utm_source ?? null, signups: 0 };
      t.signups += Number(r.signups) || 0;
      m.set(key, t);
    }
    return [...m.values()].sort((a, b) => (a.campaign == null) - (b.campaign == null) || b.signups - a.signups
      || String(a.campaign).localeCompare(String(b.campaign)));
  }
  const campaignLabel = c => (c ? c : 'No film link (the page directly)');
  const dayLabel = d => {
    const t = Date.parse(`${d}T12:00:00Z`);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : String(d);
  };
  // Visits and signups: the share of visits that became a signup, as "2.5%", "\u2014" when there were no visits, and never
  // above 100% in the display (a signup can come from an earlier visit, or a bot-filtered visit, so the ratio is approximate).
  function signupRate(visits, signups) {
    const v = Number(visits) || 0;
    const s = Number(signups) || 0;
    if (v <= 0) return '\u2014';
    const pct = Math.min(100, (s / v) * 100);
    return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
  }
  const sourceLabel = s => (s ? s : '(no link)');
  // Rows from visits_by_day / visits_by_source: totals, and the rate over the whole period.
  function visitTotals(rows) {
    const t = { visits: 0, signups: 0 };
    for (const r of rows || []) { t.visits += Number(r.visits) || 0; t.signups += Number(r.signups) || 0; }
    return { ...t, rate: signupRate(t.visits, t.signups) };
  }
  // Top sources first (by visits, then signups); 'other' and the no-link row keep their place in the order by size.
  function topSources(rows) {
    return [...(rows || [])].map(r => ({ source: r.source || '', visits: Number(r.visits) || 0, signups: Number(r.signups) || 0 }))
      .sort((a, b) => b.visits - a.visits || b.signups - a.signups || a.source.localeCompare(b.source));
  }
  window.ryagramAdmin = { byFilm, campaignLabel, dayLabel, signupRate, sourceLabel, visitTotals, topSources };
})();
