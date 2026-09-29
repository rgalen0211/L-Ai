// An in-memory stand-in for the parts of supabase-js the app uses, with the
// database rules the views depend on: version numbering and copying, locked
// versions, submit_job's checks (parameters, one job in flight per type, the
// contact sheet -> preview -> final ladder on the exact story), cancel_job,
// queue_position, final-render state mirrored onto the version, and Realtime
// change events. Used by the Node tests and by mock mode (/app/?mock on
// localhost only). Not loaded by any page on the public site.
(function (root) {
  const EDITABLE = ['draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render'];
  const ACTIVE = ['queued', 'claimed', 'running', 'validating', 'uploading'];
  const VERSION_FROM_FINAL = {
    queued: 'queued', claimed: 'rendering', running: 'rendering', validating: 'validating', uploading: 'uploading',
    complete: 'complete', failed: 'failed', editorial_action_required: 'editorial_action_required', cancelled: 'ready_to_render'
  };
  const PLACEHOLDER = label => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#354247"/>` +
    `<text x="320" y="190" font-family="Arial" font-size="28" fill="#efe5d3" text-anchor="middle">${label}</text></svg>`);

  function createFakeClient(seed = {}, { user = { id: 'u-ryan', email: 'ryan@example.com' } } = {}) {
    const db = { projects: [], versions: [], artifacts: [], jobs: [], ai_sessions: [], ai_messages: [], ...structuredClone(seed) };
    // Credits: a simplified copy of the 2B ledger's rules, only when seeded with { credits: n }.
    const ledger = typeof seed.credits === 'number' ? { available: seed.credits, held: 0 } : null;
    const VIEW_PRICE = { line: ['final_line', 6, 1], map: ['final_map', 8, 2], river: ['final_map', 8, 2], split: ['final_map', 8, 2],
                         globe: ['final_paired', 10, 3], bars: ['final_paired', 10, 3], paired: ['final_paired', 10, 3], panel: ['final_paired', 10, 3] };
    function quote(v, type) {
      if (type === 'contact_sheet') return { price_code: 'contact_sheet', credits: 0, free_preview: false };
      if (type === 'preview') {
        const mine = db.jobs.filter(j => j.job_type === 'preview' && j.free_preview && !(j.state === 'failed' && j.error_class === 'infrastructure'));
        const free = mine.filter(j => j.project_id === v.project_id).length < 6 && mine.length < 15;
        return free ? { price_code: 'preview_free', credits: 0, free_preview: true } : { price_code: 'preview_extra', credits: 1, free_preview: false };
      }
      const renders = (v.story_spec?.sequence?.clips || []).filter(c => c.kind === 'render');
      if (!renders.length) throw new Error('A final film needs at least one data view to be priced.');
      const best = renders.map(c => VIEW_PRICE[c.view]).reduce((a, b) => (!b ? a : !a || b[2] > a[2] ? b : a), null);
      if (!best) throw new Error(`Can't price a film with the view "${renders[0].view}".`);
      return { price_code: best[0], credits: best[1], free_preview: false };
    }
    let engineCommit = 'e0a1b2c';                   // what the pretend worker runs
    const log = [];
    const channels = new Set();
    let n = 0;
    const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const now = () => new Date(Date.UTC(2026, 8, 28, 12, 0, 0) + (++n) * 1000).toISOString();
    const fail = message => ({ data: null, error: { message } });

    // Realtime: tell subscribers about a changed job row.
    function emit(table, row) {
      for (const ch of channels) {
        if (ch.table === table && (!ch.versionId || ch.versionId === row.version_id)) ch.callback({ new: structuredClone(row) });
      }
    }
    // What the jobs trigger does: a final render's state shows on its version; in 2B the
    // ledger triggers capture or release the job's hold.
    function jobChanged(job) {
      if (ledger && job.held && !job.captured && !job.released) {
        if (job.state === 'complete') { job.captured = job.held; ledger.held -= job.held; }
        else if (['failed', 'cancelled', 'editorial_action_required'].includes(job.state)) {
          job.released = job.held; ledger.held -= job.held; ledger.available += job.held;
        }
      }
      if (job.job_type === 'final_render') {
        const v = db.versions.find(x => x.id === job.version_id);
        if (v) { v.state = VERSION_FROM_FINAL[job.state]; v.updated_at = now(); emit('versions', v); }
      }
      emit('jobs', job);
    }

    function query(table) {
      if (table === 'credit_balances' || table === 'job_accounting') {
        if (!ledger) return { select: () => ({ then: r => r({ data: null, error: { message: `relation ${table} does not exist` } }) }) };
        const rows = () => table === 'credit_balances'
          ? [{ pool: 'granted', available: ledger.available, held: ledger.held }]
          : db.jobs.filter(j => 'credits_quoted' in j).map(j => ({ job_id: j.id, version_id: j.version_id, price_code: j.price_code,
              credits_quoted: j.credits_quoted, free_preview: j.free_preview, held: j.held, captured: j.captured,
              released: j.released, refunded: j.refunded }));
        const filters = [];
        const q = { select: () => q, eq: (c, v) => { filters.push(r => r[c] === v); return q; },
                    then: (res, rej) => Promise.resolve({ data: structuredClone(rows().filter(r => filters.every(f => f(r)))), error: null }).then(res, rej) };
        return q;
      }
      const filters = [];
      let op = 'select', payload = null, single = false, order = null;
      const q = {
        select() { return q; },
        insert(row) { op = 'insert'; payload = row; return q; },
        update(row) { op = 'update'; payload = row; return q; },
        eq(col, val) { filters.push(r => r[col] === val); return q; },
        in(col, vals) { filters.push(r => vals.includes(r[col])); return q; },
        is(col, val) { filters.push(r => (r[col] ?? null) === val); return q; },
        order(col, { ascending = true } = {}) { order = { col, ascending }; return q; },
        single() { single = true; return q; },
        then(resolve, reject) { return Promise.resolve().then(exec).then(resolve, reject); }
      };
      function exec() {
        log.push({ table, op, payload });
        const rows = db[table];
        let result;
        if (op === 'insert') {
          const row = { id: id(), created_at: now(), updated_at: now(), archived_at: null, ...payload };
          if (table === 'projects' && !(row.title && row.title.length <= 200)) return fail('new row violates check constraint');
          rows.push(row);
          result = [row];
        } else if (op === 'update') {
          result = rows.filter(r => filters.every(f => f(r)));
          for (const r of result) {
            if (table === 'versions') {
              if (('story_spec' in payload || 'dataset_id' in payload) && !EDITABLE.includes(r.state)) {
                return fail(`This version is locked (${r.state}). Make a new version to change it.`);
              }
              if ('state' in payload && payload.state !== r.state && !((r.state === 'complete' && payload.state === 'archived')
                  || (EDITABLE.includes(r.state) && [...EDITABLE, 'archived'].includes(payload.state)))) {
                return fail(`Cannot move a version from ${r.state} to ${payload.state} by hand. Make a new version instead.`);
              }
            }
            Object.assign(r, payload, { updated_at: now() });
            if (table === 'versions' && 'story_spec' in payload) r.story_sha256 = `sha-${n}`;
          }
        } else {
          result = rows.filter(r => filters.every(f => f(r)));
        }
        if (order) {
          result = [...result].sort((a, b) => (a[order.col] < b[order.col] ? -1 : a[order.col] > b[order.col] ? 1 : 0) * (order.ascending ? 1 : -1));
        }
        result = structuredClone(result);
        if (single) {
          return result.length === 1 ? { data: result[0], error: null }
                                     : fail('JSON object requested, multiple (or no) rows returned');
        }
        return { data: result, error: null };
      }
      return q;
    }

    const rpcs = {
      create_version(args) {
        const project = db.projects.find(p => p.id === args.p_project_id && !p.archived_at);
        if (!project) return fail('Project not found.');
        const src = args.p_from_version_id ? db.versions.find(v => v.id === args.p_from_version_id && v.project_id === project.id) : null;
        if (args.p_from_version_id && !src) return fail('Version not found.');
        const number = Math.max(0, ...db.versions.filter(v => v.project_id === project.id).map(v => v.number)) + 1;
        const version = {
          id: id(), project_id: project.id, number, parent_version_id: src ? src.id : null, state: 'draft',
          story_spec: src ? structuredClone(src.story_spec) : {}, story_sha256: src ? src.story_sha256 : `sha-${n}`,
          dataset_id: null, restorability: 'unknown', note: null, created_at: now(), updated_at: now()
        };
        db.versions.push(version);
        project.updated_at = now();
        return { data: structuredClone(version), error: null };
      },

      submit_job(args) {
        const v = db.versions.find(x => x.id === args.p_version_id);
        if (!v) return fail('Version not found.');
        if (['queued', 'rendering', 'validating', 'uploading', 'complete', 'archived', 'non_restorable'].includes(v.state)) {
          return fail(`This version is ${v.state} and cannot take new jobs.`);
        }
        if (!(String(v.story_spec?.schema) === '1' && v.story_spec?.engine === 'sequence')) {
          return fail('The story is not a schema-1 sequence yet.');
        }
        const type = args.p_job_type;
        const params = args.p_params || {};
        const allowed = { contact_sheet: ['periods'], preview: ['window_s'], final_render: [] }[type];
        const bad = Object.keys(params).find(k => !allowed.includes(k));
        if (bad) return fail(`Unknown parameter "${bad}" for ${type}.`);
        if (type === 'preview' && !params.window_s) {
          return fail('A preview needs window_s: [start, end] in seconds, at most 10 seconds long.');
        }
        if (db.jobs.some(j => j.version_id === v.id && j.job_type === type && ACTIVE.includes(j.state))) {
          return fail(`A ${type} job for this version is already in progress.`);
        }
        const done = (jobId, jobType) => db.jobs.find(j => j.id === jobId && j.job_type === jobType && j.state === 'complete'
                                                         && j.version_id === v.id && j.story_sha256 === v.story_sha256);
        const sheet = type === 'final_render' && done(args.p_sheet_job_id, 'contact_sheet');
        const preview = type === 'final_render' && done(args.p_preview_job_id, 'preview');
        if (type === 'final_render' && preview && !preview.engine_commit) {
          return fail('The preview has no engine version recorded. Make a new preview first.');
        }
        if (type === 'final_render' && !(sheet && preview && sheet.engine_commit === preview.engine_commit)) {
          return fail('The contact sheet and preview must both be complete, for this exact story, from the same engine version.');
        }
        let price = null;
        if (ledger) {
          try { price = quote(v, type); } catch (e) { return fail(e.message); }
          if (price.credits > 0 && ledger.available < price.credits) {
            return fail(`Not enough credits: this needs ${price.credits}, and ${Math.max(0, ledger.available)} are available.`);
          }
          ledger.available -= price.credits;
          ledger.held += price.credits;
        }
        const job = {
          ...(price ? { price_code: price.price_code, credits_quoted: price.credits, free_preview: price.free_preview,
                        held: price.credits, captured: 0, released: 0, refunded: 0 } : {}),
          id: id(), version_id: v.id, project_id: v.project_id, owner_id: user.id, job_type: type, state: 'queued',
          attempt: 1, params, story_sha256: v.story_sha256,
          engine_commit: null, ladder_engine_commit: type === 'final_render' ? preview.engine_commit : null,
          sheet_job_id: type === 'final_render' ? args.p_sheet_job_id : null,
          preview_job_id: type === 'final_render' ? args.p_preview_job_id : null,
          cancel_requested: false, error_class: null, error_code: null, error_detail: null,
          progress: null, progress_note: null, created_at: now(), started_at: null, ended_at: null
        };
        db.jobs.push(job);
        jobChanged(job);
        return { data: structuredClone(job), error: null };
      },

      cancel_job(args) {
        const j = db.jobs.find(x => x.id === args.p_job_id);
        if (!j) return fail('Job not found.');
        if (j.state === 'queued') Object.assign(j, { state: 'cancelled', ended_at: now(), error_class: 'cancelled', error_code: 'cancelled' });
        else if (ACTIVE.includes(j.state)) j.cancel_requested = true;
        else return fail(`This job has already finished (${j.state}).`);
        jobChanged(j);
        return { data: structuredClone(j), error: null };
      },

      credit_quote(args) {
        if (!ledger) return fail('function credit_quote does not exist');
        const v = db.versions.find(x => x.id === args.p_version_id);
        if (!v) return fail('Version not found.');
        try { return { data: [{ ...quote(v, args.p_job_type), available: ledger.available }], error: null }; }
        catch (e) { return fail(e.message); }
      },

      current_engine_commit() {
        const ran = db.jobs.filter(j => j.engine_commit && j.started_at).sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
        return { data: ran[0] ? ran[0].engine_commit : null, error: null };
      },

      queue_position(args) {
        const j = db.jobs.find(x => x.id === args.p_job_id);
        if (!j || j.state !== 'queued') return { data: null, error: null };
        const ahead = db.jobs.filter(q => q.state === 'queued' && (q.created_at < j.created_at || (q.created_at === j.created_at && q.id < j.id)));
        return { data: ahead.length + 1, error: null };
      }
    };

    let session = user ? { user } : null;
    const authListeners = new Set();
    const client = {
      db, log, jobChanged, now, newId: id,
      get engineCommit() { return engineCommit; },
      set engineCommit(c) { engineCommit = c; },
      from: query,
      async rpc(name, args) {
        log.push({ rpc: name, args });
        return rpcs[name] ? rpcs[name](args) : fail(`no fake for ${name}`);
      },
      channel(name) {
        const ch = { name, table: null, versionId: null, callback: null };
        return {
          on(kind, spec, callback) {
            ch.table = spec.table;
            ch.versionId = (spec.filter || '').replace(/^version_id=eq\./, '') || null;
            ch.callback = callback;
            return this;
          },
          subscribe(status) { channels.add(ch); setTimeout(() => status && status('SUBSCRIBED'), 0); ch.handle = this; return this; },
          _ch: ch
        };
      },
      removeChannel(handle) { channels.delete(handle._ch); },
      // Mock AI editor: answers in plain text and records the conversation, no model involved.
      functions: {
        async invoke(name, { body }) {
          log.push({ fn: name, body });
          if (name !== 'ai-editor') return { data: null, error: { message: 'no such function', context: { json: async () => ({}) } } };
          let session = db.ai_sessions.find(s => s.version_id === body.version_id);
          if (!session) { session = { id: id(), version_id: body.version_id }; db.ai_sessions.push(session); }
          const reply = `(mock editor) You said: ${body.message}. In the real editor, Claude would edit the story or start a sheet here.`;
          for (const [role, content] of [['user', body.message], ['assistant', reply]]) {
            db.ai_messages.push({ id: id(), session_id: session.id, role, content, created_at: now() });
          }
          return { data: { reply, actions: [], escalated: false, tool_calls: 0 }, error: null };
        }
      },
      storage: {
        from(bucket) {
          return {
            async createSignedUrl(path, seconds) {
              log.push({ signed: path, bucket, seconds });
              const url = /\.(png|jpg)$/.test(path)
                ? PLACEHOLDER(path.endsWith('sheet.png') ? 'Contact sheet (mock)' : 'Thumbnail (mock)')
                : `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t`;
              return { data: { signedUrl: url }, error: null };
            }
          };
        }
      },
      auth: {
        async getSession() { return { data: { session } }; },
        onAuthStateChange(cb) {
          authListeners.add(cb);
          setTimeout(() => cb('INITIAL_SESSION', session), 0);
          return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
        },
        async signInWithPassword({ email }) {
          session = { user: { id: 'u-ryan', email } };
          for (const cb of authListeners) cb('SIGNED_IN', session);
          return { error: null };
        },
        async signOut() { session = null; for (const cb of authListeners) cb('SIGNED_OUT', null); return { error: null }; }
      }
    };
    return client;
  }

  if (typeof module !== 'undefined') module.exports = { createFakeClient };
  else root.createFakeClient = createFakeClient;
})(typeof window !== 'undefined' ? window : globalThis);
