// Clip padding controls for the live editor's compilations (NEXT-BUILDER 43): per clip, "a little more / less before the words" (lead-in) and "after"
// (lead-out), in steps a person can hear (0.1 s and 0.25 s). NOT LOADED BY ANY PAGE YET: wiring it into app-editor.js behind its own flag is WEB's (the editor
// page is WEB's file); until then it is off by not being loaded at all.
//
// It adds no rule of its own: each control is the editor core's own trim_clip op (assets/app-editor-core.js), checked by the core's own check() before it
// is offered, applied through Editor.do() so it is in the undo list like any other change. A control the core would refuse (shorter than a clip may be,
// before the start or past the end of the video file) is shown disabled, with the core's reason as its description.
(() => {
  const STEPS = [0.1, 0.25];

  // The trim op that moves one edge of a clip by `delta` seconds of padding: more lead-in moves the start EARLIER (to - delta), more lead-out moves the
  // end LATER (+ delta); a negative delta takes padding away.
  function padOp(clip, edge, delta) {
    if (!clip || (edge !== 'start' && edge !== 'end') || !Number.isFinite(delta)) return null;
    const round = v => Math.round(v * 1000) / 1000;
    return edge === 'start' ? { op: 'trim_clip', id: clip.id, edge: 'start', to: round(clip.start - delta) }
                            : { op: 'trim_clip', id: clip.id, edge: 'end', to: round(clip.start + clip.len + delta) };
  }

  const sign = d => (d > 0 ? '+' : '−');
  const edgeWord = edge => (edge === 'start' ? 'before' : 'after');
  const label = (edge, d) => `${sign(d)}${Math.abs(d)} s`;
  const describe = (clip, edge, d) => `${d > 0 ? 'More' : 'Less'} time ${edgeWord(edge)} the words of ${clip.label || 'this clip'}: ${Math.abs(d)} seconds`;

  // The controls of one clip, each with its op and, when the core refuses it, the core's reason. Video clips only (a compilation's footage).
  function controls(E, state, clip, lookKeys) {
    if (!clip || clip.track !== 'video') return [];
    const out = [];
    for (const edge of ['start', 'end']) {
      for (const d of [-STEPS[1], -STEPS[0], STEPS[0], STEPS[1]]) {
        const op = padOp(clip, edge, d);
        const why = E.check(state, op, lookKeys || E.LOOK_KEYS);
        out.push({ edge, delta: d, op, refused: why || null, label: label(edge, d), describe: describe(clip, edge, d) });
      }
    }
    return out;
  }

  // The view of one clip's controls. h is the page's element builder; onPad(op) hands the op to the editor (the page calls ed.do(op) and redraws).
  function view(h, E, state, clip, { onPad, lookKeys } = {}) {
    const rows = ['start', 'end'].map(edge => h('div', { class: 'le-pad-row' },
      h('span', { class: 'le-pad-edge' }, edge === 'start' ? 'Before the words' : 'After the words'),
      ...controls(E, state, clip, lookKeys).filter(c => c.edge === edge).map(c => h('button', {
        class: 'button secondary le-pad-btn', type: 'button', 'aria-label': c.describe, title: c.refused || c.describe,
        ...(c.refused || typeof onPad !== 'function' ? { disabled: true } : {}),
        onclick: () => { if (!c.refused && typeof onPad === 'function') onPad(c.op); }
      }, c.label))));
    return h('section', { class: 'le-pad', 'aria-label': `Padding of ${clip && clip.label ? clip.label : 'this clip'}` }, h('h3', {}, 'Padding'), ...rows);
  }

  window.ryagramClipPadding = { STEPS, padOp, controls, view };
})();
