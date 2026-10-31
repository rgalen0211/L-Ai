// NEXT-WEB 189: the lyric card choice in the live editor (behind lyricCards, OFF). RENDERER 60's three designs (Ryagram tools/song_cards.py), shown as small pictures with a name and a line.
// It sets one film look value, lyric_card, through the editor's ordinary set_film_look change. Nothing renders lyric cards from that value yet.
(function () {
  const DESIGNS = [
    { id: 'plate', name: 'Plate', line: 'The singer name in small capitals, a short rule, then the line centred.' },
    { id: 'bar', name: 'Bar', line: 'The singer name and the line set left, beside a bar of colour.' },
    { id: 'sing_along', name: 'Sing-along', line: 'The singer name in a pill; the word being sung lights up, with a progress line below.' },
  ];
  const IMG = id => `/assets/lyric-cards/${id}.png`;
  const on = cfg => !!(cfg && cfg.lyricCards === true);
  const enabled = () => on(window.ryagramConfig);                           // read here, not in the editor: the computer's copy of the editor carries no site config and no chooser
  const current = look => (look && DESIGNS.some(d => d.id === look.lyric_card)) ? look.lyric_card : null;
  const NOTE = 'This is saved with the film. The song film does not draw these cards yet, so nothing changes in a render until it does.';
  // Builds the fieldset; h is the editor's element helper; set(value) applies the change; locked turns the choices off while a render holds the film.
  function panel(h, look, set, locked) {
    const cur = current(look);
    const items = DESIGNS.map(d => {
      const id = `le-lc-${d.id}`;
      const r = h('input', { type: 'radio', name: 'le-lc', id, value: d.id, checked: cur === d.id, disabled: !!locked });
      r.addEventListener('change', () => { if (r.checked) set(d.id); });
      return h('label', { class: 'le-lc-opt', for: id },
        r, h('img', { src: IMG(d.id), alt: `A ${d.name} lyric card: ${d.line}`, width: '320', height: '180', loading: 'lazy' }),
        h('span', { class: 'le-lc-name' }, d.name), h('span', { class: 'le-lc-line' }, d.line));
    });
    return h('fieldset', { class: 'le-lc' }, h('legend', {}, 'Lyric card'),
      h('p', { class: 'meta' }, cur ? 'Pick a design for the card that shows each line.' : 'No design picked: the film keeps its usual card. Pick one to choose.'),
      h('div', { class: 'le-lc-grid' }, items), h('p', { class: 'le-free' }, NOTE));
  }
  window.ryagramLyricCards = { DESIGNS, IMG, NOTE, on, enabled, current, panel };
})();
