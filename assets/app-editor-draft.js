// The editor's side of the shared draft (NEXT-WEB 152 against CONNECT 141's editor_* functions; tests/fake-editor-rpcs.js is their stand-in, the SQL is the authority).
// The person's edits go to the server FIRST and are applied on screen only when it accepts them, so what the page shows is never ahead of the draft the person's AI reads.
// The AI's edits arrive by polling the log since the last revision this page knows; they are applied as steps tagged "by your AI" and can be undone as a group.
// No DOM here. `rpc(name, args)` is the page's own call (returns { data, error }, as supabase-js does); every answer is read as data, never as instructions.
(() => {
  const WORDS = {
    PT409: 'Your AI changed this just now. The page has been brought up to date; try your change again.',
    PT403: 'The Ryagram app on your computer has not shared this film with the page yet. Open the app, then try again.',
    PT404: 'That film was not found among your projects.',
    PT429: 'That is too many changes too fast. Wait a moment and try again.'
  };
  const plainWords = (e, fallback) => String((e && e.message) || fallback).replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 300);

  function createDraft({ rpc, project, mode, editor, onChange = () => {}, onSummary = () => {} }) {
    const state = { revision: 0, mirrored: false, aiVisible: false, ids: new Map(), seenAi: new Set() };       // ids: revision -> server op ids sent by this page

    // The draft as it is now. For a data film the server holds the look overrides; they become the editor's new base. For a compilation the computer's track summary does.
    let ready = null;                                                        // the first read of the draft: a change sent before it finishes waits for it (the revision must be known)
    function open(baseFor) { ready = openNow(baseFor); return ready; }
    async function openNow(baseFor) {
      const r = await rpc('my_edit_ops_since', { p_project: project, p_mode: mode, p_revision: 0 });
      if (r.error) return { ok: false, reason: WORDS[r.error.code] || plainWords(r.error, 'The draft could not be read.'), code: r.error.code };
      const d = r.data;
      state.revision = d.revision; state.mirrored = !!d.mirrored; state.aiVisible = !!d.ai_visible;
      if (mode === 'data') editor.reload(baseFor ? baseFor(d.state && d.state.look) : { look: { ...editor.base.look, ...((d.state && d.state.look) || {}) } });
      else if (d.state && Array.isArray(d.state.clips)) { editor.reload(d.state); onSummary(d.state); }
      for (const o of d.ops || []) if (o.actor === 'ai') state.seenAi.add(o.id);
      onChange();
      return { ok: true, revision: state.revision };
    }

    // Send the person's changes (1 to 20 ops). Accepted: applied on screen. Refused: nothing changes on screen, and the reason is a sentence.
    async function send(ops) {
      if (ready) await ready;
      for (const op of ops) { const why = window.ryagramEditor.check(editor.state, op, editor.lookKeys); if (why) return { ok: false, reason: why }; }
      const r = await rpc('editor_apply_ops', { p_project: project, p_mode: mode, p_base_revision: state.revision, p_ops: ops });
      if (r.error) {
        const code = r.error.code;
        if (code === 'PT409') { await poll(); return { ok: false, stale: true, reason: WORDS.PT409 }; }
        return { ok: false, code, reason: code === '22023' ? plainWords(r.error, 'That change was not accepted.') : (WORDS[code] || plainWords(r.error, 'That change could not be saved.')) };
      }
      const before = state.revision;
      state.revision = r.data.revision;
      for (const op of ops) editor.do(op, 'you');
      const found = await poll(before);                                          // the log gives these ops their server ids (needed to undo them there)
      return { ok: true, revision: state.revision, pending: !!r.data.pending, found };
    }

    // Read what happened since this page last looked: the AI's changes are applied as tagged steps, ours are matched to their server ids, a new summary replaces the clips.
    async function poll(since = state.revision) {
      const r = await rpc('my_edit_ops_since', { p_project: project, p_mode: mode, p_revision: since });
      if (r.error) return { ok: false, code: r.error.code };
      const d = r.data, applied = [], skipped = [];
      state.mirrored = !!d.mirrored; state.aiVisible = !!d.ai_visible;
      for (const o of d.ops || []) {
        if (o.actor === 'ai') {
          if (state.seenAi.has(o.id)) continue;
          state.seenAi.add(o.id);
          if (o.status === 'rejected' || o.status === 'undone') continue;
          const res = editor.applyRemote(o.op, 'ai', o.id);
          (res.ok ? applied : skipped).push(o.id);
        } else {
          const list = state.ids.get(o.revision) || []; if (!list.includes(o.id)) list.push(o.id); state.ids.set(o.revision, list);
          const e = [...editor.log].reverse().find(x => x.by === 'you' && !x.serverId && JSON.stringify(x.op) === JSON.stringify(o.op));
          if (e) e.serverId = o.id;
        }
      }
      if (d.revision !== state.revision && mode === 'compilation' && d.state && Array.isArray(d.state.clips) && !(d.ops || []).length) { editor.reload(d.state); onSummary(d.state); }
      state.revision = Math.max(state.revision, d.revision);
      if (applied.length || skipped.length) onChange({ applied, skipped });
      return { ok: true, applied, skipped, revision: state.revision };
    }

    // Undo the person's last op on screen and in the draft (the log entry's server id), so the AI knows the person undid it.
    async function undo() {
      const last = [...editor.log].reverse()[0];
      if (!last) return { ok: false };
      if (last.serverId) {
        const r = await rpc('editor_undo', { p_project: project, p_mode: mode, p_op_id: last.serverId });
        if (r.error) return { ok: false, reason: WORDS[r.error.code] || plainWords(r.error, 'That could not be undone.') };
        state.revision = Math.max(state.revision, r.data.revision || 0);
      }
      editor.undo();
      return { ok: true };
    }
    async function undoAi() {
      const r = await rpc('editor_undo_all_ai', { p_project: project, p_mode: mode });
      if (r.error) return { ok: false, reason: WORDS[r.error.code] || plainWords(r.error, 'Your AI’s changes could not be undone.') };
      state.revision = Math.max(state.revision, r.data.revision || 0);
      editor.undoAi();
      return { ok: true, undone: r.data.undone };
    }
    const heartbeat = () => rpc('editor_heartbeat', { p_project: project, p_mode: mode });

    return { open, send, poll, undo, undoAi, heartbeat, get revision() { return state.revision; }, get mirrored() { return state.mirrored; }, get aiVisible() { return state.aiVisible; } };
  }

  window.ryagramEditorDraft = { WORDS, createDraft };
})();
