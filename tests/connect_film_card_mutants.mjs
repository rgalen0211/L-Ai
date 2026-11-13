// Must-fail proof for tests/connect-film-card.test.mjs (Editor Step A, the connector's side: the card checker, the app-only tool, the stand-in world, the database layer): each mutant breaks ONE rule in a scratch copy and the suites
// must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// The SQL half (the migration's rules) has its own runner: tests/film_card_sql_mutants.py.
// Run:  node tests/connect_film_card_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-card');
const FC = 'supabase/functions/connect-core/film_card.ts', ET = 'supabase/functions/connect-core/editor_tools.ts', FK = 'supabase/functions/connect-core/fake.ts', TY = 'supabase/functions/connect-core/types.ts', DB = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-film-card.test.mjs', 'connect-chat-editor-server.test.mjs'];
const mutants = [
  // ---- a county map the engine refused for its size
  ['any detail is shown as a size', ET, '/^too_big (\\d{1,9}) (\\d{1,9})$/.exec(detail)', '/^too_big (\\d+) (\\d+)/.exec(detail)'],
  ['a size whose picture is not over the limit is shown', ET, 'return limit >= 1000 && characters > limit ? { characters, limit } : null;', 'return { characters, limit };'],
  ['a size detail on any code is shown as a size', ET, 'const size = code === "view_not_supported" ? tooBig(r.fail_detail) : null;', 'const size = tooBig(r.fail_detail);'],
  ['the size sentence leaves out the numbers', ET, 'it would be ${size.characters.toLocaleString("en-US")} characters and the limit is ${size.limit.toLocaleString("en-US")}.', 'it would be too many characters.'],
  ['the size is never reported', ET, 'return { state: "failed", code, size, message:', 'return { state: "failed", code, message:'],
  // ---- a failed picture is asked for again (only when the database says ten minutes have passed)
  ['a failed picture is never asked for again, whatever the words say', ET, ' || again) && a.p_ask === true) {', ') && a.p_ask === true) {'],
  ['a failed picture is asked for again whatever the reason it failed', ET, 'const again = (r.state === "failed" && r.retry === true)', 'const again = (r.state === "failed")'],
  ['a stale picture whose refresh failed is never asked for again', ET, ' || (r.state === "ready" && r.stale === true && r.refresh?.state === "failed" && r.refresh.retry === true);', ';'],
  ['the stand-in offers a new ask at once, not after ten minutes', FK, 'c.state === "failed" && c.fail_code === "engine_error" && (c.finished ?? 0) < Date.now() - 600000', 'c.state === "failed" && c.fail_code === "engine_error" && (c.finished ?? 0) < Date.now() + 600000'],
  ['the stand-in offers a new ask for any failure', FK, 'c.state === "failed" && c.fail_code === "engine_error" && (c.finished ?? 0)', 'c.state === "failed" && (c.finished ?? 0)'],
  ['the words promise a retry nobody makes', ET, 'Open the editor again in about ten minutes to try again.', 'It will be tried again later.'],
  // ---- the checker: the film's hatch (a pattern), the picture cap and the card cap
  ['a pattern is not on the list of elements', FC, '"clipPath", "title", "pattern"]);', '"clipPath", "title"]);'],
  ['a pattern may hold a circle', FC, 'const PATTERN_CHILDREN = new Set(["line", "path", "rect"]);', 'const PATTERN_CHILDREN = new Set(["line", "path", "rect", "circle"]);'],
  ['a pattern may hold something inside its children', FC, 'stack[stack.length - 1] !== "pattern" || !PATTERN_CHILDREN.has(name)', '!PATTERN_CHILDREN.has(name)'],
  ['a pattern may hold anything', FC, 'if (inPattern && (stack[stack.length - 1] !== "pattern" || !PATTERN_CHILDREN.has(name)))', 'if (false)'],
  ['a pattern may refer to a paint', FC, 'if (patternish && low.includes("url("))', 'if (false && low.includes("url("))'],
  ['patterns are not counted', FC, '++patterns > SVG_MAX_PATTERNS', '++patterns > 1000000'],
  ['a pattern tile may be tiny', FC, 'Number(v) >= 2 && Number(v) <= 64', 'Number(v) >= 0 && Number(v) <= 64'],
  ['a pattern tile may be huge', FC, 'Number(v) >= 2 && Number(v) <= 64', 'Number(v) >= 2 && Number(v) <= 6400'],
  ['a pattern tile may carry a unit', FC, 'const TILE = /^\\d{1,2}(?:\\.\\d{1,3})?$/;', 'const TILE = /^\\d{1,2}(?:\\.\\d{1,3})?/;'],
  ['a pattern needs no width', FC, 'if (!ok("width") || !ok("height"))', 'if (!ok("height"))'],
  ['a pattern needs no height', FC, 'if (!ok("width") || !ok("height"))', 'if (!ok("width"))'],
  ['a pattern may have any units word', FC, 'key === "patternUnits" && val !== "userSpaceOnUse"', 'key === "patternUnits" && false && val !== "userSpaceOnUse"'],
  ['a pattern attribute may be on any element', FC, 'if (PATTERN_ONLY.has(key) && name !== "pattern")', 'if (false && name !== "pattern")'],
  ['a pattern may have a content-units attribute', FC, '"patternUnits", "patternTransform",', '"patternUnits", "patternTransform", "patternContentUnits",'],
  ['the picture cap stays at 200000', FC, 'export const SVG_MAX_CHARS = 300000;', 'export const SVG_MAX_CHARS = 200000;'],
  ['the picture cap is far too high', FC, 'export const SVG_MAX_CHARS = 300000;', 'export const SVG_MAX_CHARS = 3000000;'],
  ['the card cap stays at 262144', FC, 'export const FILM_CARD_MAX_BYTES = 320000;', 'export const FILM_CARD_MAX_BYTES = 262144;'],
  ['the card cap is far too high', FC, 'export const FILM_CARD_MAX_BYTES = 320000;', 'export const FILM_CARD_MAX_BYTES = 3200000;'],
  // ---- the checker: what a picture may hold
  ['the picture may hold a script element', FC, 'new Set(["svg", "g", "path",', 'new Set(["script", "svg", "g", "path",'],
  ['the picture may hold a use element', FC, '"clipPath", "title", "pattern"]);', '"clipPath", "title", "pattern", "use"]);'],
  ['the picture may hold an image element', FC, '"tspan", "defs",', '"tspan", "defs", "image",'],
  ['the picture may carry a style attribute', FC, '"gradientUnits", "gradientTransform",', '"gradientUnits", "gradientTransform", "style",'],
  ['the picture may carry an event handler', FC, 'if (!SVG_ATTRS.has(key)) return [', 'if (!SVG_ATTRS.has(key) && !key.startsWith("on")) return ['],
  ['a url() may point anywhere', FC, 'if (low.includes("url(") && !(', 'if (false && low.includes("url(") && !('],
  ['an address or a script may sit in an attribute', FC, 'if (/javascript:|data:|https?:|\\/\\/|@import|expression\\(|&/i.test(low)) return', 'if (false) return'],
  ['any entity is allowed', FC, 'if (ENTITY.test(text)) return', 'if (false) return'],
  ['text may sit outside a text element', FC, 'if (text.trim() && !(top && TEXT_ELEMENTS.has(top))) return', 'if (false) return'],
  ['hidden characters are allowed in the picture', FC, 'if (hasHiddenChars(svg)) return', 'if (false) return'],
  ['the picture size is not limited', FC, 'if (svg.length > SVG_MAX_CHARS) return', 'if (false) return'],
  ['the number of elements is not limited', FC, 'if (++elements > SVG_MAX_ELEMENTS) return', 'if (++elements < 0) return'],
  ['the nesting depth is not limited', FC, 'if (stack.length > SVG_MAX_DEPTH) return', 'if (stack.length > 100000) return'],
  ['tags that do not match are accepted', FC, 'if (stack.pop() !== name) return', 'if (stack.pop() === undefined) return'],
  ['tags that are never closed are accepted', FC, 'if (stack.length) return ["The picture\'s tags are not closed."];', 'if (false) return ["The picture\'s tags are not closed."];'],
  ['a second top element is accepted', FC, 'if (closedRoot) return ["The picture has more than one top element."];', 'if (false) return ["The picture has more than one top element."];'],
  ['the top element need not be svg', FC, 'if (name !== "svg" || roots > 1) return', 'if (roots > 1) return'],
  ['xmlns may name any address', FC, 'if (stack.length || val !== XMLNS) return', 'if (stack.length) return'],
  ['an attribute may be repeated', FC, 'if (seen.has(key)) return', 'if (false) return'],
  ['an id need not be plain', FC, 'if (key === "id" && !ID.test(val)) return', 'if (false) return'],
  // ---- the checker: the card
  ['a card of any size is accepted', FC, 'if (bytes > FILM_CARD_MAX_BYTES) return', 'if (false) return'],
  ['any schema number is accepted', FC, 'if (card.schema !== 1) p.push(', 'if (false) p.push('],
  ['the page background is no longer required', FC, 'export const LOOK_REQUIRED = ["page.background"] as const;', 'export const LOOK_REQUIRED = [] as const;'],
  ['all five look keys are required again (a bar race is refused)', FC, 'export const LOOK_REQUIRED = ["page.background"] as const;', 'export const LOOK_REQUIRED = ["network.color", "network.base_color", "network.context_color", "state.fill", "page.background"] as const;'],
  ['lengthAdjust is no longer an allowed attribute', FC, '"textLength", "lengthAdjust", "xml:space", "dx"', '"textLength", "xml:space", "dx"'],
  ['xml:space is no longer an allowed attribute', FC, '"textLength", "lengthAdjust", "xml:space", "dx"', '"textLength", "lengthAdjust", "dx"'],
  ['a length adjustment may be any word', FC, 'if (key === "lengthAdjust" && ', 'if (false && '],
  ['an xml:space may be any word', FC, 'if (key === "xml:space" && ', 'if (false && '],
  ['textLength is no longer an allowed attribute', FC, '"letter-spacing", "textLength", "lengthAdjust"', '"letter-spacing", "lengthAdjust"'],
  ['a text length may be any text', FC, 'if (key === "textLength" && !', 'if (false && !'],
  ['a look may lack a required colour', FC, 'for (const k of LOOK_REQUIRED) if (!(k in look)) p.push(', 'for (const k of LOOK_REQUIRED) if (false) p.push('],
  ['a look colour need not be hex', FC, 'else if (typeof look[k] !== "string" || !HEX.test(look[k] as string)) p.push(', 'else if (false) p.push('],
  ['a look name need not be plain', FC, 'if (!LOOK_KEY.test(k)) p.push(', 'if (false) p.push('],
  ['the story hash need not be a sha-256', FC, 'if (typeof b.story_sha256 !== "string" || !SHA.test(b.story_sha256)) p.push(', 'if (false) p.push('],
  ['the card may carry any extra part', FC, 'if (extra.length) p.push(', 'if (false) p.push('],
  ['the picture may be any size', FC, 'if (!Number.isInteger(f[k]) || (f[k] as number) < 64 || (f[k] as number) > 4096) p.push(', 'if (false) p.push('],
  ['the ramp may have any number of stops', FC, 'card.ramp.length > 12', 'card.ramp.length > 1200'],
  ['there may be any number of notes', FC, 'card.notes.length > 5 ||', 'card.notes.length > 500 ||'],
  ['the label need not be plain', FC, 'if (f.label !== undefined && !plain(f.label, 60)) p.push(', 'if (false) p.push('],
  // ---- the tool
  ['an unchecked card is passed to the panel', ET, 'if (checkFilmCard(r.card).length || sha !== r.built_sha256) return', 'if (false) return'],
  ['a card for another story is passed to the panel', ET, 'if (checkFilmCard(r.card).length || sha !== r.built_sha256)', 'if (checkFilmCard(r.card).length)'],
  ['the card is sent again to a panel that already holds it', ET, 'if (have && have === r.built_sha256) return', 'if (false) return'],
  ['a stale card asks again on every poll', ET, 'r.stale === true && !r.refresh)', 'r.stale === true)'],
  ['a read asks without being told to', ET, '&& a.p_ask === true', ''],
  ['asks are not limited per hour', ET, 'if (!(await ctx.policy.hit(ctx.principal, "film_card", LIMITS.filmCardsPerHourPerUser, 3600))) {', 'if (false) {'],
  ['the tool needs the edit scope', ET, 'scope: "read", readOnly: false, idempotent: true, chatEditor: "app",', 'scope: "edit", readOnly: false, idempotent: true, chatEditor: "app",'],
  ['the tool exists with the chat-editor switch off', ET, 'scope: "read", readOnly: false, idempotent: true, chatEditor: "app",', 'scope: "read", readOnly: false, idempotent: true,'],
  ['a film that is not yours is found', ET, 'return answer({ code: "PT404", message: "That film was not found among your projects." }, true, "not_found");', 'return answer({ state: "none" });'],
  ['the old card goes away while the new one is drawn', ET, 'if (r.state === "ready") return answer({ ...shape({ ...r, refresh: { state: asked.state } }, have) });', ''],
  ['a database without the migration crashes the tool', ET, 'if (!get || !ask) return answer(', 'if (false) return answer('],
  ['the hourly limit is far too high', TY, 'filmCardsPerHourPerUser: 20,', 'filmCardsPerHourPerUser: 2000,'],
  // ---- the database layer and the stand-in
  ['the ask goes to the read function', DB, 'askFilmCard: (projectId) => self.fn("connect_film_card_ask"', 'askFilmCard: (projectId) => self.fn("connect_film_card_get"'],
  ['the read goes to the ask function', DB, 'getFilmCard: (projectId) => self.fn("connect_film_card_get"', 'getFilmCard: (projectId) => self.fn("connect_film_card_ask"'],
  ['the stand-in lets many requests wait', FK, 'c.state === "claimed").length >= 5) throw err("There are already 5 film pictures', 'c.state === "claimed").length >= 500) throw err("There are already 5 film pictures'],
  ['the stand-in worker may store a card for another story', FK, 'if ((o!.basis as { story_sha256?: unknown } | undefined)?.story_sha256 !== c.sha) throw', 'if (false) throw'],
  ['the stand-in retries an engine error at once', FK, '(same.finished ?? 0) < Date.now() - 600000', '(same.finished ?? 0) < Date.now() + 600000'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
