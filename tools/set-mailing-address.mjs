// The one swap for the mailing address (WEB 11-23). Usage: node tools/set-mailing-address.mjs "Street, City, ST 00000"
// Replaces the value in tests/mailing-address.txt AND on terms/index.html and privacy-policy.html; the test pins read that file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').trim();
if (!next || /[<>\r\n]/.test(next) || /to be added/i.test(next)) { console.error('give the address as one plain line (no < > or line breaks)'); process.exit(2); }
const esc = next.replace(/&/g, '&amp;');
const file = path.join(root, 'tests/mailing-address.txt');
const old = fs.readFileSync(file, 'utf8').trim();
for (const p of ['terms/index.html', 'privacy-policy.html']) {
  const f = path.join(root, p); const html = fs.readFileSync(f, 'utf8');
  if (html.split(old).length !== 2) { console.error(p + ': expected the current value exactly once'); process.exit(3); }
  fs.writeFileSync(f, html.replace(old, () => esc));
}
fs.writeFileSync(file, esc);
console.log('mailing address set on both pages and in tests/mailing-address.txt');
