// /preview-demo/ offline: registers the page's service worker (preview-demo/sw.js), shows whether the page, the drawing code and the film are saved on this
// device, and offers a button to save them again. Nothing is sent anywhere.
(() => {
  const statusEl = document.getElementById('demo-offline');
  const button = document.getElementById('demo-offline-btn');
  if (!statusEl) return;
  const show = (text, ready = false) => { statusEl.hidden = false; statusEl.textContent = text; statusEl.dataset.ready = ready ? 'yes' : 'no'; };
  const state = { supported: false, ready: false, done: 0, total: 0 };

  // The display font (the wordmark and the closing card) comes from Google Fonts. Added once the page is up, so a slow or missing connection never
  // delays the film: without it the page uses Georgia.
  const addFont = () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+Display:wght@100&display=swap';
    document.head.append(link);
  };
  if (document.readyState === 'complete') addFont(); else window.addEventListener('load', addFont);

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    show('Working without internet is not available in this browser. Open the page while online before you need it.');
    if (button) button.hidden = true;
    window.ryagramOffline = state;
    return;
  }
  state.supported = true;

  navigator.serviceWorker.addEventListener('message', event => {
    const m = event.data;
    if (!m || m.source !== 'ryagram-preview-demo-sw') return;
    if (m.type === 'progress') { state.done = m.done; state.total = m.total; if (m.done < m.total) show(`Saving for use without internet: ${m.done} of ${m.total}…`); }
    if (m.type === 'done') {
      state.ready = !!m.ready;
      show(m.ready ? 'Ready without internet: the page, the drawing code and the film are saved on this device.'
                   : `Not saved yet (${m.cached} of ${m.total}). Press the button while online.`, !!m.ready);
      if (button) button.hidden = !!m.ready;
    }
  });

  const ask = type => navigator.serviceWorker.ready.then(reg => { if (reg.active) reg.active.postMessage({ type }); });
  navigator.serviceWorker.register('/preview-demo/sw.js', { scope: '/preview-demo/' })
    .then(() => ask('status'))
    .catch(() => show('Could not prepare for use without internet on this device. Open the page while online before you need it.'));
  if (button) button.addEventListener('click', () => { show('Saving for use without internet…'); ask('precache'); });
  window.ryagramOffline = state;
})();
