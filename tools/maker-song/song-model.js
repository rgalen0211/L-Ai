// Song mode in the desktop maker: the lyrics, the song plan the engine returns, and everything the screens say about it (NEXT-WEB 121; the page is tools/maker-song/song.js).
// Pure functions, no DOM and no network: the same file runs in the page and under node.
//   Plan ("ryagram.song-plan/0"), made by the engine (CONNECT 111, rules in CLAUDE-BIG-CLUB-V3-RULES.md): every lyric word on its beat, with who says it, where it comes from, whether it is said as is, built
//   from sounds, or a stated gap, how far its length was stretched, how far it lands from the beat, and the other takes the person could swap in. This file validates a plan, summarises it in plain words,
//   flags what the rules say to flag (R1 30 ms, stretch 0.5x..3x, R4 picture holds), and applies the person's swaps. No song name and no lyric is in this file.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ryagramSongModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 'ryagram.song-plan/0';
  const STATUSES = ['whole', 'syllables', 'phonemes', 'gap'];
  const MAX_LINES = 200, MAX_WORDS_LINE = 40, MAX_CHARS = 20000, MAX_VIDEOS = 2000;
  const OFF_BEAT_MS = 30;                               // R1: a placed syllable more than 30 ms off its beat is flagged
  const STRETCH_HIGH = 3, STRETCH_LOW = 0.5;             // R1 quality flag, not a block

  class SongError extends Error { }
  const fail = m => { throw new SongError(m); };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = v => typeof v === 'number' && isFinite(v);
  const r3 = x => (Math.round(x * 1000) / 1000) || 0;                    // never -0: a saved list must read back the same
  const ri = x => Math.round(x) || 0;
  const safeName = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\\/:*?"<>|\u0000-\u001f]/.test(v);   // a file NAME, never a path
  const safeRel = v => typeof v === 'string' && v.length > 0 && v.length <= 260 && !/[*?"<>|:\u0000-\u001f]/.test(v) && !/^[\\/]/.test(v) && !v.split(/[\\/]/).some(seg => seg === '..' || seg === '' || seg === '.');
  const relName = v => v.replace(/\\/g, '/');
  const mmss = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  // ---- the words the person pastes: one line per lyric line ----
  function parseLyrics(text) {
    if (typeof text !== 'string') fail('Paste your words first.');
    if (text.length > MAX_CHARS) fail(`That is a lot of words (over ${MAX_CHARS} characters). Try a verse or a chorus first.`);
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length) fail('Paste your words first, one line of the song per line.');
    if (lines.length > MAX_LINES) fail(`That is more than ${MAX_LINES} lines. Try a verse or a chorus first.`);
    lines.forEach((l, i) => { if (l.split(' ').length > MAX_WORDS_LINE) fail(`Line ${i + 1} has more than ${MAX_WORDS_LINE} words. Split it into two lines.`); });
    return lines;
  }
  // the videos the words are looked up in: names or RELATIVE paths inside a chosen folder (never absolute), no repeats, 1 to 2,000
  function normalizeVideos(list) {
    if (!Array.isArray(list) || !list.length) fail('Choose the videos the words will be found in first.');
    if (list.length > MAX_VIDEOS) fail(`That is more than ${MAX_VIDEOS.toLocaleString('en-US')} videos. Choose a smaller set first.`);
    const seen = new Set();
    return list.map(v => {
      if (!isObj(v) || !safeRel(v.file_name)) fail('A video must be named by file name, or by a folder-relative name, never by a full path.');
      const name = relName(v.file_name);
      if (seen.has(name)) fail(`${name} is in the list twice.`);
      seen.add(name);
      const out = { file_name: name };
      if (v.folder !== undefined && v.folder !== null) { if (!safeName(v.folder)) fail('A folder must be named by name only, not by path.'); out.folder = v.folder; }
      return out;
    });
  }
  // one chosen folder: its name, how many videos the maker found, how many this run uses
  function normalizeFolder(f) {
    if (!isObj(f) || !safeName(f.name)) fail('A folder must be named by name only, not by path.');
    if (!Number.isInteger(f.found) || !Number.isInteger(f.used) || f.found < 0 || f.used < 0 || f.used > f.found) fail(`The folder ${f.name} does not say how many videos it has.`);
    return { name: f.name, found: f.found, used: f.used };
  }
  const folderNote = f => f.used < f.found ? `Found ${f.found.toLocaleString('en-US')} videos in ${f.name}; this run uses ${f.used.toLocaleString('en-US')}.` : `Using all ${f.found.toLocaleString('en-US')} video${f.found === 1 ? '' : 's'} in ${f.name}.`;
  const wordsOf = line => line.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);

  // ---- validate a plan from the engine: refuse a plan that breaks the rules the page relies on ----
  function normalize(src) {
    if (!isObj(src) || src.schema !== SCHEMA) fail('This song plan is from a different version of the maker.');
    const track = isObj(src.track) ? src.track : {};
    if (!safeName(track.file_name) || !num(track.seconds) || !(track.seconds > 0)) fail('The music track needs a name and a length.');
    let guide = null;
    if (src.guide !== null && src.guide !== undefined) { if (!isObj(src.guide) || !safeName(src.guide.file_name)) fail('The guide vocal must be named by file name only, not by path.'); guide = { file_name: src.guide.file_name }; }
    if (!Array.isArray(src.cast) || src.cast.length < 1) fail('The plan names nobody who speaks.');
    const castIds = new Set();
    const cast = src.cast.map(c => {
      if (!isObj(c) || typeof c.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,60}$/.test(c.id) || castIds.has(c.id)) fail('A speaker has a missing or repeated id.');
      castIds.add(c.id);
      if (c.name !== null && c.name !== undefined && (typeof c.name !== 'string' || c.name.length > 60 || !c.name.trim())) fail('A speaker name is not valid.');
      return { id: c.id, name: c.name ? c.name.trim() : null };
    });
    if (!Array.isArray(src.lines) || !src.lines.length || src.lines.length > MAX_LINES) fail('The plan has no lines.');
    const lines = src.lines.map((l, li) => {
      if (!isObj(l) || typeof l.text !== 'string' || !Array.isArray(l.words) || !l.words.length) fail(`Line ${li + 1} has no words.`);
      const words = l.words.map((w, wi) => normWord(w, `line ${li + 1}, word ${wi + 1}`, castIds, track.seconds));
      for (let i = 1; i < words.length; i++) if (words[i].beat_s < words[i - 1].beat_s - 1e-9) fail(`The words of line ${li + 1} are not in order.`);
      return { n: li + 1, text: l.text.trim().slice(0, 400), words };
    });
    const plan = { schema: SCHEMA, track: { file_name: track.file_name, seconds: r3(track.seconds) }, guide, cast, lines };
    for (const k of ['plan_id', 'without_forged_plan_id']) {
      if (src[k] === undefined || src[k] === null) continue;
      if (typeof src[k] !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(src[k])) fail('The plan carries an id the page cannot use.');
      plan[k] = src[k];
    }
    return plan;
  }
  function normWord(w, where, castIds, trackSeconds) {
    if (!isObj(w) || typeof w.w !== 'string' || !w.w.trim() || w.w.length > 60) fail(`The word at ${where} is not valid.`);
    if (!num(w.beat_s) || !num(w.end_s) || w.beat_s < 0 || !(w.end_s > w.beat_s) || w.end_s > trackSeconds + 0.5) fail(`The word "${w.w}" has a beat outside the music.`);
    if (!STATUSES.includes(w.status)) fail(`The word "${w.w}" must be said as is, built from sounds, or a gap.`);
    const out = { w: w.w.trim(), beat_s: r3(w.beat_s), end_s: r3(w.end_s), status: w.status, speaker_id: null, file_name: null, src_s: null, src_e: null, stretch: null, pieces: [], joins: 0,
      offset_ms: null, offset_joined: false, step_db: null, burst: w.burst === true, quiet: w.quiet === true, preview: null, voice_may_clash: w.voice_may_clash === true, alternatives: [] };
    if (w.status === 'gap') return out;
    if (typeof w.speaker_id !== 'string' || !castIds.has(w.speaker_id)) fail(`The word "${w.w}" is said by someone the plan does not name.`);
    if (!safeRel(w.file_name)) fail(`The word "${w.w}" must name its video by file name only, not by a full path.`);
    if (!num(w.src_s) || !num(w.src_e) || !(w.src_e > w.src_s) || w.src_s < 0) fail(`The word "${w.w}" has a source time that is not valid.`);
    if (!num(w.stretch) || !(w.stretch > 0) || w.stretch > 20) fail(`The word "${w.w}" has a stretch that is not valid.`);
    if (w.offset_ms !== null && w.offset_ms !== undefined && !num(w.offset_ms)) fail(`The word "${w.w}" has a landing time that is not a number.`);
    Object.assign(out, { speaker_id: w.speaker_id, file_name: relName(w.file_name), src_s: r3(w.src_s), src_e: r3(w.src_e), stretch: r3(w.stretch), offset_ms: num(w.offset_ms) ? ri(w.offset_ms) : null, step_db: num(w.step_db) ? (Math.round(w.step_db * 10) / 10) || 0 : null });
    // A word that runs straight on from the word before cannot be measured (its sound starts before its own beat): the engine says so with offset_joined (BUILDER songjoined 2026-10-27). It is kept ONLY
    // when the word has no measured landing time, so a joined word is never also a measured one.
    out.offset_joined = w.offset_joined === true && out.offset_ms === null;
    if (w.preview !== null && w.preview !== undefined) { if (!safeName(w.preview)) fail(`The play button of "${w.w}" must be a file name only, not a path.`); out.preview = w.preview; }
    if (w.status !== 'whole') {
      if (!Array.isArray(w.pieces) || w.pieces.length < 2) fail(`The word "${w.w}" is built from sounds, so it needs its pieces.`);
      out.pieces = w.pieces.map(p => {
        if (!isObj(p) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 30 || p.speaker_id !== w.speaker_id) fail(`The word "${w.w}" mixes two people. A word is built from one person's sounds only.`);
        return { text: p.text.trim(), speaker_id: p.speaker_id };
      });
      out.joins = out.pieces.length - 1;
    }
    out.alternatives = (Array.isArray(w.alternatives) ? w.alternatives : []).map((a, i) => {
      if (!isObj(a) || typeof a.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,60}$/.test(a.id) || !castIds.has(a.speaker_id) || !safeRel(a.file_name) || !num(a.src_s) || !num(a.src_e) || !(a.src_e > a.src_s) || !num(a.stretch) || !(a.stretch > 0) || (a.offset_ms !== null && a.offset_ms !== undefined && !num(a.offset_ms)))
        fail(`Another take of "${w.w}" is not valid.`);
      return { id: a.id, speaker_id: a.speaker_id, file_name: relName(a.file_name), src_s: r3(a.src_s), src_e: r3(a.src_e), stretch: r3(a.stretch), offset_ms: num(a.offset_ms) ? ri(a.offset_ms) : null };
    });
    return out;
  }

  // ---- what to call things, in plain words ----
  const speakerLabel = (plan, id) => { const i = plan.cast.findIndex(c => c.id === id); if (i < 0) return 'Nobody'; return plan.cast[i].name || `Voice ${i + 1}`; };
  function statusText(w) {
    if (w.quiet) return 'Left quiet';
    if (w.status === 'whole') return 'Said as it is';
    if (w.status === 'gap') return 'Gap: nobody in your files says this word';
    return `Built from sounds: ${w.pieces.map(p => p.text).join(' + ')}`;
  }
  function flags(plan, line, i) {
    const w = line.words[i], f = [];
    if (w.status === 'gap' || w.quiet) return f;
    if (w.offset_ms !== null && Math.abs(w.offset_ms) > OFF_BEAT_MS) f.push(`Lands ${Math.abs(w.offset_ms)} ms ${w.offset_ms > 0 ? 'after' : 'before'} the beat`);
    if (w.stretch > STRETCH_HIGH) f.push(`Stretched a lot (${w.stretch.toFixed(1)} times); it may sound smeared`);
    if (w.stretch < STRETCH_LOW) f.push(`Squeezed a lot (${w.stretch.toFixed(1)} times); it may sound rushed`);
    const prev = line.words.slice(0, i).reverse().find(x => x.status !== 'gap' && !x.quiet);
    if (prev && prev.speaker_id !== w.speaker_id) f.push(`The voice changes here, from ${speakerLabel(plan, prev.speaker_id)} to ${speakerLabel(plan, w.speaker_id)}`);
    if (w.burst) f.push('Many quick sounds here: the picture stays on the first clip');
    if (w.voice_may_clash && w.status !== 'whole') f.push('The sounds of this word may not match each other; listen to it');
    if (w.step_db !== null && Math.abs(w.step_db) > 6) f.push(`The loudness jumps ${Math.abs(w.step_db)} dB at a join`);
    return f;
  }

  // ---- the summary the person reads before they render ----
  function summarize(plan) {
    let words = 0, real = 0, built = 0, gaps = 0, quiet = 0, off = 0, stretchy = 0, switches = 0, bursts = 0, fullLines = 0, joined = 0;
    const errs = [];
    for (const line of plan.lines) {
      let full = true;
      line.words.forEach((w, i) => {
        words++;
        if (w.quiet) { quiet++; full = false; return; }
        if (w.status === 'gap') { gaps++; full = false; return; }
        real++; if (w.status !== 'whole') built++;
        if (w.offset_ms !== null) { errs.push(Math.abs(w.offset_ms)); if (Math.abs(w.offset_ms) > OFF_BEAT_MS) off++; }
        else if (w.offset_joined) joined++;                      // ran on from the word before: not measured, and said so
        if (w.stretch > STRETCH_HIGH || w.stretch < STRETCH_LOW) stretchy++;
        if (w.burst) bursts++;
        const prev = line.words.slice(0, i).reverse().find(x => x.status !== 'gap' && !x.quiet);
        if (prev && prev.speaker_id !== w.speaker_id) switches++;
      });
      if (full) fullLines++;
    }
    errs.sort((a, b) => a - b);
    const med = errs.length ? errs[Math.floor((errs.length - 1) / 2)] : 0, max = errs.length ? errs[errs.length - 1] : 0;
    const pct = words ? Math.round((real / words) * 100) : 0;
    const say = [];
    say.push(`${real} of ${words} words are real voices (${pct}%); ${plan.lines.length === fullLines ? 'every line is' : `${fullLines} of ${plan.lines.length} lines are`} fully real.`);
    if (built) say.push(`${built} word${built === 1 ? ' is' : 's are'} built from sounds. Listen to ${built === 1 ? 'it' : 'them'}: the joins can sound a little robotic.`);
    if (gaps) say.push(`${gaps} word${gaps === 1 ? ' is' : 's are'} a gap: nobody in your files says ${gaps === 1 ? 'it' : 'them'}.`);
    if (quiet) say.push(`${quiet} beat${quiet === 1 ? ' is' : 's are'} left quiet.`);
    if (off) say.push(`${off} word${off === 1 ? ' lands' : 's land'} more than ${OFF_BEAT_MS} ms from the beat.`);
    if (joined) say.push(`${joined} word${joined === 1 ? ' ran' : 's ran'} together with the word before and ${joined === 1 ? 'was' : 'were'} not measured.`);
    if (stretchy) say.push(`${stretchy} word${stretchy === 1 ? ' is' : 's are'} stretched or squeezed a lot.`);
    say.push(`The voice changes ${switches} time${switches === 1 ? '' : 's'} inside a line.`);
    return { words, real, whole: real - built, built, gaps, quiet, off_beat: off, joined_not_measured: joined, stretchy, switches, bursts, full_lines: fullLines, lines: plan.lines.length, pct_real: pct, median_err_ms: med, max_err_ms: max, say };
  }

  // ---- the person's choices: each returns a NEW plan ----
  const clone = o => JSON.parse(JSON.stringify(o));
  const at = (plan, n, i) => { const l = plan.lines[n - 1]; if (!l || !l.words[i]) fail('That word is not in the plan any more.'); return l.words[i]; };
  const ops = {
    // swap in another take of the same word (the same word, another person or another occurrence); the plan keeps the word and its beat
    swap(plan, n, i, altId) {
      const p = clone(plan), w = at(p, n, i), a = w.alternatives.find(x => x.id === altId), wasGap = w.status === 'gap';
      if (!a) fail('That other take is not offered for this word.');
      const old = { id: 'was-' + (w.alternatives.length + 1), speaker_id: w.speaker_id, file_name: w.file_name, src_s: w.src_s, src_e: w.src_e, stretch: w.stretch, offset_ms: w.offset_ms };
      Object.assign(w, { offset_joined: false, status: 'whole', speaker_id: a.speaker_id, file_name: a.file_name, src_s: a.src_s, src_e: a.src_e, stretch: a.stretch, offset_ms: a.offset_ms, pieces: [], joins: 0, step_db: null, quiet: false });
      w.alternatives = w.alternatives.filter(x => x.id !== altId).concat(wasGap ? [] : [old]);
      return normalize(p);
    },
    quiet(plan, n, i, on) { const p = clone(plan), w = at(p, n, i); if (w.status !== 'gap') fail('Only a gap can be left quiet.'); w.quiet = on !== false; return normalize(p); },
  };

  // ---- one plan to a stable text, for saving ----
  const stringify = plan => JSON.stringify(normalize(plan), null, 2) + '\n';
  const parse = text => { let v; try { v = JSON.parse(text); } catch (e) { fail('That file is not a song plan.'); } return normalize(v); };

  return { SCHEMA, STATUSES, OFF_BEAT_MS, STRETCH_HIGH, STRETCH_LOW, SongError, parseLyrics, wordsOf, normalizeVideos, normalizeFolder, folderNote, normalize, speakerLabel, statusText, flags, summarize, ops, stringify, parse, mmss };
}));
