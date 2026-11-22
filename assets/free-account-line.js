// DRAFT: do not fold until Ryan answers Q679 (option A: open sign-ups get NO welcome credits). One plain line telling a new person what a free account can make. Words are DRAFT FOR RYAN.
// Facts (supabase/phase-2b/credits_ledger.sql free_previews_per_project 6, free_previews_per_24h 15; same rule as FREE_PREVIEW_RULE in assets/app-library.js): contact sheets are free;
// 6 free previews per project and 15 in any rolling 24 hours across all projects; a full film costs credits.
// The "buying credits is not open yet" half follows the SAME switch as the Credits page (buyingOn in assets/app-library.js: credits + payments + buyingOpen in assets/ryagram-config.js).
// The HTML carries the closed wording (also right with scripts off); this file only swaps in the open wording. If welcome credits are chosen (option B) the sentences below change.
(() => {
  const FREE = 'A free account can make free contact sheets, and up to 6 free previews for each project (15 in any 24 hours across all your projects).';
  const CLOSED = FREE + ' A full film needs credits, and buying credits is not open yet.';
  const OPEN = FREE + ' Credits pay for full films.';
  const buyingOpen = () => {
    const c = window.ryagramConfig || {};
    return c.credits === true && c.payments === true && c.buyingOpen === true;
  };
  const line = () => (buyingOpen() ? OPEN : CLOSED);
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('[data-free-account-line]').forEach(el => { el.textContent = line(); });
  }
  window.ryagramFreeAccountLine = Object.freeze({ CLOSED, OPEN, buyingOpen, line });
})();
