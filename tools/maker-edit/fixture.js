// A made-up rough cut so the edit page can be tried, tested and shown with no maker behind it (NEXT-WEB 120; the real list comes from CONNECT 113 / ENGINE).
// Original lines only: no show, no song, no real person. The "picture" is a drawn shape inside the file; nothing is fetched.
(function () {
  'use strict';
  const line = (id, file, inS, text, step) => {                                  // words spread over the clip, `step` seconds apart, 0.1 s after the clip start
    const ws = text.split(' ').map((w, i) => ({ w, s: Math.round((inS + 0.1 + i * step) * 1000) / 1000, e: Math.round((inS + 0.1 + i * step + step - 0.05) * 1000) / 1000 }));
    const out = Math.round((ws[ws.length - 1].e + 0.2) * 1000) / 1000;
    return { id, file_name: file, in_s: inS, out_s: out, words: ws, join: { kind: 'cut', s: 0 } };
  };
  const base = {
    schema: 'ryagram.maker-edit/0',
    mode: 'compilation',
    film: { width: 1280, height: 720, fps: 30 },
    seq: 0,
    clips: [
      line('c1', 'first-video.mp4', 4, 'great news everyone', 0.5),
      line('c2', 'second-video.mp4', 10, 'we built a thing', 0.45),
      line('c3', 'first-video.mp4', 31, 'great news for the weekend', 0.4),
      line('c4', 'third-video.mp4', 2, 'nobody saw that coming', 0.5),
      line('c5', 'second-video.mp4', 52, 'great news again', 0.5),
      line('c6', 'third-video.mp4', 40, 'that is the end', 0.45),
    ],
    images: [], rules: [], texts: [],
    captions: { on: false, size: 'medium', position: 'bottom' },
    look: { theme: 'dark' },
    music: null,
  };
  const star = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#2a6f5f"/><polygon points="200,40 232,120 318,124 250,176 272,260 200,212 128,260 150,176 82,124 168,120" fill="#ffd25e"/></svg>';
  const picture = { id: 'img-demo', file_name: 'demo-star.png', sha256: 'ab'.repeat(32), width: 400, height: 300, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(star) };
  const KEY = 'maker-edit-fixture-saved';
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const sv = {};
  for (const m of ['compilation', 'data']) { try { sv[m] = sessionStorage.getItem(KEY + ':' + m); } catch (e) { /* the fixture still works, it just forgets on reload */ } }
  const dataBase = { schema: 'ryagram.maker-edit/0', mode: 'data', film: { width: 1280, height: 720, fps: 30 }, seq: 0, clips: [], images: [], rules: [], texts: [], captions: { on: false, size: 'medium', position: 'bottom' }, look: { theme: 'dark' }, options: {}, music: null };
  window.ryagramEditFixtureHost = {
    name: 'fixture',
    async load(mode) { const m = mode || 'compilation'; return sv[m] ? JSON.parse(sv[m]) : (m === 'data' ? dataBase : base); },
    async options() { return window.ryagramEditOptionsSample; },
    async save(text) { const m = JSON.parse(text).mode || 'compilation'; sv[m] = text; try { sessionStorage.setItem(KEY + ':' + m, text); } catch (e) { /* kept in memory */ } return { saved: true }; },
    async proxy() { return { state: 'ready', url: null }; },                      // no video: the page draws its stand-in picture
    async rebuildProxy() { await delay(350); return { state: 'ready', url: null }; },
    async pickImage() { return { image: { id: picture.id, file_name: picture.file_name, sha256: picture.sha256, width: picture.width, height: picture.height } }; },
    imageUrl(id) { return id === picture.id ? picture.url : null; },
    async render() { return { state: 'fixture', message: 'This is the practice cut: nothing is rendered.' }; },
    back() { return false; },
  };
}());
