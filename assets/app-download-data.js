// "Download my data" (NEXT-WEB 153; Ryan 2026-10-27 16:20: a person can always get a copy of the data that went into their film). One zip, made in the browser from the person's own session
// (nothing passes through a server of ours): the file exactly as received, a receipt in words and as JSON, and the cleaned table only if one exists (the worker does not write one yet: the receipt says so).
// The pure parts (zip writer, file names, the receipt) have unit tests; the button talks to data.downloadParts(datasetId).
(() => {
  // ---- a stored (not compressed) zip: CRC-32, local headers, the central directory. Names are checked so nothing can climb out of the folder.
  const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = bytes => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = s => new TextEncoder().encode(s);

  // A name inside the zip: letters, digits, space and . _ ( ) - only, one folder level at most, no leading dot, never empty, at most 120 characters.
  function safeName(name, fallback = 'file') {
    const cleaned = String(name == null ? '' : name).normalize('NFKC').replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').slice(0, 120).trim();
    return cleaned && !/^_+$/.test(cleaned) ? cleaned : fallback;
  }
  function entryName(path) {
    const parts = String(path).split('/').map((p, i, a) => safeName(p, i === a.length - 1 ? 'file' : 'folder'));
    return parts.slice(-2).join('/');                                         // at most one folder
  }
  function storedZip(files, now = new Date()) {
    const dt = ((now.getFullYear() - 1980) << 25 | (now.getMonth() + 1) << 21 | now.getDate() << 16 | now.getHours() << 11 | now.getMinutes() << 5 | (now.getSeconds() >> 1)) >>> 0;
    const locals = [], central = [];
    let offset = 0;
    const seen = new Set();
    for (const f of files) {
      const name = entryName(f.name);
      if (seen.has(name)) throw new Error(`The same file name twice: ${name}`);
      seen.add(name);
      const nb = enc(name), data = f.bytes, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);        // flag 0x0800: the name is UTF-8
      lh.setUint16(10, dt & 0xffff, true); lh.setUint16(12, dt >>> 16, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dt & 0xffff, true); ch.setUint16(14, dt >>> 16, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  // ---- the receipt
  const plain = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const day = iso => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ''; };
  // Data that may not be handed back (future licensed data-broker data): its licence class says so. Today no dataset carries that class, so nothing is hidden.
  const canDownload = ds => !!ds && ds.licence_class !== 'no_redistribution' && ds.licence_class !== 'broker';

  function buildReceipt({ dataset: d, fetchRow: f = null, fileKept, sourceName, sha256Computed = null, cleanKept = false, madeAt = new Date(), trustWords = x => x }) {
    const recorded = d.sha256 || (f && f.sha256) || null;
    const matches = recorded && sha256Computed ? recorded.toLowerCase() === sha256Computed.toLowerCase() : null;
    const notes = [];
    if (!fileKept) notes.push('The file itself is no longer kept (it was deleted after your film, or you deleted it). This receipt is what remains.');
    if (matches === false) notes.push('The file in this zip does NOT match the fingerprint recorded when it was received. Do not rely on it until that is explained.');
    if (!cleanKept) notes.push('The cleaned table is not available for this dataset yet. Ryagram reads your file with the column meanings you confirmed (below) each time it makes a film; it does not keep a separate table.');
    const receipt = {
      schema: 'ryagram.data-receipt/0',
      made_at: madeAt.toISOString(),
      dataset: { name: plain(d.filename_label || d.name || 'Your data'), format: plain(d.ext || ''), bytes: Number.isFinite(d.bytes) ? d.bytes : null, sha256_recorded: recorded, sha256_of_file_in_this_zip: sha256Computed, fingerprint_matches: matches },
      came_from: f ? { kind: 'fetched', address: plain(f.final_url), host: plain(f.host), publisher: plain(f.publisher), retrieved_on: day(f.retrieved_at), licence_text: plain(f.licence_text), licence_class: plain(f.licence_class), licence_source: plain(f.licence_source) }
        : { kind: 'uploaded_by_you', uploaded_on: day(d.uploaded_at || d.created_at) },
      trust: { label: plain(trustWords(d.trust_label || 'unverified_user')), you_acknowledged_on: day(d.trust_ack_at) },
      kept_for: d.retention === 'dont_keep' ? 'deleted after your final film' : 'until you delete it',
      status: plain(d.status || ''),
      how_ryagram_read_it: { column_meanings_you_confirmed: d.mapping || null, what_was_found_in_the_file: d.ingest_report || null },
      in_this_zip: { source_file: fileKept ? sourceName : null, cleaned_table: cleanKept ? 'clean.csv' : null, receipt: ['receipt.json', 'RECEIPT.txt'] },
      notes
    };
    const lines = [
      'RECEIPT FOR YOUR DATA', '',
      `Name: ${receipt.dataset.name}`,
      `Made: ${receipt.made_at.slice(0, 10)}`,
      `File: ${receipt.dataset.format ? receipt.dataset.format.toUpperCase() + ', ' : ''}${receipt.dataset.bytes != null ? receipt.dataset.bytes.toLocaleString('en-US') + ' bytes' : 'size not recorded'}`,
      `Fingerprint (SHA-256) recorded: ${recorded || 'not recorded'}`,
      `Fingerprint of the file in this zip: ${sha256Computed || 'no file'}${matches === true ? ' (the same)' : matches === false ? ' (DIFFERENT)' : ''}`, '',
      receipt.came_from.kind === 'fetched'
        ? `Where it came from: ${receipt.came_from.publisher || receipt.came_from.host}, fetched on ${receipt.came_from.retrieved_on || 'an unrecorded date'} from ${receipt.came_from.address}.`
        : `Where it came from: you uploaded it on ${receipt.came_from.uploaded_on || 'an unrecorded date'}.`,
      receipt.came_from.kind === 'fetched' ? `Licence: ${receipt.came_from.licence_text || 'not stated'} (class: ${receipt.came_from.licence_class || 'unknown'}).` : 'Licence: whatever permission you had to use it; Ryagram did not check it.',
      `How Ryagram labels it: ${receipt.trust.label}${receipt.trust.you_acknowledged_on ? `; you acknowledged this on ${receipt.trust.you_acknowledged_on}` : ''}.`,
      `Kept: ${receipt.kept_for}.`, '',
      'How Ryagram read it: the column meanings you confirmed and what was found in the file are in receipt.json (how_ryagram_read_it).', '',
      'In this zip:', `  ${fileKept ? 'source/' + sourceName + ' (your file exactly as received)' : '(no source file: it is no longer kept)'}`, `  ${cleanKept ? 'clean.csv (the table the film used)' : '(no cleaned table yet)'}`, '  receipt.json and RECEIPT.txt (this)', ''
    ];
    for (const n of notes) lines.push(`NOTE: ${n}`);
    return { json: JSON.stringify(receipt, null, 2) + '\n', text: lines.join('\r\n') + '\r\n', receipt };
  }

  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
  }

  // everything the button does, with its parts passed in so it can be tested: parts = { dataset, fetchRow, file (Blob|null), clean (Blob|null) }
  async function makeZip(parts, { trustWords, now = new Date() } = {}) {
    const d = parts.dataset;
    const fileBytes = parts.file ? new Uint8Array(await parts.file.arrayBuffer()) : null;
    const cleanBytes = parts.clean ? new Uint8Array(await parts.clean.arrayBuffer()) : null;
    const base = safeName(d.filename_label || d.name || 'data', 'data');
    const ext = safeName(d.ext || '', '').replace(/^\./, '');
    const sourceName = safeName(ext && !base.toLowerCase().endsWith('.' + ext.toLowerCase()) ? `${base}.${ext}` : base, 'data');
    const sha = fileBytes ? await sha256Hex(fileBytes) : null;
    const r = buildReceipt({ dataset: d, fetchRow: parts.fetchRow, fileKept: !!fileBytes, sourceName, sha256Computed: sha, cleanKept: !!cleanBytes, madeAt: now, trustWords });
    const files = [{ name: 'RECEIPT.txt', bytes: enc(r.text) }, { name: 'receipt.json', bytes: enc(r.json) }];
    if (fileBytes) files.push({ name: `source/${sourceName}`, bytes: fileBytes });
    if (cleanBytes) files.push({ name: 'clean.csv', bytes: cleanBytes });
    return { zip: storedZip(files, now), receipt: r.receipt, zipName: `${safeName(base, 'data')} (my data ${now.toISOString().slice(0, 10)}).zip` };
  }

  function create({ h, data }) {
    // The button for one dataset. `say` shows a sentence next to it.
    function button(ds) {
      if (!canDownload(ds)) return null;
      const note = h('span', { class: 'meta', role: 'status' });
      const b = h('button', { class: 'button secondary small', type: 'button', 'data-key': 'download-my-data' }, 'Download my data');
      b.addEventListener('click', async () => {
        b.disabled = true; note.textContent = 'Making your zip…';
        try {
          const parts = await data.downloadParts(ds.id);
          const made = await makeZip(parts, { trustWords: window.ryagramUploads && window.ryagramUploads.trustWords });
          const url = URL.createObjectURL(new Blob([made.zip], { type: 'application/zip' }));
          const a = h('a', { href: url, download: made.zipName });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          note.textContent = parts.file ? 'Your zip is downloading: your file as received and its receipt.' : 'Your file is no longer kept, so the zip holds the receipt only.';
        } catch (err) { note.textContent = String((err && err.message) || 'Couldn’t make the zip. Try again.').slice(0, 200); }
        b.disabled = false;
      });
      return h('span', { class: 'download-data' }, b, ' ', note);
    }
    return { button };
  }

  window.ryagramDownloadData = { crc32, safeName, entryName, storedZip, buildReceipt, makeZip, canDownload, sha256Hex, create };
})();
