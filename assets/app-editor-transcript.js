// The live editor's transcript view, with a person's corrections (NEXT-BUILDER 39). NOT LOADED BY ANY PAGE YET: wiring it into the live editor (app-editor.js) and
// giving the host an undo call are WEB's and CONNECT's (the editor and the maker's rpc list); until then it is off by not being loaded at all.
//
// The words come from the maker, which reads Ryagram's library (ryagram.library.corrections.transcript): each word as a search sees it, and whether a person corrected it:
//   [{ w, start_ms, end_ms, corrected, heard, at_ms }]     heard and at_ms are null on a word nobody corrected
// A corrected word is shown as corrected, with what the transcriber heard on hover (and in its accessible name); "Undo" hands its at_ms to the caller, which asks the
// maker to forget that one correction (the heard word comes back exactly). This file decides only wording and layout; every word goes in as a text node, never as HTML.
(() => {
  const mmss = ms => { const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Lines of the transcript: a new line after a silence of gapMs, or after maxWords words, so a long file reads as sentences rather than one block.
  function lines(words, { gapMs = 1500, maxWords = 14 } = {}) {
    const out = [];
    let cur = [];
    for (const w of words || []) {
      const prev = cur[cur.length - 1];
      if (cur.length && (cur.length >= maxWords || (Number(w.start_ms) || 0) - (Number(prev.end_ms) || 0) > gapMs)) { out.push(cur); cur = []; }
      cur.push(w);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  const isCorrected = w => !!(w && w.corrected && typeof w.heard === 'string' && w.heard.trim() && Number.isInteger(w.at_ms));
  const wordLabel = w => (isCorrected(w) ? `${w.w} (corrected; the transcriber heard “${w.heard}”)` : String(w.w));
  const undoLabel = w => `Undo the correction of “${w.w}” (back to “${w.heard}”)`;
  const counts = words => { const n = (words || []).filter(isCorrected).length; return n ? `${n} word${n === 1 ? '' : 's'} corrected by you.` : 'No corrections in this transcript.'; };

  // The view. h is the page's element builder (h(tag, attrs, ...children)). onUndo(at_ms) is optional: without it no Undo button is drawn (read-only).
  function view(h, words, { onUndo = null, title = 'Transcript' } = {}) {
    const body = lines(words).map(line => h('p', { class: 'le-tr-line' },
      h('span', { class: 'le-tr-time meta' }, mmss(line[0].start_ms)), ' ',
      ...line.flatMap((w, i) => {
        const sep = i ? ' ' : '';
        if (!isCorrected(w)) return [sep, h('span', { class: 'le-tr-word' }, String(w.w))];
        const word = h('span', { class: 'le-tr-word is-corrected', title: `Heard: ${w.heard}`, 'aria-label': wordLabel(w) }, String(w.w));
        const undo = typeof onUndo === 'function' ? h('button', { class: 'link-button le-tr-undo', type: 'button', 'aria-label': undoLabel(w), onclick: () => onUndo(w.at_ms) }, 'Undo') : null;
        return undo ? [sep, word, ' ', undo] : [sep, word];
      })));
    return h('section', { class: 'le-transcript', 'aria-label': title }, h('h3', {}, title), h('p', { class: 'meta' }, counts(words)),
      ...(body.length ? body : [h('p', { class: 'meta' }, 'No words in this clip.')]));
  }

  window.ryagramTranscript = { lines, view, wordLabel, undoLabel, counts, isCorrected, mmss };
})();
