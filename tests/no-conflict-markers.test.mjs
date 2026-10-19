// An unresolved merge leaves lines like <<<<<<< HEAD, =======, >>>>>>> origin/x in the file. Tests do not read most files (a README, a SQL file), so such a file can be committed and
// merged without any test noticing (CC1 found two on 2026-10-18). Every TRACKED text file is scanned for a line that STARTS with seven < or > followed by a space, or that is exactly
// seven = signs. Quoted examples inside code or prose do not start at the beginning of a line, so they do not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const LT = String.fromCharCode(60).repeat(7), GT = String.fromCharCode(62).repeat(7), EQ = String.fromCharCode(61).repeat(7);   // built here so this file does not itself contain a marker line

function markerLines(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => { if (line.startsWith(`${LT} `) || line.startsWith(`${GT} `) || line === EQ) hits.push(i + 1); });
  return hits;
}

// Every tracked file that is text (no NUL byte in it); returns { file: [line numbers] } for the files that have a marker.
function scan(repo) {
  const out = {};
  for (const f of git(repo, 'ls-files', '-z').split('\0').filter(Boolean)) {
    const p = path.join(repo, f);
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    if (buf.includes(0)) continue;                                      // binary
    const hits = markerLines(buf.toString('utf8'));
    if (hits.length) out[f] = hits;
  }
  return out;
}

test('no tracked text file in this repository contains merge-conflict markers', () => {
  assert.deepEqual(scan(ROOT), {});
});

test('MUST-FAIL: the scan sees a conflict left in a tracked README and a SQL file (planted in a scratch repository), and ignores quoted examples and binary files', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'markers-'));
  try {
    git(repo, 'init', '-q');
    const conflict = `top\n${LT} HEAD\nours\n${EQ}\ntheirs\n${GT} origin/engine-profiles\nbottom\n`;
    fs.writeFileSync(path.join(repo, 'README.md'), conflict);
    fs.mkdirSync(path.join(repo, 'supabase'));
    fs.writeFileSync(path.join(repo, 'supabase', 'x.sql'), `select 1;\r\n${LT} HEAD\r\nselect 2;\r\n`);
    fs.writeFileSync(path.join(repo, 'ok.md'), `a quoted example: "${LT} HEAD" and ${EQ} inside a line\n  ${EQ}\n`);
    fs.writeFileSync(path.join(repo, 'pic.bin'), Buffer.from([0, 1, 2, ...Buffer.from(`${LT} HEAD\n`)]));
    git(repo, 'add', 'README.md', 'supabase/x.sql', 'ok.md', 'pic.bin');
    assert.deepEqual(scan(repo), { 'README.md': [2, 4, 6], 'supabase/x.sql': [2] });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
