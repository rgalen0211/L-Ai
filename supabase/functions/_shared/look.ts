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
    dot_value: { label: 'One dot stands for', kind: 'num', lo: 1, hi: 1000000, int: true },
    dot_radius: { label: 'Dot size', kind: 'num', lo: 0.5, hi: 6 },
    swap_seconds: { label: 'Seconds for one bar to pass another', kind: 'num', lo: 0, hi: 1.5 }
  }
};

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
  if (problems.length) return { ok: false, problems };
  return { ok: true, story: next, changed, notes };
}

// What the controls show: the story's current values for every field above.
function describeLook(story) {
  const seq = (story && story.sequence) || {};
  const clips = Array.isArray(seq.clips) ? seq.clips : [];
  const so = seq.style_overrides || {};
  const ch = so.choropleth || {};
  return {
    film: { theme: seq.theme === 'light' ? 'light' : 'dark', hold_seconds: seq.hold_seconds ?? null },
    titles: clips.filter((c) => c && c.kind === 'title').map((c) => ({
      headline: c.headline ?? '', subhead: c.subhead ?? '', credit: c.credit ?? '', seconds: c.seconds ?? 3, align: c.align ?? 'center', fade: c.fade ?? null })),
    views: clips.filter((c) => c && c.kind === 'render').map((c) => ({
      view: c.view, dataset: c.dataset, start: c.start ?? '', end: c.end ?? '', first_period: c.first_period ?? '', last_period: c.last_period ?? '',
      hold_seconds: c.hold_seconds ?? null, subtitle: c.subtitle ?? '', top_n: (c.settings || {}).top_n ?? null, axis: (c.settings || {}).axis ?? null,
      line_top_n: (c.settings || {}).line_top_n ?? null, period_years: (c.settings || {}).period_years ?? null,
      transition: (c.transition || {}).kind ?? null, transition_seconds: (c.transition || {}).seconds ?? null })),
    look: {
      map_mode: ch.mode ?? null, map_low: ch.low ?? null, map_high: ch.high ?? null, map_steps: ch.steps ?? null, map_continuous: ch.continuous ?? null,
      map_key_label: ch.single_label ?? null, no_data_label: (so.layout || {}).no_data_label ?? null, outline_width: (so.state || {}).outline_width ?? null,
      dot_value: (so.dots || {}).value ?? null, dot_radius: (so.dots || {}).radius ?? null, swap_seconds: (so.bars || {}).swap_seconds ?? null }
  };
}
// END SHARED

export { LOOK_FIELDS, applyLook, describeLook };
