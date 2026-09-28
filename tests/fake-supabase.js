// An in-memory stand-in for the parts of supabase-js the app uses, with the
// database rules the views depend on (version numbering and copying, locked
// versions). Used by the Node tests and for driving the app in a browser
// before the real project exists. Not loaded by any page.
(function (root) {
  const EDITABLE = ['draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render'];

  function createFakeClient(seed = {}) {
    const db = { projects: [], versions: [], artifacts: [], jobs: [], ...structuredClone(seed) };
    const log = [];
    let n = 0;
    const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const now = () => new Date(Date.UTC(2026, 8, 28, 12, 0, n)).toISOString();

    function query(table) {
      const filters = [];
      let op = 'select', payload = null, single = false, order = null;
      const q = {
        select() { if (op === 'select') op = 'select'; return q; },
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
          if (table === 'projects' && !(row.title && row.title.length <= 200)) {
            return { data: null, error: { message: 'new row violates check constraint' } };
          }
          rows.push(row);
          result = [row];
        } else if (op === 'update') {
          result = rows.filter(r => filters.every(f => f(r)));
          for (const r of result) {
            if (table === 'versions') {
              if ('story_spec' in payload && !EDITABLE.includes(r.state)) {
                return { data: null, error: { message: `This version is locked (${r.state}). Make a new version to change it.` } };
              }
              if ('state' in payload && !((r.state === 'complete' && payload.state === 'archived')
                  || (EDITABLE.includes(r.state) && [...EDITABLE, 'archived'].includes(payload.state)))) {
                return { data: null, error: { message: `Cannot move a version from ${r.state} to ${payload.state} by hand. Make a new version instead.` } };
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
                                     : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: result, error: null };
      }
      return q;
    }

    const client = {
      db, log,
      from: query,
      async rpc(name, args) {
        log.push({ rpc: name, args });
        if (name !== 'create_version') return { data: null, error: { message: `no fake for ${name}` } };
        const project = db.projects.find(p => p.id === args.p_project_id && !p.archived_at);
        if (!project) return { data: null, error: { message: 'Project not found.' } };
        const src = args.p_from_version_id ? db.versions.find(v => v.id === args.p_from_version_id && v.project_id === project.id) : null;
        if (args.p_from_version_id && !src) return { data: null, error: { message: 'Version not found.' } };
        const number = Math.max(0, ...db.versions.filter(v => v.project_id === project.id).map(v => v.number)) + 1;
        const version = {
          id: id(), project_id: project.id, number, parent_version_id: src ? src.id : null, state: 'draft',
          story_spec: src ? structuredClone(src.story_spec) : {}, story_sha256: `sha-${n}`, dataset_id: null,
          restorability: 'unknown', note: null, created_at: now(), updated_at: now()
        };
        db.versions.push(version);
        project.updated_at = now();
        return { data: structuredClone(version), error: null };
      },
      storage: {
        from(bucket) {
          return {
            async createSignedUrl(path, seconds) {
              log.push({ signed: path, bucket, seconds });
              return { data: { signedUrl: `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null };
            }
          };
        }
      }
    };
    return client;
  }

  if (typeof module !== 'undefined') module.exports = { createFakeClient };
  else root.createFakeClient = createFakeClient;
})(typeof window !== 'undefined' ? window : globalThis);
