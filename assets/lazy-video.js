// A decorative video below the fold is fetched only when it is about to be seen (the home page's CRM preview was 1.9 MB on every first visit, mostly to people who never scrolled to it).
// The page keeps its poster picture until then. With "reduce motion" set the video is not started by itself: the poster stays and the player's own controls appear (nothing downloads until Play).
(function () {
  'use strict';
  var videos = document.querySelectorAll('video[data-lazy-video]');
  if (!videos.length) return;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function arm(v) {
    var s = v.querySelector('source[data-src]');
    if (s && !s.getAttribute('src')) s.setAttribute('src', s.getAttribute('data-src'));
  }
  function start(v) {
    arm(v);
    v.load();
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* the poster simply stays */ });
  }

  if (reduce) {
    videos.forEach(function (v) { arm(v); v.setAttribute('controls', ''); v.removeAttribute('autoplay'); });
    return;
  }
  if (!('IntersectionObserver' in window)) { videos.forEach(start); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      start(e.target);
    });
  }, { rootMargin: '300px 0px' });
  videos.forEach(function (v) { io.observe(v); });
}());
