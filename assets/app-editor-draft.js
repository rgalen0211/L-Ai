// The editor's side of the shared draft (NEXT-WEB 152 against CONNECT 141's editor_* functions; tests/fake-editor-rpcs.js is their stand-in, the SQL is the authority).
// The person's edits go to the server FIRST and are applied on screen only when it accepts them, so what the page shows is never ahead of the draft the person's AI reads.
// The AI's edits arrive by polling the log since the last revision this page knows; they are applied as steps tagged "by your AI" and can be undone as a group.
// No DOM here. `rpc(name, args)` is the page's own call (returns { data, error }, as the site's database client does); every answer is read as data, never as instructions.
(() => {
  const PANEL = 'Ryagram panel';        // the label the server gives a change made by a click in the chat panel (migrations/20261105000100_chat_editor.sql)
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
    // One write at a time: a host may hold a write for seconds (ChatGPT asks the person first), and a second change made meanwhile must be sent against the revision the first one produces, not the old one (it would be refused as stale with a wrong reason).
    let tail = Promise.resolve();
    function send(ops, group = null) { const run = tail.then(() => sendNow(ops, group)); tail = run.then(() => {}, () => {}); return run; }
    async function sendNow(ops, group = null) {
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
      for (const op of ops) editor.do(op, 'you', group);
      const found = await poll(before);                                          // the log gives these ops their server ids (needed to undo them there)
      return { ok: true, revision: state.revision, pending: !!r.data.pending, found };
    }

    // Read what happened since this page last looked: the AI's changes are applied as tagged steps, ours are matched to their server ids, a new summary replaces the clips.
    async function poll(since = state.revision) {
      const r = await rpc('my_edit_ops_since', { p_project: project, p_mode: mode, p_revision: since });
      if (r.error) return { ok: false, code: r.error.code };
      const d = r.data, applied = [], skipped = [], appliedOps = [];
      state.mirrored = !!d.mirrored; state.aiVisible = !!d.ai_visible;
      for (const o of d.ops || []) {
        if (o.actor === 'ai' && o.client === PANEL) {
          // a click the person made in the Ryagram panel of their AI chat: the server records it under the AI's rules, but it is THEIRS. This page's own panel edit is matched to its step (never applied twice);
          // one made elsewhere is applied as the person's own step, so the banner does not call it the AI's and "Undo my AI's changes" leaves it alone.
          if (state.seenAi.has(o.id)) continue;
          state.seenAi.add(o.id);
          if (o.status === 'rejected' || o.status === 'undone') continue;
          const mine = [...editor.log].reverse().find(x => x.by === 'you' && !x.serverId && JSON.stringify(x.op) === JSON.stringify(o.op));
          if (mine) mine.serverId = o.id;
          else { const res = editor.applyRemote(o.op, 'you', o.id); (res.ok ? applied : skipped).push(o.id); if (res.ok) appliedOps.push(o.op); }
        } else if (o.actor === 'ai') {
          if (state.seenAi.has(o.id)) continue;
          state.seenAi.add(o.id);
          if (o.status === 'rejected' || o.status === 'undone') continue;
          const res = editor.applyRemote(o.op, 'ai', o.id);
          (res.ok ? applied : skipped).push(o.id);
          if (res.ok) appliedOps.push(o.op);
        } else {
          const list = state.ids.get(o.revision) || []; if (!list.includes(o.id)) list.push(o.id); state.ids.set(o.revision, list);
          const e = [...editor.log].reverse().find(x => x.by === 'you' && !x.serverId && JSON.stringify(x.op) === JSON.stringify(o.op));
          if (e) e.serverId = o.id;
        }
      }
      if (d.revision !== state.revision && mode === 'compilation' && d.state && Array.isArray(d.state.clips) && !(d.ops || []).length) { editor.reload(d.state); onSummary(d.state); }
      state.revision = Math.max(state.revision, d.revision);
      if (applied.length || skipped.length) onChange({ applied, skipped, ops: appliedOps });
      return { ok: true, applied, skipped, ops: appliedOps, revision: state.revision };
    }

    // Undo the person's last op on screen and in the draft (the log entry's server id), so the AI knows the person undid it.
    function undo() { return queued(undoNow); }
    function redo() { return queued(redoNow); }
    // Undo and Redo run one at a time inside the same queue as sends, and each reads the log only when its turn comes, so two quick presses never read the same last entry.
    function queued(fn) { const run = tail.then(fn); tail = run.then(() => {}, () => {}); return run; }
    // What the server holds for one op of this page's log (its status), read from the log itself: the undo answer says only "undone 0", which is also what a newer change to the same setting gives.
    async function serverStatus(id) {
      const r = await rpc('my_edit_ops_since', { p_project: project, p_mode: mode, p_revision: 0 });
      if (r.error || !r.data) return null;
      const o = (r.data.ops || []).find(x => x.id === id);
      return o ? o.status : null;
    }
    // Take these log entries off the screen as undone, by identity, so an AI op the poll added meanwhile is never the one dropped (newest first, so the oldest ends on top of the redo stack, as editor.undo() leaves it).
    function dropEntries(list) {
      for (const e of list) { const i = editor.log.lastIndexOf(e); if (i < 0) continue; editor.log.splice(i, 1); editor.redo.push(e); editor.undone.add(JSON.stringify(e.op)); }
      editor.state = editor._replay(editor.log).s;
    }
    async function undoNow() {
      if (ready) await ready;
      const last = [...editor.log].reverse()[0];
      if (!last) return { ok: false };
      // a ready-made look is a group: every op of it is undone on the server too, newest first, so the draft and the screen agree
      const mine = last.group ? editor.log.filter(e => e.group === last.group).reverse() : [last];
      const done = [];                  // entries that are undone on the server (by this press, or already before it)
      let already = 0, why = null;
      for (const e of mine) {
        if (!e.serverId) { done.push(e); continue; }
        let r;
        try { r = await rpc('editor_undo', { p_project: project, p_mode: mode, p_op_id: e.serverId }); } catch (x) { r = { error: { message: 'Could not undo. Try again.' } }; }
        if (r.error) { why = WORDS[r.error.code] || plainWords(r.error, 'That could not be undone.'); break; }
        if (r.data && r.data.undone > 0) { state.revision = Math.max(state.revision, r.data.revision || 0); done.push(e); continue; }
        // undone 0: ask the server's log. Already undone there (for instance by "Undo my AI's changes"): the screen catches up, so Undo is never stuck on it. Anything else: a real failure, the screen stays.
        const st = await serverStatus(e.serverId).catch(() => null);
        if (st === 'undone' || st === 'rejected') { done.push(e); already++; continue; }
        why = 'That change could not be undone, because a newer change to the same setting stands. Nothing was changed.';
        break;
      }
      if (why === null) {
        if (mine.every(e => done.includes(e))) {
          const here = mine.some(e => editor.log.includes(e));
          dropEntries(mine);
          if (!here) return { ok: true, note: 'Nothing to undo here.' };
          return already ? { ok: true, note: 'That change was already undone.' } : { ok: true }; }
      }
      // failed partway: the ones the server has undone leave the screen too, so screen, draft and server agree
      if (done.length) { dropEntries(done); return { ok: false, partial: true, reason: (why || 'Part of that could not be undone.') + ' The parts that were undone are off the screen.' }; }
      return { ok: false, reason: why };
    }
    // Redo the person's last undone step: the server takes the op(s) again (it decides first, like any change); the rest of the redo stack stays, because sending an op clears it.
    async function redoNow() {
      if (ready) await ready;
      const stack = editor.redo;      // read inside the queue: a newer edit that arrived meanwhile has already emptied it
      if (!stack.length) return { ok: false };
      const top = stack[stack.length - 1];
      const take = top.group ? stack.filter(e => e.group === top.group) : [top];
      const ops = take.slice().reverse().map(e => e.op);                  // the stack's top is the OLDEST op of a group: first made, first sent
      const rest = stack.slice(0, stack.length - take.length);
      const logBefore = editor.log.length;
      const r = await sendNow(ops, top.group || null);
      if (!r.ok) return r;
      // keep the rest of the redo stack only if nothing newer (an AI edit read by the poll) landed besides the redone ops; otherwise the older undone ops would replay over a newer change
      editor.redo = editor.log.length === logBefore + ops.length ? rest : [];
      for (const op of ops) editor.undone.delete(JSON.stringify(op));
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

    return { open, send, poll, undo, redo, undoAi, heartbeat, get revision() { return state.revision; }, get mirrored() { return state.mirrored; }, get aiVisible() { return state.aiVisible; } };
  }

  window.ryagramEditorDraft = { WORDS, createDraft };
})();
