// Autoplay for the Ryagram page's videos, kept polite: the showcase loops play only while they are on screen (so a
// phone is not decoding four videos at once), nothing autoplays for people who ask for reduced motion (they get the
// poster and the browser's own controls), and a video the browser refuses to play simply stays on its poster.
(() => {
  const loops = [...document.querySelectorAll('video.rg-loop')];
  const walk = document.querySelector('video.rg-walk');
  const all = walk ? [walk, ...loops] : loops;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const play = v => { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* stays on its poster */ } };

  if (reduced) {
    for (const v of all) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; }
    return;
  }
  if (typeof IntersectionObserver !== 'function') {
    for (const v of loops) play(v);
    return;
  }
  const watcher = new IntersectionObserver(entries => {
    for (const e of entries) { if (e.isIntersecting) play(e.target); else e.target.pause(); }
  }, { threshold: 0.35 });
  for (const v of loops) watcher.observe(v);
})();
