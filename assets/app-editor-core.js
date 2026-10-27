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
    'network.color': COLOR, 'network.base_color': COLOR, 'network.context_color': COLOR, 'state.fill': COLOR, 'page.background': COLOR,
    // the map views' keys (WORKER's schema accepts them today; CONNECT's edit_look_keys holds them): checked here so an AI's change to them is applied, not skipped
    'choropleth.low': COLOR, 'choropleth.high': COLOR,
    'state.outline_width': v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 4,
    'sequence.theme': v => v === 'light' || v === 'dark'
  });
  // The vocabulary is CONNECT's (tests/edit-op-cases.json is run by both the SQL and TypeScript checks): the data mode's set_look / unset_look and the compilation mode's clip ops plus add_clip.
  const OPS = ['set_look', 'unset_look', 'move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'add_clip'];
  const DATA_OPS = ['set_look', 'unset_look'];
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
    const s = { look: clone(init.look || {}), clips: (init.clips || []).map(stripLocal), duration: init.duration || 0, revision: 0 };
    // From the track summary (BUILDER 21): the lanes the maker can build today (an edit in any other lane is refused), and the engine's own limits (text letters).
    if (Array.isArray(init.lanes)) s.lanes = init.lanes.filter(l => TRACKS.includes(l));
    if (init.limits && typeof init.limits === 'object') s.limits = { text_chars: Number.isInteger(init.limits.text_chars) ? init.limits.text_chars : undefined };
    return s;
  }
  // Per-clip length limits come with the clip (min_len, max_len); a clip without them uses the editor's minimum and no maximum.
  const minLen = c => (Number.isFinite(c.min_len) ? c.min_len : MIN_LEN);
  const maxLen = c => (Number.isFinite(c.max_len) ? c.max_len : Infinity);
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
    if (DATA_OPS.includes(op.op)) {
      if (typeof op.key !== 'string' || !has(lookKeys, op.key)) return 'That setting is not available yet.';
      if (op.op === 'set_look' && !lookKeys[op.key](op.value)) return 'That value is not allowed for this setting.';
      return null;
    }
    if (op.op === 'add_clip') {
      if (op.track !== 'text' && op.track !== 'pictures') return 'You can add a text line or a picture here.';
      if (state.lanes && !state.lanes.includes(op.track)) return 'That part of the film can not be edited here yet.';
      if (!Number.isFinite(op.start) || op.start < 0 || !Number.isFinite(op.len) || op.len < (op.track === 'text' ? 0.5 : MIN_LEN) - 1e-9) return 'Give it a start and a length that fit the film.';
      if (state.duration && op.start + op.len > state.duration + 1e-6) return 'That is outside the film.';
      if (op.track === 'text') {
        if (typeof op.text !== 'string' || !cleanText(op.text).trim()) return 'A text line needs some words.';
        const cap = state.limits && state.limits.text_chars;
        if (cap && cleanText(op.text).length > cap) return `Text can be at most ${cap} letters here.`;
      } else if (typeof op.picture !== 'string' || !op.picture) return 'Pick one of your pictures.';
      return null;
    }
    const c = clipOf(state, op.id);
    if (!c) return 'That clip is not in this film.';
    if (state.lanes && !state.lanes.includes(c.track)) return 'That part of the film can not be edited here yet.';
    if (op.op === 'move_clip') {
      if (c.track === 'video') return 'Video clips follow each other. Reorder this one instead.';
      if (!Number.isFinite(op.start) || op.start < 0 || (state.duration && op.start + c.len > state.duration + 1e-6)) return 'That is outside the film.';
    } else if (op.op === 'trim_clip') {
      if (op.edge !== 'start' && op.edge !== 'end') return 'Trim the start or the end.';
      if (!Number.isFinite(op.to) || op.to < 0) return 'That is outside the film.';
      // A video clip keeps its place in the run: trimming its start cuts the file's start (source_start moves), and the run is packed again. Any other clip's start moves.
      const delta = op.edge === 'start' ? op.to - c.start : 0;
      const newLen = op.edge === 'start' ? c.len - delta : op.to - c.start;
      const from = op.edge === 'start' ? op.to : c.start, to = op.edge === 'start' ? c.start + c.len : op.to;
      if (newLen < minLen(c) - 1e-9) return `A clip can not be shorter than ${minLen(c)} seconds.`;
      if (c.track === 'video') {
        if (op.edge === 'start' && Number.isFinite(c.source_start) && c.source_start + delta < -1e-9) return 'That is before the start of the video file.';
        const room = maxLen(c) - (op.edge === 'start' ? delta : 0);                 // max_len is the rest of the file from source_start
        if (newLen > room + 1e-9) return 'That is past the end of the video file.';
      } else {
        if (newLen > maxLen(c) + 1e-9) return `A clip can not be longer than ${maxLen(c)} seconds.`;
        if (state.duration && to > state.duration + 1e-6) return 'That is outside the film.';
        if (from < 0) return 'That is outside the film.';
      }
    } else if (op.op === 'reorder_clip') {
      if (c.track !== 'video') return 'Only video clips can be reordered.';
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= videoOf(state).length) return 'There is no such place in the list.';
    } else if (op.op === 'set_clip_text') {
      if (c.track !== 'text') return 'Only a text clip has text.';
      if (typeof op.text !== 'string') return 'The text must be words.';
      const cap = state.limits && state.limits.text_chars;
      if (cap && cleanText(op.text).length > cap) return `Text can be at most ${cap} letters here.`;
    }
    return null;
  }

  // Pure: returns the next state, or throws if check() would refuse (callers check first).
  function apply(state, op) {
    const next = clone(state);
    if (op.op === 'set_look') next.look[op.key] = op.value;
    else if (op.op === 'unset_look') delete next.look[op.key];
    else if (op.op === 'add_clip') {
      const id = `new${state.revision + 1}`;
      next.clips.push(op.track === 'text'
        ? { id, track: 'text', start: round(op.start), len: round(op.len), label: 'Text', text: cleanText(op.text), min_len: 0.5 }
        : { id, track: 'pictures', start: round(op.start), len: round(op.len), label: 'Picture', picture: op.picture });
    } else {
      const c = clipOf(next, op.id);
      if (op.op === 'move_clip') c.start = round(op.start);
      else if (op.op === 'trim_clip') {
        if (op.edge === 'start' && c.track === 'video') {
          const delta = op.to - c.start;
          c.len = round(c.len - delta);
          if (Number.isFinite(c.source_start)) c.source_start = round(c.source_start + delta);
          if (Number.isFinite(c.max_len)) c.max_len = round(c.max_len - delta);
        } else if (op.edge === 'start') { const end = c.start + c.len; c.start = round(op.to); c.len = round(end - op.to); }
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

  // The AI-altered marker is about FOOTAGE, not clip ids (CC1 10:37): a video clip counts as marked if it carries the marker itself OR its stretch of its source file overlaps a stretch that was
  // marked when the editor opened (base), even if the marked clip was since deleted or the clip was trimmed back into it. The page only SHOWS this; the maker's edit_from_tracks enforces it.
  function isMarked(base, clip) {
    const known = clip.track === 'video' && typeof clip.source === 'string' && Number.isFinite(clip.source_start);
    if (!known) return clip.ai_altered === true || clip.ai_altered_derived === true;      // a slide, a text or a clip with no recorded source: its own marker (BUILDER: the maker keeps slides by picture)
    // A video clip with a known stretch of its file is marked by the footage only (BUILDER 10:43): trimmed off the altered stretch, the maker builds it unmarked, so the page shows that.
    const a0 = clip.source_start, a1 = clip.source_start + clip.len;
    // the stretches are the marked clips the maker did NOT merely derive (ai_altered_derived is the maker's own overlap result, CONNECT 11:36), as the maker's edit_from_tracks counts them
    return base.clips.some(m => m.ai_altered === true && m.ai_altered_derived !== true && m.track === 'video' && m.source === clip.source && Number.isFinite(m.source_start)
      && a0 < m.source_start + m.len - 1e-9 && m.source_start < a1 - 1e-9);
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
      for (const e of this.log) if (e.by === 'ai') { const k = DATA_OPS.includes(e.op.op) ? 'look:' + e.op.key : 'clip:' + (e.op.id || 'new'); if (!seen.includes(k)) seen.push(k); }
      return seen;
    }
    // An op that the SERVER has already accepted and that came from the other side (the person's AI, through the shared draft): applied as a step tagged `by`, if it still applies
    // to what is on screen and the person did not just undo it. Returns {ok:true} or {ok:false, reason} (the caller reads the draft again).
    applyRemote(op, by = 'ai', serverId = null) {
      const why = check(this.state, op, this.lookKeys);
      if (why) return { ok: false, reason: why };
      if (this.undone.has(JSON.stringify(op))) return { ok: false, reason: 'You just undid that change, so it is not applied again.' };
      this.state = apply(this.state, op); this.log.push({ op, by, serverId }); this.redo = [];
      return { ok: true };
    }
    // A new base from the server (the draft as it was when the editor opened, or a fresh track summary from the computer): the log starts again from it.
    reload(base) { this.base = newState(base); this.state = this.base; this.log = []; this.redo = []; this.undone.clear(); }
  }

  window.ryagramEditor = { isMarked, LOCAL_ONLY, MIN_LEN, TRACKS, LOOK_KEYS, OPS, DATA_OPS, cleanText, newState, check, apply, snap, Editor, repack };
})();
