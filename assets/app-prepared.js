// "Prepared by your AI" (CONNECT, 2026-11-20; Q634): the person's own AI found some data, prepared a table and handed it to Ryagram through the connector (submit_prepared_data). It is waiting here, as inert text,
// and it is NOT usable until THIS person looks at it and presses Accept. Accept runs the same upload path as any file (startUpload: a slot, the file, "it is there"); the existing "Your own data" cards then take over
// (the worker reads it, the person confirms what the columns mean and ticks "use it anyway", then "Use in this film"), so the trust label, the warning and the tick stay where Ryan and the attorney put them.
// What the AI says (its label, sources, licence, units, notes, change log) is an untrusted string: it goes in as text nodes only, never as markup, and a source address is shown as words, never as a link.
// Nothing here sends anything before a button is pressed. The database half: migrations/20261120000500_prepared_data.sql (my_prepared_data, my_prepared_data_csv, discard_prepared_data, mark_prepared_accepted).
(() => {
  const TRUST_LABEL = 'Unverified, user-supplied';
  const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const list = v => (Array.isArray(v) ? v : []);
  const day = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // What Ryagram itself measured from the text, in one plain sentence; the years with NO rows are named (missing stays missing).
  function measuredWords(m) {
    const x = m && typeof m === 'object' ? m : {};
    const bits = [];
    if (Number.isFinite(x.rows)) bits.push(`${plural(x.rows, 'row')} and ${plural(x.columns, 'column')}`);
    if (Number.isFinite(x.places)) bits.push(plural(x.places, 'place'));
    if (Number.isFinite(x.first_period) && Number.isFinite(x.last_period)) {
      const missing = list(x.periods_missing).filter(Number.isFinite);
      bits.push(`years ${x.first_period} to ${x.last_period} (${x.periods_found} found${missing.length ? `; NO rows for ${missing.join(', ')}` : ''})`);
    } else bits.push('no year could be found in it');
    return bits.join('; ') + '.';
  }
  const fileName = label => (clip(label, 60).replace(/[^A-Za-z0-9 ._-]/g, '').trim().replace(/\s+/g, '-') || 'prepared-data') + '.csv';

  // `client` is the app's own Supabase client (the signed-in session); `data` is the data layer (startUpload); `onChange` redraws the "Your own data" cards.
  function create({ h, client, data, onChange, say }) {
    const el = h('section', { class: 'prepared-data', 'aria-labelledby': 'prepared-title', hidden: true });
    const status = h('p', { class: 'form-note', role: 'status' });
    let items = [];
    let latest = 0;

    const rpc = async (name, args) => {
      const { data: out, error } = await client.rpc(name, args || {});
      if (error) throw new Error(clip(error.message, 300) || 'Ryagram could not do that right now.');
      return out;
    };
    const fail = (e) => { status.textContent = clip(e && e.message, 300) || 'Ryagram could not do that right now.'; status.className = 'form-note app-error'; };
    const ok = (t) => { status.textContent = t; status.className = 'form-note'; };

    function card(it) {
      const src = it.sources && typeof it.sources === 'object' ? it.sources : {};
      const accept = h('button', { class: 'button small', type: 'button' }, 'Accept and continue');
      const discard = h('button', { class: 'button secondary small', type: 'button' }, 'Discard');
      accept.onclick = async () => {
        accept.disabled = true; discard.disabled = true; ok('Taking it in…');
        try {
          const csv = await rpc('my_prepared_data_csv', { p_id: it.id });
          const file = new File([csv], fileName(it.label), { type: 'text/csv' });
          const datasetId = await data.startUpload(file, { label: clip(it.label, 120) || 'Prepared by your AI', ext: 'csv', contentType: 'text/csv', retention: null });
          await rpc('mark_prepared_accepted', { p_id: it.id, p_dataset: datasetId });
          ok('Accepted. Ryagram is reading it now. Below, under “Your own data”, check what each column means and tick the box to use it anyway.');
          if (onChange) await onChange();
          await refresh();
          if (say) say('Accepted. Check what each column means below.');
        } catch (e) { accept.disabled = false; discard.disabled = false; fail(e); }
      };
      discard.onclick = async () => {
        accept.disabled = true; discard.disabled = true;
        try { await rpc('discard_prepared_data', { p_id: it.id }); ok('Discarded. The table is gone from Ryagram.'); await refresh(); } catch (e) { accept.disabled = false; discard.disabled = false; fail(e); }
      };
      const lines = list(it.preview_lines).slice(0, 21);
      const log = list(it.change_log);
      const urls = list(src.urls);
      return h('li', { class: 'prepared-card' },
        h('strong', {}, clip(it.label, 120) || 'A table from your AI'), ' ', h('span', { class: 'trust-chip' }, TRUST_LABEL),
        h('p', { class: 'meta' }, `From ${clip(it.ai_name, 60) || 'your AI'} · sent ${day(it.created_at)} · waits until ${day(it.expires_at)}`),
        h('p', { class: 'form-note' }, `Ryagram measured: ${measuredWords(it.measured)}`),
        h('p', { class: 'form-note' }, 'Where your AI says it came from (Ryagram has not checked this):'),
        h('ul', { class: 'prepared-sources' }, urls.map(u => h('li', {}, clip(u, 500))), src.publisher ? h('li', {}, `Published by: ${clip(src.publisher, 300)}`) : null,
          h('li', {}, `Licence: ${clip(src.licence, 300) || 'not said'}`), h('li', {}, `Units: ${clip(src.units, 300) || 'not said'}`), src.notes ? h('li', {}, `Notes: ${clip(src.notes, 300)}`) : null, src.retrieved ? h('li', {}, `Looked up: ${clip(src.retrieved, 300)}`) : null),
        log.length ? h('details', {}, h('summary', {}, 'What your AI says it did to the data (not checked by Ryagram)'), h('ol', {}, log.map(s => h('li', {}, clip(s, 200))))) : null,
        lines.length ? h('details', {}, h('summary', {}, `The first ${Math.max(0, lines.length - 1)} rows`), h('pre', { class: 'prepared-preview' }, lines.map(l => clip(l, 300)).join('\n'))) : null,
        h('p', { class: 'form-note' }, 'Nothing uses this table until you accept it. After you accept it you check what each column means, and you tick “use it anyway”, because Ryagram cannot vouch for it.'),
        h('div', { class: 'actions-row' }, accept, discard));
    }

    function draw() {
      el.hidden = items.length === 0;
      el.replaceChildren(...[
        h('h2', { id: 'prepared-title' }, 'Prepared by your AI'),
        h('p', { class: 'form-note' }, 'Your AI found some data and prepared a table for you. Look it over: you decide.'),
        status,
        h('ul', { class: 'prepared-cards' }, items.map(card))]);
    }

    async function refresh() {
      const mine = ++latest;
      let rows;
      try { rows = await rpc('my_prepared_data'); } catch (e) { if (mine === latest) { items = []; draw(); } return; }      // the SQL is not applied yet: show nothing
      if (mine !== latest) return;
      items = list(rows);
      draw();
    }
    refresh();
    return { el, refresh };
  }

  window.ryagramPrepared = Object.freeze({ create, measuredWords, fileName, TRUST_LABEL });
})();
