(() => {
  if (window.laiAnalytics) return;
  let active = false;
  function track(method, event) {
    if (!active) return;
    try { window.fbq(method, event); } catch { /* Measurement must never block the funnel. */ }
  }
  window.laiAnalytics = Object.freeze({
    // Called only inside the form's acknowledged-success branch. No form data is sent.
    auditSubmitted() { track('track', 'Lead'); }
  });
  const pixelId = window.laiAnalyticsConfig?.metaPixelId;
  if (typeof pixelId !== 'string' || !/^[1-9]\d+$/.test(pixelId)) return;
  try {
    if (!window.fbq) {
      const fbq = function () {
        if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
        else fbq.queue.push(arguments);
      };
      window.fbq = fbq;
      if (!window._fbq) window._fbq = fbq;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(script);
    }
    window.fbq('set', 'autoConfig', false, pixelId);
    window.fbq('init', pixelId);
    active = true;
    track('track', 'PageView');
    const path = window.location.pathname;
    if (path === '/workflow-audit' || path === '/workflow-audit/' || path === '/workflow-audit/index.html') {
      track('track', 'ViewContent');
    }
    if (path === '/workflow-audit-thanks.html') {
      const booking = document.getElementById('audit-booking');
      if (booking?.getAttribute('href') === 'https://calendar.app.google/SrHAqNaF4DMTgo4EA') {
        booking.addEventListener('click', () => track('trackCustom', 'ScheduleClicked'));
      }
    }
  } catch { active = false; }
})();
