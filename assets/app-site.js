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
  const queue = [], seen = new Map();                                              // version id -> address or null, kept for the page's life
  let running = 0;
  async function pictureFor(data, versionId) {
    if (seen.has(versionId)) return seen.get(versionId);
    let url = null;
    try {
      const arts = ((await data.getVersion(versionId)).artifacts || []);
      const a = arts.find(x => x.kind === 'thumbnail') || arts.find(x => x.kind === 'contact_sheet');
      if (a) url = (await data.fileUrl(a.storage_path)) || null;
    } catch { url = null; }
    seen.set(versionId, url); return url;
  }
  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift(); running++;
      job().finally(() => { running--; pump(); });
    }
  }
  function filmCard({ h, project, statusEl, updated, edit, data, version }) {
    const holder = h('a', { class: 'film-thumb', href: `#/p/${project.id}`, tabindex: '-1', 'aria-hidden': 'true' }, h('span', { class: 'film-thumb-letter' }, String(project.title || '?').trim().slice(0, 1).toUpperCase() || '?'));
    const li = h('li', { class: 'film-card' }, holder,
      h('div', { class: 'film-card-body' }, h('h3', {}, h('a', { href: `#/p/${project.id}` }, project.title)),
        h('p', { class: 'meta' }, statusEl, ' ', updated),
        h('p', { class: 'film-card-actions' }, h('a', { class: 'button secondary small', href: `#/p/${project.id}` }, 'Open'), edit ? [' ', edit] : null)));
    if (version && data && typeof data.getVersion === 'function' && typeof data.fileUrl === 'function') {
      const load = () => { queue.push(async () => { const url = await pictureFor(data, version); if (url && li.isConnected) { const img = h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }); holder.replaceChildren(img); } }); pump(); };
      if (typeof IntersectionObserver === 'function') { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '150px' }); io.observe(li); } else load();
    }
    return li;
  }

  window.ryagramSite = Object.freeze({ adminHub, filmCard, GROUPS });
})();
