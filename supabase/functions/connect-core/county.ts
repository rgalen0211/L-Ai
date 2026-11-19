// The county tools' words, closed rules and answer reader (CONNECT, 2026-11-09; BACKLOG CONNECT-4; contract proposals/CONNECT-COUNTY-TOOLS-CONTRACT-1109.md).
// GEO owns every sentence here (proposals/GEO-LI-TOOL-WORDS-1109.md: the descriptions, the fixed lines, the refusals); CONNECT wires them as they are. The rules (which counties, which kind, which rules, which years) are a CLOSED list in this one
// place, the same as GEO's tool refuses on, so the connector never sends a request the tool would refuse. The answer reader is the lock on the way back: nothing the house computer wrote is shown unless every figure is labelled, sourced and dated,
// no sentence holds a path on a computer or a banned claim, and an order follows only the stated rule. Pure functions, no dependencies.

export const COUNTY_LIST: Readonly<Record<string, string>> = Object.freeze({ "39057": "Greene County, Ohio", "39113": "Montgomery County, Ohio" });
export const COUNTY_KINDS = ["limited_service", "grocery", "pharmacy", "eating_places"] as const;
export type CountyKind = (typeof COUNTY_KINDS)[number];
/** The kinds' own words, GEO's (Ryan Q551): the title is OURS to show, never the answer's. */
export const COUNTY_KIND_TITLES: Readonly<Record<string, string>> = Object.freeze({ limited_service: "limited-service restaurants", grocery: "supermarkets and other grocery stores", pharmacy: "pharmacies and drug stores", eating_places: "restaurants and other eating places" });
export const COUNTY_RULES: Readonly<Record<string, string>> = Object.freeze({
  per_10k_low_first: "places per 10,000 residents, lowest first", per_10k_high_first: "places per 10,000 residents, highest first", count_high_first: "the count of places, highest first",
});
export const YEAR_MIN = 1998, YEAR_MAX = 2024;
const COVERS = "Greene County, Ohio (39057) and Montgomery County, Ohio (39113)";
const KINDS_WORDS = "Kinds: " + COUNTY_KINDS.map((k) => `${k} (${COUNTY_KIND_TITLES[k]})`).join(", ");

/** GEO's descriptions for the connector manifest, word for word. */
export const COUNTY_PROFILE_DESCRIPTION = "Every figure Ryagram already holds for one county and limited-service restaurants: counts of places and places per 10,000 residents, employees and payroll, QCEW jobs and wages paid where held, housing permits, and population. "
  + "Each figure carries its label (Observed or Calculated) and its source. It never downloads, forecasts, scores or ranks. Version one covers Greene County, Ohio (39057) and Montgomery County, Ohio (39113).";
export const COMPARE_COUNTIES_DESCRIPTION = "The same figures for two or more counties side by side. With no rule they stay in the order asked. With a rule the person states (places per 10,000 residents, lowest or highest first, or the count of places, highest first) "
  + "they are ordered by that rule only, in the latest year every county has a figure, or the year asked. It is not a ranking: if a county has no figure that year, nothing is ordered and the county is named.";

/** The fixed lines every answer carries (GEO section 3); a comparison carries a fourth. */
export const SAY_LINES = [
  "Ryagram counts places, jobs, wages paid, permits and people. It has no sales data, so it cannot say where a business would do well.",
  "These are counts of places, not of sales or customers.",
  "An order shown here follows the stated rule only; it is not a ranking of better places.",
] as const;
export const SAY_COMPARE = "This order follows only the rule you stated. It is not a ranking, and it does not say where a restaurant would do well.";
export const SOURCES_NEVER_ADDED = "QCEW and County Business Patterns count differently; their figures are never added together or averaged.";

/** What GEO's guard bans in the tools' own text (their section 6); the connector refuses an answer that holds any of it. */
export const BANNED_WORDS: readonly RegExp[] = [
  /will do well|would do well|do well|succeed|success/i, /\bprofit/i, /(?<!\b(?:no|not|never|without|cannot)\b[^.;,]{0,12})\bdemand\b/i, /(?<!\b(?:no|not|never|without|cannot)\b[^.;,]{0,12})\bsales\b(?! data)/i, /footfall|foot traffic/i, /best (location|spot|place)/i, /\bpermitted to\b|\b(?:is|are|be|being) permitted\b|allowed to (open|build)|zoning allows/i,
  /food desert/i, /under-?served/i, /saturat/i, /lack(s|ing)? access/i, /too (many|few) /i, /not enough .{0,30}(places|restaurants|stores)/i, /room for (another|more)/i,
];
/** A drive path, a UNC path or a user folder: never shown to a person. */
export const PATHISH = /[A-Za-z]:[\\/]|\\\\[A-Za-z0-9]|\/(Users|home|mnt|var|tmp)\/|\.\.[\\/]|ryagram-cache|%[A-Za-z]+%/i;

const hidden = (s: string) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true; }
  return false; };
/** What the person's own value looks like when GEO's refusal echoes it: cleaned and short, so an odd value can never shape the sentence. */
const echo = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9 _.-]/g, "?").slice(0, 24);
const isFips = (v: unknown): v is string => typeof v === "string" && /^[0-9]{5}$/.test(v);

export interface CountyAsk { shape: "profile" | "compare"; counties: string[]; kind: CountyKind; rule: string | null; year: number | null }

/** GEO's refusals, exactly as their tool words them (and "not offered yet" for the two kinds that come later). Returns the sentence, or the closed request. */
/** The most counties in one comparison: about 19.5 KB of answer a county, 64 KB an answer. Widening it needs a smaller answer first, never a bigger cap. */
export const COMPARE_MAX = 3;
export function checkCountyArgs(shape: "profile" | "compare", a: Record<string, unknown>): { refused: string } | { ask: CountyAsk } {
  const kind = a.kind === undefined ? "limited_service" : a.kind;                       // a missing kind means restaurants, as before
  if (typeof kind !== "string" || !(COUNTY_KINDS as readonly string[]).includes(kind)) {
    if (kind === "food_drink") return { refused: "kind 'food_drink' is not in version one: all of NAICS 722 also counts bars and drinking places (7224) and caterers and mobile food (7223), which are not restaurants. " + KINDS_WORDS };
    return { refused: `kind '${echo(kind)}' is not one this tool knows; it is not guessed. ${KINDS_WORDS}` };
  }
  if (shape === "profile") {
    const c = a.county;
    if (!isFips(c)) return { refused: `county '${echo(c)}': a county is its 5-digit FIPS code (state + county), for example 39057` };
    if (!(c in COUNTY_LIST)) return { refused: `county ${c}: version one covers only ${COVERS}; every other county comes once per-county extracts exist. Nothing is guessed for it.` };
    return { ask: { shape, counties: [c], kind: kind as CountyKind, rule: null, year: null } };
  }
  const cs = a.counties;
  if (!Array.isArray(cs) || cs.some((c) => !isFips(c))) return { refused: "counties: give a list of 5-digit FIPS codes, for example ['39057', '39113']" };
  const list = cs as string[];
  if (list.length > COMPARE_MAX) return { refused: `counties: a comparison is for two or three counties at a time (${list.length} were given): more would make the answer longer than this connection can carry. Ask again with three or fewer.` };       // a county costs about 19.5 KB of answer and an answer may not pass 64 KB (CC1 07:56 11-10)
  const off = list.find((c) => !(c in COUNTY_LIST));
  if (off !== undefined) return { refused: `county ${off}: version one covers only ${COVERS}; every other county comes once per-county extracts exist. Nothing is guessed for it.` };
  if (list.length < 2 || new Set(list).size !== list.length) return { refused: `counties [${list.map((c) => `'${c}'`).join(", ")}]: a comparison needs two or more different counties; version one covers ${COVERS}` };
  const rule = a.rule === undefined ? null : a.rule;
  if (rule !== null && (typeof rule !== "string" || !(rule in COUNTY_RULES))) {
    return { refused: `rule '${echo(rule)}' is not one this tool knows; an order is never guessed. Rules: ${Object.entries(COUNTY_RULES).map(([k, v]) => `${k} (${v})`).join(", ")}` };
  }
  const year = a.year === undefined ? null : a.year;
  if (year !== null) {
    if (rule === null) return { refused: "a year chooses the year a stated rule orders by; with no rule the counties are shown side by side, in the order asked" };
    if (typeof year !== "number" || !Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return { refused: `year ${echo(year)}: a 4-digit year from ${YEAR_MIN} to ${YEAR_MAX}` };
  }
  return { ask: { shape, counties: list, kind: kind as CountyKind, rule: rule as string | null, year: year as number | null } };
}

export const PROFILE_SCHEMA = "ryagram.geo-county-profile/0";
export const COMPARE_SCHEMA = "ryagram.geo-compare-counties/1";      // the slim comparison (GEO, CC1 09:06): county_figures, not whole profiles
/** The lines a kind adds to the fixed ones (GEO's, word for word); the comparison's own closing line differs by kind. */
const KIND_SAY: Readonly<Record<string, string>> = Object.freeze({
  grocery: "Ryagram counts grocery stores and people. It does not measure how far anyone travels to buy food, what they buy, or whether an area has enough stores.",
  pharmacy: "Ryagram counts pharmacies and people. It does not measure prescriptions, opening hours, or whether an area has enough pharmacies.",
});
const KIND_SAY_COMPARE: Readonly<Record<string, string>> = Object.freeze({
  grocery: "This order follows only the rule you stated. It is not a ranking, and it does not say where a store would do well or whether an area has enough stores.",
  pharmacy: "This order follows only the rule you stated. It is not a ranking, and it does not say where a pharmacy would do well or whether an area has enough pharmacies.",
});
/** The fixed lines for an answer of this kind and shape: never taken from the answer. */
export const saysFor = (kind: string, shape: "profile" | "compare"): string[] => [...SAY_LINES, ...(KIND_SAY[kind] ? [KIND_SAY[kind]] : []), ...(shape === "compare" ? [KIND_SAY_COMPARE[kind] ?? SAY_COMPARE] : [])];
const MEASURE_OF_RULE: Readonly<Record<string, string>> = Object.freeze({ per_10k_low_first: "per_10k", per_10k_high_first: "per_10k", count_high_first: "establishments" });
const REVERSE_RULE: Readonly<Record<string, boolean>> = Object.freeze({ per_10k_low_first: false, per_10k_high_first: true, count_high_first: true });
const READ_HOW: Readonly<Record<string, string>> = Object.freeze({ per_county_extract: "read from the per-county extract", national_files: "read from the national files" });

export interface CountyYear { year: number; value: number | null; note: string | null }
export interface CountySeries { measure: string; title: string; label: "Observed" | "Calculated"; source: string; unit: string; breaks: number[]; note: string | null; years: CountyYear[] }
export interface CountyProfile { fips: string; name: string; kind_title: string; series: CountySeries[]; not_held: { source: string; why: string }[]; withheld: number; read_from: string | null; more: string | null }
export interface CountyTableRow { fips: string; year: number; value: number | null; label: "Observed" | "Calculated"; source: string; unit: string; note: string | null }
export interface CountyRead { shape: "profile" | "compare"; kind: string; say: string[]; profiles: CountyProfile[]; rule: string | null; rule_year: number | null; ordered: boolean; order_words: string | null; table: CountyTableRow[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
/** Plain words a person may be shown: no hidden character, no path on a computer (a web address counts: any "x:/" does), none of the banned claims. */
export function plainWords(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.length > max || hidden(s) || PATHISH.test(s) || BANNED_WORDS.some((re) => re.test(s))) return null;
  return s;
}
/** Optional plain words: absent or empty is null; present and not plain is "bad" (the whole answer is then not shown). */
const optWords = (v: unknown, max: number): string | null | "bad" => (v === undefined || v === null || v === "" ? null : plainWords(v, max) ?? "bad");

function readSeries(v: unknown): CountySeries | null {
  if (!isObj(v)) return null;
  const measure = typeof v.measure === "string" && /^[a-z0-9_]{2,40}$/.test(v.measure) ? v.measure : null;
  const title = plainWords(v.title, 120), source = plainWords(v.source, 200), unit = v.unit === "" || v.unit === undefined || v.unit === null ? "" : plainWords(v.unit, 80);
  const note = optWords(v.note, 600);
  if (!measure || !title || !source || unit === null || note === "bad") return null;
  if (v.label !== "Observed" && v.label !== "Calculated") return null;                          // this tool has no estimates: an unlabelled or Estimated series is not shown
  if (/QCEW/i.test(source) && /County Business Patterns|\bCBP\b/i.test(source)) return null;      // two sources are never added or averaged into one series
  const breaks = v.breaks === undefined ? [] : v.breaks;
  if (!Array.isArray(breaks) || breaks.length > 20 || breaks.some((b) => !intIn(b, 1900, 2100))) return null;
  if (!Array.isArray(v.years) || v.years.length > 120) return null;
  const years: CountyYear[] = [];
  for (const y of v.years) {
    if (!isObj(y) || !intIn(y.year, 1900, 2100)) return null;
    const value = y.value === null || y.value === undefined ? null : y.value;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return null;
    const yn = optWords(y.note, 300);
    if (yn === "bad" || (value === null && yn === null)) return null;                             // a missing figure always says why: it is never read as zero
    years.push({ year: y.year, value, note: yn });
  }
  return { measure, title, label: v.label, source, unit, breaks: breaks as number[], note, years };
}

/** The part a profile and a comparison's county figures share: the series, what is not held, how it was read. */
function readBody(v: Record<string, unknown>, county: string, kind: string): CountyProfile | null {
  if (!Array.isArray(v.series) || v.series.length > 20) return null;
  const series: CountySeries[] = [];
  for (const s of v.series) { const r = readSeries(s); if (!r) return null; series.push(r); }
  // what is not held: the {source, why} items when GEO gives them, else the sentences (one that names a place on a computer is left out and counted, never shown)
  let not_held: { source: string; why: string }[] = [], withheld = 0;
  if (Array.isArray(v.not_held_items)) {
    if (v.not_held_items.length > 30) return null;
    for (const e of v.not_held_items) { const source = isObj(e) ? plainWords(e.source, 100) : null, why = isObj(e) ? plainWords(e.why, 300) : null; if (source && why) not_held.push({ source, why }); else withheld++; }
  } else if (Array.isArray(v.not_held)) {
    if (v.not_held.length > 30) return null;
    for (const t of v.not_held) { const w = plainWords(t, 400); if (w) { const i = w.indexOf(": "); not_held.push(i > 0 ? { source: w.slice(0, i), why: w.slice(i + 2) } : { source: "A source", why: w }); } else withheld++; }
  } else if (v.not_held !== undefined) return null;
  not_held = not_held.slice(0, 30);
  const read_from = typeof v.read_how === "string" && v.read_how in READ_HOW ? READ_HOW[v.read_how] : (plainWords(v.read_from, 300));   // a sentence that names a folder is left out; the how-it-was-read words stand in for it
  return { fips: county, name: COUNTY_LIST[county], kind_title: COUNTY_KIND_TITLES[kind], series, not_held, withheld, read_from, more: null };
}

/** One county's profile as GEO's tool gives it, for the kind asked. `expect` = the county asked about; null = not that county. */
export function readProfile(v: unknown, expect: string | null, kind: string = "limited_service"): CountyProfile | null {
  if (!isObj(v) || v.schema !== PROFILE_SCHEMA || v.kind !== kind || !(kind in COUNTY_KIND_TITLES)) return null;
  if (!isFips(v.county) || !(v.county in COUNTY_LIST) || (expect !== null && v.county !== expect)) return null;
  if (typeof v.forecast !== "string" || !v.forecast.startsWith("none")) return null;             // this tool never forecasts: an answer that does is not shown
  return readBody(v, v.county, kind);
}

/** One county's figures inside a slim comparison: only the series the rules order by, what is not held, and a pointer to the full profile (which must be for THIS county and kind). */
function readFigures(v: unknown, county: string, kind: string): CountyProfile | null {
  if (!isObj(v) || v.county !== county || !(county in COUNTY_LIST) || !(kind in COUNTY_KIND_TITLES)) return null;
  const p = readBody(v, county, kind);
  if (!p) return null;
  const fp = v.full_profile;
  if (!isObj(fp) || fp.tool !== "county_profile" || fp.county !== county || fp.kind !== kind) return null;
  const words = plainWords(fp.words, 300);
  if (!words) return null;
  p.more = words;
  return p;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
/** The answer the house computer stored, read against the request. null = not in a shape this connection will show (and nothing of it is). */
export function readCountyAnswer(ask: { shape: "profile" | "compare"; counties: string[]; kind: string; rule: string | null; year: number | null }, answer: unknown): CountyRead | null {
  if (!isObj(answer)) return null;
  if (ask.shape === "profile") {
    const p = readProfile(answer, ask.counties[0], ask.kind);
    return p ? { shape: "profile", kind: ask.kind, say: saysFor(ask.kind, "profile"), profiles: [p], rule: null, rule_year: null, ordered: false, order_words: null, table: [] } : null;
  }
  if (answer.schema !== COMPARE_SCHEMA || answer.kind !== ask.kind || !(ask.kind in COUNTY_KIND_TITLES) || typeof answer.forecast !== "string" || !answer.forecast.startsWith("none")) return null;
  if (!Array.isArray(answer.counties) || !Array.isArray(answer.county_figures) || answer.counties.length !== ask.counties.length || answer.county_figures.length !== ask.counties.length) return null;
  const shown = answer.counties.map((c) => (isObj(c) && isFips(c.county) ? c.county : ""));
  if ([...shown].sort().join() !== [...ask.counties].sort().join()) return null;            // exactly the counties asked about, once each
  const profiles = answer.county_figures.map((p, i) => readFigures(p, shown[i], ask.kind));
  if (profiles.some((p) => p === null)) return null;
  const got = profiles as CountyProfile[];
  // the rule: the one stated (or none), and the year the answer says it used
  let rule: string | null = null, rule_year: number | null = null;
  if (answer.rule !== null && answer.rule !== undefined) {
    if (!isObj(answer.rule) || answer.rule.id !== ask.rule || ask.rule === null) return null;
    rule = ask.rule;
    if (answer.rule.year !== null && answer.rule.year !== undefined) { if (!intIn(answer.rule.year, YEAR_MIN, YEAR_MAX)) return null; rule_year = answer.rule.year; }
    if (ask.year !== null && rule_year !== null && rule_year !== ask.year) return null;
  } else if (ask.rule !== null) return null;
  if (typeof answer.ordered !== "boolean" || (answer.ordered && rule === null)) return null;            // an order only under a stated rule
  const order_words = optWords(answer.order_words, 400);
  if (order_words === "bad") return null;
  if (!Array.isArray(answer.rule_table) || answer.rule_table.length > 10) return null;
  const table: CountyTableRow[] = [];
  for (const r of answer.rule_table) {
    if (!isObj(r) || !isFips(r.county) || !(r.county in COUNTY_LIST) || !intIn(r.year, YEAR_MIN, YEAR_MAX) || (r.label !== "Observed" && r.label !== "Calculated")) return null;
    const value = r.value === null || r.value === undefined ? null : r.value;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return null;
    const source = plainWords(r.source, 200), unit = r.unit === "" || r.unit === undefined || r.unit === null ? "" : plainWords(r.unit, 80), note = optWords(r.note, 300);
    if (!source || unit === null || note === "bad" || (value === null && note === null)) return null;
    table.push({ fips: r.county, year: r.year, value, label: r.label, source, unit, note });
  }
  if (answer.ordered) {
    // an order only when every county has a figure, and it follows the stated rule and nothing else; equal values keep the order the counties were asked in
    if (table.length !== got.length || !sameList(table.map((r) => r.fips), shown) || table.some((r) => r.value === null || r.year !== rule_year)) return null;
    const rev = REVERSE_RULE[rule as string];
    for (let i = 1; i < table.length; i++) {
      const a = table[i - 1].value as number, b = table[i].value as number;
      if (rev ? a < b : a > b) return null;
      if (a === b && ask.counties.indexOf(table[i - 1].fips) > ask.counties.indexOf(table[i].fips)) return null;
    }
    // and the figures in the table are the figures in the profiles
    const measure = MEASURE_OF_RULE[rule as string];
    for (const [i, r] of table.entries()) {
      const s = got[i].series.find((x) => x.measure === measure), y = s?.years.find((x) => x.year === r.year);
      if (!s || !y || y.value !== r.value) return null;
    }
  } else if (!sameList(shown, ask.counties)) return null;                                            // no order made: the counties stay in the order asked
  return { shape: "compare", kind: ask.kind, say: saysFor(ask.kind, "compare"), profiles: got, rule, rule_year, ordered: answer.ordered, order_words, table };
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : String(Math.round(x * 100) / 100));
function seriesLine(s: CountySeries, wrap: (t: string) => string): string {
  const held = s.years.filter((y) => y.value !== null), last = s.years[s.years.length - 1];
  const unit = s.unit ? ` ${wrap(s.unit)}` : "";
  const latest = !last ? "no years held" : last.value === null ? `${last.year}: no figure (${wrap(last.note as string)})` : `${last.year}: ${fmt(last.value)}${unit}`;
  const span = held.length ? ` Held ${held[0].year} to ${held[held.length - 1].year} (${held.length} years).` : "";
  const brk = s.breaks.length ? ` Series break${s.breaks.length === 1 ? "" : "s"}: ${s.breaks.join(", ")}.` : "";
  return `  ${wrap(s.title)}: ${latest}. ${s.label}; ${wrap(s.source)}.${span}${brk}${s.note ? " " + wrap(s.note) : ""}`;
}
/** The text the AI reads: the fixed lines first, then each county's series (the latest year, with the years held and the breaks; every year is in the structured answer), what is not held, then the order (if a rule was stated). `wrap` marks free text as data. */
export function countyLines(r: CountyRead, wrap: (s: string) => string): string[] {
  const lines = [r.shape === "profile" ? "COUNTY PROFILE (figures are Observed or Calculated, never estimated)" : "COUNTY COMPARISON (figures are Observed or Calculated, never estimated)", ...r.say];
  for (const p of r.profiles) {
    lines.push(`${p.name} (${p.fips}), ${p.kind_title}:`);
    for (const s of p.series) lines.push(seriesLine(s, wrap));
    if (p.not_held.length) { lines.push("Not held:"); for (const n of p.not_held) lines.push(`  ${wrap(n.source)}: ${wrap(n.why)}`); }
    if (p.withheld) lines.push(`(${p.withheld} source line${p.withheld === 1 ? " was" : "s were"} left out because ${p.withheld === 1 ? "it" : "they"} named a place on a computer.)`);
    if (p.read_from) lines.push(`Read from: ${wrap(p.read_from)}`);
    if (p.more) lines.push(`More: ${wrap(p.more)}`);
  }
  if (r.shape === "compare") {
    if (r.ordered && r.rule) lines.push(`Order (${COUNTY_RULES[r.rule]}${r.rule_year === null ? "" : `, ${r.rule_year}`}): ${r.table.map((t) => `${COUNTY_LIST[t.fips]} (${t.fips}) ${t.value === null ? "" : fmt(t.value)}`.trim()).join(", then ")}.${r.order_words ? " " + wrap(r.order_words) : ""}`);
    else lines.push(r.order_words ? wrap(r.order_words) : "No order was made: the counties are shown in the order asked.");
  }
  lines.push(SOURCES_NEVER_ADDED);
  return lines;
}
