// "Keep named faces sharp": the editor panel for a clip's bystander blur (NEXT-WEB 179; spec: proposals/FACES-NAMED-SHARP-EDITOR-SPEC.md, FACES 2026-10-30; engine: ryagram/local/bystander.py, branch faces-named-sharp).
//
// THIS FILE DECIDES NOTHING ABOUT WHO IS SHARP. The rule (a face is sharp only when kept AND consent is exactly true AND it has a typed name; every other face is blurred; a link to a person who is missing or
// has no OK is blurred) is the engine's single tested rule. The page only DRAWS what the engine returns and SENDS the five calls through a host object it is given, so a page bug cannot leave a face wrongly sharp:
//
//   host.faces.status(spec)                    -> the ids of the tracks that are sharp, from the engine's own sharp() (everything else is drawn as blurred)
//   host.faces.confirm(spec, name, consent)    -> the new spec     (engine: confirm_person)
//   host.faces.revoke(spec, name)              -> the new spec     (engine: revoke_person)
//   host.faces.link(spec, trackId, name)       -> the new spec     (engine: link_face)
//   host.faces.unlink(spec, trackId)           -> the new spec     (engine: unlink_face)
//   each may throw an Error whose message is the engine's own sentence (BlurError); the panel shows it as it is.
//
// The page never writes `kept`, `consent` or `name` on a track, and never writes `people` or `person` itself: it keeps the spec it was given and replaces it with what the engine returns. Faces are only FOUND
// and FOLLOWED: nothing here matches one face to another, so a person with several thumbnails is linked thumbnail by thumbnail by the user (the biometric rows in LEGAL-QUESTIONS-FOR-ATTORNEY stay closed only while
// that is true). Thumbnails come from the host (`thumbs[trackId]`, an image address); anything that is not a plain image data address is not drawn. Everything is text nodes, never HTML.
// ALL WORDS BELOW ARE DRAFT FOR RYAN AND THE ATTORNEY (consent wording).
(() => {
  const WORDS = {
    title: 'Faces in this clip',
    lead: 'Every face is blurred unless you say it is someone you have the OK of.',
    miss: 'Faces the finder misses stay sharp; look at the preview.',
    peopleTitle: 'Who is OK to leave sharp?',
    typeName: 'Type a name',
    ok: 'I have this person’s OK',
    confirm: 'Confirm',
    withdraw: 'Withdraw',
    who: 'Who is this?',
    none: 'No one yet',
    unlink: 'Unlink',
    blurred: 'blurred',
    sharp: 'sharp',
    noFaces: 'No faces were found in this clip.',
    offered: 'Names from the people speaking in this edit'
  };
  const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]{1,400000}$/;

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const cleanName = n => (typeof n === 'string' ? n.split(/\s+/).filter(Boolean).join(' ').slice(0, 40) : '');
  // The people the user has confirmed, as the engine holds them: [{name, consent}]. Only those with the OK ticked can be linked to a face (the engine refuses the rest in words).
  const confirmed = spec => ((spec && Array.isArray(spec.people)) ? spec.people : []).filter(p => p && typeof p.name === 'string' && p.consent === true).map(p => p.name);
  const allPeople = spec => ((spec && Array.isArray(spec.people)) ? spec.people : []).filter(p => p && typeof p.name === 'string').map(p => ({ name: p.name, ok: p.consent === true }));
  // Names to offer: the typed speaker names of this edit, then anyone already confirmed, each once.
  function nameChoices(offered, spec) {
    const out = [];
    for (const n of [...(Array.isArray(offered) ? offered : []), ...allPeople(spec).map(p => p.name)]) { const c = cleanName(n); if (c && !out.includes(c)) out.push(c); }
    return out;
  }
  // One thumbnail's state for drawing: `sharpIds` is the engine's answer, nothing is worked out here.
  function trackRows(spec, sharpIds, thumbs) {
    const sharp = new Set(Array.isArray(sharpIds) ? sharpIds : []);
    return ((spec && Array.isArray(spec.tracks)) ? spec.tracks : []).map((t, i) => ({
      id: String(t.id), label: `Face ${i + 1}`, person: typeof t.person === 'string' ? t.person : null, sharp: sharp.has(t.id),
      thumb: thumbs && typeof thumbs[t.id] === 'string' && IMAGE.test(thumbs[t.id]) ? thumbs[t.id] : null
    }));
  }
  // "3 faces: 1 sharp (Ann), 2 blurred." from the rows above.
  function summary(rows) {
    const n = rows.length;
    if (!n) return WORDS.noFaces;
    const sharp = rows.filter(r => r.sharp), names = [...new Set(sharp.map(r => r.person).filter(Boolean))];
    const parts = [`${sharp.length} sharp${names.length ? ` (${names.join(', ')})` : ''}`, `${n - sharp.length} blurred`];
    return `${n} face${n === 1 ? '' : 's'}: ${parts.join(', ')}.`;
  }

  function create({ h }) {
    // panel({ spec, host, offered, thumbs, onChange, locked }) -> an element. `spec` is the clip's bystander_blur as the engine last returned it; onChange(newSpec) is called with what the engine returned.
    function panel({ spec, host, offered, thumbs, onChange, locked }) {
      let cur = spec, sharpIds = [], pending = '', typed = '', ticked = false, error = '';
      const root = h('section', { class: 'faces-sharp', 'aria-labelledby': 'fs-title' });
      const say = h('p', { class: 'form-note faces-sharp-error', role: 'alert', hidden: true });
      async function run(call) {
        error = ''; say.hidden = true;
        try { const next = await call(); if (next && typeof next === 'object') { cur = next; if (onChange) onChange(cur); } await refresh(); return true; }
        catch (e) { error = String((e && e.message) || 'That could not be done.').slice(0, 300); say.textContent = error; say.hidden = false; return false; }
      }
      async function refresh() {
        try { sharpIds = (await host.faces.status(cur)) || []; } catch { sharpIds = []; }          // if the engine cannot say, nothing is drawn as sharp
        draw();
      }
      function draw() {
        const rows = trackRows(cur, sharpIds, thumbs), names = nameChoices(offered, cur), ok = confirmed(cur);
        const nameBox = h('input', { type: 'text', id: 'fs-name', maxlength: '40', list: 'fs-offered', value: typed, 'aria-label': WORDS.typeName, placeholder: WORDS.typeName, disabled: !!locked });
        nameBox.addEventListener('input', () => { typed = nameBox.value; });
        const tick = h('input', { type: 'checkbox', id: 'fs-ok', ...(ticked ? { checked: true } : {}), disabled: !!locked });
        tick.addEventListener('change', () => { ticked = tick.checked; });
        const confirmBtn = h('button', { type: 'button', class: 'button secondary', id: 'fs-confirm', disabled: !!locked, onclick: () => run(() => host.faces.confirm(cur, cleanName(typed), ticked === true)).then(done => { if (done) { typed = ''; ticked = false; draw(); } }) }, WORDS.confirm);       // a refused confirm keeps what the person typed
        const chips = allPeople(cur).map(p => h('li', { class: 'fs-person' }, h('strong', {}, p.name), ' ', p.ok
          ? [h('span', { class: 'meta' }, 'OK ticked'), ' ', h('button', { type: 'button', class: 'button secondary small', 'data-withdraw': p.name, disabled: !!locked, onclick: () => run(() => host.faces.revoke(cur, p.name)) }, WORDS.withdraw)]
          : h('span', { class: 'meta' }, 'OK withdrawn')));
        const tiles = rows.map(r => {
          const sel = h('select', { class: 'fs-who', 'data-track': r.id, 'aria-label': `${WORDS.who} (${r.label})`, disabled: !!locked || !ok.length },
            h('option', { value: '' }, ok.length ? '' : WORDS.none), ...ok.map(n => h('option', { value: n }, n)));
          sel.value = '';                                                                          // never pre-selected
          sel.addEventListener('change', () => { if (sel.value) run(() => host.faces.link(cur, r.id, sel.value)); });
          return h('li', { class: `fs-face ${r.sharp ? 'is-sharp' : 'is-blurred'}`, 'data-track': r.id },
            r.thumb ? h('img', { src: r.thumb, alt: r.label, width: '96', height: '96' }) : h('span', { class: 'fs-nothumb', role: 'img', 'aria-label': r.label }, r.label),
            h('span', { class: 'meta fs-state' }, r.sharp ? `${WORDS.sharp}${r.person ? ` (${r.person})` : ''}` : WORDS.blurred),
            r.person ? h('button', { type: 'button', class: 'button secondary small', 'data-unlink': r.id, disabled: !!locked, onclick: () => run(() => host.faces.unlink(cur, r.id)) }, WORDS.unlink)
                     : h('label', {}, WORDS.who, ' ', sel));
        });
        root.replaceChildren(h('h3', { id: 'fs-title' }, WORDS.title), h('p', { class: 'meta' }, WORDS.lead),
          h('p', { class: 'fs-summary', role: 'status', 'aria-live': 'polite' }, summary(rows)),
          h('ul', { class: 'fs-faces' }, tiles),
          h('h4', {}, WORDS.peopleTitle),
          h('datalist', { id: 'fs-offered' }, names.map(n => h('option', { value: n }))),
          h('div', { class: 'fs-add' }, nameBox, ' ', h('label', {}, tick, ' ', WORDS.ok), ' ', confirmBtn),
          names.length ? h('p', { class: 'meta' }, `${WORDS.offered}: ${names.join(', ')}.`) : h('span', {}),
          h('ul', { class: 'fs-people' }, chips),
          h('p', { class: 'meta' }, WORDS.miss), say);
        if (error) { say.textContent = error; say.hidden = false; }
      }
      draw(); refresh();
      return root;
    }
    return { panel };
  }
  window.ryagramFacesSharp = { WORDS, IMAGE, cleanName, confirmed, allPeople, nameChoices, trackRows, summary, create };
})();
