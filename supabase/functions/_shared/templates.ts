// The story templates and catalog, for Edge Functions. Must build exactly what the app's
// assets/app-templates.js builds; tests/ai-editor.test.mjs compares every combination.
// Character ranges are built from code points here, never written as escapes, so this
// source stays plain ASCII (see tests/source-hygiene.test.cjs).

export const DATASETS: Record<string, { label: string; start: string; end: string }> = {
  state_obesity_fastfood: { label: "Obesity and fast food by state (CDC + Census, annual)", start: "2011", end: "2023" },
  bps_county_permits: { label: "Residential building permits per 1,000 residents, by county", start: "1990", end: "2024" },
  bls_state_unemployment: { label: "State unemployment rate (BLS LAUS, monthly)", start: "2019-01", end: "2022-12" },
};

export const TEMPLATES = [
  { id: "line", view: "line", label: "Line", blurb: "How a handful of places move over time.",
    datasets: ["bls_state_unemployment"], settings: { line_top_n: 6 } as Record<string, unknown> | undefined, confirmed: true },
  { id: "map", view: "map", label: "Map", blurb: "Where it is high and low, and how that shifts.",
    datasets: ["state_obesity_fastfood", "bps_county_permits"], settings: undefined, confirmed: true },
  { id: "bars", view: "bars", label: "Bars", blurb: "A ranked bar race: who leads, year by year.",
    datasets: ["bls_state_unemployment"], settings: { top_n: 10, axis: "fixed" }, confirmed: true },
  { id: "paired", view: "paired", label: "Paired", blurb: "A map and a bar race side by side, one timeline.",
    datasets: ["state_obesity_fastfood"], settings: undefined, confirmed: true },
];

// The worker's v1 render views; a story may use any of them on any catalog dataset.
export const RENDER_VIEWS = ["map", "bars", "line", "paired", "panel"];

function charClass(ranges: [number, number][]): RegExp {
  return new RegExp("[" + ranges.map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]", "g");
}
// What the schema refuses in text drawn on a frame: control and invisible characters.
const INVISIBLE = charClass([[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e],
                             [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]]);
const COMBINING = charClass([[0x0300, 0x036f]]);

export function cleanText(text: unknown, max: number): string {
  return String(text ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Story "name": ^[A-Za-z0-9][A-Za-z0-9-]{0,63}$
export function slug(text: unknown): string {
  const s = String(text ?? "").normalize("NFKD").replace(COMBINING, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  return s || "ryagram-story";
}

export function build(templateId: string, datasetId: string, headline: unknown) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error("Unknown template.");
  if (!t.datasets.includes(datasetId)) throw new Error("That dataset isn’t offered for this template.");
  const d = DATASETS[datasetId];
  const title = cleanText(headline, 160) || cleanText(d.label, 160);
  const render: Record<string, unknown> = { kind: "render", id: "main", dataset: datasetId, view: t.view, start: d.start, end: d.end,
                                            transition: { kind: "crossfade", seconds: 0.6 } };
  if (t.settings) render.settings = { ...t.settings };
  return {
    schema: 1,
    name: slug(title),
    engine: "sequence",
    notes: cleanText(`Started from the ${t.label} template. Edit the headline, the years (start and end) or the view, then make a contact sheet.`, 4000),
    sequence: {
      canvas: [1920, 1080],
      fps: 30,
      theme: "dark",
      hold_seconds: 0.5,
      clips: [
        { kind: "title", id: "open", seconds: 3, fade: 0.4, headline: title, subhead: cleanText(d.label, 160) },
        render,
      ],
    },
  };
}
