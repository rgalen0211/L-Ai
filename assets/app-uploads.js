// Upload your own data, phase 1 (spreadsheets): the rules the page checks before and after the worker reads a file.
// The database and the worker enforce all of these again; this is only so people hear a plain reason at once.
// What the worker reports about a file (names, sample values) is the person's own data and untrusted text.
(() => {
  const EXTS = ['csv', 'tsv', 'xlsx', 'ods'];
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_UPLOADS = 20;
  // Sent as the file's type whatever the browser guesses (Windows calls a .csv "application/vnd.ms-excel"); the private bucket allows exactly these.
  const MIME = { csv: 'text/csv', tsv: 'text/tab-separated-values', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 ods: 'application/vnd.oasis.opendocument.spreadsheet' };
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
    SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const text = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const mb = n => `${Math.round(n / (1024 * 1024))} MB`;

  const extOf = name => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

  // { ok, ext, label, problem }: the file name becomes a label with no folders and no control characters.
  function checkFile(file, { count = 0 } = {}) {
    const name = text(String(file?.name || '').split(/[\\/]/).pop());
    const ext = extOf(name);
    const bad = problem => ({ ok: false, ext, label: name, problem });
    if (!file || !name) return bad('Choose a file.');
    if (count >= MAX_UPLOADS) return bad(`You can keep up to ${MAX_UPLOADS} uploaded datasets. Delete one first.`);
    if (['xls', 'xlsm', 'xlsb'].includes(ext)) return bad('Save it as .xlsx (or .csv) and choose it again. Older Excel files and files with macros aren’t accepted.');
    if (!EXTS.includes(ext)) return bad('Ryagram reads .csv, .tsv, .xlsx and .ods files. PDFs, scans and photos aren’t supported yet.');
    if (!(file.size > 0)) return bad('That file is empty.');
    if (file.size > MAX_BYTES) return bad(`That file is ${mb(file.size)}. The limit is ${mb(MAX_BYTES)}.`);
    return { ok: true, ext, label: name.slice(0, 200), problem: '' };
  }

  // One word for where an upload is: reading / check / ready / failed, from its dataset row and its latest ingest row.
  function chip(ds, ingest) {
    if (!ds) return { key: 'reading', label: 'Reading…' };
    if (ds.delete_requested_at || ds.deleted_at) return { key: 'deleting', label: 'Deleting…' };
    if (ds.status === 'approved') return { key: 'ready', label: 'Ready' };
    if (ds.status === 'rejected' || ingest?.state === 'failed') {
      return { key: 'failed', label: 'Couldn’t read', detail: text(ingest?.error_detail) || 'We couldn’t read this file. Check that it’s a table with one row per place and year, then upload it again.' };
    }
    if (ds.ingest_report) return { key: 'check', label: 'Check what we found' };
    return { key: 'reading', label: 'Reading…' };
  }

  // The mapping the person starts from: what the reader guessed. Null when the file has its years across the columns.
  function draft(report) {
    const g = report?.guess;
    if (!g || g.wide) return null;
    const cols = Array.isArray(report.columns) ? report.columns : [];
    const names = {};
    for (const i of g.value_indexes || []) names[String(i)] = text(cols[i]?.header).slice(0, 80) || `Value ${i + 1}`;
    const m = { place_index: g.place_index, period_index: g.period_index, value_indexes: [...(g.value_indexes || [])],
                geography: g.geography || 'us_states', cadence: g.cadence || 'annual', measure_names: names };
    if (m.value_indexes.length) m.banded_index = m.value_indexes[0];
    if (Number.isInteger(report.state_column_index)) m.state_index = report.state_column_index;
    return m;
  }

  // The same rules as the database, for an instant answer; '' means fine.
  function problem(m, report) {
    const n = Array.isArray(report?.columns) ? report.columns.length : 0;
    if (!m) return 'This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.';
    if (!Number.isInteger(m.place_index) || !Number.isInteger(m.period_index)) return 'Choose which column is the place and which is the period.';
    if (!['us_states', 'us_counties'].includes(m.geography)) return 'Choose whether the places are U.S. states or counties.';
    if (!['annual', 'monthly'].includes(m.cadence)) return 'Choose whether the periods are yearly or monthly.';
    if (!m.value_indexes?.length || m.value_indexes.length > 8) return 'Choose 1 to 8 columns of values.';
    const ints = [m.place_index, m.period_index, ...m.value_indexes, ...(m.state_index == null ? [] : [m.state_index])];
    if (ints.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return 'One of the chosen columns isn’t in the file.';
    if (new Set(ints).size !== ints.length) return 'Each column can only be used for one thing.';
    if (m.geography === 'us_counties' && m.state_index == null && !m.state) return 'County names need a state. Choose the state, or the column that has it.';
    if (m.state && !STATES[m.state]) return 'That isn’t a U.S. state.';
    for (const i of m.value_indexes) {
      const name = m.measure_names?.[String(i)];
      if (typeof name !== 'string' || !name.trim() || name.length > 80) return 'Each value column’s name needs 1 to 80 characters.';
    }
    return '';
  }

  // The mapping as sent: only keys the database accepts, no empty extras.
  function clean(m) {
    const out = { place_index: m.place_index, period_index: m.period_index, value_indexes: m.value_indexes, geography: m.geography,
                  cadence: m.cadence, measure_names: {} };
    for (const i of m.value_indexes) out.measure_names[String(i)] = String(m.measure_names?.[String(i)] ?? '').trim();
    if (m.banded_index != null && m.value_indexes.includes(m.banded_index)) out.banded_index = m.banded_index;
    if (m.state_index != null) out.state_index = m.state_index;
    if (m.geography === 'us_counties' && m.state && m.state_index == null) out.state = m.state;
    return out;
  }

  // v1: one uploaded dataset per film, so every render clip reads it. Null when the story has no render clip to point at it.
  function useInStory(story, ref) {
    const clips = story?.sequence?.clips;
    if (!Array.isArray(clips) || !clips.some(c => c && c.kind === 'render')) return null;
    const next = JSON.parse(JSON.stringify(story));
    for (const c of next.sequence.clips) if (c && c.kind === 'render') c.dataset = ref;
    return next;
  }

  window.ryagramUploads = { EXTS, MIME, MAX_BYTES, MAX_UPLOADS, STATES, ACCEPT: EXTS.map(e => `.${e}`).join(','), text, extOf, checkFile, chip, draft, problem, clean, useInStory };
})();
