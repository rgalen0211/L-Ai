// The film look card (CONNECT, 2026-11-09; contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md, shared schema proposals/film-card.schema.json): what the engine draws for one saved film so the chat editor can show its
// REAL colours and one REAL still frame. The house worker stores whatever the engine hands it; THIS file is the check every card passes before the panel ever sees it, so a card that is wrong (or hostile) is turned into
// "the card was not usable" and never passed through. The panel then rebuilds the picture element by element from the same allowed list (defence in depth: a mistake in either place cannot run anything).
// Pure functions, no dependencies. Returns a list of plain-words problems; an empty list means the card is good.

export const FILM_CARD_MAX_BYTES = 262144;
export const SVG_MAX_CHARS = 200000;
export const SVG_MAX_ELEMENTS = 30000;
export const SVG_MAX_DEPTH = 30;
/** The ONE colour every card must carry. A view lists only the keys it has (a bar race has just the page background; a map has more); a key a view does not list is simply absent, and the panel keeps its own starting colour and says so. */
export const LOOK_REQUIRED = ["page.background"] as const;

/** The only elements a drawn still may hold. Never script, style, image, foreignObject, use, an animation element, or anything not listed. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "title"]);
/** The only attributes: presentation and geometry. Never style, href, class, an event handler or anything that names an address (the one xmlns on the root is checked on its own). */
export const SVG_ATTRS: ReadonlySet<string> = new Set([
  "id", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "transform", "viewBox", "preserveAspectRatio",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "opacity", "fill-rule", "clip-rule", "clip-path",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "textLength", "lengthAdjust", "xml:space", "dx", "dy", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "xmlns",
]);
const TEXT_ELEMENTS = new Set(["text", "tspan", "title"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
const NAME = /^[a-z0-9_]{1,40}$/;
const THEME = /^[a-z0-9_-]{1,40}$/;
const DATASET = /^[a-z0-9_]{1,60}$/;
const LOOK_KEY = /^[a-z0-9_]{1,24}(\.[a-z0-9_]{1,24}){0,2}$/;
const XMLNS = "http://www.w3.org/2000/svg";
const URL_REF = /^url\(#[A-Za-z0-9_-]{1,40}\)$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_][-A-Za-z0-9_:.]*\s*=\s*(?:"[^"<>&]*"|'[^'<>&]*'))*)\s*(\/?)>/y;
const ATTR = /\s+([A-Za-z_][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos);)/;

/** True when the text has a control character or a direction/format character (what a person must never be shown). */
export function hasHiddenChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}
const shown = (s: string) => s.replace(/[^A-Za-z0-9 ._-]/g, "?").slice(0, 30);

/** Problems with one drawn still. */
export function checkSvg(svg: unknown): string[] {
  if (typeof svg !== "string" || !svg.trim()) return ["The picture is not text."];
  if (svg.length > SVG_MAX_CHARS) return [`The picture is over ${SVG_MAX_CHARS} characters.`];
  if (hasHiddenChars(svg)) return ["The picture has control or direction characters."];
  const stack: string[] = [];
  let pos = 0, elements = 0, roots = 0, closedRoot = false;
  while (pos < svg.length) {
    const lt = svg.indexOf("<", pos);
    const text = svg.slice(pos, lt === -1 ? svg.length : lt);
    if (text) {
      if (ENTITY.test(text)) return ["The picture has an entity it may not have."];
      const top = stack[stack.length - 1];
      if (text.trim() && !(top && TEXT_ELEMENTS.has(top))) return ["The picture has text outside a text element."];
    }
    if (lt === -1) break;
    TAG.lastIndex = lt;
    const m = TAG.exec(svg);
    if (!m) return ["The picture has markup that is not a plain element (a comment, a declaration, an instruction, or a broken tag)."];
    pos = lt + m[0].length;
    const [, closing, name, attrs, selfClose] = m;
    if (!SVG_ELEMENTS.has(name)) return [`The picture has an element that is not allowed (${shown(name)}).`];
    if (closing) {
      if (attrs.trim() || selfClose) return ["A closing tag has attributes."];
      if (stack.pop() !== name) return ["The picture's tags do not match."];
      if (!stack.length) closedRoot = true;
      continue;
    }
    if (closedRoot) return ["The picture has more than one top element."];
    if (!stack.length) { roots++; if (name !== "svg" || roots > 1) return ["The picture must be one svg element."]; }
    if (++elements > SVG_MAX_ELEMENTS) return [`The picture has more than ${SVG_MAX_ELEMENTS} elements.`];
    const seen = new Set<string>();
    for (const a of attrs.matchAll(ATTR)) {
      const key = a[1], val = a[2] ?? a[3] ?? "";
      if (!SVG_ATTRS.has(key)) return [`The picture has an attribute that is not allowed (${shown(key)}).`];
      if (seen.has(key)) return ["An element repeats an attribute."];
      seen.add(key);
      if (key === "xmlns") { if (stack.length || val !== XMLNS) return ["The picture names an address it may not."]; continue; }
      if (val.length > 60000) return ["An attribute is too long."];
      const low = val.toLowerCase();
      if (low.includes("url(") && !(["fill", "stroke", "clip-path"].includes(key) && URL_REF.test(val))) return ["The picture refers to something that is not on the picture."];
      if (/javascript:|data:|https?:|\/\/|@import|expression\(|&/i.test(low)) return ["The picture has an address or a script in an attribute."];
      if (key === "id" && !ID.test(val)) return ["An id is not plain."];
      if (key === "lengthAdjust" && val !== "spacing" && val !== "spacingAndGlyphs") return ["A length adjustment is not one of the two allowed words."];
      if (key === "xml:space" && val !== "preserve" && val !== "default") return ["An xml:space is not preserve or default."];
      if (key === "textLength" && !/^\d{1,5}(?:\.\d{1,3})?$/.test(val)) return ["A text length is not a plain number."];
    }
    if (!selfClose) { stack.push(name); if (stack.length > SVG_MAX_DEPTH) return ["The picture is nested too deeply."]; }
    else if (!stack.length) closedRoot = true;
  }
  if (stack.length) return ["The picture's tags are not closed."];
  if (!roots) return ["The picture must be one svg element."];
  return [];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).filter((k) => !keys.includes(k));
const plain = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !hasHiddenChars(v);

/** Problems with a whole card (an empty list = good). Stops at the first few so the words stay short. */
export function checkFilmCard(card: unknown): string[] {
  const p: string[] = [];
  if (!isObj(card)) return ["The card is not an object."];
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(card)).length; } catch { return ["The card cannot be read."]; }
  if (bytes > FILM_CARD_MAX_BYTES) return [`The card is over ${FILM_CARD_MAX_BYTES} bytes.`];
  const extra = only(card, ["schema", "basis", "look", "ramp", "frame", "notes"]);
  if (extra.length) p.push(`The card has a part it may not have (${shown(extra[0])}).`);
  if (card.schema !== 1) p.push("The card is not schema 1.");
  const b = card.basis;
  if (!isObj(b)) p.push("The card has no basis.");
  else {
    const x = only(b, ["story_sha256", "view", "theme", "dataset", "engine"]);
    if (x.length) p.push(`The basis has a part it may not have (${shown(x[0])}).`);
    if (typeof b.story_sha256 !== "string" || !SHA.test(b.story_sha256)) p.push("The basis story hash is not a sha-256.");
    if (typeof b.view !== "string" || !NAME.test(b.view)) p.push("The basis view is not a plain name.");
    if (typeof b.theme !== "string" || !THEME.test(b.theme)) p.push("The basis theme is not a plain name.");
    if (b.dataset !== undefined && (typeof b.dataset !== "string" || !DATASET.test(b.dataset))) p.push("The basis dataset is not a plain name.");
    if (b.engine !== undefined && !plain(b.engine, 40)) p.push("The basis engine label is not plain text.");
  }
  const look = card.look;
  if (!isObj(look)) p.push("The card has no look.");
  else {
    const keys = Object.keys(look);
    if (keys.length > 40) p.push("The look has more than 40 colours.");
    for (const k of LOOK_REQUIRED) if (!(k in look)) p.push(`The look has no ${k}.`);
    for (const k of keys.slice(0, 40)) {
      if (!LOOK_KEY.test(k)) p.push(`The look has a name that is not plain (${shown(k)}).`);
      else if (typeof look[k] !== "string" || !HEX.test(look[k] as string)) p.push(`The look colour ${shown(k)} is not a 6-digit hex colour.`);
    }
  }
  if (card.ramp !== undefined) {
    if (!Array.isArray(card.ramp) || card.ramp.length > 12) p.push("The ramp is not a list of at most 12 stops.");
    else for (const s of card.ramp) {
      if (!isObj(s) || only(s, ["at", "color"]).length || typeof s.at !== "number" || !(s.at >= 0 && s.at <= 1) || typeof s.color !== "string" || !HEX.test(s.color)) { p.push("A ramp stop is not {at 0 to 1, color hex}."); break; }
    }
  }
  const f = card.frame;
  if (!isObj(f)) p.push("The card has no picture.");
  else {
    const x = only(f, ["label", "width", "height", "svg"]);
    if (x.length) p.push(`The picture has a part it may not have (${shown(x[0])}).`);
    for (const k of ["width", "height"]) if (!Number.isInteger(f[k]) || (f[k] as number) < 64 || (f[k] as number) > 4096) p.push(`The picture ${k} is not a whole number from 64 to 4096.`);
    if (f.label !== undefined && !plain(f.label, 60)) p.push("The picture label is not plain text.");
    p.push(...checkSvg(f.svg));
  }
  if (card.notes !== undefined) {
    if (!Array.isArray(card.notes) || card.notes.length > 5 || card.notes.some((n) => !plain(n, 160))) p.push("The notes are not up to 5 plain sentences.");
  }
  return p.slice(0, 5);
}
