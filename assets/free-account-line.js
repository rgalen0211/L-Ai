// Q679 option B (Ryan 11-23 15:46): a new account gets 8 welcome credits when its email is verified, once per email address. One plain line telling a new person what a free account has and can make.
// Facts (supabase/phase-2b/credits_ledger.sql free_previews_per_project 6, free_previews_per_24h 15; same rule as FREE_PREVIEW_RULE in assets/app-library.js): contact sheets are free;
// 6 free previews per project and 15 in any rolling 24 hours across all projects; a full film costs 6 to 10 credits by film type (final_line 6, final_map 8, final_paired 10), and 8 welcome credits cover the smaller ones.
// A person who is not signed in cannot read the price table, so the numbers here are typed; tests/welcome-credits-1123.test.mjs pins them against credits_ledger.sql.
// The "buying credits is not open yet" half follows the SAME switch as the Credits page (buyingOn in assets/app-library.js: credits + payments + buyingOpen in assets/ryagram-config.js).
// The HTML carries the closed wording (also right with scripts off); this file only swaps in the open wording.
(() => {
  const WELCOME = 'When you confirm your email you get 8 welcome credits, once for each email address.';
  const FREE = 'A free account can make free contact sheets. Each project gets 6 free previews (15 across all projects in any 24 hours); then 1 credit each.';       // FREE_PREVIEW_RULE in assets/app-library.js without its last sentence (kept on the Credits page only: phone height); a test pins both
  const FILM = 'A full film costs 6 to 10 credits, depending on the film type: 8 covers the smaller ones.';
  const CLOSED = WELCOME + ' ' + FREE + ' ' + FILM + ' Buying credits is not open yet.';
  const OPEN = WELCOME + ' ' + FREE + ' Credits pay for full films.';
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
