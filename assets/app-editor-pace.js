// Pace for a compilation in the live editor (NEXT-WEB 182; BUILDER 45's named paces, Ryagram branch pace-preset 956a4f72, ryagram/library/padding.py PRESETS).
//
// The engine plans a cut with a pace: "standard" = 120 ms before and 160 ms after the words (today's cut, still the default), "unhurried" = 200 ms before, 280 ms after, and no clip shorter than 1.0 s
// (FACES' proposals, not measured on viewers). The editor edits a cut that is ALREADY planned, so a pace here is the difference from the standard cut, applied as the editor core's own trim_clip ops:
// "unhurried" adds 0.08 s before and 0.12 s after the words of each video clip and lengthens any clip that is still under 1.0 s. It assumes the cut was planned at the standard pace; the page says so.
// Nothing is a rule of its own: every op goes through the core's check(), a clip the core refuses (no room in the video file, past the film) is left as it is and named, and the whole preset is
// ordinary undoable edits. Choosing Standard changes nothing: it is the default and has no ops. Behind its own switch (clipPace, off).
(() => {
  const PACES = [
    { id: 'standard', label: 'Standard', blurb: 'The cut as it was planned. Nothing changes.', add_before: 0, add_after: 0, min_len: 0 },
    { id: 'unhurried', label: 'Unhurried', blurb: 'A little more quiet round every word, and no clip shorter than 1 second. Adds 0.08 s before and 0.12 s after each clip, where the video has room.', add_before: 0.08, add_after: 0.12, min_len: 1.0 }
  ];
  const find = id => PACES.find(p => p.id === id) || null;
  const round = v => Math.round(v * 1000) / 1000;

  // The ops of one pace on this state, worked out on a COPY of the editor so each op is checked against the clips as the earlier ones left them (the run is packed again after every video trim).
  // -> { ops: [trim_clip...], skipped: [{ id, label, why }], clips: n }.  E is the editor core (window.ryagramEditor); state is ed.state.
  function plan(E, state, paceId) {
    const p = find(paceId);
    if (!p || (p.add_before === 0 && p.add_after === 0 && p.min_len === 0)) return { ops: [], skipped: [], clips: 0 };
    const copy = new E.Editor(JSON.parse(JSON.stringify(state)));
    const ops = [], skipped = [];
    const ids = copy.state.clips.filter(c => c.track === 'video' && !c.slide).map(c => c.id);
    for (const id of ids) {
      const at = () => copy.state.clips.find(c => c.id === id);
      const tryOp = (edge, to) => {
        const op = { op: 'trim_clip', id, edge, to: round(to) };
        const r = copy.do(op);
        if (r.ok) { ops.push(op); return null; }
        return r.reason || 'That could not be changed.';
      };
      let c = at(), why = null;
      if (p.add_before) { const w = tryOp('start', c.start - p.add_before); if (w) why = w; }
      c = at();
      if (p.add_after) { const w = tryOp('end', c.start + c.len + p.add_after); if (w) why = why || w; }
      c = at();
      if (p.min_len && c.len < p.min_len - 1e-9) {                                 // still short: lengthen the end, then (if the file ends there) the start
        const need = p.min_len - c.len;
        if (tryOp('end', c.start + c.len + need)) { c = at(); if (tryOp('start', c.start - need)) why = why || 'The video has no more room to make this clip as long as 1 second.'; }
      }
      if (why) skipped.push({ id, label: String(at().label || id).slice(0, 60), why });          // any refusal is named, even when the rest of that clip's changes went through
    }
    return { ops, skipped, clips: ids.length };
  }

  // A plain sentence for the preview of a plan.
  function summary(paceId, pl) {
    const p = find(paceId);
    if (!p || !pl.ops.length && !pl.skipped.length) return p && p.id !== 'standard' ? 'Nothing to change: every clip already has that much room.' : 'Standard changes nothing.';
    const changed = new Set(pl.ops.map(o => o.id)).size;
    return `${p.label}: ${changed} of ${pl.clips} clip${pl.clips === 1 ? '' : 's'} change${changed === 1 ? 's' : ''}${pl.skipped.length ? `; ${pl.skipped.length} could not change fully (see below)` : ''}. Undo takes it all back.`;
  }

  // Ops go to the server in batches of at most 20 (its limit); the page applies them batch by batch.
  const batches = (ops, n = 20) => { const out = []; for (let i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n)); return out; };

  // The panel: a choice (Standard is chosen, and nothing happens until another is chosen and applied), the plain blurb, the plan in words, the clips that could not change, and one button.
  // onApply(batches) is the page's: it applies each batch and says the result.
  function view(h, E, state, { current = 'standard', onChoose, onApply, locked } = {}) {
    const p = find(current) || PACES[0], pl = plan(E, state, p.id);
    const sel = h('select', { id: 'le-pace', 'aria-label': 'Pace of the cut', disabled: !!locked },
      PACES.map(x => h('option', { value: x.id, ...(x.id === p.id ? { selected: true } : {}) }, x.label)));
    sel.addEventListener('change', () => { if (onChoose) onChoose(sel.value); });
    const go = h('button', { type: 'button', class: 'button secondary', id: 'le-pace-apply', disabled: !!locked || !pl.ops.length, onclick: () => { if (onApply) onApply(batches(pl.ops)); } }, p.id === 'standard' ? 'Standard changes nothing' : `Make the pace ${p.label.toLowerCase()}`);
    return h('section', { class: 'le-pace', 'aria-labelledby': 'le-pace-h' },
      h('h2', { id: 'le-pace-h' }, 'Pace'),
      h('label', { for: 'le-pace' }, 'How much quiet round each word '), sel,
      h('p', { class: 'meta' }, p.blurb),
      h('p', { class: 'meta le-pace-note', role: 'status', 'aria-live': 'polite' }, summary(p.id, pl)),
      pl.skipped.length ? h('ul', { class: 'le-pace-skipped' }, pl.skipped.slice(0, 12).map(s => h('li', {}, `${s.label}: ${s.why}`))) : h('span', {}),
      h('p', { class: 'meta' }, 'This assumes the cut was planned at the standard pace (120 ms before, 160 ms after). The numbers are proposals, not measured on viewers.'),
      go);
  }
  window.ryagramClipPace = { PACES, find, plan, summary, batches, view };
})();
