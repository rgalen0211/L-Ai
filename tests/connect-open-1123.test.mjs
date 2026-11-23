// Connect-an-AI OPEN: the page words that are true ONLY when the connector is open to every account (L5: live steps 36 then 35, GEO's L5 row).
// WEB 11-23 (GAMES audit items vi, vii). Doc: proposals\WEB-CONNECT-OPEN-1123.md. The pages go with L5: if Ryan answers (c), this commit is NOT pushed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ');
const terms = read('terms/index.html'), privacy = read('privacy-policy.html'), aic = read('ai-content/index.html'), help = read('help/index.html'), guide = read('connect-ai/index.html');

const SENTENCE = 'You can connect an AI assistant such as Claude or ChatGPT to your account.';
const LIMITS = 'It cannot spend your credits, start a full render, publish or delete your account.';

test('ONE SENTENCE on Terms, AI content and Help: the same first sentence; Terms and AI content carry the same limits sentence', () => {
  for (const [n, html] of [['terms', terms], ['ai-content', aic], ['help', help]]) assert.ok(text(html).includes(SENTENCE), n);
  assert.ok(text(terms).includes(LIMITS) && text(aic).includes(LIMITS));
  assert.ok(text(terms).includes('You can disconnect it at any time. Your AI provider has its own terms.'));
});

test('OLD WORDS GONE: no page says connecting an AI is "not yet in the preview"; the not-yet sentences name only uploads and film pages', () => {
  for (const [n, html] of [['terms', terms], ['privacy', privacy], ['ai-content', aic], ['help', help], ['guide', guide]]) {
    assert.doesNotMatch(text(html), /connecting your own AI( assistant)?( is)?/i, n);
    assert.doesNotMatch(text(html), /not yet in the preview[^.]*connect/i, n);
  }
  assert.ok(text(terms).includes('Some things are not yet in the preview: uploading your own data and publishing a film page.'));
  assert.ok(text(privacy).includes('nothing is kept for them: uploading your own data and publishing a film page.'));
  assert.ok(text(aic).includes('Some things are not yet in the preview: uploading your own data and publishing a film page.'));
});

test('PRIVACY says what is kept for a connection, and each clause is what the code does', () => {
  const li = /<li data-connect-an-ai>([\s\S]*?)<\/li>/.exec(privacy);
  assert.ok(li, 'the Privacy list item');
  const t = text(li[1]);
  assert.match(t, /^ Connected AI assistants\. If you connect one, we keep the connection \(the assistant's name and what you allowed\) until you delete your account\./);
  assert.match(t, /tokens are kept only in scrambled form, and stop working when you disconnect it or after 30 days without renewal/);
  assert.match(t, /log of what it asked us to do for 30 days: the name of the action, whether it worked, a short code, the credits used and the time, but no story text and no tokens/);
  assert.match(t, /handled by its company, under its own terms, not by us\./);
  const sql = read('supabase/migrations/20261018000100_connect_ai.sql');
  assert.match(sql, /access_hash text/); assert.match(sql, /refresh_hash text not null unique check \(refresh_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);   // tokens stored only as hashes
  assert.match(sql, /p_refresh_hash, now\(\) \+ interval '30 days'/);                                                                   // the refresh lasts 30 days
  assert.match(sql, /one row per tool call; NO arguments, story text or tokens/);
  assert.match(sql, /tool text not null[\s\S]*credits int not null default 0[\s\S]*result text not null[\s\S]*code text not null/);
  assert.match(sql, /update public\.connect_grants set revoked_at = now\(\) where owner_id = me/);                                      // disconnect ends the grant and tokens
  assert.match(sql, /owner_id uuid not null references auth\.users \(id\) on delete cascade/);                                          // grants and tokens go with the account
  assert.match(read('supabase/migrations/20261120000600_prepared_purge_daily.sql'), /delete from public\.connect_calls where at < now\(\) - interval '30 days'/);
});

test('THE LIMITS are what the connector does: no spend, no full render, no publish, no delete-account tool', () => {
  const tools = read('supabase/functions/connect-core/tools.ts');
  assert.match(tools, /a connection cannot spend credits/);
  assert.match(tools, /A full render can never be started from a connection/);
  assert.match(tools, /You cannot render, spend credits or publish from here/);
  const names = [...(tools + read('supabase/functions/connect-core/editor_tools.ts')).matchAll(/^\s*name: "([a-z_]+)"/gm)].map(m => m[1]);
  assert.ok(names.length > 20);
  for (const n of names) assert.doesNotMatch(n, /publish|delete_account|delete_project|account_delete|close_account|spend|pay|buy/, n);
  assert.match(read('assets/app-connect.js'), /'Your AI acts as your Ryagram account\.', 'It cannot spend your credits\.', 'You can disconnect it any time: Account, then Connected AIs\.'/);
});

test('CONNECT GUIDE: no invite wording, a neutral mail subject, and says where to look and how to ask', () => {
  assert.ok(guide.includes('A Ryagram account. Open Account in Ryagram and look for Connected AIs. If it does not show, connecting is not available on your account;'));
  assert.ok(guide.includes('mailto:ryagram@uselai.com?subject=Connecting%20an%20AI'));
  assert.doesNotMatch(guide, /invite/i);
});

test('SWITCH: these words are ONLY correct when Connect-an-AI is open to every account (L5). The page flag is on; the server rule that opens it exists; the doc names the order', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /connectAi: true,/);                                                              // the pages and the Help entry assume the Connected AIs list is shown
  const open = read('supabase/migrations/20261121000700_connect_ai_open_to_all.sql');
  assert.match(open, /alter table public\.connect_flags add column open_to_all boolean not null default false/);   // OFF until the admin switch runs: until then the Terms/Privacy/Help words above are false for a stranger
  assert.match(open, /ryagram_private\.connect_open\(\) and not exists \(select 1 from public\.connect_access a where a\.user_id = p_owner\)/);
  assert.match(open, /public\.admin_connect_set_open\(p_on boolean\)/);
  // Each of the five pages keeps its swappable sentence marked, so a revert to "not yet" is one sentence per page.
  assert.equal((terms.match(/data-connect-an-ai/g) || []).length, 1);
  assert.equal((aic.match(/data-connect-an-ai/g) || []).length, 1);
  assert.equal((privacy.match(/data-connect-an-ai/g) || []).length, 1);
  assert.match(help, /data-flag="connectAi"/);
});
