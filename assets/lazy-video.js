(() => {
  // Autoplay preview videos (3D CRM room, Ryagram) are heavy on a first
  // mobile load, so their <source> is held back via data-src until the
  // section is actually about to be scrolled into view, and they never
  // autoplay at all for visitors who've asked for reduced motion -
  // those visitors get a normal, static-by-default player with controls
  // instead so the content is still reachable, just not auto-moving.
  const videos = document.querySelectorAll('video[data-lazy-video]');
  if (!videos.length) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function activate(video) {
    if (video.dataset.activated) return;
    video.dataset.activated = 'true';
    const source = video.querySelector('source[data-src]');
    if (source) {
      source.src = source.dataset.src;
      source.removeAttribute('data-src');
    }
    video.preload = 'auto';
    if (reduceMotion) {
      video.controls = true;
      video.load();
    } else {
      video.autoplay = true;
      video.load();
      video.play().catch(() => { /* Autoplay can still be blocked; poster remains. */ });
    }
  }

  if (!('IntersectionObserver' in window)) {
    videos.forEach(activate); // Old browser: fall back to loading eagerly rather than never.
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        activate(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '200px 0px' });
  videos.forEach(video => observer.observe(video));
})();
