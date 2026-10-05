// The sources screen (what a film is made from): turns the database's version_sources rows into card
// fields. Every fact on a card comes from the database row (filled server side from the catalog);
// nothing here invents a source, coverage or licence. Rows are untrusted text: strings are plain text
// in the page, and a link is only ever https.
(() => {
  const DASH = '\u2014';
  const text = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const https = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

  // { title, publisher, url, coverage, licenceShort, licenceFull, kind }: a dash for anything the row doesn't say.
  function cardView(row) {
    const r = row && typeof row === 'object' ? row : {};
    return {
      title: text(r.title) || DASH,
      publisher: text(r.publisher) || (r.kind === 'upload' ? 'Your data' : DASH),
      url: https(r.source_url),
      coverage: text(r.coverage) || DASH,
      licenceShort: text(r.licence_short) || (r.kind === 'upload' ? 'You confirm you may use this data' : DASH),
      licenceFull: text(r.licence_full),
      kind: r.kind === 'upload' ? 'upload' : 'catalog',
      // Licence-restricted data: the film is fine, the data itself is not handed on (never offered for download).
      noRedistribution: r.no_redistribution === true
    };
  }

  // The line under the cards: what the screen is, and the limit, in the words of the proposal.
  function note({ editable, count }) {
    if (!editable) return 'This version is finished, so its sources are fixed.';
    if (!count) return 'A film\u2019s data comes from its story. Start from an example film below, or edit the story.';
    return 'Up to 5 sources per film, one clip each. The data comes from the film\u2019s story: change the story to change the sources.';
  }

  window.ryagramSources = { DASH, cardView, note, MAX: 5 };
})();
