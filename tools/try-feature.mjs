// Try an OFF website feature on YOUR OWN PC, for you only (WEB 11-10, for the walkthrough).
//   node tools/try-feature.mjs myFilms            (one switch)      node tools/try-feature.mjs liveEditor whyClip      (several)      node tools/try-feature.mjs --list
// It starts a small server on 127.0.0.1 (this PC only, a port of its own) that serves this folder, but hands the browser a COPY of assets/ryagram-config.js with the named switches set to true.
// No file is changed, nothing is uploaded, no one else sees anything: the site everyone else uses is unaffected. Stop it with Ctrl+C.
// Default address is /app/?mock (made-up films and a pretend worker). --real opens /app/ with the real sign-in and database instead (the page then talks to the real project: use it only for features that read your own films).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'assets/ryagram-config.js';
// A feature that does nothing without another one: the other is turned on too, and said.
export const NEEDS = { whyClip: ['liveEditor'], lyricCards: ['liveEditor'], testerFilmProgress: ['myFilms'], songIntake: ['intake'], catalogComingSoon: ['catalog'] };
// Where to look first, by switch (a hint only, printed).
export const WHERE = { myFilms: '#/films', intake: '#/new', catalog: '#/catalog', liveEditor: 'open a film, then its editor', testerWizard: '#/tester-start', mapPanelDemo: '/map-panel-demo/', geoDemo: '/geo-demo/', gameTv: '/game-tv/', gamePhone: '/game-phone/', locationWords: 'Departments bar, Geographic Intelligence', departmentDetails: 'Departments bar, the Coming soon pages' };
const OWN_PAGE = new Set(['mapPanelDemo', 'geoDemo', 'gameTv', 'gamePhone']);

export function readSwitches(text) {
  const win = {}; vm.runInNewContext(text, { window: win });
  return Object.fromEntries(Object.entries(win.ryagramConfig).filter(([, v]) => typeof v === 'boolean'));
}

// Returns { text, turnedOn, alreadyOn, added }; throws a plain sentence for a name that is not a true/false switch.
export function withSwitches(text, names) {
  const all = readSwitches(text);
  const asked = [...new Set(names)];
  for (const n of asked) if (!Object.hasOwn(all, n)) throw new Error(`"${n}" is not a true/false switch in ${CONFIG}. Run with --list to see the names.`);
  const added = [];
  for (const n of [...asked]) for (const d of NEEDS[n] || []) if (!asked.includes(d) && Object.hasOwn(all, d)) { asked.push(d); added.push(d); }
  let out = text; const turnedOn = [], alreadyOn = [];
  for (const n of asked) {
    if (all[n] === true) { alreadyOn.push(n); continue; }
    const re = new RegExp(`^(\\s*${n}:\\s*)false(?=\\s*(?:,|//|$))`, 'm');
    if (!re.test(out)) throw new Error(`Could not find the line "${n}: false," in ${CONFIG}.`);
    out = out.replace(re, '$1true'); turnedOn.push(n);
  }
  const after = readSwitches(out);
  for (const k of Object.keys(all)) if ((after[k] === true) !== (all[k] === true || turnedOn.includes(k))) throw new Error(`Changing "${k}" went wrong; nothing served.`);
  return { text: out, turnedOn, alreadyOn, added };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };

// The address it listens on: this PC only. Exported so a test can pin it WITHOUT opening any socket (createServer can be replaced).
export const BIND_HOST = '127.0.0.1';
export function startServer(names, { root = ROOT, port = 0, createServer = http.createServer } = {}) {
  const real = fs.readFileSync(path.join(root, CONFIG), 'utf8');
  const cfg = withSwitches(real, names);
  const server = createServer((req, res) => {
    let rel; try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('bad address'); return; }
    if (rel === '/' + CONFIG) { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(cfg.text); return; }
    let file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('no'); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (path.relative(root, file).split(path.sep).includes('.git') || !fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, BIND_HOST, () => resolve({ server, port: server.address().port, ...cfg })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), real = args.includes('--real'), names = args.filter(a => !a.startsWith('--'));
  if (args.includes('--list')) {
    const s = readSwitches(fs.readFileSync(path.join(ROOT, CONFIG), 'utf8'));
    for (const [k, v] of Object.entries(s)) console.log(`${v ? 'ON ' : 'off'}  ${k}${WHERE[k] ? '   (look at: ' + WHERE[k] + ')' : ''}`);
    process.exit(0);
  }
  if (!names.length) { console.log('Usage: node tools/try-feature.mjs <switch> [<switch> ...] [--real]     or   --list'); process.exit(1); }
  try {
    const r = await startServer(names);
    const own = names.find(n => OWN_PAGE.has(n));
    const url = `http://127.0.0.1:${r.port}${own ? WHERE[own] : real ? '/app/' : '/app/?mock'}`;
    console.log(`\nOn for THIS PC only: ${r.turnedOn.join(', ') || '(nothing: already on)'}` + (r.alreadyOn.length ? `   already on in the file: ${r.alreadyOn.join(', ')}` : '') + (r.added.length ? `   also turned on because it needs them: ${r.added.join(', ')}` : ''));
    for (const n of names) if (WHERE[n]) console.log(`Look at: ${n}: ${WHERE[n]}`);
    console.log(`\nOpen this in your browser:\n  ${url}\n\n${real ? 'REAL mode: the page talks to the real project with your sign-in.' : 'Mock mode: made-up films and a pretend worker; nothing real is read or written.'}\nCtrl+C stops it. Nothing on the live site changed.\n`);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
