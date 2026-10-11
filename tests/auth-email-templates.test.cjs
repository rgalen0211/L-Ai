const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'supabase', 'email-templates');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');          // line endings do not matter (autocrlf checkouts)

// name -> the verifyOtp type its link must carry
const TEMPLATES = { 'confirm-signup': 'signup', 'invite-user': 'invite', 'magic-link': 'magiclink', 'reset-password': 'recovery', 'email-change': 'email_change' };

test('five templates, each with an HTML body, a matching plain-text body and a subject', () => {
  for (const name of Object.keys(TEMPLATES)) {
    for (const ext of ['.html', '.txt', '.subject.txt']) assert.ok(fs.existsSync(path.join(dir, name + ext)), name + ext);
    assert.ok(read(name + '.subject.txt').trim().length > 5 && read(name + '.subject.txt').trim().length < 80);
  }
});

test('every template: Ryagram name, one short reason, a visible button AND the full plain link, the footer, no images or scripts', () => {
  for (const name of Object.keys(TEMPLATES)) {
    const html = read(name + '.html');
    assert.match(html, />Ryagram</, name);
    assert.match(html, /You(?:'|’)re getting this because/, name);                                 // why they got it
    assert.equal((html.match(/You(?:'|’)re getting this because/g) || []).length, 1, name);
    assert.match(html, /<a href="[^"]+" style="display:inline-block;background:#1b6f63[^>]*>[^<]+<\/a>/, name);   // a button
    const hrefs = html.match(/<a href="([^"]+auth\/confirm[^"]+)"/g) || [];
    assert.equal(hrefs.length, 1, name);
    assert.ok(html.split(hrefs[0].slice(9, -1)).length === 3, name + ': the same link is also printed in full');     // button + plain text = 2 occurrences
    assert.match(html, /Ryagram is operated by L'Ai, LLC\./, name);
    assert.match(html, /<a href="mailto:ryagram@uselai\.com"[^>]*>ryagram@uselai\.com<\/a>/, name);
    assert.match(html, /<a href="https:\/\/uselai\.com\/ryagram\/"/, name);
    assert.doesNotMatch(html, /<script|<img|<!--|supabase\.co/i, name);                                             // never the supabase.co domain
    assert.equal((html.match(/<table/g) || []).length, (html.match(/<\/table>/g) || []).length, name);
  }
});

test('every link goes through our own domain to the app route with the right type: {{ .SiteURL }}/app/#/auth/confirm?token_hash={{ .TokenHash }}&type=<type>', () => {
  for (const [name, type] of Object.entries(TEMPLATES)) {
    const html = read(name + '.html');
    const links = html.match(/\{\{ \.SiteURL \}\}\/app\/#\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&amp;type=[a-z_]+/g);
    assert.equal(links.length, 2, name);
    for (const l of links) assert.ok(l.endsWith('type=' + type), `${name}: ${l}`);
    assert.doesNotMatch(html, /ConfirmationURL|\.RedirectTo/, name);                                               // not the supabase.co link
    const text = read(name + '.txt');
    assert.equal((text.match(/\{\{ \.SiteURL \}\}\/app\/#\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&type=[a-z_]+/g) || []).length, 1, name);
    assert.ok(text.includes(`&type=${type}\n`), name);
    for (const v of (html + text).match(/\{\{[^}]*\}\}/g)) assert.match(v, /^\{\{ \.(SiteURL|TokenHash|Email|NewEmail) \}\}$/, `${name}: ${v}`);
  }
});

test('the plain-text part says the same as the HTML part: same reason, button words, ignore line and footer', () => {
  const plain = s => s.replace(/&amp;/g, '&');
  for (const name of Object.keys(TEMPLATES)) {
    const html = plain(read(name + '.html'));
    const text = read(name + '.txt');
    const why = html.match(/(You(?:'|’)re getting this because[^<]+)</)[1];
    assert.ok(text.includes(why), name + ': reason');
    const button = html.match(/<a href="[^"]+" style="display:inline-block[^>]*>([^<]+)<\/a>/)[1];
    assert.ok(text.includes(button + ':'), name + ': button words');
    const heading = html.match(/<h1[^>]*>([^<]+)<\/h1>/)[1];
    assert.ok(text.includes(heading), name + ': heading');
    for (const line of ["Ryagram is operated by L'Ai, LLC.", 'Questions: ryagram@uselai.com', 'https://uselai.com/ryagram/']) assert.ok(text.includes(line), name + ': ' + line);
    const ignore = [...html.matchAll(/color:#667074;">(If [^<]+)<\/p>/g)].pop()[1];                  // the last grey line
    assert.ok(text.includes(ignore), name + ': ignore line');
  }
});

test('the app understands every type the templates send (end to end in the auth harness lives in app-auth.test.cjs)', () => {
  const auth = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-auth.js'), 'utf8');
  for (const type of Object.values(TEMPLATES)) assert.ok(auth.includes(`'${type}'`), type);
  assert.match(auth, /#\\\/auth\\\/confirm/);
});
