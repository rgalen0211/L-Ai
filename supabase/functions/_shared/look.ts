// @ts-nocheck
// "Shape the film": the settings of a story a person can change without editing JSON, as one pure function.
// The body between BEGIN SHARED and END SHARED is copied byte for byte into assets/app-look.js (the page's
// controls) and tests/look.test.mjs fails if the two differ. It writes ONLY keys the worker's story schema
// v1 (Ryagram ryagram/worker/schema.py) accepts, inside the ranges it enforces; the worker re-validates
// every job, and tests/look-worker-schema.test.mjs runs what this produces through the worker's own
// validate_story when a Ryagram checkout is available.
//
// A patch is { film: {...}, title: { index, ... }, view: { index, ... }, look: {...} }. A value of null
// (or an empty string) takes an optional setting out again; a key that is absent is left alone.
// apply(story, patch) never changes the story it is given. It returns
//   { ok: true, story, changed: [plain words], notes: [plain words] }   or   { ok: false, problems: [plain words] }.
// BEGIN SHARED
// LIMITS (Ryan, 2026-10-05 W2): no title-card or subhead cap tighter than the engine's. The engine's reading-speed (250 wpm) and
// card-fit checks decide what is readable; these are only sanity bounds, and the worker schema must accept at least the same.
const LOOK_INVISIBLE = new RegExp('[' + [[0, 31], [127, 159], [173, 173], [8203, 8207], [8234, 8238], [8288, 8303], [65279, 65279], [65529, 65531]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const LOOK_PERIOD = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;
const LOOK_COLOUR = /^#[0-9a-fA-F]{6}$/;

// scope -> field -> { label, kind, ... }. kinds: text (max), num (lo, hi, int), enum (values), period, colour, bool, steps.
const LOOK_FIELDS = {
  film: {
    theme: { label: 'Light or dark', kind: 'enum', values: ['light', 'dark'], required: true },
    canvas: { label: 'Shape of the picture', kind: 'canvas', required: true },
    fps: { label: 'Frames per second', kind: 'fps', required: true },
    hold_seconds: { label: 'Seconds on each period (whole film)', kind: 'num', lo: 0, hi: 10 }
  },
  title: {
    headline: { label: 'Headline', kind: 'text', max: 1000 },
    subhead: { label: 'Subhead', kind: 'text', max: 1000 },
    credit: { label: 'Credit line', kind: 'text', max: 1000 },
    seconds: { label: 'Seconds on screen', kind: 'num', lo: 0.5, hi: 60, required: true },
    align: { label: 'Alignment', kind: 'enum', values: ['center', 'left'] },
    fade: { label: 'Fade (seconds)', kind: 'num', lo: 0, hi: 2 }
  },
  view: {
    start: { label: 'First period', kind: 'period' },
    end: { label: 'Last period', kind: 'period' },
    first_period: { label: 'First period shown', kind: 'period' },
    last_period: { label: 'Last period shown', kind: 'period' },
    hold_seconds: { label: 'Seconds on each period', kind: 'num', lo: 0, hi: 10 },
    subtitle: { label: 'Caption under the picture', kind: 'text', max: 200 },
    top_n: { label: 'How many places in a bar race', kind: 'num', lo: 1, hi: 20, int: true },
    axis: { label: 'Bar axis', kind: 'enum', values: ['fixed', 'dynamic'] },
    line_top_n: { label: 'How many lines', kind: 'num', lo: 1, hi: 20, int: true },
    period_years: { label: 'Years per step', kind: 'num', lo: 1, hi: 10, int: true },
    transition: { label: 'How this part begins', kind: 'enum', values: ['cut', 'crossfade', 'fade'] },
    transition_seconds: { label: 'Transition length (seconds)', kind: 'num', lo: 0, hi: 3 }
  },
  look: {
    map_mode: { label: 'Map fill', kind: 'enum', values: ['solid', 'hatch'] },
    map_low: { label: 'Map colour for low values', kind: 'colour' },
    map_high: { label: 'Map colour for high values', kind: 'colour' },
    map_steps: { label: 'Number of colour steps', kind: 'steps' },
    map_continuous: { label: 'Smooth colour (no steps)', kind: 'bool' },
    map_key_label: { label: 'Key label for a one-colour map', kind: 'text', max: 80 },
    no_data_label: { label: 'Key text for missing data', kind: 'text', max: 80 },
    outline_width: { label: 'State outline width', kind: 'num', lo: 0, hi: 4 },
    no_data_fill: { label: 'Colour for missing data', kind: 'colour' },
    dot_color: { label: 'Dot colour', kind: 'colour' },
    dot_baseline_color: { label: 'Colour of the starting stock of dots', kind: 'colour' },
    dot_value: { label: 'One dot stands for', kind: 'num', lo: 1, hi: 1000000, int: true },
    dot_radius: { label: 'Dot size', kind: 'num', lo: 0.5, hi: 6 },
    swap_seconds: { label: 'Seconds for one bar to pass another', kind: 'num', lo: 0, hi: 1.5 }
  }
};

// ---- Themes. Each maps onto settings the worker schema already accepts: sequence.theme (light or dark) plus
// style_overrides colour keys. Page and text colours are NOT written: the schema refuses them until WORKER's W1 lands
// (LOOK_PAGE_COLOURS_ACCEPTED flips then). `reset` is what choosing a theme puts back to the engine's own colours.
const LOOK_PAGE_COLOURS_ACCEPTED = false;
const LOOK_RESET = ['map_mode', 'map_low', 'map_high', 'map_steps', 'map_continuous', 'no_data_fill', 'dot_color', 'dot_baseline_color', 'outline_width'];
const LOOK_THEMES = {
  night: { label: 'Night', blurb: 'The default: a dark page. Best for lines, paths and networks.', theme: 'dark', set: {} },
  atlas: { label: 'Atlas', blurb: 'A light, near-white page, like a printed atlas.', theme: 'light', set: {} },
  print: { label: 'Print', blurb: 'Black on white with hatched textures, so it still reads in greyscale.', theme: 'light', set: { map_mode: 'hatch', outline_width: 2.5 } },
  contrast: { label: 'High contrast', blurb: 'Dark page, a wide yellow-to-purple ramp, heavy outlines, bright dots.', theme: 'dark',
              set: { map_mode: 'solid', map_low: '#2a0845', map_high: '#fff68f', outline_width: 3, no_data_fill: '#6e5a3a', dot_color: '#00e5ff' } }
};
// The engine's own colours for each theme (ryagram/maprace/style.yaml), the things a person's colours are checked against.
const LOOK_BASE = {
  dark: { page: '#14141a', fill: '#1f1f27', low: '#232838', high: '#e8eefb', dot: '#ff8a3d' },
  light: { page: '#fcfcfb', fill: '#f6f5f1', low: '#eef1f6', high: '#16233f', dot: '#c2410c' }
};
// The engine's floors (ryagram/maprace/colour.py, preflight.py): a patch needs 5 dE, a dot 20 dE (four times a patch).
const LOOK_PATCH_DE = 5;
const LOOK_DOT_DE = 20;

function lookLab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const x = (0.4124564 * c[0] + 0.3575761 * c[1] + 0.1804375 * c[2]) / 0.95047;
  const y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
  const z = (0.0193339 * c[0] + 0.119192 * c[1] + 0.9503041 * c[2]) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
// CIE76 colour distance, the same statistic the engine's checks use.
function lookDE(a, b) {
  const p = lookLab(a);
  const q = lookLab(b);
  return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
}

// The engine's contrast rules, in plain words, for the colours the person set. The engine re-checks the finished film.
function lookContrast(seq) {
  const base = LOOK_BASE[seq.theme === 'light' ? 'light' : 'dark'];
  const so = seq.style_overrides || {};
  const ch = so.choropleth || {};
  const out = [];
  const solid = ch.mode === 'solid';
  const low = ch.low;
  const high = ch.high;
  if (solid && (low || high)) {
    const a = low || base.low;
    const b = high || base.high;
    const n = Number.isInteger(ch.steps) ? ch.steps : null;
    const need = LOOK_PATCH_DE * ((n || 3) - 1);
    if (lookDE(a, b) < need) {
      out.push(n ? `The map's low and high colours are too close together to tell ${n} steps apart. Choose colours that differ more, or fewer steps.`
                 : 'The map\u2019s low and high colours are too close together to give readable steps. Choose colours that differ more.');
    }
    if (low && lookDE(low, base.page) < LOOK_PATCH_DE) out.push('The map\u2019s low colour would disappear into the page. Choose one that stands out from it.');
    if (high && lookDE(high, base.page) < LOOK_PATCH_DE) out.push('The map\u2019s high colour would disappear into the page. Choose one that stands out from it.');
  }
  const nd = (so.state || {}).no_data_fill;
  if (nd && lookDE(nd, base.fill) < LOOK_PATCH_DE) out.push('The colour for missing data is too close to the colour of a state with data. Choose one that differs more.');
  const dots = so.dots || {};
  if (dots.color) {
    if (lookDE(dots.color, base.fill) < LOOK_DOT_DE || lookDE(dots.color, base.page) < LOOK_DOT_DE) {
      out.push('The dot colour is too close to the map and page colours; small dots need a stronger contrast. Choose a brighter or darker one.');
    }
  }
  if (dots.baseline_color && lookDE(dots.baseline_color, dots.color || base.dot) < LOOK_DOT_DE) {
    out.push('The two kinds of dots are too close in colour to tell apart. Choose colours that differ more.');
  }
  return out;
}

// ---- Canvas. The worker schema accepts 1920x1080, 1280x720 and 1080x1920 today (ryagram/worker/schema.py); a square
// (1080x1080) is NOT accepted yet, so it is offered but refused in plain words until WORKER adds it and this flips.
const LOOK_SQUARE_ACCEPTED = false;
const LOOK_FPS = [24, 25, 30];
const LOOK_CANVAS = {
  wide: { label: '16:9 (wide)', size: [1920, 1080], accepted: true },
  square: { label: '1:1 (square)', size: [1080, 1080], accepted: false },
  vertical: { label: '9:16 (vertical)', size: [1080, 1920], accepted: true,
              warn: 'A vertical film needs its own title and end cards: text written for a wide picture rarely fits a narrow one. Check the contact sheet before you render.' }
};
function lookCanvasName(seq) {
  const c = Array.isArray(seq.canvas) ? seq.canvas : [];
  for (const [k, v] of Object.entries(LOOK_CANVAS)) if (v.size[0] === c[0] && v.size[1] === c[1]) return k;
  return 'wide';                                      // 1920x1080 and 1280x720 are both 16:9
}
// What choosing this theme would overwrite: colours the person has already changed (an element that is set and is not
// what the theme itself would put there).
const LOOK_COLOUR_FIELDS = ['map_low', 'map_high', 'no_data_fill', 'dot_color', 'dot_baseline_color'];
function lookWouldReplace(story, themeKey) {
  const t = LOOK_THEMES[themeKey];
  if (!t || !story || !story.sequence) return [];
  const so = story.sequence.style_overrides || {};
  const cur = { map_low: (so.choropleth || {}).low, map_high: (so.choropleth || {}).high, no_data_fill: (so.state || {}).no_data_fill,
                dot_color: (so.dots || {}).color, dot_baseline_color: (so.dots || {}).baseline_color };
  return LOOK_COLOUR_FIELDS.filter((f) => cur[f] != null && cur[f] !== (t.set[f] ?? null)).map((f) => LOOK_FIELDS.look[f].label);
}

function lookClean(text, max) {
  return String(text == null ? '' : text).replace(LOOK_INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const lookIsEmpty = v => v === null || v === undefined || v === '';
const lookNum = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const lookPlace = scope => (scope === 'title' ? 'title card' : scope === 'view' ? 'data view' : '');

// One value, checked: { value } to store, { clear: true } to remove, or { problem }.
function lookCheck(field, spec, raw) {
  if (lookIsEmpty(raw)) {
    return spec.required ? { problem: `${spec.label} can't be left empty.` } : { clear: true };
  }
  if (spec.kind === 'text') {
    const text = String(raw);
    const hadBreak = /[\r\n]/.test(text);
    const clean = lookClean(text, 100000);
    if (!clean) return { clear: true };
    if (clean.length > spec.max) return { problem: `${spec.label} can be at most ${spec.max} characters; this is ${clean.length}.` };
    return { value: clean, note: hadBreak ? `${spec.label}: line breaks were turned into spaces (the story format doesn't take line breaks yet).` : null };
  }
  if (spec.kind === 'num') {
    const n = lookNum(raw);
    if (!Number.isFinite(n)) return { problem: `${spec.label} must be a number.` };
    if (spec.int && !Number.isInteger(n)) return { problem: `${spec.label} must be a whole number.` };
    if (n < spec.lo || n > spec.hi) return { problem: `${spec.label} must be between ${spec.lo} and ${spec.hi}.` };
    return { value: n };
  }
  if (spec.kind === 'enum') {
    return spec.values.includes(raw) ? { value: raw } : { problem: `${spec.label} must be ${spec.values.join(' or ')}.` };
  }
  if (spec.kind === 'period') {
    return LOOK_PERIOD.test(String(raw)) ? { value: String(raw) } : { problem: `${spec.label} must look like 2016 or 2016-03.` };
  }
  if (spec.kind === 'colour') {
    return LOOK_COLOUR.test(String(raw)) ? { value: String(raw).toLowerCase() } : { problem: `${spec.label} must be a colour like #1a4fa3.` };
  }
  if (spec.kind === 'canvas') {
    const c = LOOK_CANVAS[raw];
    if (!c) return { problem: `${spec.label} must be one of ${Object.values(LOOK_CANVAS).map((x) => x.label).join(', ')}.` };
    if (!c.accepted && !(raw === 'square' && LOOK_SQUARE_ACCEPTED)) {
      return { problem: `${c.label} isn't available yet: the render machine takes 16:9 and 9:16 for now.` };
    }
    return { value: raw, note: c.warn || null };
  }
  if (spec.kind === 'fps') {
    const n = lookNum(raw);
    return LOOK_FPS.includes(n) ? { value: n } : { problem: `${spec.label} must be ${LOOK_FPS.join(', ')}.` };
  }
  if (spec.kind === 'bool') {
    return typeof raw === 'boolean' ? { value: raw } : raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { problem: `${spec.label} must be on or off.` };
  }
  if (spec.kind === 'steps') {
    if (raw === 'auto') return { value: 'auto' };
    const n = lookNum(raw);
    return Number.isInteger(n) && n >= 1 && n <= 9 ? { value: n } : { problem: `${spec.label} must be auto, or a whole number from 1 to 9.` };
  }
  return { problem: `${field} isn't something that can be changed here.` };
}

function lookSet(obj, key, res) {
  if (res.clear) delete obj[key];
  else obj[key] = res.value;
}
function lookPrune(obj, key) {
  if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && Object.keys(obj[key]).length === 0) delete obj[key];
}

function lookClipAt(clips, kind, index) {
  const at = [];
  clips.forEach((c, i) => { if (c && c.kind === kind) at.push(i); });
  const n = index === undefined || index === null ? 0 : Number(index);
  if (!Number.isInteger(n) || n < 0) return -1;
  return n < at.length ? at[n] : -1;
}

// Where each field lives in the story.
function lookWrite(story, scope, field, res, clipIndex) {
  const seq = story.sequence;
  if (scope === 'film') {
    if (field === 'theme') lookSet(seq, 'theme', res);
    else if (field === 'canvas') seq.canvas = [...LOOK_CANVAS[res.value].size];
    else if (field === 'fps') seq.fps = res.value;
    else lookSet(seq, 'hold_seconds', res);
    return;
  }
  if (scope === 'title') {
    lookSet(seq.clips[clipIndex], field, res);
    return;
  }
  if (scope === 'view') {
    const clip = seq.clips[clipIndex];
    if (['top_n', 'axis', 'line_top_n', 'period_years'].includes(field)) {
      clip.settings = clip.settings && typeof clip.settings === 'object' ? clip.settings : {};
      lookSet(clip.settings, field, res);
      lookPrune(clip, 'settings');
    } else if (field === 'transition') {
      if (res.clear) delete clip.transition;
      else clip.transition = { ...(clip.transition || {}), kind: res.value };
    } else if (field === 'transition_seconds') {
      if (res.clear) { if (clip.transition) delete clip.transition.seconds; }
      else clip.transition = { kind: 'crossfade', ...(clip.transition || {}), seconds: res.value };
    } else {
      lookSet(clip, field, res);
    }
    return;
  }
  const so = (seq.style_overrides = seq.style_overrides && typeof seq.style_overrides === 'object' ? seq.style_overrides : {});
  const group = (name) => (so[name] = so[name] && typeof so[name] === 'object' ? so[name] : {});
  if (field === 'map_mode') lookSet(group('choropleth'), 'mode', res);
  else if (field === 'map_low') lookSet(group('choropleth'), 'low', res);
  else if (field === 'map_high') lookSet(group('choropleth'), 'high', res);
  else if (field === 'map_steps') lookSet(group('choropleth'), 'steps', res);
  else if (field === 'map_continuous') lookSet(group('choropleth'), 'continuous', res);
  else if (field === 'map_key_label') lookSet(group('choropleth'), 'single_label', res);
  else if (field === 'no_data_label') lookSet(group('layout'), 'no_data_label', res);
  else if (field === 'outline_width') lookSet(group('state'), 'outline_width', res);
  else if (field === 'no_data_fill') lookSet(group('state'), 'no_data_fill', res);
  else if (field === 'dot_color') lookSet(group('dots'), 'color', res);
  else if (field === 'dot_baseline_color') lookSet(group('dots'), 'baseline_color', res);
  else if (field === 'dot_value') lookSet(group('dots'), 'value', res);
  else if (field === 'dot_radius') lookSet(group('dots'), 'radius', res);
  else if (field === 'swap_seconds') lookSet(group('bars'), 'swap_seconds', res);
  for (const name of ['choropleth', 'layout', 'state', 'dots', 'bars']) lookPrune(so, name);
  if (Object.keys(so).length === 0) delete seq.style_overrides;
}

function applyLook(story, patch) {
  const problems = [];
  if (!story || typeof story !== 'object' || !story.sequence || !Array.isArray(story.sequence.clips)) {
    return { ok: false, problems: ["This version has no story yet. Start from a ready-made film first."] };
  }
  const next = JSON.parse(JSON.stringify(story));
  const changed = [];
  const notes = [];
  const clips = next.sequence.clips;
  if (patch && patch.theme !== undefined && patch.theme !== null) {
    const t = LOOK_THEMES[patch.theme];
    if (!t) {
      problems.push(`"${String(patch.theme).slice(0, 30)}" isn't one of the themes: ${Object.values(LOOK_THEMES).map((x) => x.label).join(', ')}.`);
    } else {
      const replaced = lookWouldReplace(story, patch.theme);
      if (replaced.length) notes.push(`This replaced your custom colours: ${replaced.join(', ')}.`);
      lookWrite(next, 'film', 'theme', { value: t.theme }, -1);
      for (const f of LOOK_RESET) lookWrite(next, 'look', f, { clear: true }, -1);
      for (const [f, v] of Object.entries(t.set)) lookWrite(next, 'look', f, { value: v }, -1);
      changed.push(`Theme: ${t.label}`);
    }
  }
  for (const scope of ['film', 'title', 'view', 'look']) {
    const part = patch && patch[scope];
    if (!part || typeof part !== 'object') continue;
    let clipIndex = -1;
    if (scope === 'title' || scope === 'view') {
      clipIndex = lookClipAt(clips, scope === 'title' ? 'title' : 'render', part.index);
      if (clipIndex < 0) {
        problems.push(scope === 'title' ? "There's no such title card in this film." : "There's no such data view in this film.");
        continue;
      }
    }
    for (const field of Object.keys(part)) {
      if (field === 'index') continue;
      const spec = LOOK_FIELDS[scope][field];
      if (!spec) { problems.push(`"${field}" isn't something that can be changed here.`); continue; }
      const res = lookCheck(field, spec, part[field]);
      if (res.problem) { problems.push(res.problem); continue; }
      if (res.note) notes.push(res.note);
      lookWrite(next, scope, field, res, clipIndex);
      changed.push(`${spec.label}${lookPlace(scope) ? ` (${lookPlace(scope)} ${Number(part.index || 0) + 1})` : ''}: ${res.clear ? 'removed' : String(res.value)}`);
    }
    if (scope === 'view' && clipIndex >= 0) {
      const c = clips[clipIndex];
      for (const [a, b] of [['start', 'end'], ['first_period', 'last_period']]) {
        if (c[a] && c[b] && String(c[a]).length === String(c[b]).length && String(c[a]) > String(c[b])) {
          problems.push(`The first period (${c[a]}) is after the last (${c[b]}).`);
        }
      }
    }
  }
  const ch = (next.sequence.style_overrides || {}).choropleth || {};
  if (ch.continuous === true && ch.mode !== 'solid') {
    problems.push('Smooth colour needs the map fill set to solid.');
  }
  if (patch && (patch.theme != null || (patch.look && Object.keys(patch.look).some((k) => /colou?r|fill|map_low|map_high|map_steps|map_mode/.test(k))) || (patch.film && patch.film.theme !== undefined))) {
    problems.push(...lookContrast(next.sequence));
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, story: next, changed, notes };
}

// Which named theme the story is on right now ('custom' when its colours were changed by hand).
function lookThemeName(seq) {
  const probe = JSON.parse(JSON.stringify({ sequence: seq }));
  for (const [key, t] of Object.entries(LOOK_THEMES)) {
    if ((seq.theme === 'light' ? 'light' : 'dark') !== t.theme) continue;
    const copy = JSON.parse(JSON.stringify(probe));
    lookWrite(copy, 'film', 'theme', { value: t.theme }, -1);
    for (const f of LOOK_RESET) lookWrite(copy, 'look', f, { clear: true }, -1);
    for (const [f, v] of Object.entries(t.set)) lookWrite(copy, 'look', f, { value: v }, -1);
    const strip = (x) => JSON.stringify((x.sequence.style_overrides || {}));
    if (strip(copy) === strip(probe)) return key;
  }
  return 'custom';
}

// What the controls show: the story's current values for every field above.
function describeLook(story) {
  const seq = (story && story.sequence) || {};
  const clips = Array.isArray(seq.clips) ? seq.clips : [];
  const so = seq.style_overrides || {};
  const ch = so.choropleth || {};
  return {
    theme_name: lookThemeName(seq),
    film: { theme: seq.theme === 'light' ? 'light' : 'dark', hold_seconds: seq.hold_seconds ?? null, canvas: lookCanvasName(seq), fps: seq.fps ?? 30 },
    titles: clips.filter((c) => c && c.kind === 'title').map((c) => ({
      headline: c.headline ?? '', subhead: c.subhead ?? '', credit: c.credit ?? '', seconds: c.seconds ?? 3, align: c.align ?? 'center', fade: c.fade ?? null })),
    views: clips.filter((c) => c && c.kind === 'render').map((c) => ({
      view: c.view, dataset: c.dataset, start: c.start ?? '', end: c.end ?? '', first_period: c.first_period ?? '', last_period: c.last_period ?? '',
      hold_seconds: c.hold_seconds ?? null, subtitle: c.subtitle ?? '', top_n: (c.settings || {}).top_n ?? null, axis: (c.settings || {}).axis ?? null,
      line_top_n: (c.settings || {}).line_top_n ?? null, period_years: (c.settings || {}).period_years ?? null,
      transition: (c.transition || {}).kind ?? null, transition_seconds: (c.transition || {}).seconds ?? null })),
    look: {
      map_mode: ch.mode ?? null, map_low: ch.low ?? null, map_high: ch.high ?? null, map_steps: ch.steps ?? null, map_continuous: ch.continuous ?? null,
      no_data_fill: (so.state || {}).no_data_fill ?? null, dot_color: (so.dots || {}).color ?? null, dot_baseline_color: (so.dots || {}).baseline_color ?? null,
      map_key_label: ch.single_label ?? null, no_data_label: (so.layout || {}).no_data_label ?? null, outline_width: (so.state || {}).outline_width ?? null,
      dot_value: (so.dots || {}).value ?? null, dot_radius: (so.dots || {}).radius ?? null, swap_seconds: (so.bars || {}).swap_seconds ?? null }
  };
}
// END SHARED

export { LOOK_FIELDS, LOOK_THEMES, LOOK_BASE, LOOK_PAGE_COLOURS_ACCEPTED, LOOK_CANVAS, LOOK_FPS, LOOK_SQUARE_ACCEPTED, applyLook, describeLook, lookDE, lookWouldReplace };
