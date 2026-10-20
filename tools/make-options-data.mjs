// Generates assets/options-data.js from assets/options.json (the shared list of options: wording, control type, defaults; never the validator).
// Run: node tools/make-options-data.mjs   (tests/options.test.mjs fails if the committed file is not what this builds)
import fs from 'node:fs';
const root = new URL('..', import.meta.url);
const src = JSON.parse(fs.readFileSync(new URL('assets/options.json', root), 'utf8'));
const out = `// GENERATED from assets/options.json by tools/make-options-data.mjs. Do not edit by hand: change options.json and run the generator.
// The shared list of film options (wording, control type, defaults). It is never the validator: the engine's schema check, run by the server, decides what is accepted.
window.ryagramOptions = (() => {
  const data = ${JSON.stringify(src, null, 2)};
  const byPath = Object.create(null);
  for (const o of data.options) if (o.path) byPath[o.path] = o;
  return Object.freeze({ data, groups: data.groups, options: data.options, byPath });
})();
`;
// An optional first argument writes somewhere else (the test builds into a temp file and compares, so the checked-out file is never touched).
const target = process.argv[2] ? process.argv[2] : new URL('assets/options-data.js', root);
fs.writeFileSync(target, out);
console.log('options-data.js written:', src.options.length, 'rows');
