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
    const db = { projects: [], versions: [], artifacts: [], jobs: [], ai_sessions: [], ai_messages: [], film_pages: [],
                 account_settings: [], version_sources: [], datasets: [], dataset_ingests: [], ...structuredClone(seed) };
    // Credits: a simplified copy of the 2B ledger's rules, only when seeded with { credits: n }.
    const ledger = typeof seed.credits === 'number' ? { available: seed.credits, held: 0 } : null;
    // Packs and plans on sale (credit_prices + stripe_prices), with the ledger only.
    if (ledger) {
      const at = '2026-09-01T00:00:00Z';
      db.credit_prices = db.credit_prices || [['pack_starter', 10, 1200, false], ['pack_maker', 28, 3000, false], ['pack_studio', 60, 6000, false],
        ['sub_creator', 30, 2400, true], ['sub_pro', 100, 6900, true], ['final_map', 8, null, false]]
        .map(([code, credits, price_cents, monthly]) => ({ price_version: '2026-09', code, credits, price_cents, monthly, effective_from: at }));
      db.stripe_prices = db.stripe_prices || ['pack_starter', 'pack_maker', 'pack_studio', 'sub_creator', 'sub_pro']
        .map(price_code => ({ price_code, mode: price_code.startsWith('sub_') ? 'subscription' : 'payment', active: true }));
      db.stripe_subscriptions = db.stripe_subscriptions || [];
    }
    const WEBHOOK_DELAY_MS = seed.webhookDelayMs ?? 2000;
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
        upsert(row) { op = 'upsert'; payload = row; return q; },         // one row per person (account_settings)
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
        if (op === 'upsert') {
          if (!rows.length) rows.push({ owner_id: 'u-ryan' });
          Object.assign(rows[0], payload, { updated_at: now() });
          result = [rows[0]];
        } else if (op === 'insert') {
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

    // Mock version of sync_version_sources (SQL 20261004000100): facts for the template datasets, plus one
    // dataset Ryagram has but can't run yet. The real rules are tested against Postgres.
    const MOCK_CATALOG = {
      state_obesity_fastfood: ['Obesity and fast food by state', 'CDC (BRFSS) and U.S. Census Bureau (County Business Patterns)', 'https://data.cdc.gov/d/hn4x-zwk7', 'US state (plus DC), 2011 to 2023, annual', 'Both are U.S. Government works in the public domain', 'Both are U.S. Government works in the public domain. CDC asks that BRFSS be cited and notes its values are self-reported survey estimates.'],
      bps_county_permits: ['Residential building permits per 1,000 residents, by county', 'U.S. Census Bureau, Building Permits Survey', 'https://www.census.gov/construction/bps/', 'US county (lower 48 + DC), 1990 to 2024, annual', 'U.S. Government work, public domain', 'U.S. Government work, public domain. The Census Bureau asks that the source be cited.'],
      bls_state_unemployment: ['BLS state unemployment', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/lau/', 'US state (plus DC), 1976-01 onward, monthly', 'U.S. Government work, public domain', 'U.S. Government work, public domain.'],
      cbp_manufacturing_share_state: ['Manufacturing share of CBP-covered employment, by state', 'U.S. Census Bureau, County Business Patterns', 'https://www.census.gov/programs-surveys/cbp.html', 'US state (plus DC), 1998 to 2023, annual', 'U.S. Government work, public domain', 'U.S. Government work, public domain. The Census Bureau asks that the source be cited.'],
      cbp_retail_employment: ['Retail trade (employment)', 'U.S. Census Bureau, County Business Patterns', 'https://www.census.gov/programs-surveys/cbp.html', 'US county (lower 48 + DC), 1998 to 2023, annual', 'U.S. Government work, public domain', 'U.S. Government work, public domain.', false]
    };
    function syncSources(versionId) {
      const v = db.versions.find(x => x.id === versionId);
      if (!v) return { data: null, error: { message: 'Version not found.' } };
      db.version_sources = db.version_sources || [];
      if (EDITABLE.includes(v.state)) {
        const clips = Array.isArray(v.story_spec?.sequence?.clips) ? v.story_spec.sequence.clips : [];
        const named = [...new Set(clips.filter(c => c.kind === 'render' && c.dataset).map(c => c.dataset))];
        if (named.length > 5) return { data: null, error: { message: 'A film can use up to 5 sources.' } };
        // An uploaded dataset is named u_<24 hex>; it must be one of the person's approved uploads (the real rule).
        const upload = ref => db.datasets.find(d => d.source === 'upload' && d.status === 'approved' && !d.deleted_at && !d.delete_requested_at && refOf(d) === ref);
        for (const ref of named.filter(n => /^u_[0-9a-f]{24}$/.test(n))) {
          if (!upload(ref)) return { data: null, error: { message: `"${ref}" isn't ready, or isn't yours.` } };
        }
        const wanted = named.filter(n => !/^u_[0-9a-f]{24}$/.test(n));
        for (const id of wanted) {
          if (!MOCK_CATALOG[id]) return { data: null, error: { message: `We don't have data called "${id}".` } };
          if (MOCK_CATALOG[id][6] === false) return { data: null, error: { message: `We have "${MOCK_CATALOG[id][0]}", but can't run it yet.` } };
        }
        db.version_sources = db.version_sources.filter(r => r.version_id !== versionId || r.kind !== 'catalog' || wanted.includes(r.dataset_ref));
        wanted.forEach((id, i) => {
          const [title, publisher, source_url, coverage, licence_short, licence_full] = MOCK_CATALOG[id];
          const row = { version_id: versionId, kind: 'catalog', dataset_ref: id, title, publisher, source_url, coverage, licence_short, licence_full, position: i + 1 };
          const at = db.version_sources.findIndex(r => r.version_id === versionId && r.dataset_ref === id);
          if (at >= 0) db.version_sources[at] = row; else db.version_sources.push(row);
        });
      }
      return { data: db.version_sources.filter(r => r.version_id === versionId).sort((a, b) => a.position - b.position), error: null };
    }
    // Mock of upload-your-own-data (SQL 20261004000200/300). The mock "worker" reads a .csv/.tsv for real (headers,
    // a few sample values, a guess at which column is what) after READ_MS; other formats come back unreadable, because
    // the real reader runs only on the worker. The real rules are tested against Postgres.
    const READ_MS = seed.uploadReadMs ?? 600;
    const files = {};
    const COUNTY_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
    function readTable(textBody, sep) {
      const rows = textBody.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
      if (rows.length < 2) return null;
      const head = rows[0], body = rows.slice(1);
      const kinds = head.map((_, i) => {
        const vals = body.map(r => r[i] ?? '').filter(Boolean);
        if (!vals.length) return 'text';
        if (vals.every(v => /^(19|20)\d\d$/.test(v) || /^(19|20)\d\d-\d\d$/.test(v)) && /year|date|period|month/i.test(head[i])) return 'period';
        if (vals.every(v => /^-?[\d,.]+$/.test(v))) return 'number';
        return /state|county|place|name|area/i.test(head[i]) ? 'place' : 'text';
      });
      const columns = head.map((header, index) => ({ index, header: header.slice(0, 80), kind: kinds[index], sample: body.slice(0, 5).map(r => String(r[index] ?? '').slice(0, 40)) }));
      const place = kinds.indexOf('place'), period = kinds.indexOf('period');
      const periods = period >= 0 ? body.map(r => r[period]).filter(Boolean).sort() : [];
      const wide = head.filter(h => /^(19|20)\d\d$/.test(h)).length >= 3;
      return { rows: body.length, columns, place, period, wide, periods,
               values: kinds.map((k, i) => (k === 'number' && i !== place && i !== period ? i : -1)).filter(i => i >= 0),
               cadence: periods.some(p => /^\d{4}-\d\d$/.test(p)) ? 'monthly' : 'annual',
               places: place >= 0 ? [...new Set(body.map(r => r[place]))] : [] };
    }
    function runMockWorker(ds) {
      const ing = db.dataset_ingests.find(i => i.dataset_id === ds.id);
      setTimeout(async () => {
        const file = files[ds.storage_path];
        const reject = (code, detail) => { ing.state = 'failed'; ing.error_code = code; ing.error_detail = detail; ds.status = 'rejected'; };
        const text = ['csv', 'tsv'].includes(ds.ext);
        let t = null;
        if (text && file?.text) t = readTable(await file.text(), ds.ext === 'tsv' ? '\t' : ',');
        if (!t) return reject(text ? 'not_a_table' : 'unreadable',
                              text ? 'This doesn\u2019t look like a table with a header row and some data rows.'
                                   : 'The mock reader only opens .csv and .tsv. The real reader also opens .xlsx and .ods.');
        const named = t.places.filter(p => /^[A-Z]{2}$/.test(p) || /^[A-Z][a-z]+( [A-Z][a-z]+)*$/.test(p));
        ds.ingest_report = { format: ds.ext, sha256: 'a'.repeat(64), rows: t.rows, columns: t.columns,
          guess: { place_index: t.place, period_index: t.period, value_indexes: t.values, geography: named.length && named.length <= 52 ? 'us_states' : null,
                   cadence: t.periods.length ? t.cadence : null, wide: t.wide },
          periods: t.periods.length ? { first: t.periods[0], last: t.periods[t.periods.length - 1], count: new Set(t.periods).size } : null,
          unmatched: { count: 0, names: [] } };
        ds.row_count = t.rows;
        ing.state = 'done';
      }, READ_MS);
    }
    const mine = dsId => db.datasets.find(d => d.id === dsId && d.source === 'upload' && !d.deleted_at && !d.delete_requested_at);
    const EXT_OK = ['csv', 'tsv', 'xlsx', 'ods'];
    const refOf = ds => 'u_' + ds.id.replace(/-/g, '').slice(0, 24);
    const rpcsExtra = {
      create_upload({ p_label, p_ext, p_bytes, p_retention }) {
        const label = String(p_label || '').trim();
        if (!label) return fail('Give the file a name.');
        if (!EXT_OK.includes(String(p_ext).toLowerCase())) return fail('Ryagram reads .csv, .tsv, .xlsx and .ods files.');
        if (!(p_bytes > 0) || p_bytes > 10 * 1024 * 1024) return fail('A file can be up to 10 MB.');
        const live = db.datasets.filter(d => d.source === 'upload' && !d.deleted_at && !d.delete_requested_at);
        if (live.length >= 20) return fail('You can keep up to 20 uploaded datasets.');
        if (live.reduce((a, d) => a + (d.bytes || 0), 0) + p_bytes > 100 * 1024 * 1024) return fail('Your uploads can add up to 100 MB. Delete some data first.');
        const dsId = id();
        const ext = String(p_ext).toLowerCase();
        const path = `u-ryan/${dsId}/source.${ext}`;
        db.datasets.push({ id: dsId, owner_id: 'u-ryan', name: label, filename_label: label, source: 'upload', status: 'pending_validation', ext, bytes: p_bytes,
          retention: p_retention || db.account_settings[0]?.upload_retention || 'keep', storage_path: path, geography: null, mapping: null,
          ingest_report: null, uploaded_at: null, delete_requested_at: null, deleted_at: null, created_at: now() });
        return { data: [{ dataset_id: dsId, storage_path: path }], error: null };
      },
      finish_upload({ p_dataset }) {
        const ds = mine(p_dataset);
        if (!ds) return fail('Dataset not found.');
        if (!files[ds.storage_path]) return fail('The file didn\u2019t arrive. Try uploading it again.');
        ds.uploaded_at = now();
        db.dataset_ingests.push({ id: id(), dataset_id: ds.id, state: 'queued', error_code: null, error_detail: null });
        runMockWorker(ds);
        return { data: null, error: null };
      },
      confirm_dataset_mapping({ p_dataset, p_mapping }) {
        const ds = mine(p_dataset);
        if (!ds) return fail('Dataset not found.');
        if (!ds.ingest_report) return fail('We haven\u2019t finished reading this file yet.');
        const m = p_mapping || {};
        if (ds.ingest_report.guess.wide) return fail('This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.');
        if (!Number.isInteger(m.place_index) || !Number.isInteger(m.period_index)) return fail('Choose which column is the place and which is the period.');
        if (m.geography === 'us_counties' && m.state_index == null && !COUNTY_STATES.includes(m.state)) return fail('County names need a state. Choose the state, or the column that has it.');
        if (!m.value_indexes?.length) return fail('Choose 1 to 8 columns of values.');
        Object.assign(ds, { mapping: structuredClone(m), geography: m.geography, status: 'approved' });
        return { data: null, error: null };
      },
      attach_upload_to_version({ p_version, p_dataset }) {
        const v = db.versions.find(x => x.id === p_version);
        const ds = mine(p_dataset);
        if (!v || !ds) return fail('Dataset not found.');
        if (!EDITABLE.includes(v.state)) return fail(`This version is ${v.state} and can't change its data. Make a new version.`);
        if (ds.status !== 'approved') return fail('Confirm what the columns mean before using this data.');
        v.dataset_id = ds.id;
        const p = ds.ingest_report.periods;
        const coverage = [ds.geography === 'us_counties' ? 'U.S. counties' : 'U.S. states', p ? `${p.first} to ${p.last}` : null, ds.mapping.cadence].filter(Boolean).join(', ');
        db.version_sources = db.version_sources.filter(r => !(r.version_id === v.id && r.kind === 'upload'));
        db.version_sources.push({ version_id: v.id, kind: 'upload', dataset_ref: refOf(ds), title: ds.name, publisher: 'Your data', source_url: '', coverage,
          licence_short: 'You confirm you may use this data', licence_full: '', position: db.version_sources.filter(r => r.version_id === v.id).length + 1 });
        return { data: refOf(ds), error: null };
      },
      request_dataset_deletion({ p_dataset }) {
        const ds = mine(p_dataset);
        if (!ds) return fail('Dataset not found.');
        ds.delete_requested_at = now();
        for (const v of db.versions) if (v.dataset_id === ds.id) v.dataset_id = null;
        db.version_sources = db.version_sources.filter(r => r.dataset_ref !== refOf(ds));
        delete files[ds.storage_path];
        return { data: null, error: null };
      }
    };
    const sceneAsks = {};
    const rpcs = {
      ...rpcsExtra,
      sync_version_sources({ p_version }) { return syncSources(p_version); },
      // Mock: the mock user is an admin; three films' worth of made-up signup counts.
      is_app_admin() { return { data: true, error: null }; },
      waitlist_by_film({ p_days }) {
        const rows = [
          ['2026-10-03', 'r002-industry-story', 'youtube', 3], ['2026-10-03', null, null, 1],
          ['2026-10-02', 'housing-supply-story', 'youtube', 2], ['2026-10-02', 'r002-industry-story', 'youtube', 1],
          ['2026-09-20', 'obesity-fastfood-story', 'youtube', 4], ['2026-07-01', 'housing-supply-story', 'youtube', 5]];
        const since = Date.parse('2026-10-03T00:00:00Z') - p_days * 864e5;
        return { data: rows.filter(r => Date.parse(r[0]) > since)
                   .map(([day, campaign, utm_source, signups]) => ({ day, campaign, utm_source, signups })), error: null };
      },
      // Mock visit counts: made-up numbers for the private view (the real ones come from SQL 20261006000100).
      visits_by_day({ p_days }) {
        const rows = [['2026-10-05', 40, 3], ['2026-10-04', 25, 1], ['2026-10-03', 18, 0], ['2026-08-01', 90, 4]];
        const since = Date.parse('2026-10-05T00:00:00Z') - p_days * 864e5;
        return { data: rows.filter(r => Date.parse(r[0]) > since).map(([day, visits, signups]) => ({ day, visits, signups })), error: null };
      },
      visits_by_source({ p_days }) {
        const rows = p_days >= 90 ? [['youtube', 120, 7], ['', 30, 1], ['newsletter', 6, 0]] : [['youtube', 70, 4], ['', 10, 0], ['newsletter', 3, 0]];
        return { data: rows.map(([source, visits, signups]) => ({ source, visits, signups })), error: null };
      },
      // Mock scene bundle (live preview): 'building' on the first ask, then 'ready' with the synthetic fixture.
      request_scene_bundle({ p_version_id }) {
        sceneAsks[p_version_id] = (sceneAsks[p_version_id] || 0) + 1;
        if (sceneAsks[p_version_id] === 1) return { data: [{ status: 'building', job_id: id(), storage_path: null, engine_commit: null, error_detail: null }], error: null };
        return { data: [{ status: 'ready', job_id: id(), storage_path: `mock/${p_version_id}/scene.bundle.zip`, engine_commit: 'f1x7ure', error_detail: null }], error: null };
      },
      film_unpublish({ p_version }) {
        const page = db.film_pages.find(p => p.version_id === p_version);
        if (!page) return fail('No public page for that film.');
        page.published = false;
        return { data: null, error: null };
      },
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
          if (name === 'redeem-invite') {
            // Mock: RYA-TEST-CODE works; the "email" is the link /app/?mock&invite=mock-invite-token.
            const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (code !== 'RYATESTCODE' && code !== 'TESTCODE') {
              return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'That code isn\u2019t valid, has expired or has been used up.' }) } } };
            }
            log.push({ invited: body.email });
            return { data: { message: 'If that email can join, a link to finish joining is on its way. It works once. Already have an account? Sign in instead.' }, error: null };
          }
          if (name === 'delete-account') {
            if ((body.confirm_email || '').trim().toLowerCase() !== (session?.user?.email || '').toLowerCase()) {
              return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'Type your account’s email address exactly to confirm.' }) } } };
            }
            if (db.jobs.some(j => ACTIVE.includes(j.state))) {
              return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'A render is still running. Cancel it or let it finish, then try again.' }) } } };
            }
            if (ledger && db.jobs.some(j => j.credits_quoted > 0)) {
              return { data: { status: 'requested', message: 'Your account has credit history, which is kept as a financial record. Your request is recorded, and your account and files will be deleted by hand within 30 days.' }, error: null };
            }
            for (const t of ['projects', 'versions', 'artifacts', 'jobs', 'film_pages', 'account_settings', 'ai_sessions', 'ai_messages']) db[t].length = 0;
            return { data: { status: 'deleted', files_removed: 0 }, error: null };
          }
          if (name === 'film-page') {
            // Mock publish: the summary comes from the sample page; the link opens /film/?mock.
            const v = db.versions.find(x => x.id === body.version_id);
            const err = text => ({ data: null, error: { message: 'x', context: { json: async () => ({ error: text }) } } });
            if (!v) return err('Version not found.');
            if (v.state !== 'complete') return err('Only a finished film can have a public page.');
            let page = db.film_pages.find(p => p.version_id === v.id);
            if (!page) {
              page = { version_id: v.id, slug: `Mock${id().replace(/-/g, '')}`.slice(0, 22), published_at: now() };
              db.film_pages.push(page);
            }
            Object.assign(page, { title: body.title || 'Obesity and fast food (mock)', published: true });
            return { data: { slug: page.slug, url: `/film/?mock&s=${page.slug}` }, error: null };
          }
          if (name === 'stripe-checkout' && ledger) {
            // Mock Stripe: no checkout page. The "webhook" grants the credits a moment later.
            if (body.action === 'portal') {
              if (!db.stripe_subscriptions.length) return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'There’s no plan or purchase to manage yet.' }) } } };
              for (const sub of db.stripe_subscriptions) sub.cancel_at_period_end = !sub.cancel_at_period_end;
              return { data: { url: '#/credits' }, error: null };
            }
            const offer = db.credit_prices.find(p => p.code === body.price_code && p.price_cents != null);
            if (!offer) return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'That isn’t on sale.' }) } } };
            if (offer.monthly) {
              if (db.stripe_subscriptions.some(x => x.status === 'active')) {
                return { data: null, error: { message: 'x', context: { json: async () => ({ error: 'You already have a plan. Use Manage plan to change or cancel it.' }) } } };
              }
              db.stripe_subscriptions.push({ subscription_id: `sub_${id()}`, price_code: offer.code, status: 'active',
                current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(), cancel_at_period_end: false });
            }
            setTimeout(() => { ledger.available += offer.credits; }, WEBHOOK_DELAY_MS);
            return { data: { url: `#/credits?paid=${offer.code}` }, error: null };
          }
          if (name !== 'ai-editor') return { data: null, error: { message: 'no such function', context: { json: async () => ({}) } } };
          let aiSession = db.ai_sessions.find(s => s.version_id === body.version_id);
          if (!aiSession) { aiSession = { id: id(), version_id: body.version_id }; db.ai_sessions.push(aiSession); }
          const reply = `(mock editor) You said: ${body.message}. In the real editor, Claude would edit the story or start a sheet here.`;
          for (const [role, content] of [['user', body.message], ['assistant', reply]]) {
            db.ai_messages.push({ id: id(), session_id: aiSession.id, role, content, created_at: now() });
          }
          return { data: { reply, actions: [], escalated: false, tool_calls: 0 }, error: null };
        }
      },
      storage: {
        from(bucket) {
          return {
            async upload(path, file, options) {
              log.push({ upload: path, bucket, type: options?.contentType, bytes: file?.size });
              if (bucket === 'ryagram-uploads') {
                const slot = db.datasets.find(d => d.storage_path === path && !d.uploaded_at);
                if (!slot || files[path]) return { data: null, error: { message: 'new row violates row-level security policy' } };
                files[path] = file;
              }
              return { data: { path }, error: null };
            },
            // Authenticated download (the live preview's bundle): the synthetic fixture zip in mock mode.
            async download(path) {
              log.push({ download: path, bucket });
              const b64 = (typeof window !== 'undefined' ? window : globalThis).ryagramSceneFixtureB64;
              if (!/scene\.bundle\.zip$/.test(path) || !b64) return { data: null, error: { message: 'not found' } };
              const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return { data: new Blob([bytes], { type: 'application/zip' }), error: null };
            },
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
        async resetPasswordForEmail(email, options) { log.push({ reset: email, options }); return { data: {}, error: null }; },
        async verifyOtp({ token_hash, type }) {
          const ok = (type === 'recovery' && token_hash === 'mock-reset-token') || (type === 'invite' && token_hash === 'mock-invite-token');
          if (!ok) return { error: { message: 'Token has expired or is invalid' } };
          session = { user: { id: 'u-ryan', email: 'ryan@example.com' } };
          for (const cb of authListeners) cb('SIGNED_IN', session);
          return { data: { session }, error: null };
        },
        async updateUser({ password }) {
          if (!session) return { error: { message: 'Auth session missing!' } };
          if (!password || password.length < 10) return { error: { message: 'Password should be at least 10 characters.' } };
          log.push({ passwordChanged: true });
          return { data: { user: session.user }, error: null };
        },
        async signOut() { session = null; for (const cb of authListeners) cb('SIGNED_OUT', null); return { error: null }; }
      }
    };
    return client;
  }

  if (typeof module !== 'undefined') module.exports = { createFakeClient };
  else root.createFakeClient = createFakeClient;
})(typeof window !== 'undefined' ? window : globalThis);
