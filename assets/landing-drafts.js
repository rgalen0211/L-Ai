// The landing page drafts for song films and compilations (NEXT-WEB 193). The page's real text sits in #draft, hidden. It is shown only when the site's switch landingDrafts is ON in
// assets/ryagram-config.js; otherwise the page says it is not available. Nothing is fetched and nothing is stored. Every sentence carries a visible marker for Ryan's wording.
(() => {
  const on = !!(window.ryagramConfig && window.ryagramConfig.landingDrafts === true);
  const draft = document.getElementById('draft'), off = document.getElementById('not-available');
  if (draft) draft.hidden = !on;
  if (off) off.hidden = on;
})();
