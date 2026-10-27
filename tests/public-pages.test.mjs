// Public pages sanity (tools/audit-public-pages.py is the readable report; this is the guard): every served page has a title and language, public pages have a description and say no noindex, draft and
// private pages (the legal shells, connect-ai, the thank-you pages, the 404, the app) keep search engines away, the unlisted drafts are linked from nowhere, every internal link and anchor resolves,
// a link that opens a new tab says noopener, and every OUTSIDE host is one we decided on (a new host fails until it is added here with its reason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = execFileSync('git', ['ls-files', '*.html'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => !/^(supabase|node_modules|tests)\//.test(f));
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const SHOULD_BE_NOINDEX = new Set(['connect-ai/index.html', 'legal-drafts/privacy-policy.html', 'legal-drafts/terms.html', 'ai-content/index.html', 'terms/index.html', 'thank-you.html', 'workflow-audit-thanks.html', '404.html', 'app/index.html']);
const SHOULD_BE_INDEXED = new Set(['index.html', 'ryagram/index.html', 'help/index.html', 'privacy-policy.html']);
const UNLISTED = ['connect-ai/index.html', 'legal-drafts/privacy-policy.html', 'legal-drafts/terms.html'];

// Every outside host the public pages may use, and why.
const OUTSIDE = {
  'fonts.googleapis.com': 'the page font (render-blocking; self-hosting it is a pending decision, see the page weight pass)',
  'fonts.gstatic.com': 'the page font files',
  'cdn.jsdelivr.net': 'the Supabase client library, pinned to an exact version, in the app',
  'formspree.io': 'the contact and workflow-audit forms (disclosed in the privacy policy)',
  'calendar.app.google': 'the booking link on the home page',
  'youtu.be': 'the Ryagram showcase videos',
  '3d-crm.pages.dev': 'the 3D CRM demo linked from the home page',
  'uselai.com': 'canonical and social-card addresses of our own site',
  'policies.google.com': 'a vendor privacy policy, linked from OUR privacy policy as its source',
  'supabase.com': 'a vendor privacy policy, linked from our privacy policy as its source',
  'stripe.com': 'a vendor privacy policy, linked from our privacy policy as its source',
  'resend.com': 'a vendor privacy policy, linked from our privacy policy as its source',
  'www.facebook.com': 'a vendor privacy policy, linked from our privacy policy as its source',
  'support.claude.com': 'Anthropic\'s help page, the source of the connect guide\'s Claude steps (connect-ai, unlisted draft)',
};

function parse(html) {
  const tags = [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)].map(m => {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    return { tag: m[1].toLowerCase(), attrs };
  });
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const meta = {};
  for (const t of tags) if (t.tag === 'meta' && t.attrs.name) meta[t.attrs.name.toLowerCase()] = t.attrs.content || '';
  const ids = new Set(tags.map(t => t.attrs.id).filter(Boolean));
  const html_ = tags.find(t => t.tag === 'html');
  return { tags, title, meta, ids, lang: html_ ? html_.attrs.lang : '' };
}
const pages = Object.fromEntries(files.map(f => [f, parse(read(f))]));

test('EVERY PAGE has a title and a language; every public page has a description and no noindex', () => {
  for (const [f, p] of Object.entries(pages)) {
    assert.ok(p.title, `${f}: no <title>`);
    assert.ok(p.lang, `${f}: no lang on <html>`);
    assert.ok('viewport' in p.meta, `${f}: no viewport meta`);
  }
  for (const f of SHOULD_BE_INDEXED) {
    assert.ok(!/noindex/i.test(pages[f].meta.robots || ''), `${f}: a public page must not say noindex`);
    assert.ok((pages[f].meta.description || '').length >= 50, `${f}: needs a meta description of 50 characters or more`);
  }
});

// Pages under tools/ are LOCAL TOOL pages: the maker serves them on the person's own computer. They are never public, so they must say noindex; only they are exempt from the description and heading rules.
const LOCAL_TOOL = f => f.startsWith('tools/');

test('LOCAL TOOL PAGES (tools/) say noindex, and no page outside tools/ gets that exemption', () => {
  for (const f of files.filter(LOCAL_TOOL)) assert.match(pages[f].meta.robots || '', /noindex/i, `${f}: a local tool page must say noindex`);
  for (const f of SHOULD_BE_INDEXED) assert.ok(!LOCAL_TOOL(f), `${f}: a public page cannot be a local tool page`);
  for (const f of files.filter(x => !LOCAL_TOOL(x) && !SHOULD_BE_NOINDEX.has(x))) assert.ok(!/noindex/i.test(pages[f].meta.robots || '') || ['film/index.html', 'report/index.html', 'preview-demo/index.html', 'workflow-audit/index.html', 'app/index.html'].includes(f), `${f}: outside tools/ a page is classified, not exempt`);
});

test('DRAFT, PRIVATE AND NOT-A-DESTINATION PAGES keep search engines away; every page is classified', () => {
  for (const f of SHOULD_BE_NOINDEX) assert.match(pages[f].meta.robots || '', /noindex/i, `${f}: needs noindex`);
  for (const f of files) assert.ok(SHOULD_BE_NOINDEX.has(f) || SHOULD_BE_INDEXED.has(f) || LOCAL_TOOL(f) || ['film/index.html', 'report/index.html', 'preview-demo/index.html', 'workflow-audit/index.html'].includes(f), `${f}: a new page must be classified here (indexed or noindex)`);
});

test('THE UNLISTED DRAFTS ARE LINKED FROM NOWHERE (connect-ai, the legal-drafts)', () => {
  for (const target of UNLISTED) {
    for (const [f, p] of Object.entries(pages)) {
      if (f === target) continue;
      for (const t of p.tags) {
        if (t.tag !== 'a' || !t.attrs.href) continue;
        const href = t.attrs.href.split('#')[0];
        if (!href || /^[a-z]+:/i.test(href)) continue;
        const resolved = path.posix.normalize(href.startsWith('/') ? href.slice(1) : path.posix.join(path.posix.dirname(f), href));
        const asFile = resolved.endsWith('/') ? `${resolved}index.html` : resolved;
        assert.notEqual(asFile, target, `${f} links to the unlisted ${target}`);
      }
    }
  }
});

test('EVERY INTERNAL LINK AND ANCHOR RESOLVES', () => {
  for (const [f, p] of Object.entries(pages)) {
    for (const t of p.tags) {
      const url = t.attrs.href ?? t.attrs.src ?? t.attrs.poster ?? t.attrs.action;
      if (!url || !['a', 'link', 'script', 'img', 'source', 'video', 'form'].includes(t.tag)) continue;
      if (/^([a-z]+:|\/\/|#|mailto)/i.test(url)) continue;
      const [pathPart, frag = ''] = url.split('#');
      if (!pathPart) continue;
      const clean = decodeURIComponent(pathPart.split('?')[0]);
      let target = path.join(root, clean.startsWith('/') ? clean.slice(1) : path.join(path.dirname(f), clean));
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      assert.ok(fs.existsSync(target), `${f}: broken ${t.tag} ${url}`);
      if (frag && !frag.startsWith('/')) {
        const rel = path.relative(root, target).split(path.sep).join('/');
        if (pages[rel]) assert.ok(pages[rel].ids.has(frag), `${f}: broken anchor ${url} (no id "${frag}" in ${rel})`);
      }
    }
  }
});

test('A LINK THAT OPENS A NEW TAB SAYS noopener', () => {
  for (const [f, p] of Object.entries(pages)) for (const t of p.tags) if (t.tag === 'a' && t.attrs.target === '_blank') assert.match(t.attrs.rel || '', /noopener/, `${f}: ${t.attrs.href}`);
});

test('EVERY OUTSIDE HOST IS ONE WE DECIDED ON (a new host fails until it is added here, with its reason)', () => {
  const seen = new Set();
  for (const [f, p] of Object.entries(pages)) {
    for (const t of p.tags) {
      const url = t.attrs.href ?? t.attrs.src ?? t.attrs.action;
      if (!url || !['a', 'link', 'script', 'img', 'source', 'iframe', 'form'].includes(t.tag)) continue;
      if (!/^(https?:)?\/\//i.test(url)) continue;
      const host = new URL(url.startsWith('//') ? `https:${url}` : url).hostname;
      seen.add(host);
      assert.ok(host in OUTSIDE, `${f}: outside host ${host} (${url}) has no rule; add it to OUTSIDE with a reason, or remove the link`);
    }
  }
  for (const host of Object.keys(OUTSIDE)) if (host !== 'support.claude.com') assert.ok(seen.has(host), `${host} is in the allow-list but no page uses it any more: remove it`);
});
