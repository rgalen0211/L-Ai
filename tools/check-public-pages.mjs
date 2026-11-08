// CLOUD-SITE 11-02 round 3 (task 2): every page the site serves, read from the files (no network, no browser): broken internal links and anchors, missing assets, images
// with no alt text, missing titles / language / viewport / description, a heading problem, draft or private pages that do not keep search engines away, and site-wide things
// a crawler sees (robots.txt, sitemap.xml, .nojekyll and therefore which Markdown files GitHub Pages most likely publishes as pages).
//   node tools/check-public-pages.mjs            prints the findings; exit 1 on any HARD finding (warnings never fail)
//   node tools/check-public-pages.mjs --write    also writes docs/PUBLIC-PAGES-REPORT-1102.md
// tests/public-pages-check.test.mjs runs check() and fails on any hard finding.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// Pages that must keep search engines away (drafts, private, not a destination). The same list as tests/public-pages.test.mjs, plus anything that says it is a draft.
export const NOINDEX_EXPECTED = ['connect-ai/index.html', 'game-tv/index.html', 'geo-demo/index.html', 'map-panel-demo/index.html', 'landing-drafts/song-films/index.html', 'landing-drafts/compilations/index.html',
  'directory-drafts/privacy/index.html', 'directory-drafts/terms/index.html', 'legal-drafts/privacy-policy.html', 'legal-drafts/terms.html', 'ai-content/index.html', 'terms/index.html',
  'thank-you.html', 'workflow-audit-thanks.html', '404.html', 'app/index.html', 'get-app/index.html'];

const attrsOf = (s) => { const a = {}; for (const m of s.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''; return a; };
const tagsOf = (html) => [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)].map((m) => ({ tag: m[1].toLowerCase(), a: attrsOf(m[2]) }));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** A site path to the file that serves it, or null. */
function fileFor(urlPath) {
  const p = decodeURIComponent(urlPath.replace(/^\//, ''));
  if (p === '') return 'index.html';
  if (p.endsWith('/')) return exists(p + 'index.html') ? p + 'index.html' : null;
  if (exists(p) && fs.statSync(path.join(ROOT, p)).isFile()) return p;
  if (exists(p + '/index.html')) return p + '/index.html';
  if (exists(p + '.html')) return p + '.html';
  return null;
}

/** extraPages: { 'name.html': html } checked as if served (used by the test to plant faults without touching the files). */
export function check({ extraPages = {} } = {}) {
  const pages = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/^(supabase|node_modules|tests|tools)\//.test(f)).concat(Object.keys(extraPages));
  const hard = [], warn = [], info = {};
  const parsed = Object.fromEntries(pages.map((f) => { const html = f in extraPages ? extraPages[f] : read(f); return [f, { html, tags: tagsOf(html), text: textOf(html) }]; }));
  const ids = (f) => new Set(parsed[f] ? parsed[f].tags.map((t) => t.a.id).filter(Boolean) : tagsOf(read(f)).map((t) => t.a.id).filter(Boolean));
  const linkedFrom = {};
  // ids a page's own scripts create (h('section', { id: 'sources' ...}) and the like): an anchor to one is real once the script has run
  const scriptIds = (f) => { const out = new Set(); for (const m of read(f).matchAll(/<script[^>]*src="\/(assets\/[^"?]+\.js)/g)) if (exists(m[1])) for (const x of read(m[1]).matchAll(/\bid:\s*'([A-Za-z][\w-]*)'/g)) out.add(x[1]); return out; };

  for (const [f, { html, tags, text }] of Object.entries(parsed)) {
    const meta = Object.fromEntries(tags.filter((t) => t.tag === 'meta' && t.a.name).map((t) => [t.a.name.toLowerCase(), t.a.content || '']));
    const noindex = /noindex/i.test(meta.robots || '');
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
    if (!title) hard.push(`${f}: no <title>`);
    if (!(tags.find((t) => t.tag === 'html') || { a: {} }).a.lang) hard.push(`${f}: no lang on <html>`);
    if (!('viewport' in meta)) hard.push(`${f}: no viewport meta`);
    if (!noindex && (meta.description || '').length < 50) hard.push(`${f}: an indexed page needs a description of 50 characters or more`);
    if (NOINDEX_EXPECTED.includes(f) && !noindex) hard.push(`${f}: should say noindex (draft, private or not a destination)`);
    if (!noindex && /\b(DRAFT|not available yet)\b/.test(text)) hard.push(`${f}: says it is a draft or not available, but does not say noindex`);
    const h1 = tags.filter((t) => t.tag === 'h1').length;
    if (h1 > 1) warn.push(`${f}: ${h1} <h1> in the HTML`);
    // images and pictures: alt text
    for (const t of tags) {
      if (t.tag === 'img' && !('alt' in t.a)) hard.push(`${f}: <img src="${t.a.src}"> has no alt`);
      if (t.tag === 'svg' && t.a.role === 'img' && !t.a['aria-label'] && !t.a['aria-labelledby']) hard.push(`${f}: an <svg role="img"> has no name`);
      if (t.tag === 'input' && t.a.type === 'image' && !t.a.alt) hard.push(`${f}: an image button has no alt`);
      if (t.tag === 'video' && !t.a['aria-label'] && !t.a.title && !('aria-hidden' in t.a)) warn.push(`${f}: a <video> has no label (aria-label or title)`);
    }
    // links and assets
    for (const t of tags) {
      const refs = [];
      if (t.tag === 'a' && t.a.href != null) refs.push(['link', t.a.href]);
      if (['img', 'script', 'source', 'iframe', 'audio', 'video', 'track'].includes(t.tag) && t.a.src) refs.push(['asset', t.a.src]);
      if (t.tag === 'video' && t.a.poster) refs.push(['asset', t.a.poster]);
      if (t.tag === 'link' && t.a.href && !/preconnect|dns-prefetch|canonical|alternate/.test(t.a.rel || '')) refs.push(['asset', t.a.href]);
      if (t.tag === 'form' && t.a.action) refs.push(['link', t.a.action]);
      for (const [kind, raw] of refs) {
        if (/^(mailto:|tel:|data:|javascript:|https?:\/\/(?!uselai\.com))/i.test(raw) || raw === '') continue;
        const u = new URL(raw.replace(/^https?:\/\/uselai\.com/i, ''), `https://site.local/${f}`);
        if (u.hostname !== 'site.local') continue;
        const target = u.pathname === `/${f}` || (u.pathname.endsWith('/') && `${u.pathname.slice(1)}index.html` === f) ? f : fileFor(u.pathname);
        if (!target) { hard.push(`${f}: ${kind} "${raw}" goes nowhere`); continue; }
        if (kind === 'link' && target.endsWith('.html')) (linkedFrom[target] ||= new Set()).add(f);
        const frag = u.hash.slice(1);
        if (kind === 'link' && frag && !frag.startsWith('/') && !frag.includes('=') && target.endsWith('.html') && !ids(target).has(decodeURIComponent(frag))) {
          if (scriptIds(target).has(frag)) warn.push(`${f}: link "${raw}" goes to an anchor that ${target}'s own script draws (#${frag}); it goes nowhere until the script has drawn it`);
          else hard.push(`${f}: link "${raw}" names an anchor "#${frag}" that is not on ${target}`);
        }
      }
    }
    if (noindex) (info.noindex ||= []).push(f); else (info.indexed ||= []).push(f);
  }
  // noindex pages that an INDEXED page links to: a crawler finds them (noindex still keeps them out of results; listed so each one is a choice)
  info.noindexLinkedFromIndexed = Object.entries(linkedFrom).filter(([t, from]) => (info.noindex || []).includes(t) && [...from].some((x) => (info.indexed || []).includes(x)))
    .map(([t, from]) => `${t} (from ${[...from].filter((x) => (info.indexed || []).includes(x)).join(', ')})`);
  // site-wide
  info.robots = exists('robots.txt'); info.sitemap = exists('sitemap.xml'); info.nojekyll = exists('.nojekyll');
  if (!info.robots) warn.push('there is no robots.txt: crawlers get no Disallow for /tests/, /tools/, /supabase/, /docs/ (every file in the repo is served)');
  if (!info.sitemap) warn.push('there is no sitemap.xml listing the pages that should be found');
  const md = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/(^|\/)(node_modules|vendor|_[^/]*)\//.test(f) && !f.split('/').some((s) => s.startsWith('.')));
  info.markdown = md;
  if (!info.nojekyll && md.length) warn.push(`there is no .nojekyll, so GitHub Pages most likely publishes these ${md.length} Markdown files as pages with no noindex (verify in a browser, e.g. https://uselai.com/README.html): ${md.slice(0, 6).join(', ')}${md.length > 6 ? ' ...' : ''}`);
  const served = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !f.split('/').some((s) => s.startsWith('.') || s.startsWith('_')) && !f.startsWith('node_modules/'));
  info.rawByFolder = Object.entries(served.reduce((a, f) => { const k = f.includes('/') ? f.split('/')[0] + '/' : '(root)'; a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
  return { pages, hard, warn, info };
}

function report({ pages, hard, warn, info }) {
  const L = [];
  L.push('# Public pages report, 11-02 (CLOUD-SITE, round 3)', '', `Made by \`node tools/check-public-pages.mjs --write\` from the files on the branch (no network, no browser). ${pages.length} pages served.`, '');
  L.push('## Hard findings', '', hard.length ? hard.map((x) => `- ${x}`).join('\n') : 'None: every internal link, anchor and asset resolves; every image has alt text; every page has a title, a language and a viewport; every indexed page has a description; every draft or private page says noindex.', '');
  L.push('## Warnings (for Ryan; none fails the check)', '', warn.length ? warn.map((x) => `- ${x}`).join('\n') : 'None.', '');
  L.push('## Indexed pages', '', (info.indexed || []).map((x) => `- ${x}`).join('\n'), '');
  L.push('## Pages that keep search engines away (noindex)', '', (info.noindex || []).map((x) => `- ${x}`).join('\n'), '');
  L.push('### noindex pages an indexed page links to', '', 'A crawler finds these, and noindex keeps them out of the results. Each is listed so it stays a choice.', '', info.noindexLinkedFromIndexed.length ? info.noindexLinkedFromIndexed.map((x) => `- ${x}`).join('\n') : 'None.', '');
  L.push('## Everything else the site serves', '', 'GitHub Pages serves every file in the repository (except names starting with a dot or an underscore). The page check above covers the HTML pages; the rest are served as plain files:', '');
  L.push(info.rawByFolder.map(([k, n]) => `- ${k} ${n} files`).join('\n'), '');
  L.push(`robots.txt: ${info.robots ? 'present' : 'absent'}. sitemap.xml: ${info.sitemap ? 'present' : 'absent'}. .nojekyll: ${info.nojekyll ? 'present' : 'absent'}.`, '');
  if (!info.nojekyll) L.push('### Markdown files GitHub Pages most likely publishes as pages', '', 'Without .nojekyll, GitHub Pages builds the site with Jekyll, which turns Markdown files into HTML pages even without front matter. None of them carries noindex. Verify on the live site before acting (this check makes no network call).', '', info.markdown.map((x) => `- ${x} (would be /${x.replace(/\.md$/, '.html')})`).join('\n'), '');
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = check();
  for (const x of r.hard) console.log('HARD', x);
  for (const x of r.warn) console.log('WARN', x);
  console.log(`${r.pages.length} pages; HARD: ${r.hard.length}; warnings: ${r.warn.length}`);
  if (process.argv.includes('--write')) { fs.writeFileSync(path.join(ROOT, 'docs/PUBLIC-PAGES-REPORT-1102.md'), report(r) + '\n'); console.log('wrote docs/PUBLIC-PAGES-REPORT-1102.md'); }
  process.exit(r.hard.length ? 1 : 0);
}
