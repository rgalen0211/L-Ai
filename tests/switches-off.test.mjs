// CLOUD-SITE 11-02 round 2 (task 4): ONE check that the site's switches (assets/ryagram-config.js) default OFF and that no page shows a feature whose switch is OFF.
//  1. Every switch is false, except the ones Ryan turned on (ON_BY_RYAN below; each was a recorded yes). A NEW switch must ship false: adding it as true fails here until it is added to the list.
//  2. Every place the served code reads an OFF switch reads it STRICTLY (=== true, or !== true for the "is it off" form): a missing switch, a typo, "true" or 1 never turns a feature on.
//  3. Every OFF switch is wired to something (read in code, named by a data-flag, or named in a table's flag field), except the two that are permanently off and read by nothing.
//  4. Every page entry marked data-flag is hidden in the HTML itself and names real switches; every stand-alone switched page keeps its content hidden in the HTML and says it is not available.
//  5. With the shipped config, the help page's switch code shows no entry that needs an OFF switch, and the stand-alone pages' own on() answers false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// The switches Ryan has turned ON (each with his recorded yes in the config's comment or the commit that turned it on). Anything else must be false.
const ON_BY_RYAN = ['visitCounting', 'credits', 'payments', 'stripeTestMode', 'accountTools', 'passwordReset', 'inviteSignup', 'opsTools', 'filmRequests', 'guidedBuilder',
  'lookEditor', 'renderOrders', 'connectAi', 'aiFirst', 'departments', 'desktopApp'];
// Permanently off and read by nothing (the config says so; tests/app-catalog.test.cjs fails if either turns true).
// Switches that hold the string 'account' (on only for accounts an admin named; assets/app-switches.js featureOn). Each must be read through featureOn, and nothing else may be a string.
const ACCOUNT_SWITCHES = ['myFilms', 'intake'];
const UNREAD_ON_PURPOSE = ['catalog', 'catalogComingSoon'];

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ');

test('SWITCHES: every switch defaults OFF unless Ryan turned it on, every OFF switch is read strictly and hidden in the HTML, and no page shows an OFF feature', () => {
  const win = {}; vm.runInNewContext(read('assets/ryagram-config.js'), { window: win });
  const cfg = win.ryagramConfig;
  const switches = Object.entries(cfg).filter(([, v]) => typeof v === 'boolean');
  assert.ok(switches.length > 30, 'the config has its switches');
  for (const [k, v] of Object.entries(cfg)) if (!['supabaseUrl', 'supabaseKey'].includes(k)) {
    if (ACCOUNT_SWITCHES.includes(k)) assert.equal(v, 'account', `${k} must be exactly 'account' (or false to undo)`);
    else assert.equal(typeof v, 'boolean', `${k} must be true or false, never a string or a number`);
  }
  const allAssets = execFileSync('git', ['ls-files', 'assets/*.js'], { cwd: root, encoding: 'utf8' }).split(String.fromCharCode(10)).filter(f => f && f !== 'assets/ryagram-config.js').map(f => read(f)).join(String.fromCharCode(10));
  for (const k of ACCOUNT_SWITCHES) assert.ok(allAssets.includes(`featureOn('${k}')`), `${k} is 'account' but nothing reads it through featureOn`);

  // 1. OFF by default
  for (const [k, v] of switches) if (v === true) assert.ok(ON_BY_RYAN.includes(k), `${k} is ON in the config but is not one Ryan turned on: a new switch ships false`);
  for (const k of ON_BY_RYAN) assert.ok(k in cfg, `${k} is listed as on but no longer exists: remove it from ON_BY_RYAN`);
  const off = switches.filter(([, v]) => v === false).map(([k]) => k);

  // the served files: the site's scripts and pages (not tests, tools, functions or node_modules)
  const files = execFileSync('git', ['ls-files', 'assets/*.js', '*.html'], { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f && !/^(supabase|node_modules|tests|tools)\//.test(f) && f !== 'assets/ryagram-config.js');
  const code = Object.fromEntries(files.map(f => [f, read(f)]));
  const bare = Object.fromEntries(files.map(f => [f, stripComments(code[f])]));

  // 2. strict reads only, for every OFF switch, in every served file
  const loose = [];
  for (const [f, src] of Object.entries(bare)) {
    if (f === 'assets/app-switches.js') continue;            // the one helper that reads a switch by name: tests/account-switch.test.mjs holds it to === true / === 'account' plus a list check
    for (const k of off) {
      for (const m of src.matchAll(new RegExp(`(?:ryagramConfig|\\bcfg|\\bconfig)\\s*(?:\\?\\.|\\.)\\s*${k}\\b([^\\n]{0,12})`, 'g'))) if (!/^\s*[!=]==\s*true\b/.test(m[1])) loose.push(`${f}: .${k}${m[1]}`);
    }
    for (const m of src.matchAll(/(?:ryagramConfig\??\.?|\bcfg)\[[^\]]+\]([^\n]{0,12})/g)) if (!/^\s*===\s*true\b/.test(m[1])) loose.push(`${f}: a switch read by name without === true: ${m[0]}`);
  }
  assert.deepEqual(loose, [], 'an OFF switch is read loosely somewhere (use === true)');

  // 3. every OFF switch is wired to something
  const all = Object.values(bare).join('\n'), html = files.filter(f => f.endsWith('.html')).map(f => code[f]).join('\n');
  for (const k of off) {
    if (UNREAD_ON_PURPOSE.includes(k)) { assert.ok(!new RegExp(`\\.${k}\\s*===\\s*true`).test(all), `${k} is meant to be read by nothing`); continue; }
    const wired = new RegExp(`\\.${k}\\s*[!=]==\\s*true`).test(all) || new RegExp(`featureOn\\('${k}'\\)`).test(all) || new RegExp(`flag:\\s*'${k}'`).test(all) || new RegExp(`data-flag="[^"]*\\b${k}\\b`).test(html);
    assert.ok(wired, `${k} is in the config but nothing reads it: a switch that does nothing`);
  }

  // 4. the HTML keeps OFF things hidden without any script
  const known = new Set(switches.map(([k]) => k));
  for (const f of files.filter(x => x.endsWith('.html'))) {
    for (const m of code[f].matchAll(/<([a-z]+)\b([^>]*\bdata-flag="([^"]*)"[^>]*)>/g)) {
      assert.match(m[2], /\bhidden\b/, `${f}: <${m[1]} data-flag="${m[3]}"> must carry hidden in the HTML`);
      for (const n of m[3].split(/\s+/).filter(Boolean)) assert.ok(known.has(n), `${f}: data-flag names "${n}", which is not a switch`);
    }
    if (/<p id="not-available">/.test(code[f])) {
      assert.match(code[f], /<div id="[a-z-]+" hidden>/, `${f}: a switched page keeps its content hidden in the HTML`);
      const scripts = [...code[f].matchAll(/src="\/(assets\/[a-z0-9-]+\.js)\?v=/g)].map(x => x[1]).filter(s => s !== 'assets/ryagram-config.js'), script = scripts[scripts.length - 1];
      const flag = (/(?:\bcfg|ryagramConfig)\??\.([a-zA-Z]+) === true/.exec(code[script] || '') || [])[1];
      assert.ok(flag && off.includes(flag), `${f}: its switch (${flag}) is OFF`);
      // 5b. the page's own switch test answers false with the shipped config
      const w = { ryagramConfig: cfg }, ctx = vm.createContext({ window: w, document: { getElementById: () => null } });
      for (const sc of scripts) vm.runInContext(code[sc], ctx);                                // the page's own scripts, in its order, with the shipped config
      const api = Object.values(w).find(v => v && typeof v.on === 'function');
      if (api) assert.equal(api.on(cfg), false, `${f}: on() with the shipped config`);
    }
  }

  // 5a. the help page, run with the shipped config: no entry that needs an OFF switch is shown
  const helpEls = [...read('help/index.html').matchAll(/data-flag="([^"]*)"/g)].map(m => ({ flags: m[1], hidden: true, getAttribute() { return this.flags; } }));
  vm.runInNewContext(read('assets/help-flags.js'), { window: { ryagramConfig: cfg }, document: { querySelectorAll: () => helpEls } });
  for (const e of helpEls) if (e.flags.split(/\s+/).some(n => off.includes(n))) assert.equal(e.hidden, true, `help entry "${e.flags}" is shown although a switch it needs is OFF`);
  assert.ok(helpEls.some(e => e.flags === 'connectAi' && e.hidden === false), 'control: an entry whose switch is ON is shown');
});
