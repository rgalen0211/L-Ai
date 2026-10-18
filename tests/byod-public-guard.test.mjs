// Ryan Q5 (2026-10-18): the BYOD fields ship with PLACEHOLDER wording for INVITED TESTERS ONLY. Nothing public may show a placeholder marker, and the fields themselves must stay behind
// byodGuide (off) so the live app does not show them to anyone until Ryan turns the flag on for the testers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const files = [];
const walk = d => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (['node_modules', '.git', 'supabase', 'tests', 'tools'].includes(e.name)) continue;
  const rel = path.posix.join(d, e.name);
  if (e.isDirectory()) walk(rel); else if (/\.(html|js|css)$/.test(e.name)) files.push(rel);
} };
walk('.');

test('NO PUBLIC PLACEHOLDER MARKERS: the draft-wording marker appears only in the signed-in app\'s upload code, never in a public page or a public script', () => {
  const MARK = /\[PLACEHOLDER WORDING|U\.PLACEHOLDER|ryagramUploads.*PLACEHOLDER/;       // the BYOD draft-wording marker (the Terms/AI-content shells and the connect guide have their own visible DRAFT banners, approved by Ryan)
  const holders = files.filter(f => MARK.test(read(f)));
  assert.deepEqual(holders.sort(), ['assets/app-library.js', 'assets/app-uploads.js'], 'where the marker lives');
  for (const f of files) {
    if (holders.includes(f)) continue;
    assert.doesNotMatch(read(f), MARK, f);
  }
  const publicPages = files.filter(f => f.endsWith('.html') && f !== 'app/index.html');
  assert.ok(publicPages.length >= 8, publicPages.join());
  for (const f of publicPages) assert.doesNotMatch(read(f), /app-uploads\.js|byodGuide/, `${f} loads nothing of the BYOD code`);
});

test('ONLY BEHIND THE FLAG: the fields and their marker are drawn only when byodGuide is on (it ships off), and the marker text itself is built from one constant', () => {
  assert.match(read('assets/ryagram-config.js'), /byodGuide: false,/);
  const lib = read('assets/app-library.js');
  assert.match(lib, /const provBox = byodGuideOn\(\) \? provenanceFields\(prov\) : null;/);
  const marked = lib.split('\n').filter(l => /PLACEHOLDER/.test(l));
  assert.ok(marked.length >= 2 && marked.every(l => /U\.PLACEHOLDER|PLACEHOLDER wording|PLACEHOLDER\)/.test(l) || l.trim().startsWith('//')), marked.join('\n'));
  assert.match(read('assets/app-uploads.js'), /const PLACEHOLDER = '\[PLACEHOLDER WORDING, pending Ryan and the lawyer\]';/);
});
