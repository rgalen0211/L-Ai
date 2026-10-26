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

  // Wide files (Q6, ENGINE's interface of 12:36, agreed): the worker melts the file in memory and reports the LONG columns; report.wide_groups lists the year-column groups (one is melted) and
  // report.wide_chosen the default. The page then asks the person to confirm 'These columns are years' and sends melt_wide + wide_prefix with the usual mapping. An old report with guess.wide and
  // no wide_groups keeps the refusal. Behind byodGuide (the caller decides).
  const WIDE_TICK = 'These columns are years';
  const wideGroups = report => (report?.guess?.wide === true && Array.isArray(report.wide_groups) ? report.wide_groups.filter(g => g && typeof g === 'object' && typeof g.prefix === 'string').slice(0, 8) : []);
  const wideOffered = report => wideGroups(report).length > 0;
  const groupLabel = g => `${text(g.prefix) || 'The year columns'}: ${text(g.first)} to ${text(g.last)} (${Number(g.count) || 0} years)`;
  const chosenPrefix = report => { const gs = wideGroups(report); return gs.some(g => g.prefix === report.wide_chosen) ? report.wide_chosen : (gs[0] ? gs[0].prefix : ''); };

  // The mapping the person starts from: what the reader guessed. Null when the file has its years across the columns (unless the wide step is on and offered).
  function draft(report, opts = {}) {
    const g = report?.guess;
    if (!g || (g.wide && !(opts.wide && wideOffered(report)))) return null;
    const cols = Array.isArray(report.columns) ? report.columns : [];
    const names = {};
    for (const i of g.value_indexes || []) names[String(i)] = text(cols[i]?.header).slice(0, 80) || `Value ${i + 1}`;
    const m = { place_index: g.place_index, period_index: g.period_index, value_indexes: [...(g.value_indexes || [])],
                geography: g.geography || 'us_states', cadence: g.cadence || 'annual', measure_names: names };
    if (m.value_indexes.length) m.banded_index = m.value_indexes[0];
    if (Number.isInteger(report.state_column_index)) m.state_index = report.state_column_index;
    if (g.wide) { m.melt_wide = false; m.wide_prefix = chosenPrefix(report); }          // the person ticks 'These columns are years'
    return m;
  }

  // The same rules as the database, for an instant answer; '' means fine.
  function problem(m, report) {
    const n = Array.isArray(report?.columns) ? report.columns.length : 0;
    if (!m) return 'This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.';
    if (report?.guess?.wide && wideOffered(report) && m.melt_wide !== true) return `Tick \u201c${WIDE_TICK}\u201d to go on.`;
    if (!Number.isInteger(m.place_index) || !Number.isInteger(m.period_index)) return 'Choose which column is the place and which is the period.';
    if (!['us_states', 'us_counties'].includes(m.geography)) return 'Choose whether the places are U.S. states or counties.';
    if (!['annual', 'monthly'].includes(m.cadence)) return 'Choose whether the periods are yearly or monthly.';
    if (!m.value_indexes?.length || m.value_indexes.length > 8) return 'Choose 1 to 8 columns of values.';
    const ints = [m.place_index, m.period_index, ...m.value_indexes, ...(m.state_index == null ? [] : [m.state_index])];
    if (ints.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return 'One of the chosen columns isn’t in the file.';
    if (new Set(ints).size !== ints.length) return 'Each column can only be used for one thing.';
    if (m.geography === 'us_counties' && m.state_index == null && !m.state) return 'County names need a state. Choose the state, or the column that has it.';
    if (m.state && !Object.hasOwn(STATES, m.state)) return 'That isn’t a U.S. state.';
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
    if (m.melt_wide === true) { out.melt_wide = true; out.wide_prefix = typeof m.wide_prefix === 'string' ? m.wide_prefix.slice(0, 40) : ''; }
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

  // BYOD audit: the words for a file that cannot be mapped (its years run across the columns), with the shape that works.
  const WIDE_HELP = 'This file has its years across the columns (one column per year). Ryagram needs one row for each place and year, like the example above: a place column, a year column, and a column of values. In a spreadsheet program you can reshape it (in Excel: Data, Get & Transform, Unpivot), save it as .csv, and upload it again.';
  const EXAMPLE = { head: ['State', 'Year', 'Median rent'], rows: [['Alabama', '2015', '1,100'], ['Alabama', '2016', '1,150'], ['Alaska', '2015', '1,400']] };
  // ---- S5 (ENGINE-BYOD-GAPS.md gaps 2 and 3): who published the data, where it came from, the licence or permission, the unit, and the person's attestation. Behind byodGuide.
  // EVERY SENTENCE BELOW MARKED PLACEHOLDER IS DRAFT WORDING: Ryan's and the lawyer's final wording is RYAN-QUEUE Q5. Nothing here decides what is allowed; it only collects what the person says,
  // so the film's closing card and the video description can carry it (the worker and engine side is a proposal: set_dataset_provenance, see the MAILBOX post).
  const LICENCES = [['public_domain', 'Public domain (for example a U.S. government work)'], ['open_licence', 'An open licence (for example CC BY)'], ['permission', 'I have the owner\u2019s permission'],
                    ['own_data', 'It is my own data'], ['other', 'Something else (describe it)']];
  const PLACEHOLDER = '[PLACEHOLDER WORDING, pending Ryan and the lawyer]';
  const AS_SUPPLIED = 'Figures as supplied by the film\u2019s maker; not checked by Ryagram.';                 // PLACEHOLDER: the closing-card and description label
  const ATTESTATION = 'I may publish charts of this data.';                                                    // PLACEHOLDER
  // RULINGS 2026-10-26 (Ryan 09:38, S0): EVERY bring-your-own-data upload carries a visible trust label and a plain warning, and the person chooses to use it anyway. The label is fixed text
  // the page puts there; it is never typed by the person or an AI, and it does not depend on any other switch. PLACEHOLDER wording: Ryan's and the attorney's final words come in the merge row.
  const TRUST_LABEL = 'Unverified, user-supplied';
  const TRUST_WARNING = 'Ryagram has not checked this data. Your film will show exactly what is in your file, so anything wrong in it will be wrong in the film. Check it before you publish.';
  const TRUST_ACK = 'I understand, use it anyway.';
  const trustProblem = acked => (acked === true ? '' : 'Tick the box to use this data anyway.');
  const FIELD_MAX = { publisher: 200, link: 300, licence_note: 200, unit: 40 };
  const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  // A link goes in the video DESCRIPTION only (brand rule 028667d: no link on any frame, a link on a frame is a phishing surface), and only as a plain http(s) address: javascript:, data: and the like are refused.
  const WEB_LINK = /^https?:\/\/[^\s<>"']{1,290}$/i;
  const safeLink = v => { const t = clip(v, FIELD_MAX.link); return WEB_LINK.test(t) ? t : ''; };
  const linkTyped = v => clip(v, FIELD_MAX.link) !== '';
  function cleanProvenance(p) {
    p = p || {};
    return { publisher: clip(p.publisher, FIELD_MAX.publisher), link: safeLink(p.link), licence: LICENCES.some(([k]) => k === p.licence) ? p.licence : '',
             licence_note: clip(p.licence_note, FIELD_MAX.licence_note), unit: clip(p.unit, FIELD_MAX.unit), decimals: [0, 1, 2, 3].includes(Number(p.decimals)) ? Number(p.decimals) : 0, attested: p.attested === true };
  }
  function provenanceProblem(raw) {
    const p = cleanProvenance(raw);
    if (!p.publisher) return 'Say who published or owns this data.';
    if (linkTyped(raw && raw.link) && !p.link) return 'A link must be a web address starting with http:// or https://, or left empty.';
    if (!p.licence) return 'Say what lets you use it: public domain, an open licence, permission, your own data, or something else.';
    if (p.licence === 'other' && !p.licence_note) return 'Describe what lets you use this data.';
    if (!p.unit) return 'Say what the numbers are in (for example dollars, percent, people).';
    if (!p.attested) return 'Tick the box to confirm you may publish charts of this data.';
    return '';
  }
  // How the closing card will read (a preview for the person; the real card is drawn by the engine).
  function provenanceCard(raw) {
    const p = cleanProvenance(raw);
    const lic = (LICENCES.find(([k]) => k === p.licence) || [])[1] || '';
    return [`Source: ${p.publisher || '\u2014'}`, `Licence or permission: ${p.licence === 'other' ? p.licence_note : lic.replace(/ \(.*\)$/, '')}${p.licence === 'other' || !p.licence_note ? '' : ` (${p.licence_note})`}`,
            `Unit: ${p.unit || '\u2014'}`, AS_SUPPLIED];
  }
  // What goes in the video DESCRIPTION (the card above carries no link). PLACEHOLDER wording; the engine and worker draw the real description.
  function descriptionLines(raw) {
    const p = cleanProvenance(raw);
    return provenanceCard(p).concat(p.link ? [`Link: ${p.link}`] : []);
  }
  window.ryagramUploads = { TRUST_LABEL, TRUST_WARNING, TRUST_ACK, trustProblem, WIDE_TICK, wideGroups, wideOffered, groupLabel, descriptionLines, safeLink, LICENCES, PLACEHOLDER, AS_SUPPLIED, ATTESTATION, FIELD_MAX, cleanProvenance, provenanceProblem, provenanceCard, WIDE_HELP, EXAMPLE, EXTS, MIME, MAX_BYTES, MAX_UPLOADS, STATES, ACCEPT: EXTS.map(e => `.${e}`).join(','), text, extOf, checkFile, chip, draft, problem, clean, useInStory };
})();
