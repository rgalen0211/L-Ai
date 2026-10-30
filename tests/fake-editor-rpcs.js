// A stand-in for CONNECT's live-editor functions (supabase/migrations/20261027000400_live_editor.sql, NOT APPLIED), for WEB's page to be built and tested against.
// The SQL is the authority; this mirrors its SHAPES and its refusals (stale revision, not mirrored, nothing to undo) so the page handles the real answers.
//   const { rpcs, ai, app } = createEditorRpcs({ check });      // check(mode, op) -> null | 'a plain sentence' : pass WEB's own op check (assets/app-editor-core.js); the default only knows the op names
//   client.rpc('editor_apply_ops', { p_project, p_mode, p_base_revision, p_ops })  ->  { data, error }
//   ai.apply(project, mode, base, ops)  = what the person's connected AI does (connect_edit_ops);  app.post(project, { mirror, aiVisible, summary, applied }) = the desktop app (node_edit_post_summary)
// Errors are { data: null, error: { code, message } } with the SQL's codes: PT409 stale, PT403 not shared / not mirrored, PT404 not found, 22023 refused, PT429 too fast.
(function () {
  const NAMES = { data: ['set_look', 'unset_look'], compilation: ['move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'add_clip', 'set_clip_style', 'set_music', 'set_rule', 'delete_rule', 'set_film_look'] };
  const defaultCheck = (mode, op) => (op && NAMES[mode] && NAMES[mode].includes(op.op) ? null : '"' + String(op && op.op).slice(0, 40) + '" is not a change this editor knows.');
  const fail = (code, message) => ({ data: null, error: { code, message } });
  const ok = data => ({ data, error: null });

  function createEditorRpcs({ check = defaultCheck, now = () => Date.now(), projects = null } = {}) {
    const drafts = new Map();       // `${project}|${mode}` -> { revision, state, mirrored, ai_visible, editor_seen_at }
    const ops = [];                 // the log: { id, project, mode, revision, actor, client, op, inverse, status, at, undone_at }
    let nextId = 1;
    const draft = (project, mode) => {
      const k = project + '|' + mode;
      if (!drafts.has(k)) drafts.set(k, { revision: 0, state: mode === 'data' ? { look: {} } : {}, mirrored: false, ai_visible: false, editor_seen_at: null });
      return drafts.get(k);
    };
    const mine = project => projects === null || projects.includes(project);

    function apply(project, mode, base, list, actor, client) {
      if (!mine(project)) return fail('PT404', 'That project was not found among your projects.');
      if (!['data', 'compilation'].includes(mode)) return fail('22023', 'That is not an editor mode.');
      if (!Array.isArray(list) || list.length < 1 || list.length > 20) return fail('22023', 'Send between 1 and 20 changes at a time.');
      const d = draft(project, mode);
      if (base !== d.revision) return fail('PT409', 'The editor has changed since you looked (it is now at revision ' + d.revision + '). Read it again with get_edit_state and send your changes on top of that.');
      if (mode === 'compilation' && actor === 'ai' && !d.ai_visible) return fail('PT403', 'The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app.');
      if (mode === 'compilation' && actor === 'person' && !d.mirrored) return fail('PT403', 'The Ryagram app on your computer has not shared the track list with this page yet. Open it, then try again.');
      for (let i = 0; i < list.length; i++) {
        const p = check(mode, list[i]);
        if (p) return fail('22023', 'Change ' + (i + 1) + ' was not accepted, and nothing was changed: ' + p);
        if (mode === 'compilation' && list[i].op === 'add_clip' && Array.isArray(d.state.lanes) && !d.state.lanes.includes(list[i].track)) return fail('22023', 'Change ' + (i + 1) + ' was not accepted: the editor cannot add to the ' + list[i].track + ' track yet.');
        if (actor === 'ai' && ops.some(o => o.project === project && o.mode === mode && (o.status === 'undone' || o.status === 'rejected') && o.ended_by === 'person' && JSON.stringify(o.op) === JSON.stringify(list[i]) && now() - o.undone_at < 600000)) {
          return fail('PT409', 'Change ' + (i + 1) + ' was not accepted: the person undid exactly this a moment ago. Ask them before doing it again.');
        }
      }
      const revision = d.revision + 1;
      for (const op of list) {
        let inverse = null;
        if (mode === 'data') {
          const prev = d.state.look[op.key];
          if (op.op === 'set_look') { inverse = prev === undefined ? { op: 'unset_look', key: op.key } : { op: 'set_look', key: op.key, value: prev }; d.state.look[op.key] = op.value; }
          else { inverse = prev === undefined ? null : { op: 'set_look', key: op.key, value: prev }; delete d.state.look[op.key]; }
        }
        ops.push({ id: nextId++, project, mode, revision, actor, client: actor === 'ai' ? client || 'AI' : null, op, inverse, status: mode === 'data' ? 'applied' : 'pending', at: now(), undone_at: null, ended_by: null });
      }
      d.revision = revision;
      return ok({ revision, changes: list.length, state: mode === 'data' ? JSON.parse(JSON.stringify(d.state)) : null, pending: mode === 'compilation' });
    }

    function undo(project, mode, ids, by) {
      if (!mine(project)) return fail('PT404', 'That project was not found among your projects.');
      const d = draft(project, mode);
      let undone = 0, skipped = 0;
      for (const row of ops.filter(o => o.project === project && o.mode === mode && ids.includes(o.id)).sort((a, b) => b.id - a.id)) {
        if (row.status === 'pending') { row.status = 'rejected'; row.undone_at = now(); row.ended_by = by; undone++; }
        else if (row.status === 'applied' && row.inverse && mode === 'data') {
          if (ops.some(l => l.project === project && l.mode === mode && l.id > row.id && l.status === 'applied' && l.op.key === row.op.key)) { skipped++; continue; }
          if (row.inverse.op === 'set_look') d.state.look[row.inverse.key] = row.inverse.value; else delete d.state.look[row.inverse.key];
          row.status = 'undone'; row.undone_at = now(); row.ended_by = by; undone++;
        } else skipped++;
      }
      if (undone > 0) d.revision++;
      return ok({ undone, skipped, revision: d.revision, state: mode === 'data' ? JSON.parse(JSON.stringify(d.state)) : null });
    }

    const rpcs = {
      editor_apply_ops: ({ p_project, p_mode, p_base_revision, p_ops }) => apply(p_project, p_mode, p_base_revision, p_ops, 'person', null),
      editor_undo: ({ p_project, p_mode, p_op_id }) => undo(p_project, p_mode, [p_op_id], 'person'),
      editor_undo_all_ai: ({ p_project, p_mode }) => undo(p_project, p_mode, ops.filter(o => o.project === p_project && o.mode === p_mode && o.actor === 'ai' && (o.status === 'applied' || o.status === 'pending')).map(o => o.id), 'person'),
      my_edit_ops_since: ({ p_project, p_mode, p_revision }) => {
        if (!mine(p_project)) return fail('PT404', 'That project was not found among your projects.');
        const d = draft(p_project, p_mode);
        const rows = ops.filter(o => o.project === p_project && o.mode === p_mode && o.revision > p_revision).slice(0, 200)
          .map(o => ({ id: o.id, revision: o.revision, actor: o.actor, client: o.client, op: o.op, status: o.status, at: new Date(o.at).toISOString() }));
        return ok({ revision: d.revision, state: JSON.parse(JSON.stringify(d.state)), mirrored: d.mirrored, ai_visible: d.ai_visible, ops: rows });
      },
      editor_heartbeat: ({ p_project, p_mode }) => {
        if (!mine(p_project) || !['data', 'compilation'].includes(p_mode)) return fail('PT404', 'That project was not found among your projects.');
        draft(p_project, p_mode).editor_seen_at = now();
        return ok(null);
      },
    };

    const ai = {
      apply: (project, mode, base, list, client) => apply(project, mode, base, list, 'ai', client),
      undoLast: (project, mode) => {
        const mineOps = ops.filter(o => o.project === project && o.mode === mode && o.actor === 'ai' && (o.status === 'applied' || o.status === 'pending'));
        const last = mineOps.length ? Math.max(...mineOps.map(o => o.revision)) : -1;
        return undo(project, mode, mineOps.filter(o => o.revision === last).map(o => o.id), 'ai');
      },
    };

    // The desktop app: mirrors the track summary (the page may then edit it), optionally lets the AI see it, acknowledges what it applied.
    const app = {
      post: (project, { mirror = true, aiVisible = false, summary = {}, applied = [] } = {}) => {
        if (!mine(project)) return fail('PT404', 'That project was not found among your projects.');
        const d = draft(project, 'compilation');
        if (!mirror) {
          ops.filter(o => o.project === project && o.mode === 'compilation' && o.status === 'pending').forEach(o => { o.status = 'rejected'; o.undone_at = now(); o.ended_by = 'app'; });
          Object.assign(d, { mirrored: false, ai_visible: false, state: {}, revision: d.revision + 1 });
          return ok({ revision: d.revision, mirrored: false, ai_visible: false });
        }
        for (const a of applied) {
          const row = ops.find(o => o.id === a.op_id && o.project === project && o.mode === 'compilation' && o.status === 'pending');
          if (row) { row.status = a.ok ? 'applied' : 'rejected'; row.undone_at = a.ok ? null : now(); row.ended_by = a.ok ? null : 'app'; }
        }
        Object.assign(d, { mirrored: true, ai_visible: !!aiVisible, state: summary, revision: d.revision + 1 });
        if (!aiVisible) ops.filter(o => o.project === project && o.mode === 'compilation' && o.actor === 'ai' && o.status === 'pending').forEach(o => { o.status = 'rejected'; o.undone_at = now(); o.ended_by = 'app'; });
        return ok({ revision: d.revision, mirrored: true, ai_visible: !!aiVisible });
      },
      pending: project => ops.filter(o => o.project === project && o.mode === 'compilation' && o.status === 'pending' && draft(project, 'compilation').mirrored)
        .slice(0, 100).map(o => ({ id: o.id, project_id: o.project, revision: o.revision, client: o.client, op: o.op })),
    };

    return { rpcs, ai, app, ops, draft };
  }

  if (typeof module !== 'undefined') module.exports = { createEditorRpcs };
  else if (typeof window !== 'undefined') window.createEditorRpcs = createEditorRpcs;
})();
