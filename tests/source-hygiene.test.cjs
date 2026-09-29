// No invisible or direction-control characters in source ("Trojan Source"): they can make
// code read differently from what runs. Write them as \uXXXX escapes instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');

test('source files contain no invisible, control or stray combining characters', () => {
  // Tracked files and new ones not yet added, so a check before committing sees them too.
  const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n')
    .filter(f => /\.(js|cjs|mjs|ts|html|css|sql|py|md|json)$/.test(f));
  const found = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const ch of text) {
      if (/[\p{Cf}\p{Co}\p{Cs}\p{Mn}\p{Me}]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(ch)) {
        found.push(`${f}: U+${ch.codePointAt(0).toString(16).padStart(4, '0')}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
