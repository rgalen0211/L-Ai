// The directory-listing draft pages (privacy and terms for the Claude and ChatGPT connector directories; NEXT-WEB 183). The page's real text sits in #draft, hidden. It is shown only when the site's
// switch directoryDrafts is ON in assets/ryagram-config.js; otherwise the page says it is not available. Nothing is fetched and nothing is stored. Every sentence that needs Ryan's or the lawyer's
// wording carries a visible marker and the draft banner says so.
(() => {
  const on = !!(window.ryagramConfig && window.ryagramConfig.directoryDrafts === true);
  const draft = document.getElementById('draft'), off = document.getElementById('not-available');
  if (draft) draft.hidden = !on;
  if (off) off.hidden = on;
})();
