// "Describe what you want to see": what the page does with source-search's answer. Every fact on a card comes from the
// function (which fills it from the catalog table); this only cleans the text for display and turns ticked cards into a
// story with the ready-made films the app already has. Nothing here invents a source, a coverage or a licence.
(() => {
  const MAX_PROMPT = 500;
  const MAX_TICKS = 5;
  const text = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const https = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const DASH = '—';

  function checkPrompt(value) {
    const t = text(value);
    if (!t) return { ok: false, problem: 'Write what you want to see.' };
    if (t.length > MAX_PROMPT) return { ok: false, problem: `That is ${t.length} characters. The limit is ${MAX_PROMPT}.` };
    return { ok: true, prompt: t, problem: '' };
  }

  // The card as shown. Recommended appears on at most one card, and only with the reason the server verified.
  function cardView(c) {
    const r = c && typeof c === 'object' ? c : {};
    return { id: text(r.id), title: text(r.title) || DASH, publisher: text(r.publisher) || DASH, url: https(r.source_url),
             coverage: text(r.coverage) || DASH, licenceShort: text(r.licence_short) || DASH, licenceFull: text(r.licence_full),
             fit: r.fit === 'full' ? 'full' : 'partial', recommended: r.recommended === true, reason: r.recommended === true ? text(r.reason) : '',
             noRedistribution: r.no_redistribution === true };
  }

  // The answer, made safe to draw: at most one recommended card, at most 6 cards, plain-text messages.
  function answerView(a) {
    const r = a && typeof a === 'object' ? a : {};
    let seenRec = false;
    const cards = (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, 6).map(cardView).filter(c => c.id).map(c => {
      if (c.recommended && seenRec) return { ...c, recommended: false, reason: '' };
      if (c.recommended) seenRec = true;
      return c;
    });
    return {
      cards,
      verdict: r.verdict && typeof r.verdict === 'object' ? { code: text(r.verdict.code), message: text(r.verdict.message) } : null,
      unavailable: (Array.isArray(r.unavailable) ? r.unavailable : []).slice(0, 3).map(u => ({ id: text(u?.id), message: text(u?.message) })).filter(u => u.message)
    };
  }

  // Ticked ids -> one story from the ready-made films the app has. Returns { story, missing } (ids with no ready-made film).
  // v1 rule (WEB-PROMPT-FIRST-SOURCING.md 2.6): up to 5 sources, one clip each, no joins.
  function filmFromTicks(ids, T, headline) {
    const picked = [...new Set(ids || [])].slice(0, MAX_TICKS);
    const offered = id => (T.TEMPLATES || []).find(t => (!t.flag || window.ryagramConfig?.[t.flag] === true || window.ryagramMock) && t.datasets.includes(id));
    const stories = [], missing = [];
    for (const id of picked) {
      const t = offered(id);
      if (!t) { missing.push(id); continue; }
      stories.push(T.build(t.id, id, picked.length === 1 ? headline : ''));
    }
    if (!stories.length) return { story: null, missing };
    const story = JSON.parse(JSON.stringify(stories[0]));
    stories.slice(1).forEach((s, i) => {
      const clip = JSON.parse(JSON.stringify(s.sequence.clips.find(c => c.kind === 'render')));
      clip.id = `src${i + 2}`;
      story.sequence.clips.push(clip);
    });
    if (stories.length > 1) story.notes = `${story.notes || ''} Each ticked source is its own clip; Ryagram does not join datasets.`.trim();
    return { story, missing };
  }

  window.ryagramSearch = { MAX_PROMPT, MAX_TICKS, DASH, text, checkPrompt, cardView, answerView, filmFromTicks };
})();
