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
  window.ryagramAdmin = { byFilm, campaignLabel, dayLabel };
})();
