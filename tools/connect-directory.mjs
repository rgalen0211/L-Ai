// The connector directory listings (NEXT-CONNECT 165, punch P8): one place that says whether the listing files in supabase/directory/ still match the connector's real tool list.
//
//   node tools/connect-directory.mjs --check     exit 1 and a plain list when a manifest and the tool registry disagree (also run by tests/directory-manifests.test.mjs)
//   node tools/connect-directory.mjs --write     rewrite supabase/directory/tools.json from the registry (titles, hints, new tools); written justifications are kept, a new tool gets "TODO"
//
// The registry is the one the live server answers tools/list from (supabase/functions/connect-core/mcp.ts toolList), so a tool added, renamed, hidden or given another hint makes --check fail until
// tools.json (and the justification a directory reviewer reads) is brought up to date. Nothing here talks to a network, and no credential is ever kept in these files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'supabase', 'directory');
export const FILES = { tools: 'tools.json', anthropic: 'anthropic-listing.json', openai: 'openai-listing.json' };
const NAME = /^[a-z0-9_]{1,64}$/;
const BAD_DESCRIPTION = [/ignore (all |any )?(previous|prior|above)/i, /do not (tell|show|reveal)[^.]{0,30}(user|person)/i, /<\s*(script|system|instructions?)[^a-z]/i];
const INVISIBLE = (s) => [...s].some((c) => { const n = c.codePointAt(0); return (n >= 0x200b && n <= 0x200f) || (n >= 0x202a && n <= 0x202e) || n === 0x2060 || n === 0xfeff; });
const SECRET_LOOK = [/\bsk-[A-Za-z0-9]{10,}/, /\beyJ[A-Za-z0-9_-]{10,}\./, /\bBearer\s+[A-Za-z0-9._-]{10,}/, /"password"\s*:\s*"(?!IN THE VENDOR)/i];

export async function registry() {
  const { toolList } = await import('../supabase/functions/connect-core/mcp.ts');
  return toolList();
}

export function load(dir = DIR) {
  const out = {};
  for (const [k, f] of Object.entries(FILES)) out[k] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}

const https = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(\/\S*)?$/i.test(u);
const len = (s) => (typeof s === 'string' ? [...s].length : -1);

export function check(m, reg) {
  const p = [];
  const live = new Map(reg.map((t) => [t.name, t]));
  // 1. tools.json against the registry
  const rows = m.tools.tools ?? [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.name)) p.push(`tools.json lists ${r.name} twice`);
    seen.add(r.name);
    const t = live.get(r.name);
    if (!t) { p.push(`tools.json lists ${r.name}, which the connector does not list (renamed, hidden or removed)`); continue; }
    if (!NAME.test(r.name)) p.push(`${r.name}: a tool name must be a-z, 0-9, underscore, at most 64 characters`);
    if (r.title !== t.title) p.push(`${r.name}: title is "${r.title}" in tools.json but "${t.title}" in the connector`);
    for (const h of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      if (r[h] !== t.annotations[h]) p.push(`${r.name}: ${h} is ${r[h]} in tools.json but ${t.annotations[h]} in the connector`);
    }
    if (t.annotations.openWorldHint !== false) p.push(`${r.name}: openWorldHint must be false (every tool works only on the person's own account)`);
    if (t.annotations.readOnlyHint && t.annotations.destructiveHint) p.push(`${r.name}: a read-only tool cannot be destructive`);
    if (typeof r.justification !== 'string' || len(r.justification) < 20 || r.justification.trim().toUpperCase().startsWith('TODO')) p.push(`${r.name}: needs a written justification (the reviewer reads it)`);
    else if (len(r.justification) > 400) p.push(`${r.name}: justification is over 400 characters`);
  }
  for (const t of reg) if (!seen.has(t.name)) p.push(`the connector lists ${t.name}, which tools.json does not (run --write, then write its justification)`);
  if (m.tools.tool_count !== reg.length) p.push(`tools.json says ${m.tools.tool_count} tools; the connector lists ${reg.length}`);
  for (const t of reg) for (const re of BAD_DESCRIPTION) if (re.test(t.description) || re.test(t.title)) p.push(`${t.name}: the description matches a pattern directory reviewers reject (${re})`);
  for (const t of reg) if (INVISIBLE(t.description) || INVISIBLE(t.title)) p.push(`${t.name}: the description holds hidden or direction-changing characters`);
  // 2. the Anthropic listing
  const a = m.anthropic;
  if (a.status !== 'DRAFT') p.push('anthropic-listing.json: status must stay DRAFT until Ryan has approved the words');
  if (!(len(a.name) > 0 && len(a.name) <= 100)) p.push('anthropic-listing.json: name must be 1 to 100 characters');
  if (!(len(a.one_liner) > 0 && len(a.one_liner) <= 200)) p.push(`anthropic-listing.json: one_liner is ${len(a.one_liner)} characters (limit 200)`);
  if (!(len(a.description) > 0 && len(a.description) <= 2000)) p.push(`anthropic-listing.json: description is ${len(a.description)} characters (limit 2000)`);
  if (!(Array.isArray(a.categories) && a.categories.length >= 1 && a.categories.length <= 5)) p.push('anthropic-listing.json: 1 to 5 categories');
  for (const k of ['documentation_url', 'privacy_policy_url', 'terms_url', 'website']) if (!https(a[k])) p.push(`anthropic-listing.json: ${k} must be an https address`);
  if (!/^(IN THE VENDOR PORTAL ONLY)/.test(String(a.test_account?.credentials ?? ''))) p.push('anthropic-listing.json: test_account.credentials must say IN THE VENDOR PORTAL ONLY (no credential is ever kept in this file)');
  // 3. the OpenAI listing
  const o = m.openai;
  if (o.status !== 'DRAFT') p.push('openai-listing.json: status must stay DRAFT until Ryan has approved the words');
  if (!(len(o.displayName) > 0 && len(o.displayName) <= 30)) p.push(`openai-listing.json: displayName is ${len(o.displayName)} characters (limit 30)`);
  if (!(len(o.shortDescription) > 0 && len(o.shortDescription) <= 30)) p.push(`openai-listing.json: shortDescription is ${len(o.shortDescription)} characters (limit 30)`);
  if (!(len(o.longDescription) > 0 && len(o.longDescription) <= 4000)) p.push(`openai-listing.json: longDescription is ${len(o.longDescription)} characters (limit 4000)`);
  if (!(len(o.developerName) > 0 && len(o.developerName) <= 80)) p.push('openai-listing.json: developerName must be 1 to 80 characters');
  for (const k of ['website', 'support_url', 'privacy_policy_url', 'terms_url']) if (!https(o[k])) p.push(`openai-listing.json: ${k} must be an https address`);
  if (!Array.isArray(o.default_prompts) || o.default_prompts.length < 1 || o.default_prompts.length > 3) p.push('openai-listing.json: 1 to 3 default prompts');
  const cases = o.test_cases ?? [];
  const pos = cases.filter((c) => c.kind === 'positive');
  const neg = cases.filter((c) => c.kind === 'negative');
  if (pos.length < 5) p.push(`openai-listing.json: ${pos.length} positive test cases (at least 5)`);
  if (neg.length < 3) p.push(`openai-listing.json: ${neg.length} negative test cases (at least 3)`);
  for (const c of cases) {
    if (!c.prompt || !c.expected) p.push(`openai-listing.json: test case "${String(c.prompt).slice(0, 30)}" needs a prompt and the expected behaviour`);
    for (const n of c.tools ?? []) if (!live.has(n)) p.push(`openai-listing.json: test case "${String(c.prompt).slice(0, 30)}" names ${n}, which the connector does not list`);
    if (c.kind === 'positive' && !(c.tools ?? []).length) p.push(`openai-listing.json: positive test case "${String(c.prompt).slice(0, 30)}" must name the tool it triggers`);
    if (c.kind === 'negative' && (c.tools ?? []).some((n) => !live.get(n)?.annotations.readOnlyHint)) p.push(`openai-listing.json: negative test case "${String(c.prompt).slice(0, 30)}" must not trigger a tool that changes anything`);
  }
  if (!/^(IN THE VENDOR PORTAL ONLY)/.test(String(o.demo_account?.credentials ?? ''))) p.push('openai-listing.json: demo_account.credentials must say IN THE VENDOR PORTAL ONLY');
  // 4. no secret-looking text anywhere
  for (const [k, v] of Object.entries(m)) for (const re of SECRET_LOOK) if (re.test(JSON.stringify(v))) p.push(`${FILES[k]}: contains text that looks like a credential (${re})`);
  return p;
}

export function rebuildTools(existing, reg) {
  const old = new Map((existing?.tools ?? []).map((r) => [r.name, r]));
  return {
    note: existing?.note ?? 'Generated by tools/connect-directory.mjs --write from the tool list the live server answers; the justification of each tool is hand-written and kept.',
    tool_count: reg.length,
    tools: reg.map((t) => ({ name: t.name, title: t.title, ...t.annotations, justification: old.get(t.name)?.justification ?? 'TODO' })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reg = await registry();
  if (process.argv.includes('--write')) {
    const file = path.join(DIR, FILES.tools);
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    fs.writeFileSync(file, JSON.stringify(rebuildTools(old, reg), null, 2) + '\n');
    console.log(`wrote ${path.relative(ROOT, file)}: ${reg.length} tools`);
  } else {
    const problems = check(load(), reg);
    console.log(problems.length ? problems.map((x) => '  - ' + x).join('\n') + `\n${problems.length} problem(s)` : `ok: ${reg.length} tools, both listings match`);
    process.exit(problems.length ? 1 : 0);
  }
}
