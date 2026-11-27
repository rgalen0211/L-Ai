// Checks tools/chat-editor/controls.json (the ONE control table of the live editor) against the code it describes, and FAILS when they disagree:
//   - an op in assets/app-editor-core.js (its OPS list) has no control entry                         -> "NO ENTRY for op ..."
//   - an entry names an op the core does not know (a planned entry may name plannedOp instead)       -> "UNKNOWN OP ..."
//   - a look key the core accepts (LOOK_KEYS) or a film-look key / text style / rule mode has no entry, or an entry names one the core does not
//   - an aiTool that is not in the connector's TOOLS list, or one whose input does not cover the op
//   - "inChat" that disagrees with the chat page as committed (supabase/functions/connect-core/editor_page.ts): a control the page does not hold, or a hidden one with no evidence for why
// It also computes the GAPS (op with no chat control, control with no AI tool, planned, on WEB's branch only, AI limit differs) and requires controls.json "knownGaps" to be exactly that list,
// so a new gap, or a closed one, is a deliberate edit.
//   node tools/chat-editor/controls_check.mjs            exits 1 on any problem        --gaps   prints the computed gap list        --table  prints the table
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..', '..');
export const GROUPS = ['history', 'clips', 'text', 'music', 'rules', 'look', 'film', 'view'];
export const KINDS = ['edit', 'history', 'view', 'film'];
export const STATUSES = ['exists', 'built-not-loaded', 'web-branch', 'planned'];
export const NEEDS = ['clip', 'track', 'film'];
export const MODES = ['data', 'compilation', 'both'];

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const arrayOf = (src, name) => { const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null; };
const same = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** The core, run the way the tests run it: its own source in a bare context. */
export function loadCore(coreSrc) {
  const window = {};
  vm.runInNewContext(coreSrc, { window, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
  return window.ryagramEditor;
}

/** What the connector's AI tools cover: the ops edit_tracks lists, and the data ops set_look / its 'unset' list. */
export function aiCoverage(tools) {
  const byName = new Map(tools.map(t => [t.name, t]));
  const covered = new Map();      // op -> tool name
  const et = byName.get('edit_tracks'), sl = byName.get('set_look');
  const props = et && et.inputSchema && et.inputSchema.properties && et.inputSchema.properties.ops && et.inputSchema.properties.ops.items && et.inputSchema.properties.ops.items.properties;
  if (props && props.op && Array.isArray(props.op.enum)) for (const o of props.op.enum) covered.set(o, 'edit_tracks');
  const sp = sl && sl.inputSchema && sl.inputSchema.properties;
  if (sp && sp.set) covered.set('set_look', 'set_look');
  if (sp && sp.unset) covered.set('unset_look', 'set_look');
  return { byName, covered, opProps: props || {} };
}

/**
 * @param {{controls:any, coreSrc:string, chatHtml:string, chatFiles:string[], tools:{name:string,inputSchema?:any}[], root?:string}} i
 * @returns {{problems:string[], gaps:string[]}}
 */
export function checkControls({ controls: doc, coreSrc, chatHtml, chatFiles, tools, root = ROOT }) {
  const problems = [], gaps = [];
  const bad = s => problems.push(s);
  if (!doc || doc.version !== 1) bad('controls.json must say "version": 1');
  const list = Array.isArray(doc && doc.controls) ? doc.controls : (bad('controls.json has no "controls" list'), []);
  const E = loadCore(coreSrc);
  const OPS = E.OPS, LOOK = Object.keys(E.LOOK_KEYS);
  const FILM = arrayOf(coreSrc, 'FILM_LOOK'), STYLES = arrayOf(coreSrc, 'STYLES'), MODES_R = arrayOf(coreSrc, 'RULE_MODES'), LYRIC = arrayOf(coreSrc, 'LYRIC_CARDS');
  for (const [n, v] of [['FILM_LOOK', FILM], ['STYLES', STYLES], ['RULE_MODES', MODES_R], ['LYRIC_CARDS', LYRIC]]) if (!v) bad(`could not read ${n} from the core`);
  const { byName, covered, opProps } = aiCoverage(tools);

  const ids = new Set();
  for (const c of list) {
    const at = `control "${c && c.id}"`;
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(c.id)) { bad(`${at}: id must be a lower-case name`); continue; }
    if (ids.has(c.id)) bad(`${at}: duplicate id`);
    ids.add(c.id);
    if (typeof c.label !== 'string' || !c.label.trim()) bad(`${at}: no label`);
    if (!GROUPS.includes(c.group)) bad(`${at}: group must be one of ${GROUPS.join(', ')}`);
    if (!KINDS.includes(c.kind)) bad(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (!STATUSES.includes(c.status)) bad(`${at}: status must be one of ${STATUSES.join(', ')}`);
    if (!NEEDS.includes(c.needs)) bad(`${at}: needs must be one of ${NEEDS.join(', ')}`);
    if (!MODES.includes(c.mode)) bad(`${at}: mode must be one of ${MODES.join(', ')}`);
    if (typeof c.inChat !== 'boolean') bad(`${at}: inChat must be true or false`);
    if (typeof c.undo !== 'boolean') bad(`${at}: undo must be true or false`);
    const planned = c.status === 'planned';

    // ---- the op
    if (planned) {
      if (c.op) bad(`${at}: a planned control names plannedOp, not op`);
      if (typeof c.plannedOp !== 'string' || !c.plannedOp) bad(`${at}: planned but no plannedOp`);
      else if (OPS.includes(c.plannedOp) && !c.plannedKey) bad(`${at}: plannedOp "${c.plannedOp}" is in the core now: make it a real control`);
      if (c.plannedKey && LOOK.includes(c.plannedKey)) bad(`${at}: plannedKey "${c.plannedKey}" is a look key the core accepts now: make it a real control`);
      if (!c.plannedBy || !c.plannedSource) bad(`${at}: planned controls say who plans them (plannedBy) and where (plannedSource)`);
      if (c.inChat !== false) bad(`${at}: a planned control is not in the chat panel`);
      gaps.push(`planned:${c.id}`);
    } else if (c.kind === 'edit') {
      if (typeof c.op !== 'string' || !OPS.includes(c.op)) bad(`UNKNOWN OP "${c.op}" in ${at}: the core's ops are ${OPS.join(', ')}`);
      if (!c.example || c.example.op !== c.op) bad(`${at}: "example" must be an op of "${c.op}"`);
      if (!c.refuse || c.refuse.op !== c.op) bad(`${at}: "refuse" must be an op of "${c.op}" the core refuses`);
      if (c.undo !== true) bad(`${at}: an edit control's change must be undoable (undo: true)`);
    } else if (c.op !== null) bad(`${at}: a ${c.kind} control applies no op (op must be null)`);

    // ---- look keys, film-look keys, styles, modes
    const pEnum = n => (c.params && c.params[n] && Array.isArray(c.params[n].enum) ? c.params[n].enum : null);
    if (!planned && c.op === 'set_look' || c.op === 'unset_look') {
      const keys = pEnum('key');
      if (!keys) bad(`${at}: a look control names its key(s) in params.key.enum`);
      else for (const k of keys) if (!LOOK.includes(k)) bad(`${at}: look key "${k}" is not one the core accepts (${LOOK.join(', ')})`);
    }
    if (c.op === 'set_film_look') {
      const keys = pEnum('key');
      if (!keys || keys.length !== 1) bad(`${at}: a film-look control names exactly one key`);
      else if (FILM && !FILM.includes(keys[0])) bad(`${at}: film-look key "${keys[0]}" is not one the core accepts (${FILM.join(', ')})`);
      else if (keys[0] === 'theme' && !same(pEnum('value') || [], ['dark', 'light'])) bad(`${at}: theme takes dark or light`);
      else if (keys[0] === 'lyric_card' && LYRIC && !same(pEnum('value') || [], LYRIC)) bad(`${at}: the lyric card takes ${LYRIC.join(', ')}`);
    }
    if (c.op === 'set_clip_style' && STYLES && !same(pEnum('style') || [], STYLES)) bad(`${at}: the text styles are ${STYLES.join(', ')}`);
    if (c.op === 'set_rule' && MODES_R && !same(pEnum('mode') || [], MODES_R)) bad(`${at}: the rule modes are ${MODES_R.join(', ')}`);

    // ---- the AI tool
    if (c.aiTool != null) {
      if (!byName.has(c.aiTool)) bad(`${at}: aiTool "${c.aiTool}" is not in the connector's TOOLS list`);
      else if (c.kind === 'edit' && !planned && covered.get(c.op) !== c.aiTool) bad(`${at}: tool "${c.aiTool}" does not take op "${c.op}" (the tools take: ${[...covered].map(([o, t]) => `${o} via ${t}`).join(', ')})`);
      if (!planned && c.aiTool === 'edit_tracks' && c.op === 'set_film_look' && opProps.key && Array.isArray(opProps.key.enum) && c.params && c.params.key && c.params.key.enum && !opProps.key.enum.includes(c.params.key.enum[0])) {
        gaps.push(`ai-tool-refuses:${c.id} (the core and the TypeScript twin take "${c.params.key.enum[0]}" but edit_tracks' key list does not)`);
      }
      for (const [n, p] of Object.entries(c.params || {})) {
        if (c.aiTool === 'edit_tracks' && p.probe && opProps[n]) {
          if (opProps[n].minimum !== undefined && opProps[n].minimum !== p.min) bad(`${at}: ${n} minimum is ${p.min} here and ${opProps[n].minimum} in the AI tool`);
          if (opProps[n].maximum !== undefined && opProps[n].maximum !== p.max) bad(`${at}: ${n} maximum is ${p.max} here and ${opProps[n].maximum} in the AI tool`);
        }
        if (c.aiTool === 'edit_tracks' && p.maxLen && opProps[n] && opProps[n].maxLength !== undefined && opProps[n].maxLength !== p.maxLen) gaps.push(`ai-limit-differs:${c.id}.${n} (panel ${p.maxLen}, AI tool ${opProps[n].maxLength})`);
      }
    } else {
      if (c.kind === 'edit' && !planned) { bad(`${at}: an edit control needs an AI tool (aiTool)`); gaps.push(`no-ai-twin:${c.id}`); }
      if (!c.aiWhy && !c.aiToolPlanned) bad(`${at}: no aiTool and no aiWhy/aiToolPlanned: say why`);
    }
    if (c.aiToolPlanned) {
      gaps.push(`ai-tool-planned:${c.id} -> ${c.aiToolPlanned}`);
      if (byName.has(c.aiToolPlanned)) bad(`${at}: aiToolPlanned "${c.aiToolPlanned}" exists now: set aiTool`);
    }

    // ---- the source and the chat panel
    if (planned) continue;
    const src = c.source;
    if (!src || typeof src.file !== 'string' || typeof src.snippet !== 'string') { bad(`${at}: source needs {file, snippet}`); continue; }
    let file = null;
    try { file = read(root, src.file); } catch { bad(`${at}: source file ${src.file} does not exist`); continue; }
    const inFile = file.includes(src.snippet);
    if (c.status !== 'web-branch' && !inFile) bad(`${at}: the snippet ${JSON.stringify(src.snippet)} is not in ${src.file} (the control moved or was renamed)`);
    const built = chatFiles.includes(src.file);
    if (c.status === 'web-branch') {
      const there = chatHtml.includes(src.snippet);
      if (there !== c.inChat) bad(`${at}: it is ${there ? 'IN' : 'NOT in'} the chat page as committed, so inChat must be ${there}`);
      if (there) gaps.push(`web-branch-now-in-tree:${c.id}`);      // merged: make the status 'exists'
      else gaps.push(`web-branch-not-in-chat:${c.id}`);
      if (!c.web || !c.web.branch || !c.web.head) bad(`${at}: a web-branch control names the branch and its head`);
    } else if (!built) {
      if (c.inChat) bad(`${at}: ${src.file} is not a file the chat page is built from, so inChat must be false`);
      if (!c.inChatGate || c.inChatGate.notBuilt !== src.file) bad(`${at}: say it with inChatGate {"notBuilt": "${src.file}"}`);
    } else {
      if (!chatHtml.includes(src.snippet)) bad(`${at}: the snippet is in ${src.file} but not in the chat page as committed (regenerate it: node tools/build-chat-editor.mjs)`);
      if (!c.inChat) {
        const g = c.inChatGate;
        if (g && g.notBuilt) { /* hidden because the file that would show it is not part of the chat page: checked below */ }
        else if (!g || typeof g.file !== 'string' || typeof g.snippet !== 'string') bad(`${at}: a hidden control needs inChatGate {file, snippet} as evidence`);
        else {
          let gf = ''; try { gf = read(root, g.file); } catch { bad(`${at}: gate file ${g.file} does not exist`); }
          if (!gf.includes(g.snippet)) bad(`${at}: the gate ${JSON.stringify(g.snippet)} is not in ${g.file}`);
          if (!chatFiles.includes(g.file)) bad(`${at}: the gate file ${g.file} is not part of the chat page`);
        }
      }
    }
    if (c.inChat === false && c.kind === 'edit') gaps.push(`not-in-chat:${c.id}`);
    if (c.inChat === false && (typeof c.inChatWhy !== 'string' || !c.inChatWhy.trim())) bad(`${at}: not in the chat panel: say why (inChatWhy)`);
    if (c.inChatGate && c.inChatGate.notBuilt) {
      if (chatFiles.includes(c.inChatGate.notBuilt)) bad(`${at}: ${c.inChatGate.notBuilt} IS part of the chat page now: the control may be there`);
      if (!fs.existsSync(path.join(root, c.inChatGate.notBuilt))) bad(`${at}: ${c.inChatGate.notBuilt} does not exist`);
    }
  }

  // ---- every op and every key has an entry
  const real = list.filter(c => c && c.status !== 'planned' && c.kind === 'edit');
  for (const op of OPS) {
    const has = real.filter(c => c.op === op);
    if (!has.length) bad(`NO ENTRY for op "${op}": the core knows it and controls.json has no control for it`);
    else if (!has.some(c => c.inChat)) gaps.push(`no-chat-control:${op}`);
  }
  const covers = (op, n, vals) => { const seen = new Set(); for (const c of real.filter(x => x.op === op)) for (const v of (c.params && c.params[n] && c.params[n].enum) || []) seen.add(v); return vals.filter(v => !seen.has(v)); };
  for (const k of covers('set_look', 'key', LOOK)) bad(`NO ENTRY for look key "${k}" (set_look)`);
  if (FILM) for (const k of covers('set_film_look', 'key', FILM)) bad(`NO ENTRY for film-look key "${k}" (set_film_look)`);
  if (LYRIC && !real.some(c => c.op === 'set_film_look' && c.params.key.enum[0] === 'lyric_card')) bad('NO ENTRY for the lyric card');
  for (const op of OPS) if (!covered.has(op)) { bad(`NO AI TOOL covers op "${op}" (edit_tracks lists: ${[...covered.keys()].join(', ')})`); gaps.push(`no-ai-tool:${op}`); }
  for (const op of covered.keys()) if (!OPS.includes(op)) bad(`UNKNOWN OP "${op}": an AI tool takes an op the core does not know`);

  const known = Array.isArray(doc && doc.knownGaps) ? doc.knownGaps : null;
  if (!known) bad('controls.json needs a "knownGaps" list (node tools/chat-editor/controls_check.mjs --gaps)');
  else {
    for (const g of gaps) if (!known.includes(g)) bad(`NEW GAP not listed in knownGaps: ${g}`);
    for (const g of known) if (!gaps.includes(g)) bad(`knownGaps lists a gap that is closed or gone: ${g}`);
  }
  return { problems, gaps: [...new Set(gaps)].sort() };
}

/** Load the real inputs (committed files, the real TOOLS list and chat page) and check them. */
export async function checkRepo(root = ROOT) {
  const build = await import(pathToFileURL(path.join(root, 'tools', 'build-chat-editor.mjs')).href);
  const { TOOLS } = await import(pathToFileURL(path.join(root, 'supabase/functions/connect-core/tools.ts')).href);
  const { EDITOR_HTML } = await import(pathToFileURL(path.join(root, 'supabase/functions/connect-core/editor_page.ts')).href);
  const controls = JSON.parse(fs.readFileSync(path.join(root, 'tools/chat-editor/controls.json'), 'utf8'));
  const r = checkControls({ controls, coreSrc: read(root, 'assets/app-editor-core.js'), chatHtml: EDITOR_HTML, chatFiles: [...build.JS, ...build.CSS], tools: TOOLS, root });
  return { ...r, controls, coreOps: loadCore(read(root, 'assets/app-editor-core.js')).OPS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await checkRepo();
  if (process.argv.includes('--gaps')) { console.log(JSON.stringify(r.gaps, null, 2)); }
  else if (process.argv.includes('--table')) {
    for (const c of r.controls.controls) console.log([c.id, c.label, c.op || c.plannedOp || '-', c.inChat ? 'in chat' : 'not in chat', c.aiTool || c.aiToolPlanned || '-', c.status].join(' | '));
  }
  if (r.problems.length) { for (const p of r.problems) console.error('FAIL ' + p); process.exit(1); }
  console.log(`ok: ${r.controls.controls.length} controls, ${r.coreOps.length} ops, ${r.gaps.length} known gaps`);
}
