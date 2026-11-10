// The shared film-card cases (CONNECT, 2026-11-09; contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md). ALL INVENTED. cases.json is built from this file (node tests/fixtures/film-card/build-cases.mjs --write) and a test
// fails if the two differ, so the cases ENGINE and WORKER read are exactly the ones the connector's checker is tested with. Each case: { name, ok, why, card }. ok = the card must pass; otherwise it must be refused.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHA = 'a'.repeat(64);
const NS = ' xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"';
const SVG = (inner = '<rect width="960" height="540" fill="#0d0d11"/>', attrs = NS) => `<svg${attrs}>${inner}</svg>`;
const RLO = String.fromCharCode(0x202e);
const base = () => ({
  schema: 1,
  basis: { story_sha256: SHA, view: 'network', theme: 'dark3', dataset: 'invented_set', engine: 'test-1' },
  look: { 'network.color': '#6fd1bd', 'network.base_color': '#c9a66b', 'network.context_color': '#5a5a66', 'state.fill': '#23232d', 'page.background': '#0d0d11' },
  frame: { label: '2024', width: 960, height: 540, svg: SVG() },
});
const withSvg = (svg) => { const c = base(); c.frame.svg = svg; return c; };
const mod = (f) => { const c = base(); f(c); return c; };

export function cases() {
  const good = [
    ['good', 'a small valid card', base()],
    ['good with ramp, notes and a drawn picture', 'every optional part, a gradient, a clip path, text with entities, a group with transforms',
      mod((c) => {
        c.ramp = [{ at: 0, color: '#112233' }, { at: 1, color: '#ddeeff' }];
        c.notes = ['This still shows the last year of the film.'];
        c.frame.svg = SVG('<defs><linearGradient id="g1"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#ddeeff"/></linearGradient><clipPath id="c1"><rect width="900" height="500"/></clipPath></defs>'
          + '<g transform="translate(10 10)" clip-path="url(#c1)"><path d="M0 0L100 0L100 100Z" fill="url(#g1)" stroke="#ffffff" stroke-width="1.5"/>'
          + '<text x="20" y="40" font-family="sans-serif" font-size="20" fill="#ffffff">A &amp; B &lt; C</text></g>');
      })],
    ['good with extra look keys', 'a view that names more colours than the five', mod((c) => { c.look['network.glow'] = '#ffffff'; })],
    ['good bar race card with one look key', 'a view lists only the keys it has: page.background is the one key every card carries (the bar race view of the engine)', mod((c) => { c.basis.view = 'bars'; c.look = { 'page.background': '#14141a' }; })],
    ['good map card with all its keys', 'a map view lists its own keys, here the five and two map colours', mod((c) => { c.basis.view = 'choropleth'; c.look['choropleth.low'] = '#1b2a41'; c.look['choropleth.high'] = '#f2c14e'; })],
    ['good text with a text length', 'textLength is a plain presentation attribute: a number only', withSvg(SVG('<text x="20" y="40" font-size="20" textLength="120.5" fill="#ffffff">Rent</text>'))],
  ];
  const bad = [
    ['wrong schema number', 'schema must be exactly 1', mod((c) => { c.schema = 2; })],
    ['missing a required look key', 'page.background is the one required look key', mod((c) => { delete c.look['page.background']; })],
    ['a look with other colours but no page background', 'the page background is required even when the view lists other keys', mod((c) => { c.look = { 'network.color': '#6fd1bd', 'state.fill': '#23232d' }; })],
    ['an empty look', 'a card must say at least its page background', mod((c) => { c.look = {}; })],
    ['a text length that is not a plain number', 'textLength is a number only', withSvg(SVG('<text x="1" y="1" textLength="abc">a</text>'))],
    ['a text length written as an expression', 'textLength is a plain number, never an expression or a unit', withSvg(SVG('<text x="1" y="1" textLength="1e3">a</text>'))],
    ['a colour that is not hex', 'colours are 6-digit hex only', mod((c) => { c.look['network.color'] = 'red'; })],
    ['a short hex colour', 'colours are 6-digit hex only (not #fff)', mod((c) => { c.look['network.color'] = '#fff'; })],
    ['a look name that is not plain', 'look names are short lowercase dotted names', mod((c) => { c.look['Network Color'] = '#ffffff'; })],
    ['a story hash that is not 64 hex', 'basis.story_sha256 is a sha-256', mod((c) => { c.basis.story_sha256 = 'abc'; })],
    ['an extra top-level part', 'no unknown parts (the card is closed)', mod((c) => { c.extra = 1; })],
    ['a picture wider than the limit', 'width 64 to 4096', mod((c) => { c.frame.width = 5000; })],
    ['a ramp of 13 stops', 'at most 12 stops', mod((c) => { c.ramp = Array.from({ length: 13 }, (_, i) => ({ at: i / 13, color: '#112233' })); })],
    ['six notes', 'at most 5 notes', mod((c) => { c.notes = ['a', 'b', 'c', 'd', 'e', 'f']; })],
    ['a label with a direction character', 'labels are plain text', mod((c) => { c.frame.label = '20' + RLO + '24'; })],
    ['no picture', 'a card without a real frame is not allowed', mod((c) => { delete c.frame; })],
    ['a script element', 'never script', withSvg(SVG('<script>alert(1)</script>'))],
    ['a style element', 'never style', withSvg(SVG('<style>rect{fill:red}</style>'))],
    ['an image element', 'never image', withSvg(SVG('<image href="x.png"/>'))],
    ['a foreignObject element', 'never foreignObject', withSvg(SVG('<foreignObject><div/></foreignObject>'))],
    ['a use element', 'never use', withSvg(SVG('<defs><g id="a"/></defs><use href="#a"/>'))],
    ['an animation element', 'never animate', withSvg(SVG('<rect width="1" height="1"><animate attributeName="x" to="5"/></rect>'))],
    ['an event handler', 'never an on... attribute', withSvg(SVG('<rect width="1" height="1" onclick="x()"/>'))],
    ['a style attribute', 'never style as an attribute', withSvg(SVG('<rect width="1" height="1" style="fill:red"/>'))],
    ['an href attribute', 'never href', withSvg(SVG('<path d="M0 0" href="#a"/>'))],
    ['an address in an attribute', 'never an http address', withSvg(SVG('<rect width="1" height="1" fill="http://x.example/a"/>'))],
    ['a url() that is not a fragment', 'url() only as url(#id)', withSvg(SVG('<rect width="1" height="1" fill="url(http://x.example/a)"/>'))],
    ['a url() in the wrong attribute', 'url(#id) only in fill, stroke, clip-path', withSvg(SVG('<rect width="1" height="1" x="url(#a)"/>'))],
    ['a data address', 'never data:', withSvg(SVG('<rect width="1" height="1" fill="data:text/plain,x"/>'))],
    ['a javascript address', 'never javascript:', withSvg(SVG('<text x="1" y="1" fill="javascript:x">a</text>'))],
    ['the wrong namespace', 'xmlns only as the svg address, on the root', mod((c) => { c.frame.svg = SVG('<rect width="1" height="1"/>', ' xmlns="http://evil.example/ns" width="10" height="10"'); })],
    ['xmlns on an inner element', 'xmlns only on the root', withSvg(SVG('<g xmlns="http://www.w3.org/2000/svg"/>'))],
    ['a comment', 'no comments', withSvg(SVG('<!-- x --><rect width="1" height="1"/>'))],
    ['a CDATA section', 'no CDATA', withSvg(SVG('<text x="1" y="1"><![CDATA[x]]></text>'))],
    ['a doctype', 'no declarations', withSvg('<!DOCTYPE svg>' + SVG())],
    ['a processing instruction', 'no instructions', withSvg('<?xml version="1.0"?>' + SVG())],
    ['an entity that is not one of the five', 'only amp, lt, gt, quot, apos', withSvg(SVG('<text x="1" y="1">&xx;</text>'))],
    ['text outside a text element', 'text only inside text, tspan, title', withSvg(SVG('hello'))],
    ['tags that are not closed', 'balanced tags', withSvg('<svg width="9" height="9"><g>')],
    ['tags that do not match', 'balanced tags', withSvg('<svg width="9" height="9"><g></text></svg>')],
    ['two top elements', 'one svg only', withSvg(SVG() + SVG())],
    ['no svg at all', 'the picture is one svg', withSvg('<g/>')],
    ['a repeated attribute', 'no repeated attributes', withSvg(SVG('<rect width="1" width="2" height="1"/>'))],
    ['an id that is not plain', 'ids are plain', withSvg(SVG('<g id="a b"/>'))],
    ['a picture over the character limit', 'at most 200000 characters', withSvg(SVG('<g/>'.repeat(50001)))],
    ['too many elements', 'at most 30000 elements', withSvg(SVG('<g/>'.repeat(30001)))],
    ['nested too deeply', 'at most 30 levels', withSvg(SVG('<g>'.repeat(31) + '</g>'.repeat(31)))],
    ['a card over the byte limit', 'at most 262144 bytes of JSON', mod((c) => { c.frame.svg = SVG('<text x="1" y="1">' + 'ab'.repeat(65000) + '</text>'); c.notes = Array.from({ length: 5 }, () => 'x'.repeat(160)); c.engine_pad = 'z'.repeat(140000); })],
    ['a hidden character in the picture', 'no control or direction characters', withSvg(SVG('<text x="1" y="1">a' + RLO + 'b</text>'))],
  ];
  return [...good.map(([name, why, card]) => ({ name, ok: true, why, card })), ...bad.map(([name, why, card]) => ({ name, ok: false, why, card }))];
}

if (process.argv[2] === '--write') {
  const out = fileURLToPath(new URL('./cases.json', import.meta.url));
  const BS = String.fromCharCode(92);
  // every character that is not plain printable ASCII is written as a backslash-u escape, so the file holds no invisible or direction character (tests/source-hygiene.test.cjs)
  const text = JSON.stringify(cases(), null, 1).replace(/[^\x20-\x7e\n]/g, (c) => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(out, text + '\n');
  console.log('wrote', out);
}
