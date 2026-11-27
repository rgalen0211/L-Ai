// THE PUBLIC WORDS LINT (CONNECT 11-27): every word a person or their AI reads from the connector's tools, held to Ryan's rules.
// Scope: the title and the description of EVERY tool in TOOLS (listed or not), and the refusal words (text, and the strings of data) of every department tool in every state a refusal can come from
// (not signed in, no permission, department closed, switch list unreadable, bad arguments, a limit reached, not the person's project, the status call not available).
// The rules (each has a planted fault in tests/connect_words_lint_mutants.mjs and a self-check at the end of this file):
//   money      no price or money sign
//   credit     no credit amount (a number of credits); the code states none in any tool description
//   free       no "free" unless it is a listed case below (a read-only tool saying it, or a named exception whose truth the code shows)
//   date       no promise of a date or a time
//   soon       no "soon" in a tool description unless a listed case below (a refusal may never say it)
//   jargon     none of: scope, token, JWT, RPC, schema, errcode, PT###, SQLSTATE, Postgres, supabase
//   address    no raw web address, email or IP address
//   names      never the words for the old product names
// THE ALLOWED CASES ARE LISTED BELOW IN ONE PLACE. Each is one tool, one rule, one exact sentence, and the reason. A case that no longer matches fails (a stale allowance), so the list cannot grow silently.
// The ones marked REVIEW break Ryan's plain rule as written and are listed so he can decide; they are not new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);
const RSQUO = String.fromCharCode(0x2019);                                 // the typographic apostrophe, written without an escape in the source

// ---------------------------------------------------------------- the rules
const RULES = [
  { id: 'money', re: /[$€£¥]|\bUSD\b|\bdollars?\b|\bcents?\b|\bprices?\b|\bpricing\b/i },
  { id: 'credit', re: /\b(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twenty|forty|hundred)\s+(more\s+)?credits?\b|\bcredits?\s*[:=]\s*\d/i },
  { id: 'free', re: /\bfree\b/i },
  { id: 'date', re: /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b20(2[5-9]|[3-9]\d)\b|\b(mon|tues?|wednes|thurs?|fri|satur|sun)day\b|\b(tomorrow|tonight)\b|\bnext (week|month|year|friday)\b|\bthis (week|month|year|weekend)\b|\bin \d+ (days?|weeks?|months?)\b|\bwithin \d+ (days?|weeks?|months?)\b|\bby the end of\b|\bQ[1-4]\b|\bcoming (in|on|next)\b|\bwill (be )?(open|ready|available|live|launch\w*)\b/i },
  { id: 'soon', re: /\bsoon\b/i },
  { id: 'jargon', re: /\b(scopes?|tokens?|JWT|RPC|schemas?|errcode|PT\d{3}|SQLSTATE|postgres(ql)?|supabase)\b/i },
  { id: 'address', re: /https?:\/\/|\bwww\.|[\w.+-]+@[\w-]+(\.[\w-]+)+|\b\d{1,3}(\.\d{1,3}){3}\b|\b[a-z0-9-]+\.(com|org|net|gov|edu|io|dev|app|co|us|uk|test)\b/i },
  { id: 'names', re: new RegExp(`\\bL[-.'${RSQUO}]?A[iI]\\b|\\b[Mm]ind ?[Ww]ise\\b`) },           // case matters: "all AI" is not the old name
];
const RULE = Object.fromEntries(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------- the allowed cases: tool, part, rule, the exact sentence that holds the word, and why
const ALLOWED = [
  // free: a read-only tool whose "free" is true because the tool reads and starts nothing (the department tools prove it in tests/connect-hard-rule-1127.test.mjs: the ledger is untouched)
  { tool: 'dataset_info', part: 'description', rule: 'free', sentence: 'Read-only, free, nothing started.', readOnly: true },
  { tool: 'open_compilations_page', part: 'description', rule: 'free', sentence: 'Read-only and free; it starts nothing.', readOnly: true },
  { tool: 'get_cost_estimate', part: 'description', rule: 'free', sentence: 'Read-only and free: nothing is started, no credit is held and nothing needs confirming.', readOnly: true },
  { tool: 'get_cost_estimate', part: 'description', rule: 'free', sentence: 'a connection can start only the free ones', readOnly: true },
  { tool: 'open_ryagram_home', part: 'description', rule: 'free', sentence: 'Read-only, free, nothing is started.', readOnly: true },
  // free: NOT read-only tools; each is true by the code and is a named exception to "free only if read-only"
  { tool: 'create_project', part: 'description', rule: 'free', sentence: 'Starts a new, empty film project. Free.', readOnly: false, exception: 'creating a project holds and spends no credit (checked below in the stand-in world)' },
  { tool: 'make_contact_sheet', part: 'description', rule: 'free', sentence: 'which also runs Ryagram\'s full correctness checks. Free.', readOnly: false, exception: 'a contact sheet is free by the code\'s own quote, and the tool refuses anything that would cost credits' },
  { tool: 'make_preview', part: 'description', rule: 'free', sentence: 'The first few per project are free', readOnly: false, exception: 'the first previews of a project are free by the code\'s own quote; a costing one is refused' },
  // money: the sentence tells the AI NOT to promise a price
  { tool: 'open_ryagram_home', part: 'description', rule: 'money', sentence: 'say so, never promise a date or a price.', readOnly: true },
  // soon: REVIEW, existing: the home panel and suggest_next_step describe the departments that are still "coming soon"; the word is the product's own status word
  { tool: 'suggest_next_step', part: 'description', rule: 'soon', sentence: 'says plainly when something is coming soon', readOnly: true, review: true },
  { tool: 'open_ryagram_home', part: 'description', rule: 'soon', sentence: 'and what is coming soon, with a line about each.', readOnly: true, review: true },
  { tool: 'open_ryagram_home', part: 'description', rule: 'soon', sentence: 'A coming-soon department has nothing to start', readOnly: true, review: true },
  // jargon: REVIEW, existing: the story format is named by its own name; the second is the AI's own usage unit
  { tool: 'get_story_schema', part: 'description', rule: 'jargon', sentence: 'the story format (a JSON Schema)', readOnly: true, review: true },
  { tool: 'get_story_schema', part: 'description', rule: 'jargon', sentence: 'against exactly this schema and these rules', readOnly: true, review: true },
  { tool: 'submit_prepared_data', part: 'description', rule: 'jargon', sentence: 'costs the person\'s AI plan tokens', readOnly: false, review: true },
];

/** The rule hits in one text, minus the ones an ALLOWED case covers. `used` collects the allowed cases that really covered a hit. */
export function lint(text, { tool, part, rules = RULES.map((r) => r.id), used = new Set() }) {
  const found = [];
  for (const id of rules) {
    const re = new RegExp(RULE[id].re.source, RULE[id].re.flags.includes('g') ? RULE[id].re.flags : RULE[id].re.flags + 'g');
    for (const m of text.matchAll(re)) {
      const covered = ALLOWED.find((a) => {
        if (a.tool !== tool || a.part !== part || a.rule !== id) return false;
        const at = text.indexOf(a.sentence);
        return at !== -1 && m.index >= at && m.index + m[0].length <= at + a.sentence.length;
      });
      if (covered) used.add(covered); else found.push({ rule: id, match: m[0], at: m.index, context: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ') });
    }
  }
  return found;
}

// ---------------------------------------------------------------- the stand-in world, to collect the refusal words of the department tools
const DEPT_TOOLS = [
  ['get_compilation_status', (id) => ({ project_id: id })], ['open_compilations_page', () => ({})],
  ['list_games', () => ({})], ['open_games_page', () => ({})],
];
const SWITCHES = ['compilations', 'games'];
function world({ switches = SWITCHES, scopes = ['read', 'write'], desktop = false } = {}) {
  const w = new FakeWorld();
  const P = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
  w.addUser(P.userId, 'alice@example.test', 100); w.invite(P.userId, P.clientId, scopes);
  const u = w.users.get(P.userId); u.switches = switches; u.desktopApp = desktop;
  const env = (wrap, hit) => {
    const d = w.data(P.userId);
    const data = wrap ? new Proxy(d, { get: (t, k) => (k in wrap ? wrap[k] : t[k]) }) : d;
    const policy = w.policy(); if (hit) policy.hit = hit;
    return { data, policy, deps: { compile } };
  };
  return { w, u, P, env, call: (name, args, wrap, hit) => callTool(name, args, P, env(wrap, hit)) };
}
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

/** Every refusal a department tool can give, as { tool, state, text, data } */
async function refusals() {
  const out = [];
  for (const [name, args] of DEPT_TOOLS) {
    const add = (state, r) => { if (r.isError) out.push({ tool: name, state, text: r.text, data: r.data }); };
    const open = world({ desktop: true });
    const pid = (await open.call('create_project', { title: 'Compilation' })).data.project_id;
    const A = args(pid);
    add('closed', await world({ switches: [], desktop: false }).call(name, A));
    add('unreadable', await open.call(name, A, { switches: async () => { throw new Error('db down'); }, departments: async () => { throw new Error('db down'); }, whoami: async () => { throw new Error('db down'); } }));
    add('unreadable (not a list)', await world({ desktop: false }).call(name, A, { switches: async () => 'games' }));
    add('no permission', await world({ scopes: ['write'] }).call(name, A));
    const stranger = { tokenHash: 'h-x', userId: 'u-x', clientId: 'client-x' };
    add('not signed in', await callTool(name, A, stranger, open.env()));
    add('bad arguments', await open.call(name, { ...A, extra: 'x' }));
    add('bad id', await open.call(name, name === 'get_compilation_status' ? { project_id: 'not-an-id' } : { extra: 1 }));
    add('a limit', await open.call(name, A, undefined, async (p, bucket) => bucket === 'calls_acct' || bucket === 'calls'));
    add('the department limit', await open.call(name, A, undefined, async (p, bucket) => !/compilation_reads/.test(bucket)));
    add('not the person\'s project', await open.call(name, args('00000000-0000-4000-8000-0000000000aa')));
    add('status not available just now', await open.call(name, A, { compilationGet: undefined }));
    add('database function missing', await open.call(name, A, { compilationGet: async () => { throw Object.assign(new Error('function connect_compilation_get does not exist'), { code: 'unavailable' }); } }));
    add('unexpected failure', await open.call(name, A, { compilationGet: async () => { throw new Error('boom: select * from compilation_runs'); } }));
    add('closed, desktop app off, switch on, other dept', await world({ switches: SWITCHES.filter((s) => !name.includes(s.toLowerCase().slice(0, 4))), desktop: false }).call(name, A));
  }
  return out;
}

// ---------------------------------------------------------------- the lint over the tools
test('the allowed cases are well formed: one tool, one rule, one exact sentence, and the sentence is really in that tool\'s words', () => {
  for (const a of ALLOWED) {
    const t = TOOLS.find((x) => x.name === a.tool);
    assert.ok(t, a.tool + ' exists');
    assert.ok(t[a.part].includes(a.sentence), `${a.tool}.${a.part} no longer holds the allowed sentence: ${a.sentence}`);
    assert.ok(RULE[a.rule].re.test(a.sentence), `the allowed sentence has no ${a.rule} hit, so the case is stale: ${a.sentence}`);
    assert.equal(a.readOnly, t.readOnly, `${a.tool}: the case says readOnly ${a.readOnly} but the tool is ${t.readOnly}`);
    if (a.rule === 'free') assert.ok(a.readOnly === true || (a.exception && a.exception.length > 20), `${a.tool}: "free" on a tool that is not read-only needs a named exception`);
  }
  assert.equal(ALLOWED.filter((a) => a.rule === 'credit').length, 0, 'no credit amount is allowed anywhere: the code states none in any tool description');
  assert.equal(ALLOWED.filter((a) => a.rule === 'date' || a.rule === 'address' || a.rule === 'names').length, 0, 'no date, address or old name is allowed anywhere');
});

test('EVERY tool title and description passes the lint (only the listed allowed cases pass), and every allowed case is really used', () => {
  assert.ok(TOOLS.length > 30);
  const used = new Set(); const bad = [];
  for (const t of TOOLS) {
    for (const part of ['title', 'description']) {
      assert.equal(typeof t[part], 'string', `${t.name}.${part}`); assert.ok(t[part].trim().length > 3, `${t.name}.${part} is empty`);
      for (const f of lint(t[part], { tool: t.name, part, used })) bad.push(`${t.name}.${part} [${f.rule}] "${f.match}": ...${f.context}...`);
    }
  }
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
  const unused = ALLOWED.filter((a) => !used.has(a));
  assert.deepEqual(unused.map((a) => `${a.tool}: ${a.sentence}`), [], 'an allowed case that matches nothing is stale: remove it');
});

test('the words of the argument fields (what an AI reads in each argument\'s description) are held to the money, credit, date, address, jargon and name rules too', () => {
  // two plain uses: the format "https://" of the one address a person may name, and "price" as a verb
  const ARG_OK = [['request_download', '.properties.url.description', 'https://'], ['get_cost_estimate', '.properties.step.description', 'price']];
  const usedArg = new Set(); const bad = [];
  const walk = (v, tool, path) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, tool, path + '.' + k);
    else if (typeof v === 'string' && /description$/.test(path)) {
      for (const f of lint(v, { tool, part: path, rules: ['money', 'credit', 'date', 'address', 'jargon', 'names'] })) {
        const ok = ARG_OK.find(([t, p, m]) => t === tool && p === path && m === f.match);
        if (ok) usedArg.add(ok); else bad.push(`${tool}${path} [${f.rule}] "${f.match}"`);
      }
    }
  };
  for (const t of TOOLS) walk(t.inputSchema, t.name, '');
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.equal(usedArg.size, ARG_OK.length, 'a stale argument allowance');
});

test('every department tool\'s REFUSAL words (text and the words in its data) pass the lint, in every state a refusal can come from; no allowed case applies to a refusal', async () => {
  const all = await refusals();
  for (const [name] of DEPT_TOOLS) {
    const mine = all.filter((x) => x.tool === name);
    assert.ok(mine.length >= 6, `${name}: only ${mine.length} refusals were collected`);
    for (const s of ['closed', 'unreadable', 'no permission', 'not signed in', 'bad arguments']) assert.ok(mine.some((x) => x.state === s), `${name} has a "${s}" refusal`);
  }
  const bad = [];
  for (const r of all) {
    assert.ok(/\S{3}/.test(r.text) && !/undefined|\[object/.test(r.text), `${r.tool} ${r.state}: ${r.text}`);
    for (const f of lint(r.text, { tool: r.tool, part: 'refusal:' + r.state })) bad.push(`${r.tool} [${r.state}] text [${f.rule}] "${f.match}": ...${f.context}...`);
    for (const s of strings(r.data)) for (const f of lint(s, { tool: r.tool, part: 'refusal-data:' + r.state, rules: ['money', 'credit', 'free', 'date', 'jargon', 'address', 'names'] })) bad.push(`${r.tool} [${r.state}] data [${f.rule}] "${f.match}"`);
  }
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
  // the refusals of the closed departments say plainly that it is not open for this account
  for (const r of all.filter((x) => x.state === 'closed')) assert.match(r.text, /not (open|switched on|available)/i, r.tool);
});

test('the department tools\' DESCRIPTIONS say what they must (read-only, nothing started, no date promise) and none says a price', () => {
  for (const [name] of DEPT_TOOLS) {
    const t = TOOLS.find((x) => x.name === name);
    assert.match(t.description, /read-only|changes nothing/i, name);
    assert.match(t.description, /nothing is started|starts nothing|reads no place|changes nothing|nothing is chosen/i, name);
    assert.ok(!/\bsoon\b/i.test(t.description), name + ' says soon');
  }
});

test('"free" claimed on a tool that is not read-only is checked against a stand-in world: create_project leaves the ledger alone', async () => {
  const h = world({ desktop: true });
  const before = [h.u.credits, h.u.held, h.u.jobs.length];
  const r = await h.call('create_project', { title: 'A film' });
  assert.equal(r.isError, undefined, r.text);
  assert.deepEqual([h.u.credits, h.u.held, h.u.jobs.length], before);
  assert.ok(!(r.credits > 0));
});

// ---------------------------------------------------------------- the lint can see each fault (these must fail without the rule)
test('SELF-CHECK: each rule catches a planted violation and passes the plain version', () => {
  const T = { tool: 'planted', part: 'description' };
  const cases = [
    ['money', ['It costs $5.', 'It costs €5.', 'The price is low.', 'Only 5 dollars.', 'It costs £5.'], ['It changes nothing and costs nothing.']],
    ['credit', ['It uses 5 credits.', 'It takes two credits.', 'Credits: 5', 'About 40 credits'], ['A connection cannot spend credits.', 'The person has credits left.']],
    ['free', ['Free to use.', 'It is free.'], ['Nothing is spent.']],
    ['date', ['Opens 1 December 2026 or Dec 1.', 'It opens tomorrow.', 'Ready by the end of the month.', 'Coming next week.', 'On 2026-12-01.', 'Back in 3 days.', 'It will be available.', 'Open on Friday.', 'Coming in 2027.'], ['Years 2010, 2011 are examples.', 'Each waits 7 days.']],
    ['soon', ['More games soon.', 'Coming soon.'], ['Not open yet.']],
    ['jargon', ['Needs the read scope.', 'A JWT is sent.', 'Uses an RPC.', 'The schema says.', 'errcode 42', 'PT403 refused.', 'SQLSTATE 42501.', 'Postgres says.', 'supabase edge', 'The token ended.'], ['Needs permission to read.']],
    ['address', ['See https://example.com/x', 'Write to alice@example.test', 'At 10.0.0.1 it lives', 'Go to www.example.org', 'See ryagram.com'], ['Open Games in the top bar.', 'The U.S. National Archives, e.g. NASA.']],
    ['names', ['Made by L' + RSQUO + 'Ai.', "Made by L'Ai.", 'L-Ai says', 'MindWise says', 'Mind Wise'], ['Made by Ryagram.']],
  ];
  for (const [rule, bad, fine] of cases) {
    for (const s of bad) assert.ok(lint(s, { ...T, rules: [rule] }).length > 0, `${rule} should catch: ${s}`);
    for (const s of fine) assert.equal(lint(s, { ...T, rules: [rule] }).length, 0, `${rule} should pass: ${s}`);
  }
  // an allowed case covers only its own sentence, in its own tool
  assert.equal(lint('Starts a new, empty film project. Free. It is also free.', { tool: 'create_project', part: 'description', rules: ['free'] }).length, 1);
  assert.equal(lint('Starts a new, empty film project. Free.', { tool: 'create_film', part: 'description', rules: ['free'] }).length, 1);
});
