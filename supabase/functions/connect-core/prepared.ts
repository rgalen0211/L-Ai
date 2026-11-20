// AI-PREPARED DATA, the connector's side (CONNECT, 2026-11-20; Q634). The person's own AI hands Ryagram a small table it researched (place, year, value ...) with its sources. This file READS that table the
// way Ryagram will: it parses the CSV text strictly, MEASURES what it can (rows, columns, the periods it really finds and the ones missing in between) and says what is wrong in plain words, before anything is stored.
// What the AI CLAIMS about its table (the change log, the licence, the units, the sources) is never measured here; it is shown to the person as "declared by your AI, not checked by Ryagram".
// Pure functions, no network, no storage: the database (migration 20261120000500_prepared_data.sql) is the second lock and stores the result as inert text.

export const PREPARED_LIMITS = Object.freeze({ maxBytes: 204800, maxRows: 5000, maxColumns: 40, maxCell: 300, maxLogSteps: 12, maxLogStep: 200, maxSources: 5, maxLabel: 120 });

export interface Measured {
  rows: number; columns: number; header: string[]; places: number | null;
  place_column: string | null; period_column: string | null; value_column: string | null;
  first_period: number | null; last_period: number | null; periods_found: number | null; periods_missing: number[];
  shape: "long" | "wide" | "unknown"; non_numeric_values: number;
}
/** A cell that a spreadsheet would run as a formula: it starts with =, + or @, or with a minus and then anything but a digit or a dot. Refused before the table is stored or ever drawn. */
const FORMULA = /^[=+@]|^-[^0-9.]/;
export type Parsed = { ok: true; header: string[]; rows: string[][] } | { ok: false; problem: string };

/** Strict CSV (RFC 4180 shape): commas, double-quoted cells with "" for a quote, LF or CRLF line ends, an optional BOM. A row with another number of cells than the header is refused WITH ITS NUMBER. */
export function parseCsv(text: string): Parsed {
  if (typeof text !== "string") return { ok: false, problem: "The table must be CSV text." };
  if (new TextEncoder().encode(text).length > PREPARED_LIMITS.maxBytes) return { ok: false, problem: "The table is over 200 KB. For a bigger table, give the person the cleaned file to upload by hand." };
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return { ok: false, problem: "The table has control characters in it. Send plain CSV text." };
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[][] = [];
  let row: string[] = [], cell = "", inQ = false, i = 0;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); if (!(row.length === 1 && row[0].trim() === "")) out.push(row); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (i + 1 < s.length && s[i + 1] !== ',' && s[i + 1] !== '\n') return { ok: false, problem: "A quoted cell has text after its closing quote. Check the quotes in the table." };
        inQ = false; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"' && cell === "") { inQ = true; i += 1; continue; }
    if (ch === ",") { pushCell(); i += 1; continue; }
    if (ch === "\n") { pushRow(); i += 1; continue; }
    cell += ch; i += 1;
  }
  if (inQ) return { ok: false, problem: "A quoted cell is never closed. Check the quotes in the table." };
  if (cell !== "" || row.length) pushRow();
  if (out.length < 3) return { ok: false, problem: "The table needs a header row and at least 2 data rows." };
  const header = out[0].map((h) => h.trim());
  if (header.length < 2) return { ok: false, problem: "The table needs at least 2 columns (a place and a value, with the year as a column or as the column titles)." };
  if (header.length > PREPARED_LIMITS.maxColumns) return { ok: false, problem: `The table has ${header.length} columns; the most is ${PREPARED_LIMITS.maxColumns}.` };
  if (header.some((h) => h === "")) return { ok: false, problem: "Every column needs a title in the header row." };
  if (header.some((h) => h.length > 60)) return { ok: false, problem: "A column title is longer than 60 characters. Use short titles." };
  if (out.length - 1 > PREPARED_LIMITS.maxRows) return { ok: false, problem: `The table has ${out.length - 1} rows; the most is ${PREPARED_LIMITS.maxRows}.` };
  const rows = out.slice(1);
  for (let r = 0; r < rows.length; r += 1) {
    if (rows[r].length !== header.length) return { ok: false, problem: `Row ${r + 2} of the table has ${rows[r].length} cells but the header has ${header.length}. Fix that row.` };
    for (const c of rows[r]) if (FORMULA.test(c)) return { ok: false, problem: `Row ${r + 2} has a cell that starts with =, +, @ or - and then something that is not a number (a spreadsheet formula). Send the value, not a formula.` };
    for (const c of rows[r]) if (c.length > PREPARED_LIMITS.maxCell) return { ok: false, problem: `Row ${r + 2} has a cell of more than ${PREPARED_LIMITS.maxCell} characters. Send the data, not text around it.` };
  }
  return { ok: true, header, rows };
}

const YEAR = /^(1[89]\d\d|20\d\d|21\d\d)$/;
const isNum = (v: string) => v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""));
const PLACE_NAMES = /^(place|state|county|geography|geo|name|area|region|location|state name|county name)$/i;
const PERIOD_NAMES = /^(year|period|date|time)$/i;

/** What Ryagram can say about the table from the text alone. Never trusts the AI's own counts. */
export function measure(p: Extract<Parsed, { ok: true }>): Measured {
  const { header, rows } = p;
  const yearCols = header.map((h, i) => (YEAR.test(h) ? i : -1)).filter((i) => i >= 0);
  let shape: Measured["shape"] = "unknown";
  let placeCol = header.findIndex((h) => PLACE_NAMES.test(h));
  let periodCol = header.findIndex((h) => PERIOD_NAMES.test(h));
  let valueCol = -1;
  const years = new Set<number>();
  let nonNumeric = 0;
  if (yearCols.length >= 2 && periodCol < 0) {                                      // wide: one column per year
    shape = "wide";
    if (placeCol < 0) placeCol = header.findIndex((_, i) => !yearCols.includes(i));
    for (const c of yearCols) years.add(Number(header[c]));
    for (const r of rows) for (const c of yearCols) if (r[c].trim() !== "" && !isNum(r[c])) nonNumeric += 1;
  } else {
    if (periodCol < 0) periodCol = header.findIndex((_, i) => rows.length > 0 && rows.every((r) => YEAR.test(r[i].trim())));
    if (periodCol >= 0) {
      shape = "long";
      for (const r of rows) { const y = r[periodCol].trim(); if (YEAR.test(y)) years.add(Number(y)); }
      if (placeCol < 0) placeCol = header.findIndex((h, i) => i !== periodCol && rows.some((r) => r[i].trim() !== "" && !isNum(r[i])));
      valueCol = header.findIndex((h, i) => i !== periodCol && i !== placeCol && rows.filter((r) => isNum(r[i])).length >= Math.max(1, Math.floor(rows.length / 2)));
      if (valueCol >= 0) for (const r of rows) if (r[valueCol].trim() !== "" && !isNum(r[valueCol])) nonNumeric += 1;
    }
  }
  const ys = [...years].sort((a, b) => a - b);
  const first = ys.length ? ys[0] : null, last = ys.length ? ys[ys.length - 1] : null;
  const missing: number[] = [];
  if (first !== null && last !== null && last - first <= 200) for (let y = first; y <= last; y += 1) if (!years.has(y)) missing.push(y);
  const places = placeCol >= 0 ? new Set(rows.map((r) => r[placeCol].trim()).filter((v) => v !== "")).size : null;
  return {
    rows: rows.length, columns: header.length, header: header.slice(0, 40), places,
    place_column: placeCol >= 0 ? header[placeCol] : null, period_column: periodCol >= 0 ? header[periodCol] : null, value_column: valueCol >= 0 ? header[valueCol] : null,
    first_period: first, last_period: last, periods_found: ys.length || null, periods_missing: missing.slice(0, 60), shape, non_numeric_values: nonNumeric,
  };
}

/** The plain sentence about what Ryagram measured, including the periods that are missing (the honest "missing stays missing"). */
export function describeMeasured(m: Measured): string {
  const bits = [`${m.rows} rows and ${m.columns} columns`];
  if (m.places !== null) bits.push(`${m.places} places`);
  if (m.first_period !== null && m.last_period !== null) bits.push(`years ${m.first_period} to ${m.last_period} (${m.periods_found} found${m.periods_missing.length ? `; NO rows for ${m.periods_missing.join(", ")}` : ""})`);
  else bits.push("no year could be found: name a column year, or title the columns with the years");
  if (m.non_numeric_values) bits.push(`${m.non_numeric_values} value${m.non_numeric_values === 1 ? "" : "s"} that are not numbers`);
  return bits.join("; ") + ".";
}
