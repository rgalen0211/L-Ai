// A made-up song build so the song screens can be tried, tested and shown with no maker behind them (NEXT-WEB 121; the real plan comes from CONNECT 111 under CLAUDE-BIG-CLUB-V3-RULES.md).
// The practice words are original and are not a song. The "engine" here only spreads the words over made-up beats and invents who says them, so every state the screens can show appears:
// said as it is, built from sounds (syllables, phonemes), a gap, a word that lands off the beat, stretched and squeezed words, a voice change, and other takes to swap in.
(function () {
  'use strict';
  const model = window.ryagramSongModel;
  const PRACTICE = ['the morning comes up slowly', 'we carry the quiet home', 'zigzag lanterns on the river', 'every window knows our name'].join('\n');
  const KEY = 'maker-song-fixture-saved';
  let saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) { /* kept in memory */ }
  const files = ['first-video.mp4', 'second-video.mp4', 'third-video.mp4'];
  const cast = [{ id: 'v-a', name: null }, { id: 'v-b', name: 'Narrator' }];
  const hash = w => [...w].reduce((a, c) => a + c.charCodeAt(0), 0);

  function build(lines, track, guide) {
    let wordNo = 0;
    const out = lines.map((text, li) => {
      const ws = text.split(' ');
      const start = li * 5.2;
      return {
        text,
        words: ws.map((raw, k) => {
          const w = raw, h = hash(w.toLowerCase()) % 10, beat = Math.round((start + k * 0.62) * 1000) / 1000, end = Math.round((beat + 0.52) * 1000) / 1000;
          wordNo++;
          if (/[zqx]/i.test(w)) return { w, beat_s: beat, end_s: end, status: 'gap' };
          const who = (li + (h === 3 || wordNo % 7 === 3 ? 1 : 0)) % 2 ? 'v-b' : 'v-a', other = who === 'v-a' ? 'v-b' : 'v-a';
          const status = w.length < 2 ? 'whole' : h === 0 ? 'phonemes' : (h === 1 || w.length >= 7) ? 'syllables' : 'whole';
          const half = Math.ceil(w.length / 2);
          const src = 4 + (wordNo % 17) * 3.1;
          const word = { w, beat_s: beat, end_s: end, status, speaker_id: who, file_name: files[wordNo % 3], src_s: Math.round(src * 1000) / 1000, src_e: Math.round((src + 0.45) * 1000) / 1000,
            stretch: h === 2 ? 0.4 : Math.round((0.8 + h * 0.3) * 10) / 10, offset_ms: h === 5 ? 41 : (h * 7) % 31 - 15, step_db: status === 'whole' ? null : (h === 4 ? 8.5 : 2.5), burst: h === 6 || wordNo % 9 === 4,
            alternatives: [
              { id: `alt-${li + 1}-${k + 1}-a`, speaker_id: other, file_name: files[(wordNo + 1) % 3], src_s: Math.round((src + 9) * 1000) / 1000, src_e: Math.round((src + 9.5) * 1000) / 1000, stretch: 1.1, offset_ms: 4 },
              { id: `alt-${li + 1}-${k + 1}-b`, speaker_id: who, file_name: files[(wordNo + 2) % 3], src_s: Math.round((src + 21) * 1000) / 1000, src_e: Math.round((src + 21.4) * 1000) / 1000, stretch: 1.6, offset_ms: -9 },
            ] };
          if (status !== 'whole') word.pieces = status === 'phonemes' ? [...w].map(c => ({ text: c, speaker_id: who })) : [{ text: w.slice(0, half), speaker_id: who }, { text: w.slice(half), speaker_id: who }];
          return word;
        }),
      };
    });
    return { schema: model.SCHEMA, track: { file_name: track.file_name, seconds: Math.max(track.seconds, lines.length * 5.2 + 1) }, guide: guide || null, cast, lines: out };
  }

  window.ryagramSongFixtureHost = {
    name: 'fixture',
    practiceLyrics: PRACTICE,
    async pickTrack() { return { track: { file_name: 'my-song.mp3', seconds: 40 } }; },
    async pickGuide() { return { guide: { file_name: 'my-guide-vocal.wav' } }; },
    async build(req) { return { plan: build(req.lines, req.track, req.guide) }; },
    async hear() { return null; },                                                // no audio: the page plays a tone for each word so the timing can be heard
    async load() { return saved ? JSON.parse(saved) : null; },
    async save(text) { saved = text; try { sessionStorage.setItem(KEY, text); } catch (e) { /* kept in memory */ } return { saved: true }; },
    async render() { return { message: 'This is the practice build: nothing is rendered.' }; },
    back() { return false; },
  };
}());
