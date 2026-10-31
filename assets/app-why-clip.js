// "Why this clip": a panel that shows, clip by clip, why a compilation's cut is what it is (NEXT-WEB 185; the report is BUILDER 48's tools/why_this_clip.py, Ryagram branch why-this-clip, schema ryagram.why-clip/0).
// The page ONLY DRAWS the report it is given. It works nothing out: every sentence under a clip is the report's own `why` text; a field the report does not hold is shown as not recorded, never guessed.
// The report comes from the maker through a host (host.whyClip() -> the report object); the website itself has none, and the panel says so in words. Behind its own switch (whyClip, off). Text nodes only.
(() => {
  const SCHEMA = 'ryagram.why-clip/0';
  const TAKES = { own: 'the singer’s own take', fit: 'another take of the same words', forms: 'the word in another form', alias: 'a reviewed other spelling', 'cast-fallback': 'a stand-in' };
  const FILTERS = [
    ['all', 'All clips', () => true],
    ['stand_in', 'Stand-ins', r => r.stand_in === true],
    ['voice_unsure', 'Voice unsure', r => r.voice_unsure === true],
    ['limited', 'Held back by the speed limit', r => Array.isArray(r.speed && r.speed.flags) && r.speed.flags.includes('limited')]
  ];
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const str = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '');

  // ---------------------------------------------------------------- pure helpers (tested in node)
  // Is this the report we draw? A report from anywhere is checked before it is trusted: the schema name, a clip list, and the fields the panel reads. -> null, or a sentence.
  function problem(rep) {
    if (!rep || typeof rep !== 'object') return 'The explanation did not arrive.';
    if (rep.schema !== SCHEMA) return 'That is not an explanation this panel knows.';
    if (!Array.isArray(rep.clips) || rep.clips.length > 5000) return 'The explanation has no list of clips, or too many.';
    for (const r of rep.clips) {
      if (!r || typeof r !== 'object' || !Number.isInteger(r.n) || !Array.isArray(r.why) || r.why.some(x => typeof x !== 'string')) return 'A clip in the explanation is not readable.';
      if (r.at_s !== null && r.at_s !== undefined && !num(r.at_s)) return 'A clip in the explanation has a time that is not a number.';
    }
    return null;
  }
  const filtered = (rep, id) => { const f = FILTERS.find(x => x[0] === id) || FILTERS[0]; return (rep.clips || []).filter(f[2]); };
  // The clip that is playing at second t: the last clip that starts at or before t (clips without a time are never chosen).
  function clipAt(rep, t) {
    if (!num(t)) return null;
    let best = null;
    for (const r of rep.clips || []) if (num(r.at_s) && r.at_s <= t + 1e-9 && (!best || r.at_s >= best.at_s)) best = r;
    return best;
  }
  const mmss = s => (num(s) ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : 'time not recorded');
  function summaryLine(rep) {
    const s = rep.summary || {}, n = num(s.clips) ? s.clips : (rep.clips || []).length, parts = [`${n} clip${n === 1 ? '' : 's'}`];
    if (num(s.stand_ins) && s.stand_ins) parts.push(`${s.stand_ins} stand-in${s.stand_ins === 1 ? '' : 's'}`);
    if (num(s.voice_unsure) && s.voice_unsure) parts.push(`${s.voice_unsure} to check by ear`);
    if (num(s.speed_limited) && s.speed_limited) parts.push(`${s.speed_limited} held back by the speed limit`);
    return parts.join(', ') + '.';
  }
  const takeWords = r => TAKES[r.take] || 'chosen by a step this explanation does not know';
  const headline = r => `${r.n}. ${mmss(r.at_s)} · “${str(r.sung, 120) || 'words not recorded'}” · ${str(r.voice, 60) || 'voice not recorded'}`;

  // The panel. `rep` is the report; `at` is the second the editor is at (the clip playing there is marked and opened); `filter` the chosen filter. onFilter(id) is the page's.
  function view(h, rep, { at = null, filter = 'all', onFilter } = {}) {
    const why = problem(rep);
    if (why) return h('section', { class: 'le-why', 'aria-labelledby': 'le-why-h' }, h('h2', { id: 'le-why-h' }, 'Why this clip'), h('p', { class: 'form-note', role: 'status' }, why));
    const now = clipAt(rep, at), rows = filtered(rep, filter);
    const sel = h('select', { id: 'le-why-filter', 'aria-label': 'Which clips to show' }, FILTERS.map(f => h('option', { value: f[0], ...(f[0] === filter ? { selected: true } : {}) }, f[1])));
    sel.addEventListener('change', () => { if (onFilter) onFilter(sel.value); });
    return h('section', { class: 'le-why', 'aria-labelledby': 'le-why-h' },
      h('h2', { id: 'le-why-h' }, 'Why this clip'),
      h('p', { class: 'meta' }, 'Each line says why the cut is what it is, in the words the cut itself recorded. Nothing here is guessed: a thing the cut did not record says so.'),
      h('p', { class: 'le-why-sum', role: 'status', 'aria-live': 'polite' }, summaryLine(rep)),
      h('label', { for: 'le-why-filter' }, 'Show '), sel,
      now ? h('p', { class: 'meta le-why-now' }, `At this moment: clip ${now.n}.`) : h('span', {}),
      rows.length ? h('ol', { class: 'le-why-list' }, rows.map(r => h('li', { class: `le-why-clip${now && now.n === r.n ? ' is-now' : ''}${r.stand_in ? ' is-standin' : ''}`, 'data-n': String(r.n), ...(now && now.n === r.n ? { 'aria-current': 'true' } : {}) },
        h('strong', {}, headline(r)), ' ', h('span', { class: 'meta' }, takeWords(r)),
        r.said && r.said !== r.sung ? h('p', { class: 'meta' }, `The recording says “${str(r.said, 120)}”.`) : h('span', {}),
        h('ul', { class: 'le-why-reasons' }, r.why.map(x => h('li', {}, str(x, 600))))))) : h('p', { class: 'form-note' }, 'No clip matches that.'));
  }
  window.ryagramWhyClip = Object.freeze({ SCHEMA, FILTERS: FILTERS.map(f => [f[0], f[1]]), problem, filtered, clipAt, summaryLine, takeWords, headline, mmss, view });
})();
