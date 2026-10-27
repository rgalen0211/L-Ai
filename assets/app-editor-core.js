// The live editor's logic (NEXT-WEB 152): the person's edits as OPS from a closed list, each checked, each undoable, applied in order to a small state.
// No DOM and no network here, so every rule has a unit test. The same ops are what the shared draft carries (CONNECT's editor_apply_ops): the page
// applies the person's ops at once, and applies the AI's ops tagged `by: 'ai'` so the person can see them and undo them.
//   state = { look: {key: value}, clips: [{id, track, start, len, label, text?, picture?}], duration, revision }
//   ops   = set_look {key, value} | move_clip {id, start} | trim_clip {id, edge, to} | reorder_clip {id, index} | set_clip_text {id, text} | delete_clip {id}
// The look keys are NOT invented here: a caller passes the keys the worker's schema accepts (see LOOK_KEYS for today's colour keys), and a key not on
// that list is refused before anything is sent.
(() => {
  const MIN_LEN = 0.3;                         // seconds: a clip is never trimmed below this
  const TRACKS = ['video', 'pictures', 'text', 'music'];
  const MAX_TEXT = 200;
  const COLOR = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  // What the worker's schema accepts today (WORKER W1; the preview's colour edits send exactly these). ENGINE 35's keys are added when the schema has them.
  const LOOK_KEYS = Object.freeze({
    'network.color': COLOR, 'network.base_color': COLOR, 'network.context_color': COLOR, 'state.fill': COLOR, 'page.background': COLOR
  });
  const OPS = ['set_look', 'move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip'];
  // Text from the AI or the person is data: capped, control and bidirectional characters removed, never markup.
  const cleanText = s => String(s).replace(new RegExp('[' + [[0, 31], [127, 127], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [60, 60], [62, 62]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g'), '').slice(0, MAX_TEXT);
  const clone = x => JSON.parse(JSON.stringify(x));
  const round = n => Math.round(n * 1000) / 1000;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Who is speaking, which voice, which cast line: these live ONLY on the person's own computer (FACES 62). The website's editor never carries them, so they are stripped from any clip
  // that arrives here, and no op can set them. The AI-altered marker (`ai_altered`, FACES 63) is NOT stripped: it travels with the clip through every move, trim, reorder and undo.
  const LOCAL_ONLY = ['speaker', 'speakers', 'speaker_state', 'speaker_label', 'voice', 'voices', 'voice_id', 'cast', 'cast_badge', 'face', 'faces'];
  const stripLocal = c => { const o = clone(c); for (const k of LOCAL_ONLY) delete o[k]; return o; };
  function newState(init = {}) {
    return { look: clone(init.look || {}), clips: (init.clips || []).map(stripLocal), duration: init.duration || 0, revision: 0 };
  }
  const clipOf = (state, id) => state.clips.find(c => c.id === id);
  const videoOf = state => state.clips.filter(c => c.track === 'video');

  // The video lane is one run: clips follow each other with no gaps. After a change it is packed again from 0 in lane order.
  function repack(state) {
    let t = 0;
    for (const c of videoOf(state)) { c.start = round(t); t += c.len; }
  }
  function endOf(state) { return round(state.clips.reduce((m, c) => Math.max(m, c.start + c.len), 0)); }

  // null when the op may be applied, otherwise the plain sentence the page shows.
  function check(state, op, lookKeys = LOOK_KEYS) {
    if (!op || typeof op !== 'object' || !OPS.includes(op.op)) return 'That change is not one the editor can make.';
    if (op.op === 'set_look') {
      if (typeof op.key !== 'string' || !has(lookKeys, op.key)) return 'That setting is not available yet.';
      if (!lookKeys[op.key](op.value)) return 'That value is not allowed for this setting.';
      return null;
    }
    const c = clipOf(state, op.id);
    if (!c) return 'That clip is not in this film.';
    if (op.op === 'move_clip') {
      if (c.track === 'video') return 'Video clips follow each other. Reorder this one instead.';
      if (!Number.isFinite(op.start) || op.start < 0 || (state.duration && op.start + c.len > state.duration + 1e-6)) return 'That is outside the film.';
    } else if (op.op === 'trim_clip') {
      if (op.edge !== 'start' && op.edge !== 'end') return 'Trim the start or the end.';
      if (!Number.isFinite(op.to) || op.to < 0) return 'That is outside the film.';
      const from = op.edge === 'start' ? op.to : c.start, to = op.edge === 'start' ? c.start + c.len : op.to;
      if (to - from < MIN_LEN - 1e-9) return `A clip can not be shorter than ${MIN_LEN} seconds.`;
      if (op.edge === 'start' && c.track === 'video') return 'Trim a video clip from its end; the next ones move up.';
      if (state.duration && to > state.duration + 1e-6 && c.track !== 'video') return 'That is outside the film.';
    } else if (op.op === 'reorder_clip') {
      if (c.track !== 'video') return 'Only video clips can be reordered.';
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= videoOf(state).length) return 'There is no such place in the list.';
    } else if (op.op === 'set_clip_text') {
      if (c.track !== 'text') return 'Only a text clip has text.';
      if (typeof op.text !== 'string') return 'The text must be words.';
    }
    return null;
  }

  // Pure: returns the next state, or throws if check() would refuse (callers check first).
  function apply(state, op) {
    const next = clone(state);
    if (op.op === 'set_look') next.look[op.key] = op.value;
    else {
      const c = clipOf(next, op.id);
      if (op.op === 'move_clip') c.start = round(op.start);
      else if (op.op === 'trim_clip') {
        if (op.edge === 'start') { const end = c.start + c.len; c.start = round(op.to); c.len = round(end - op.to); }
        else c.len = round(op.to - c.start);
        if (c.track === 'video') repack(next);
      } else if (op.op === 'reorder_clip') {
        const vids = videoOf(next), from = vids.indexOf(c);
        vids.splice(from, 1); vids.splice(op.index, 0, c);
        const others = next.clips.filter(x => x.track !== 'video');
        next.clips = [...vids, ...others];
        repack(next);
      } else if (op.op === 'set_clip_text') c.text = cleanText(op.text);
      else if (op.op === 'delete_clip') { next.clips = next.clips.filter(x => x !== c); if (c.track === 'video') repack(next); }
    }
    next.duration = Math.max(state.duration || 0, endOf(next));
    next.revision = state.revision + 1;
    return next;
  }

  // Snapping while dragging: to the playhead, to another clip's edge, then to a grid; within `reach` seconds, else the raw value.
  function snap(state, id, start, { playhead = null, grid = 0.1, reach = 0.15 } = {}) {
    const c = clipOf(state, id);
    const edges = [0];
    if (playhead !== null) edges.push(playhead);
    for (const o of state.clips) if (o !== c) edges.push(o.start, o.start + o.len);
    let best = null;
    for (const e of edges) for (const at of [e, e - (c ? c.len : 0)]) {
      const d = Math.abs(at - start);
      if (d <= reach && (best === null || d < best.d)) best = { at, d };
    }
    if (best) return round(Math.max(0, best.at));
    return round(Math.max(0, Math.round(start / grid) * grid));
  }

  // The editor: the base state, the log of accepted ops (who made each), undo and redo, and the AI's side of the draft.
  class Editor {
    constructor(base, { lookKeys = LOOK_KEYS } = {}) {
      this.base = newState(base); this.lookKeys = lookKeys;
      this.log = [];                 // { op, by }
      this.redo = [];                // entries undone by the person
      this.undone = new Set();       // signatures of ops the person undid: the AI may not silently repeat them
      this.state = this.base;
    }
    get revision() { return this.state.revision; }
    _replay(entries) {
      let s = this.base; const kept = [];
      for (const e of entries) { if (check(s, e.op, this.lookKeys) === null) { s = apply(s, e.op); kept.push(e); } }
      return { s, kept };
    }
    // The person's op: applied at once. Returns {ok:true} or {ok:false, reason}.
    do(op, by = 'you') {
      const why = check(this.state, op, this.lookKeys);
      if (why) return { ok: false, reason: why };
      this.state = apply(this.state, op); this.log.push({ op, by }); this.redo = [];
      return { ok: true };
    }
    // The AI's ops arrive with the revision they were made against. A stale one is refused with the current state (the AI re-reads and tries again);
    // an op the person just undid is refused too, so the AI can not quietly put it back.
    receive(ops, baseRevision) {
      if (baseRevision !== this.state.revision) return { ok: false, reason: 'stale', revision: this.state.revision };
      if (!Array.isArray(ops) || ops.length > 20) return { ok: false, reason: 'too_many' };
      let s = this.state;
      for (const op of ops) {
        const why = check(s, op, this.lookKeys);
        if (why) return { ok: false, reason: why };
        if (this.undone.has(JSON.stringify(op))) return { ok: false, reason: 'You just undid that change, so your AI can not make it again.' };
        s = apply(s, op);
      }
      for (const op of ops) { this.state = apply(this.state, op); this.log.push({ op, by: 'ai' }); }
      this.redo = [];
      return { ok: true, count: ops.length };
    }
    undo() {
      if (!this.log.length) return { ok: false };
      const e = this.log.pop(); this.redo.push(e); this.undone.add(JSON.stringify(e.op));
      this.state = this._replay(this.log).s;
      return { ok: true, undid: e };
    }
    redoOne() {
      if (!this.redo.length) return { ok: false };
      const rest = this.redo.slice(0, -1), e = this.redo[this.redo.length - 1];
      this.undone.delete(JSON.stringify(e.op));
      const r = this.do(e.op, e.by);
      this.redo = r.ok ? rest : this.redo;
      return r;
    }
    // "Undo my AI's changes": the log is replayed without the AI's ops; the person's own ops stay if they still apply.
    undoAi() {
      const ai = this.log.filter(e => e.by === 'ai');
      if (!ai.length) return { ok: false };
      const { s, kept } = this._replay(this.log.filter(e => e.by !== 'ai'));
      for (const e of ai) this.undone.add(JSON.stringify(e.op));
      this.log = kept; this.state = s; this.redo = [];
      return { ok: true, count: ai.length };
    }
    revert() { this.log = []; this.redo = []; this.undone.clear(); this.state = this.base; }
    // What the banner says about the AI's changes: the controls it touched.
    aiTouched() {
      const seen = [];
      for (const e of this.log) if (e.by === 'ai') { const k = e.op.op === 'set_look' ? 'look:' + e.op.key : 'clip:' + e.op.id; if (!seen.includes(k)) seen.push(k); }
      return seen;
    }
  }

  window.ryagramEditor = { LOCAL_ONLY, MIN_LEN, TRACKS, LOOK_KEYS, OPS, cleanText, newState, check, apply, snap, Editor, repack };
})();
