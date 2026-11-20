// The in-chat panels share ONE look with the site (Ryan 2026-11-20): WEB's design files are the source, tools/build-chat-look.mjs copies the tokens and shared components
// into supabase/functions/connect-core/chat_look.ts, and the panels import only that. These tests are the DRIFT guard: a change to the site's tokens that is not built into the chat,
// a hand edit of the generated file, a colour written by hand in the chat layer, or a vendored design copy that went stale, each fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, layoutProblems, minify, rules, siteDrift } from '../tools/build-chat-look.mjs';
import * as look from '../supabase/functions/connect-core/chat_look.ts';
import { homeHtml } from '../supabase/functions/connect-core/home_panel.ts';
import { cardHtml } from '../supabase/functions/connect-core/mcp_app.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

test('chat_look.ts is exactly what the design sources build (the drift test)', () => {
  const r = build();
  assert.deepEqual(r.problems, [], r.problems.join('; '));
  assert.equal(rd('supabase/functions/connect-core/chat_look.ts'), r.text, 'chat_look.ts is not what the sources build: run node tools/build-chat-look.mjs');
  for (const part of ['tokens', 'controls', 'scroll', 'flip', 'base', 'home', 'card', 'editor']) assert.ok(look.CHAT_CSS[part] && look.CHAT_CSS[part].length > 100, 'part ' + part + ' is there');
  assert.throws(() => look.chatCss('nope'), /no such part/);
});

test('the chat carries the site\'s own tokens, byte for byte, not a retyped copy', () => {
  const src = rd(fs.existsSync(path.join(ROOT, 'assets/ds.css')) ? 'assets/ds.css' : 'tools/chat-look/source/ds.css');
  const root = rules(src).find((x) => x.startsWith(':root'));
  assert.ok(root, 'the site has a :root block');
  assert.ok(look.CHAT_CSS.tokens.startsWith(minify(root)), 'the chat\'s :root is the site\'s :root');
  for (const t of ['--accent', '--bg-2', '--ink', '--radius', '--s4', '--serif', '--ok', '--glow']) assert.ok(look.CHAT_LOOK_TOKENS.includes(t), t + ' is a token');
  for (const sel of ['.btn.primary', '.badge.soon', '.flip-viewport', '.flip-dot']) assert.ok(look.chatCss('controls', 'flip', 'scroll').includes(sel), sel + ' comes from the site');
});

test('the vendored design copy is not stale: once the site lifts its files into assets/, they must be the same', () => {
  for (const f of ['ds.css', 'ds-v11.css']) {
    if (!fs.existsSync(path.join(ROOT, 'assets', f))) continue;
    assert.equal(rd('assets/' + f), rd('tools/chat-look/source/' + f), `assets/${f} differs from tools/chat-look/source/${f}`);
  }
});

test('the chat layer may use only the site\'s tokens, no colour of its own, and nothing that loads or draws a dashed field', () => {
  const shared = rules(rd('tools/chat-look/source/ds.css')).concat(rules(rd('tools/chat-look/source/ds-v11.css'))).join('\n');
  const clean = rd('tools/chat-look/chat-ui.css');
  assert.deepEqual(layoutProblems(clean, shared), []);
  assert.match(layoutProblems(clean + '\n.x{color:#ff0000}', shared).join(), /colour of its own/);
  assert.match(layoutProblems(clean + '\n.x{color:rgba(1,2,3,.5)}', shared).join(), /colour of its own/);
  assert.match(layoutProblems(clean + '\n.x{color:var(--not-a-token)}', shared).join(), /tokens the site does not define/);
  assert.match(layoutProblems(clean + '\n.x{background:url(a.png)}', shared).join(), /url\(\)/);
  assert.match(layoutProblems(clean + '\n.x{border:1px dashed red}', shared).join(), /dashed/);
  assert.deepEqual(layoutProblems(clean + '\n.x{background:color-mix(in srgb,var(--accent) 20%,transparent)}', shared), [], 'color-mix of a token is allowed');
});

test('the home panel is drawn with the generated look and writes no colour or token of its own', () => {
  const html = homeHtml('https://uselai.com/app/');
  assert.ok(html.includes(look.chatCss('tokens', 'controls', 'flip', 'base', 'home')), 'the page carries the generated look (the parts it uses)');
  assert.ok(!html.includes(look.CHAT_CSS.editor) && !html.includes(look.CHAT_CSS.card), 'and not the parts of the other panels');
  const src = rd('supabase/functions/connect-core/home_panel.ts');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(src), 'home_panel.ts writes no colour');
  assert.ok(/import \{[^}]*chatCss[^}]*\} from "\.\/chat_look\.ts"/.test(src), 'it imports the look from the one generated file');
});

test('the account card is drawn with the generated look, only the parts it uses, and writes no colour of its own', () => {
  const html = cardHtml('https://uselai.com/app/');
  assert.ok(html.includes(look.chatCss('tokens', 'controls', 'base', 'card')), 'the page carries the generated look (the parts it uses)');
  assert.ok(!html.includes(look.CHAT_CSS.flip) && !html.includes(look.CHAT_CSS.editor) && !html.includes(look.CHAT_CSS.home), 'and not the parts of the other panels');
  const src = rd('supabase/functions/connect-core/mcp_app.ts');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(src.replace(/\/\/.*$/gm, '')), 'mcp_app.ts writes no colour');
  assert.ok(/import \{[^}]*chatCss[^}]*\} from "\.\/chat_look\.ts"/.test(src), 'it imports the look from the one generated file');
});

test('siteDrift compares the chat\'s tokens with the site sheet by effective value: a later declaration wins, a changed or missing token fails, extra site tokens are information', () => {
  const chat = ':root{--a:#111111;--b:#222222;--c:1px}';
  const site = (body) => '/* note */ body.ryagram-ds.ryagram-look{' + body + ';color:var(--a);background:radial-gradient(1px 1px at 1px 1px,red,blue)}';
  assert.deepEqual(siteDrift(site('--a:#111111;--b:#222222;--c:1px;--extra:9'), chat), { problems: [], notCarried: ['--extra'] });
  assert.deepEqual(siteDrift(site('--a:#000000;--b:#222222;--c:1px;--a:#111111'), chat).problems, [], 'a later declaration of the same name wins, as in a browser');
  assert.match(siteDrift(site('--a:#111111;--b:#333333;--c:1px'), chat).problems.join(), /--b is #222222 in the chat but #333333/);
  assert.match(siteDrift(site('--a:#111111;--b:#222222'), chat).problems.join(), /--c is in the chat but not in the site/);
  assert.match(siteDrift('a{color:red}', chat).problems.join(), /no body\.ryagram-ds/);
});

test('the chat\'s tokens equal WEB\'s shipped sheet once assets/ryagram-ds.css is in the tree (until then this cannot run: see the top of tools/build-chat-look.mjs)', (t) => {
  if (!fs.existsSync(path.join(ROOT, 'assets/ryagram-ds.css'))) { t.diagnostic('assets/ryagram-ds.css is not in this tree: the token guard against the shipped sheet did NOT run here'); return; }
  const d = siteDrift(rd('assets/ryagram-ds.css'), look.CHAT_CSS.tokens);
  assert.deepEqual(d.problems, [], d.problems.join('; '));
});
