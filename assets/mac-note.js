// The plain sentence about Mac on the download pages (NEXT-WEB 184). One source for both places that offer the Windows app: the page behind an invite email (/get-app/) and the Download card on the
// Account page. It is shown only when the site switch macNote is exactly true in assets/ryagram-config.js (off). The facts come from proposals/CONNECT-MAC-READY-PLAN.md: the app is Windows only today
// (a Windows Python, a Windows ffmpeg, Windows start files and a Windows credential store), nothing for Mac is built, and whether and when it is built is Ryan's decision. So the words say "planned, not built,
// no date", not "coming soon". THE WORDS ARE DRAFT FOR RYAN: he decides whether to say a Mac version is planned at all.
(() => {
  const LINES = [
    'The Ryagram app is for Windows today. A Mac version is planned. It is not built yet, and there is no date.',
    'On a Mac you can sign in to Ryagram in your browser, but making a film on your own computer needs the Windows app.'
  ];
  const on = cfg => !!cfg && cfg.macNote === true;
  const isMac = nav => { const s = String((nav && (nav.userAgentData && nav.userAgentData.platform || nav.platform)) || ''), ua = String((nav && nav.userAgent) || ''); return /^mac/i.test(s) && !/iphone|ipad|ipod/i.test(ua); };
  window.ryagramMacNote = Object.freeze({ LINES, on, isMac });
})();
