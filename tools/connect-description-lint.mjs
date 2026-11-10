// The directory review's rules for tool DESCRIPTIONS, as a lint (CONNECT, 2026-11-09; BACKLOG CONNECT own pick; paper proposals/CONNECT-DIRECTORY-READINESS-1109.md sections 2 and 3). Both reviewers read what a tool says about itself:
//   Claude (connector review criteria): a description is REJECTED if it tells Claude to call external software or tools the user did not ask for, interferes with Claude calling other tools, directs Claude to pull behavioural instructions from
//   somewhere else, holds hidden, obfuscated or encoded instructions, or tells Claude to behave in ways unrelated to the tool's function, to override system instructions, or to promote products. Names at most 64 characters; every tool has a title.
//   OpenAI (app/plugin guidelines): clear, verb-based, readable names; a non-empty description of purpose, when to use it, limits and side effects that matches the schema and the behaviour; no steering toward or away from other services;
//   "do not direct the model to call another plugin or connector"; no promotion, pricing or comparison.
// lintTool(tool, knownTools) returns a list of plain-words problems; lintRegistry(tools) runs every tool and also finds a description that names a tool this server does not have. An IMPERATIVE sentence aimed at the assistant
// ("Use ...", "Read ...", "Do not call ...") is not refused outright (some are safety advice about THIS tool), but each one must be on the reviewed list in tests/connect-directory-descriptions.test.mjs with its reason, so a new one is a decision.
export const MAX_DESCRIPTION = 900;
export const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;
export const OVERRIDE = [/ignore (all |any |your |the )?(previous|prior|above|system)/i, /disregard/i, /override/i, /system prompt/i, /\bjailbreak/i, /you (must|should) (always|never) (call|use|prefer)/i, /instead of (using |calling )?(the |any )?(other|another|built-in)/i,
  /(always|only) (call|use) (this|me)/i, /before (using|calling) any other/i, /do not (call|use) (any )?other tools?/i, /prefer this (tool )?over/i];
export const PROMOTION = [/\b(best|leading|#1|premium|world-class|unrivalled|cutting-edge)\b/i, /\b(upgrade|subscribe|subscription|discount|promo|coupon|free trial)\b/i, /\b(better|cheaper|faster) than\b/i, /\bcompetitor/i];
export const EXTERNAL = [/https?:\/\//i, /\bwww\./i, /(fetch|download|read|pull|load|follow) (your |the |its )?(instructions|rules|prompt|policy) (from|at|in)\b/i, /(go|navigate|browse) to\b/i, /\bcurl\b|\bwget\b/i];
export const ENCODED = [/[A-Za-z0-9+/]{60,}={0,2}/, /<!--/, /&#x?[0-9a-f]+;/i, /%[0-9a-f]{2}%[0-9a-f]{2}%[0-9a-f]{2}/i, /\\u[0-9a-f]{4}/i, /\b(?:base64|rot13|hex-encoded)\b/i];
/** A sentence that opens with an instruction to the assistant. */
export const IMPERATIVE = /(?:^|[.;:!?] +)(Use|Read(?!-)|Pass|Call|Ask|Tell|Check|Make sure|Remember|Never|Always|Do not|Don't|Wait|Repeat|Say|Show|Avoid|Prefer|Try|Send|Open|Visit)\b[^.;]*[.;]?/gi;
const VERB_NAME = /^(get|set|list|create|make|request|suggest|open|undo|edit|what|where|read|ask|county|compare|geo|forecast|editor|my|whoami|dataset|job|find|check|show|start|end|join|play|lock|reveal|skip|pause|resume|remove|let|scores|room|map)(_|$)/;

/** Claude's directory does not accept a connector that "generates images, video, or audio through AI models" (their review criteria), and its portal has an acknowledgment for it. Ryagram compiles films with its OWN engine from data and the person's own clips: no tool, description, title,
 *  listing text or result sentence may name a generative image, video, audio or voice model or say the connector generates media with one. (A sentence that says Ryagram does NOT use one would trip this too: say it in the listing prose, not in code.) */
export const GENERATIVE = [
  /\b(?:dall-?e|midjourney|stable[ -]diffusion|sora|veo|runway|pika|imagen|firefly|suno|udio|elevenlabs|heygen|synthesia|kling|luma dream machine|flux|gen-?[23])\b/i,
  /text[ -]to[ -](?:image|video|speech|music|audio)/i, /(?:image|video|audio|voice|music|song|speech) (?:generat|synthes)/i, /generat(?:e|es|ed|ing) (?:an? |the |some )?(?:image|video|audio|voice|song|music|picture|film)s? (?:with|using|by|from) (?:an? )?(?:ai|model|prompt)/i,
  /ai[- ]generated/i, /generative (?:ai|model|media|video|image)/i, /\b(?:deepfake|face[ -]?swap|voice clon\w*|lip[ -]?sync model|diffusion model)\b/i,
];
/** Problems with any text (a description, a title, a listing sentence, a source file) that names a generative media model. */
export function lintGenerative(text, where = 'text') {
  const p = [];
  for (const re of GENERATIVE) { const m = re.exec(String(text)); if (m) p.push(`${where}: names a generative media model or says it generates media with one (${m[0].slice(0, 40)}).`); }
  return p;
}

export function imperatives(description) {
  const out = [];
  for (const m of String(description).matchAll(IMPERATIVE)) out.push(m[0].replace(/^[.;:!?]\s*/, '').trim());
  return out;
}

export function lintTool(t, knownTools = []) {
  const p = [];
  const n = typeof t?.name === 'string' ? t.name : '';
  const at = `Tool ${n.slice(0, 40)}`;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(n)) p.push(`${at}: the name must be lowercase letters, digits and underscores, at most 64 characters.`);
  if (typeof t?.title !== 'string' || !t.title.trim() || t.title.length > 80) p.push(`${at}: it needs a title of 1 to 80 characters.`);
  else if (INVISIBLE.test(t.title)) p.push(`${at}: the title holds a hidden character.`);
  if (/\b(mcp|plugin|server)\b/i.test(`${n} ${t?.title ?? ''}`)) p.push(`${at}: the name or title says MCP, plugin or server (OpenAI refuses that in a name).`);
  const d = t?.description;
  if (typeof d !== 'string' || d.trim().length < 20) { p.push(`${at}: the description must say what the tool does (at least 20 characters).`); return p; }
  if (d.length > MAX_DESCRIPTION) p.push(`${at}: the description is ${d.length} characters (the most is ${MAX_DESCRIPTION}); long descriptions are where hidden instructions hide.`);
  if (INVISIBLE.test(d)) p.push(`${at}: the description holds a hidden, control or direction character.`);
  for (const re of OVERRIDE) if (re.test(d)) p.push(`${at}: the description tries to override or steer other tools or the assistant (${String(re.exec(d)?.[0]).slice(0, 40)}).`);
  for (const re of PROMOTION) if (re.test(d)) p.push(`${at}: the description promotes or compares (${String(re.exec(d)?.[0]).slice(0, 40)}).`);
  for (const re of EXTERNAL) if (re.test(d)) p.push(`${at}: the description points at an address or tells the assistant to fetch instructions from elsewhere (${String(re.exec(d)?.[0]).slice(0, 40)}).`);
  for (const re of ENCODED) if (re.test(d)) p.push(`${at}: the description holds encoded or hidden-looking text (${String(re.exec(d)?.[0]).slice(0, 20)}).`);
  for (const x of lintGenerative(`${n} ${t?.title ?? ''} ${d}`, at)) p.push(x);
  // it may name only this server's own tools: a snake_case word used as a tool ("use X", "call X", "with X", "via X", "then X", "see X") must be one
  if (knownTools.length) for (const m of d.matchAll(/\b(?:use|call|with|via|then|see|using|calls)\s+([a-z]+(?:_[a-z]+)+)\b/gi)) {
    if (!knownTools.includes(m[1])) p.push(`${at}: the description names ${m[1]}, which is not a tool of this server.`);
  }
  return p;
}

export function lintRegistry(tools) {
  const p = [];
  const names = tools.map((t) => t.name);
  const seen = new Set();
  for (const t of tools) { if (seen.has(t.name)) p.push(`Tool ${String(t.name).slice(0, 40)} is listed twice.`); seen.add(t.name); p.push(...lintTool(t, names)); }
  return p;
}
