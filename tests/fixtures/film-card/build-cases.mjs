// The shared film-card cases (CONNECT, 2026-11-09; contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md). ALL INVENTED. cases.json is built from this file (node tests/fixtures/film-card/build-cases.mjs --write) and a test
// fails if the two differ, so the cases ENGINE and WORKER read are exactly the ones the connector's checker is tested with. Each case: { name, ok, why, card }. ok = the card must pass; otherwise it must be refused.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHA = 'a'.repeat(64);
const NS = ' xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"';
const SVG = (inner = '<rect width="960" height="540" fill="#0d0d11"/>', attrs = NS) => `<svg${attrs}>${inner}</svg>`;
const RLO = String.fromCharCode(0x202e);
const EMOJI = String.fromCodePoint(0x1f3ac);                                  // one code point, TWO UTF-16 units
const base = () => ({
  schema: 1,
  basis: { story_sha256: SHA, view: 'network', theme: 'dark3', dataset: 'invented_set', engine: 'test-1' },
  look: { 'network.color': '#6fd1bd', 'network.base_color': '#c9a66b', 'network.context_color': '#5a5a66', 'state.fill': '#23232d', 'page.background': '#0d0d11' },
  frame: { label: '2024', width: 960, height: 540, svg: SVG() },
});
const withSvg = (svg) => { const c = base(); c.frame.svg = svg; return c; };
// a picture of EXACTLY `total` characters made of a few long paths (few elements, no attribute over 60000 characters)
const sized = (total) => {
  let rest = total - SVG('').length;
  let inner = '';
  while (rest > 0) { let n = Math.min(rest, 40012); if (rest - n > 0 && rest - n < 14) n -= 14; inner += '<path d="M' + '0'.repeat(n - 13) + '"/>'; rest -= n; }
  return SVG(inner);
};
const PATTERN = (attrs, inner) => '<pattern id="p0" ' + attrs + '>' + inner + '</pattern>';
const TILE = '<line x1="0" y1="0" x2="0" y2="8" stroke="#e8e0c8" stroke-width="1.2"/>';
const HATCHED = (pat) => SVG('<defs>' + pat + '</defs><path d="M0 0L100 0L100 100Z" fill="url(#p0)" stroke="#ffffff"/>');
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
    ['good text fitted to a length', 'lengthAdjust is spacing or spacingAndGlyphs and xml:space is preserve or default (the bar race still of the engine uses them)', withSvg(SVG('<text x="20" y="40" font-size="20" textLength="120.5" lengthAdjust="spacing" xml:space="preserve" fill="#ffffff">Rent  index</text><text x="20" y="80" textLength="90" lengthAdjust="spacingAndGlyphs" xml:space="default">Year</text>'))],
    ['good text with a text length', 'textLength is a plain presentation attribute: a number only', withSvg(SVG('<text x="20" y="40" font-size="20" textLength="120.5" fill="#ffffff">Rent</text>'))],
    ['good hatch: a pattern of two lines, filled by a reference to it', 'the film\'s hatch: a pattern (userSpaceOnUse, a transform) holding lines, used as the fill of a shape',
      withSvg(HATCHED(PATTERN('patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"', TILE + '<line x1="4" y1="0" x2="4" y2="8" stroke="#7a6f9b"/>')))],
    ['good pattern holding a path and a rectangle', 'a pattern may hold line, path and rect (direct children, nothing inside them); x and y are allowed; the other units word is allowed',
      withSvg(HATCHED(PATTERN('patternUnits="objectBoundingBox" x="1" y="1.5" width="2" height="64"', '<path d="M0 0L8 8" stroke="#ffffff"/><rect width="3" height="3" fill="#112233"/>')))],
    ['good pattern at the edges of its limits', 'width 2 and height 64 are the smallest and largest tile; a tile of 12.125 has three decimals at most', withSvg(HATCHED(PATTERN('width="2" height="64"', TILE)).replace('</defs>', '<pattern id="p1" width="12.125" height="2.5">' + TILE + '</pattern></defs>'))],
    ['good picture of exactly 300000 characters', 'the picture cap is 300000 characters (it was 200000): a picture AT the cap passes, and its card is about 301000 bytes, under the card cap', withSvg(sized(300000))],
    ['good label of 30 emoji', 'exactly at the 60-unit label cap (30 emoji are 60 UTF-16 units), with an engine label of 20 emoji (40 units) and a note of 80 emoji (160 units): the edge passes', mod((c) => { c.frame.label = EMOJI.repeat(30); c.basis.engine = EMOJI.repeat(20); c.notes = [EMOJI.repeat(80)]; })],
  ];
  const bad = [
    ['wrong schema number', 'schema must be exactly 1', mod((c) => { c.schema = 2; })],
    ['missing a required look key', 'page.background is the one required look key', mod((c) => { delete c.look['page.background']; })],
    ['a look with other colours but no page background', 'the page background is required even when the view lists other keys', mod((c) => { c.look = { 'network.color': '#6fd1bd', 'state.fill': '#23232d' }; })],
    ['an empty look', 'a card must say at least its page background', mod((c) => { c.look = {}; })],
    ['a length adjustment that is not an allowed word', 'lengthAdjust is only spacing or spacingAndGlyphs', withSvg(SVG('<text x="1" y="1" textLength="50" lengthAdjust="stretch">a</text>'))],
    ['an xml:space that is not an allowed word', 'xml:space is only preserve or default', withSvg(SVG('<text x="1" y="1" xml:space="remove">a</text>'))],
    ['an xml attribute that is not on the list', 'xml:lang is not allowed (only xml:space is)', withSvg(SVG('<text x="1" y="1" xml:lang="en">a</text>'))],
    ['a text length that is not a plain number', 'textLength is a number only', withSvg(SVG('<text x="1" y="1" textLength="abc">a</text>'))],
    ['a text length written as an expression', 'textLength is a plain number, never an expression or a unit', withSvg(SVG('<text x="1" y="1" textLength="1e3">a</text>'))],
    ['a text length written in non-ASCII digits', 'textLength is the ASCII digits 0-9 only: a script that has its own digits (Arabic-Indic here) is refused, so a checker whose digit class is Unicode (Python re without ASCII) must not pass it', withSvg(SVG('<text x="1" y="1" textLength="' + String.fromCharCode(0x661, 0x660) + '">a</text>'))],
    ['a label of 31 emoji', 'lengths count UTF-16 units, as JavaScript does: 31 emoji are 62 units, over the 60 a label may have (a checker that counts code points sees 31)', mod((c) => { c.frame.label = EMOJI.repeat(31); })],
    ['an engine label of 21 emoji', 'the engine label is at most 40 UTF-16 units: 21 emoji are 42', mod((c) => { c.basis.engine = EMOJI.repeat(21); })],
    ['a note of 81 emoji', 'a note is at most 160 UTF-16 units: 81 emoji are 162', mod((c) => { c.notes = [EMOJI.repeat(81)]; })],
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
    ['a picture over the character limit', 'at most 300000 characters', withSvg(sized(300001))],
    ['a pattern child that is not a line, path or rect', 'a pattern holds only line, path and rect', withSvg(HATCHED(PATTERN('width="8" height="8"', '<circle cx="1" cy="1" r="1"/>')))],
    ['a text in a pattern', 'a pattern holds no text', withSvg(HATCHED(PATTERN('width="8" height="8"', '<text x="1" y="1">a</text>')))],
    ['a pattern child with something inside it', 'the children of a pattern hold nothing', withSvg(HATCHED(PATTERN('width="8" height="8"', '<path d="M0 0"><rect width="1" height="1"/></path>')))],
    ['a pattern inside a pattern', 'no pattern in a pattern', withSvg(HATCHED(PATTERN('width="8" height="8"', '<pattern id="p1" width="8" height="8"/>')))],
    ['a pattern child that refers to a paint', 'no url() anywhere inside a pattern, even the one form allowed elsewhere', withSvg(HATCHED(PATTERN('width="8" height="8"', '<line x1="0" y1="0" x2="0" y2="8" stroke="url(#p0)"/>')))],
    ['a pattern that is itself filled by a reference', 'no url() on the pattern itself', withSvg(HATCHED(PATTERN('width="8" height="8" fill="url(#p0)"', TILE)))],
    ['a pattern transform that refers to something', 'patternTransform may not hold url()', withSvg(HATCHED(PATTERN('width="8" height="8" patternTransform="url(#p0)"', TILE)))],
    ['a pattern with an href', 'a pattern never inherits from another (no href)', withSvg(HATCHED(PATTERN('width="8" height="8" href="#p9"', TILE)))],
    ['a pattern with an attribute that is not on the list', 'patternContentUnits is not allowed', withSvg(HATCHED(PATTERN('width="8" height="8" patternContentUnits="objectBoundingBox"', TILE)))],
    ['a pattern units word that is not allowed', 'patternUnits is userSpaceOnUse or objectBoundingBox', withSvg(HATCHED(PATTERN('patternUnits="evil" width="8" height="8"', TILE)))],
    ['a pattern with no width', 'a pattern needs a width', withSvg(HATCHED(PATTERN('height="8"', TILE)))],
    ['a pattern with no height', 'a pattern needs a height', withSvg(HATCHED(PATTERN('width="8"', TILE)))],
    ['a pattern tile of 1 pixel', 'a tile under 2 is refused', withSvg(HATCHED(PATTERN('width="1" height="8"', TILE)))],
    ['a pattern tile of 65 pixels', 'a tile over 64 is refused', withSvg(HATCHED(PATTERN('width="65" height="8"', TILE)))],
    ['a pattern tile with a unit', 'a plain number only', withSvg(HATCHED(PATTERN('width="10px" height="8"', TILE)))],
    ['a pattern tile as a percentage', 'a plain number only', withSvg(HATCHED(PATTERN('width="50%" height="8"', TILE)))],
    ['a pattern tile of 1.5 pixels', 'a height under 2 is refused', withSvg(HATCHED(PATTERN('width="8" height="1.5"', TILE)))],
    ['a pattern tile with four decimals', 'at most three decimals', withSvg(HATCHED(PATTERN('width="8.1234" height="8"', TILE)))],
    ['a hundred and one patterns', 'at most 100 patterns in one picture', withSvg(SVG('<defs>' + Array.from({ length: 101 }, (_, i) => '<pattern id="q' + i + '" width="8" height="8"/>').join('') + '</defs>'))],
    ['a pattern attribute on a rectangle', 'patternUnits belongs to a pattern only', withSvg(SVG('<rect width="1" height="1" patternUnits="userSpaceOnUse"/>'))],
    ['a pattern transform on a path', 'patternTransform belongs to a pattern only', withSvg(SVG('<path d="M0 0" patternTransform="rotate(45)"/>'))],
    ['too many elements', 'at most 30000 elements', withSvg(SVG('<g/>'.repeat(30001)))],
    ['nested too deeply', 'at most 30 levels', withSvg(SVG('<g>'.repeat(31) + '</g>'.repeat(31)))],
    ['a card over the byte limit', 'at most 320000 bytes of JSON', mod((c) => { c.frame.svg = SVG('<text x="1" y="1">' + 'ab'.repeat(130000) + '</text>'); c.notes = Array.from({ length: 5 }, () => 'x'.repeat(160)); c.engine_pad = 'z'.repeat(80000); })],
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
