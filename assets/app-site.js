// The signed-in site as ONE website (WEB, 2026-11-20, Ryan's top goal): the Admin page, the home's film cards with a picture, and the plain pieces they share. Layout and look live in assets/app-site.css.
// Everything a person typed (a film's title) goes in as text, never as HTML. A picture is only ever the film's OWN contact sheet or thumbnail (read the way the film's page reads them); no picture is invented:
// a film with none gets a plain tile with its first letter.
(() => {
  // ---- the Admin page: every admin page that is switched on, in plain words, in groups. `pages` = [{ href, label, about, group }] already filtered by the caller's switches.
  const GROUPS = ['People', 'Films', 'Computers'];
  function adminHub({ h, pages }) {
    const cards = group => pages.filter(p => p.group === group).map(p => h('li', { class: 'site-card' }, h('a', { class: 'site-card-link', href: p.href }, h('strong', {}, p.label)), h('p', { class: 'meta' }, p.about)));
    const sections = GROUPS.map(g => ({ g, items: cards(g) })).filter(s => s.items.length).map(s => h('section', { class: 'site-section', 'aria-labelledby': `admin-${s.g.toLowerCase()}` }, h('h2', { id: `admin-${s.g.toLowerCase()}` }, s.g), h('ul', { class: 'site-card-grid' }, s.items)));
    return [h('h1', { tabindex: '-1' }, 'Admin'), h('p', { class: 'form-intro' }, 'The pages only you can open. Everything else on the site is the same for you as for anyone.'),
      ...(sections.length ? sections : [h('p', { class: 'form-intro' }, 'No admin pages are switched on.')]),
      h('p', { class: 'meta' }, h('a', { href: '#/' }, 'Back to your projects'))];
  }

  // ---- a film card on the home page: a picture (or a plain tile), the title, where it stands, when it changed, Open and Edit.
  // A signed picture address lasts 15 minutes (app-data SIGNED_URL_SECONDS 900): a cached one is used for at most 10, a failed read is not kept for long (a retry on the next visit), so coming back to the home page
  // after a while never shows a broken picture from an old address. `makeCache` is pure so node can test it.
  function makeCache(ttlMs, failMs, now = () => Date.now()) {
    const m = new Map();
    return {
      get(k) { const e = m.get(k); if (!e) return undefined; if (now() > e.until) { m.delete(k); return undefined; } return e.v; },
      set(k, v) { if (m.size > 200) m.delete(m.keys().next().value); m.set(k, { v, until: now() + (v ? ttlMs : failMs) }); },
      drop(k) { m.delete(k); },
      size: () => m.size
    };
  }
  const queue = [], seen = makeCache(10 * 60 * 1000, 30 * 1000);                  // version id -> address or null
  let running = 0;
  async function pictureFor(data, versionId) {
    const hit = seen.get(versionId);
    if (hit !== undefined) return hit;
    let url = null;
    try {
      const arts = (await data.artifactsFor(versionId)) || [];                    // ONE light read (the thumbnail and contact-sheet rows of this version), not the version page's four or five
      const a = arts.find(x => x.kind === 'thumbnail') || arts.find(x => x.kind === 'contact_sheet');
      if (a) url = (await data.fileUrl(a.storage_path)) || null;
    } catch { url = null; }
    seen.set(versionId, url); return url;
  }
  // ONE observer for every card on the page (a card that is never scrolled to costs nothing and is released when it leaves the page).
  const waiting = new WeakMap();
  let shared = null;
  function observe(li, load) {
    if (typeof IntersectionObserver !== 'function') { load(); return; }
    if (!shared) shared = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { const f = waiting.get(e.target); shared.unobserve(e.target); waiting.delete(e.target); if (f) f(); } }, { rootMargin: '150px' });
    waiting.set(li, load); shared.observe(li);
  }
  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift(); running++;
      job().finally(() => { running--; pump(); });
    }
  }
  // The card's small line: the parts that exist, with a middle dot only BETWEEN two of them (never a leading or trailing dot when one is missing).
  function metaLine(h, parts) {
    const out = [];
    parts.filter(x => x !== null && x !== undefined && x !== false && x !== '').forEach((x, i) => { if (i) out.push(' \u00b7 '); out.push(x); });
    return out;
  }
  function filmCard({ h, project, statusEl, updated, parts, edit, data, version }) {
    const letter = () => h('span', { class: 'film-thumb-letter' }, String(project.title || '?').trim().slice(0, 1).toUpperCase() || '?');
    const holder = h('a', { class: 'film-thumb', href: `#/p/${project.id}`, tabindex: '-1', 'aria-hidden': 'true' }, letter());
    const li = h('li', { class: 'film-card' }, holder,
      h('div', { class: 'film-card-body' }, h('h3', {}, h('a', { href: `#/p/${project.id}` }, project.title)),
        h('p', { class: 'meta' }, parts ? metaLine(h, parts) : [statusEl, ' ', updated]),
        h('p', { class: 'film-card-actions' }, h('a', { class: 'button secondary small', href: `#/p/${project.id}` }, 'Open'), edit ? [' ', edit] : null)));
    if (version && data && typeof data.artifactsFor === 'function' && typeof data.fileUrl === 'function') {
      const load = () => { queue.push(async () => { const url = await pictureFor(data, version); if (url && li.isConnected) { const img = h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }); img.addEventListener('error', () => { seen.drop(version); holder.replaceChildren(letter()); }); holder.replaceChildren(img); }       // an address that stopped working puts the plain tile back and is asked again next time
 }); pump(); };
      observe(li, load);
    }
    return li;
  }

  window.ryagramSite = Object.freeze({ adminHub, filmCard, GROUPS, makeCache });
})();
