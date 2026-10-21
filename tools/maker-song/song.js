// The song screens of the desktop maker (NEXT-WEB 121): paste the words, choose the music, see every word placed on its beat with who says it, hear any line, swap a clip from the other takes,
// and see plainly which words are built from sounds or are a stated gap. The engine side is CONNECT 111; this page draws the plan it returns (song-model.js) and sends the person's choices back.
// One host object (docs/maker-song-host-contract.md): pickTrack / pickGuide / build / hear / load / save / render / back. ?fixture uses a made-up build with no maker. No innerHTML anywhere.
(function () {
  'use strict';
  const M = window.ryagramSongModel;

  function apiHost() {
    const token = new URLSearchParams(location.search).get('t') || (function () { try { return sessionStorage.getItem('maker-token') || ''; } catch (e) { return ''; } }());
    try { sessionStorage.setItem('maker-token', token); } catch (e) { /* works without it */ }
    const call = async (path, body) => {
      const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Maker-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The maker did not answer. Is it still open?');
      return j;
    };
    let lastSound = null;
    return {
      name: 'maker',
      practiceLyrics: null,
      async pickTrack() { return call('/api/song/track', {}); },
      async pickGuide() { return call('/api/song/guide', {}); },
      async build(req) { return call('/api/song/build', req); },
      async hear(req) {                                             // the token travels in a header, never in an address; the sound is played from a blob: address
        const r = await call('/api/song/hear', req);
        if (!r || !r.url) return null;
        const res = await fetch(r.url, { headers: { 'X-Maker-Token': token } });
        if (!res.ok) throw new Error('The maker could not give the sound.');
        if (lastSound) URL.revokeObjectURL(lastSound);
        lastSound = URL.createObjectURL(await res.blob());
        return { url: lastSound };
      },
      async load() { return (await call('/api/song')).plan; },
      async save(text) { return call('/api/song', { plan: JSON.parse(text) }); },
      async render(plan) { return call('/api/song/render', { plan }); },
      back() { location.href = '/?t=' + encodeURIComponent(token); return true; },
    };
  }
  let host = null;
  const loadScript = src => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('The practice build could not be loaded.')); document.head.append(el); });

  const S = { lyrics: '', track: null, guide: null, plan: null, sel: null, msg: '', building: false, rendering: false, dirty: false, heard: [], audio: null };
  const $ = id => document.getElementById(id);
  const mm = M.mmss;

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const plain = attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs);
    if (plain) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === false || v === null || v === undefined) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') { if (v) el.setAttribute(k, ''); }
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = plain ? 2 : 1; i < arguments.length; i++) for (const k of [arguments[i]].flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const say = t => { const n = $('live'); if (n) n.textContent = t; };
  const err = t => { S.msg = t; const n = $('msg'); if (n) n.textContent = t; };

  // ---- hearing: the maker's audio for a line or a word, or (practice build) a tone for each word so the timing can be heard ----
  function stopAudio() { if (S.audio) { try { S.audio.close(); } catch (e) { /* already closed */ } S.audio = null; } const a = document.getElementById('player'); if (a) a.pause(); }
  async function hear(req) {
    stopAudio();
    try {
      const r = await host.hear(req);
      if (r && r.url) { const a = $('player'); a.src = r.url; await a.play(); say('Playing.'); return; }
    } catch (e) { err(e.message); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { err('This browser cannot play the practice sound.'); return; }
    const ctx = new Ctx(); S.audio = ctx;
    const line = S.plan.lines[req.n - 1], words = req.kind === 'word' ? [line.words[req.i]] : line.words, t0 = words[0].beat_s;
    let count = 0;
    for (const w of words) {
      if (w.status === 'gap' || w.quiet) continue;
      const k = S.plan.cast.findIndex(c => c.id === w.speaker_id), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 220 * Math.pow(2, Math.max(0, k) / 4); o.connect(g); g.connect(ctx.destination);
      const at = ctx.currentTime + 0.05 + (w.beat_s - t0), len = Math.min(0.4, w.end_s - w.beat_s);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.2, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.start(at); o.stop(at + len + 0.05); count++;
    }
    S.heard.push({ kind: req.kind, n: req.n, i: req.i === undefined ? null : req.i, tones: count });
    say(count ? 'Playing a tone for each word that has a voice.' : 'There is nothing to play there.');
  }

  // ---- the three steps ----
  function drawWords() {
    const box = $('s-words'); box.replaceChildren();
    const ta = h('textarea', { id: 'lyrics', rows: '7', 'aria-label': 'Your words, one line of the song per line', maxlength: '20000', 'data-key': 'lyrics', oninput: ev => { S.lyrics = ev.target.value; countNote(); } });
    ta.value = S.lyrics;
    box.append(h('h2', {}, '1. Your words'), h('p', { class: 'note' }, 'Paste or type the words of your song, one line of the song per line. Nothing is uploaded: the maker looks the words up in your own videos.'), ta,
      h('p', { id: 'count', class: 'note' }), host.practiceLyrics ? h('button', { type: 'button', 'data-key': 'practice', onclick: () => { S.lyrics = host.practiceLyrics; ta.value = S.lyrics; countNote(); } }, 'Use the practice words') : null);
    countNote();
  }
  function countNote() {
    const n = $('count'); if (!n) return;
    try { const l = M.parseLyrics(S.lyrics); n.textContent = `${l.length} line${l.length === 1 ? '' : 's'}, ${l.reduce((a, x) => a + M.wordsOf(x).length, 0)} words.`; } catch (e) { n.textContent = ''; }
  }
  function drawMusic() {
    const box = $('s-music'); box.replaceChildren();
    box.append(h('h2', {}, '2. Your music'),
      h('p', { class: 'note' }, 'Choose the music the words will be sung over. If it has the singing in it, the maker finds each word’s beat from it. If you have a separate track of just the singing, add it too.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', id: 'pick-track', 'data-key': 'pick-track', onclick: async () => { try { const r = await host.pickTrack(); if (r && r.track) { S.track = r.track; err(''); drawMusic(); say(`${r.track.file_name} chosen.`); } } catch (e) { err(e.message); } } }, S.track ? 'Choose a different track' : 'Choose your music'),
        S.track ? h('span', {}, `${S.track.file_name} (${mm(S.track.seconds)})`) : h('span', { class: 'note' }, 'No music chosen yet.')),
      h('div', { class: 'row' },
        h('button', { type: 'button', id: 'pick-guide', 'data-key': 'pick-guide', onclick: async () => { try { const r = await host.pickGuide(); if (r && r.guide) { S.guide = r.guide; err(''); drawMusic(); say(`${r.guide.file_name} chosen as the singing.`); } } catch (e) { err(e.message); } } }, S.guide ? 'Choose a different singing track' : 'Add a track of just the singing (optional)'),
        S.guide ? h('span', {}, S.guide.file_name) : null),
      h('p', {}, h('button', { type: 'button', id: 'build', class: 'primary', 'data-key': 'build', disabled: S.building, onclick: build }, S.building ? 'Building...' : (S.plan ? 'Build again' : 'Build my song'))));
  }
  async function build() {
    let lines;
    try { lines = M.parseLyrics(S.lyrics); } catch (e) { err(e.message); return; }
    if (!S.track) { err('Choose your music first.'); return; }
    err(''); S.building = true; drawMusic(); say('Building. This can take a few minutes for a long song.');
    try {
      const r = await host.build({ lines, track: S.track, guide: S.guide });
      S.plan = M.normalize(r.plan); S.sel = null; S.dirty = true; say('Your song is built. Look at each line, then press Make the film.');
    } catch (e) { err(e instanceof M.SongError ? e.message : (e.message || 'The build did not finish.')); }
    S.building = false; draw();
  }

  // ---- the board: summary, one lane of words per line, the detail of the chosen word ----
  function drawBoard() {
    const box = $('s-board'); box.replaceChildren();
    if (!S.plan) { box.hidden = true; return; }
    box.hidden = false;
    const sum = M.summarize(S.plan);
    box.append(h('h2', {}, '3. Your song, word by word'),
      h('ul', { class: 'sum', id: 'sum', 'aria-label': 'What the build found' }, sum.say.map(t => h('li', {}, t))),
      h('p', { class: 'note' }, 'Each box is a word on its beat. Press one to see who says it, where it comes from, and the other takes you can swap in. The preview and the film can differ a little: the render is the real thing.'));
    S.plan.lines.forEach(line => box.append(drawLine(line)));
    drawDetail();
  }
  function chipLabel(line, i) {
    const w = line.words[i];
    return `Line ${line.n}, word ${i + 1}: ${w.w}. Beat ${mm(w.beat_s)}. ${w.status === 'gap' || w.quiet ? M.statusText(w) : `${M.speakerLabel(S.plan, w.speaker_id)}. ${M.statusText(w)}`}.${M.flags(S.plan, line, i).length ? ' Needs a look.' : ''} Press for details.`;
  }
  function drawLine(line) {
    const lane = h('div', { class: 'lane', role: 'group', 'aria-label': `Line ${line.n} on its beats` });
    line.words.forEach((w, i) => {
      const fl = M.flags(S.plan, line, i), sel = S.sel && S.sel.n === line.n && S.sel.i === i;
      const chip = h('button', { type: 'button', class: `chip st-${w.quiet ? 'quiet' : w.status}${fl.length ? ' flag' : ''}`, 'data-key': `chip-${line.n}-${i}`, 'data-n': line.n, 'data-i': i, 'aria-pressed': String(!!sel), 'aria-label': chipLabel(line, i),
        onclick: () => { S.sel = { n: line.n, i }; drawBoard(); const c = document.querySelector(`[data-key="chip-${line.n}-${i}"]`); if (c) c.focus(); say(`${w.w} chosen.`); } },
        h('span', { class: 'ct' }, mm(w.beat_s)), h('span', { class: 'cw' }, w.w),
        h('span', { class: 'cs' }, w.quiet ? 'quiet' : w.status === 'gap' ? 'gap' : M.speakerLabel(S.plan, w.speaker_id)),
        w.status === 'syllables' || w.status === 'phonemes' ? h('span', { class: 'cb' }, 'built from sounds') : null, fl.length ? h('span', { class: 'cf' }, 'check') : null);
      chip.style.minWidth = Math.max(86, Math.round((w.end_s - w.beat_s) * 150)) + 'px';
      lane.append(chip);
    });
    return h('section', { class: 'line', 'aria-label': `Line ${line.n}` }, h('div', { class: 'row' }, h('h3', {}, `Line ${line.n}: ${line.text}`),
      h('button', { type: 'button', 'data-key': `hear-line-${line.n}`, 'aria-label': `Hear line ${line.n}`, onclick: () => hear({ kind: 'line', n: line.n }) }, 'Hear this line')), lane,
      S.sel && S.sel.n === line.n ? h('div', { id: 'detail', class: 'detail', role: 'region', 'aria-label': 'The chosen word', 'aria-live': 'polite' }) : null);
  }
  function drawDetail() {
    const d = $('detail'); if (!d) return; d.replaceChildren();
    if (!S.sel) return;
    const line = S.plan.lines[S.sel.n - 1], w = line.words[S.sel.i], who = w.status === 'gap' || w.quiet ? null : M.speakerLabel(S.plan, w.speaker_id);
    d.append(h('h3', {}, `"${w.w}"${who ? `, said by ${who}` : ''}`));
    const facts = h('dl', { class: 'facts' }, h('dt', {}, 'Beat'), h('dd', {}, `${mm(w.beat_s)} to ${mm(w.end_s)} in your music`), h('dt', {}, 'What it is'), h('dd', {}, M.statusText(w)));
    if (w.status !== 'gap' && !w.quiet) {
      facts.append(h('dt', {}, 'Comes from'), h('dd', {}, `${w.file_name}, ${w.src_s.toFixed(1)} s to ${w.src_e.toFixed(1)} s`),
        h('dt', {}, 'Length'), h('dd', {}, w.stretch === 1 ? 'Used at its own length' : `Stretched or squeezed ${w.stretch.toFixed(1)} times to fit the beat`),
        h('dt', {}, 'On the beat'), h('dd', {}, Math.abs(w.offset_ms) <= M.OFF_BEAT_MS ? `Lands on the beat (${Math.abs(w.offset_ms)} ms ${w.offset_ms > 0 ? 'after' : 'before'})` : `Lands ${Math.abs(w.offset_ms)} ms ${w.offset_ms > 0 ? 'after' : 'before'} the beat`));
    }
    d.append(facts);
    const fl = M.flags(S.plan, line, S.sel.i);
    if (fl.length) d.append(h('ul', { class: 'warns', id: 'flags' }, fl.map(t => h('li', {}, t))));
    d.append(h('div', { class: 'row' }, w.status !== 'gap' && !w.quiet ? h('button', { type: 'button', 'data-key': 'hear-word', onclick: () => hear({ kind: 'word', n: S.sel.n, i: S.sel.i }) }, 'Hear this word') : null,
      h('button', { type: 'button', 'data-key': 'hear-line-d', onclick: () => hear({ kind: 'line', n: S.sel.n }) }, 'Hear this line')));
    if (w.status === 'gap') {
      d.append(h('p', {}, w.quiet ? 'This beat is left quiet.' : 'Nobody in the videos you chose says this word, and it cannot be built from sounds. The film leaves this beat quiet unless you change the words.'),
        h('div', { class: 'row' }, h('button', { type: 'button', 'data-key': 'quiet', onclick: () => change(() => M.ops.quiet(S.plan, S.sel.n, S.sel.i, !w.quiet), w.quiet ? 'Beat put back as a gap.' : 'Beat left quiet.') }, w.quiet ? 'Put it back as a gap' : 'Leave this beat quiet')),
        h('p', { class: 'note' }, 'To use a different word, change the words in step 1 and press Build again.'));
    }
    if (w.alternatives.length) {
      const ul = h('ul', { class: 'list', 'aria-label': 'Other takes of this word' });
      w.alternatives.forEach(a => ul.append(h('li', {}, h('span', {}, `${M.speakerLabel(S.plan, a.speaker_id)}, ${a.file_name}, ${a.src_s.toFixed(1)} s${a.stretch === 1 ? '' : ` (${a.stretch.toFixed(1)} times its length)`}`),
        h('button', { type: 'button', 'aria-label': `Hear this other take, ${M.speakerLabel(S.plan, a.speaker_id)}`, onclick: () => hear({ kind: 'alt', n: S.sel.n, i: S.sel.i, id: a.id }) }, 'Hear it'),
        h('button', { type: 'button', class: 'primary', 'data-key': 'use-' + a.id, 'aria-label': `Use this other take, ${M.speakerLabel(S.plan, a.speaker_id)}`, onclick: () => change(() => M.ops.swap(S.plan, S.sel.n, S.sel.i, a.id), 'Swapped in the other take.') }, 'Use this one'))));
      d.append(h('h4', {}, 'Other takes of this word'), ul);
    } else if (w.status !== 'gap') d.append(h('p', { class: 'note' }, 'No other take of this word was found in your videos.'));
  }
  function change(fn, said) {
    try { S.plan = fn(); S.dirty = true; err(''); say(said); drawBoard(); drawStatus(); const k = S.sel && document.querySelector(`[data-key="chip-${S.sel.n}-${S.sel.i}"]`); if (k) k.focus(); } catch (e) { if (e instanceof M.SongError) { err(e.message); } else throw e; }
  }

  // ---- the top bar ----
  function drawStatus() { const sv = $('save'); if (sv) { sv.textContent = S.dirty ? 'Save my song' : 'Saved'; sv.disabled = !S.plan; } const r = $('render'); if (r) r.disabled = !S.plan || S.rendering; }
  async function save() { try { await host.save(M.stringify(S.plan)); S.dirty = false; err(''); say('Your song is saved.'); } catch (e) { err(e.message); } drawStatus(); }
  async function render() {
    if (S.rendering) { err('A render is already running. Wait for it to finish.'); return; }
    S.rendering = true; drawStatus(); say('Starting the render.');
    try { await host.save(M.stringify(S.plan)); S.dirty = false; const r = await host.render(S.plan); say(r.message || 'The render has started.'); } catch (e) { err(e.message); }
    S.rendering = false; drawStatus();
  }
  function draw() { drawWords(); drawMusic(); drawBoard(); drawStatus(); }

  async function start() {
    try {
      if (new URLSearchParams(location.search).has('fixture')) { await loadScript('fixture.js'); host = window.ryagramSongFixtureHost; } else host = apiHost();
      const top = $('top');
      top.append(h('h1', {}, 'Make a song'), h('div', { class: 'row' },
        h('button', { id: 'back', type: 'button', onclick: () => { if (!host.back()) say('This is the practice build: there is no plan to go back to.'); } }, 'Back to Plan'),
        h('button', { id: 'save', type: 'button', onclick: save }, 'Save my song'), h('button', { id: 'render', type: 'button', class: 'primary', onclick: render }, 'Make the film')));
      let prior = null; try { prior = await host.load(); } catch (e) { top.append(h('p', { class: 'msg', role: 'alert' }, e.message)); return; }
      if (prior) { S.plan = M.normalize(prior); S.track = S.plan.track; S.guide = S.plan.guide; S.lyrics = S.plan.lines.map(l => l.text).join('\n'); }
      draw();
      window.ryagramSong = { get plan() { return S.plan; }, get state() { return S; }, model: M, host, saveText: () => M.stringify(S.plan) };
      document.documentElement.setAttribute('data-ready', '1');
    } catch (e) { $('top').append(h('p', { class: 'msg', role: 'alert' }, e instanceof M.SongError ? e.message : 'The song page could not open: ' + e.message)); }
  }
  start();
}());
