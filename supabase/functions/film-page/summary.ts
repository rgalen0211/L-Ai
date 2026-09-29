// What a public film page may say, built from the film's receipt by ALLOWLIST: every field is
// named here and copied as capped plain text. Anything else in the receipt (machine paths,
// cache fingerprints, reproduce commands, per-period coverage) never reaches the page.
// A film made from the owner's own upload names only "the maker's own data": no labels,
// links, notes or measures from the upload (marketing strategy: never uploaded data unless
// the owner chooses; that choice is not built yet).
//
// The receipt is read ONLY through pick(), against receipt-fields.json: an unlisted path throws,
// and a test fails if a listed path goes unused, so the list and the code can't drift apart.
import FIELDS from "./receipt-fields.json" with { type: "json" };

const ALLOWED = { top: new Set<string>(FIELDS.top), clip: new Set<string>(FIELDS.clip) };
export const USED = new Set<string>();             // "top:path" / "clip:path", for the coverage test

// A listed field of `obj`. For an array item, pass the item and the listed path: only the part
// after the last "[]." is walked.
function pick(scope: "top" | "clip", obj: any, path: string): any {
  if (!ALLOWED[scope].has(path)) throw new Error(`receipt field not on the allowlist: ${scope}:${path}`);
  USED.add(`${scope}:${path}`);
  const rel = path.includes("[].") ? path.slice(path.lastIndexOf("[].") + 3) : path;
  let cur = obj;
  for (const k of rel.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

const MAX_TEXT = 1200;
const MAX_ITEMS = 20;

// Plain text: no control or invisible characters, collapsed spaces, capped.
function text(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "\u2026" : s;
}

function httpsUrl(v: unknown): string {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch { return ""; }
}

// The engine's notes point at the private receipt ("see derivations", "the sidecar lists...");
// those sentences are dead ends on a public page, so they're dropped (as the publish kit does).
const PRIVATE = /sidecar|see derivations|receipt|cache|C:\\|\/home\/|\/Users\//i;
function publicText(v: unknown, max = MAX_TEXT): string {
  const parts = text(v, 4 * max).split(/(?<=[.!?;])\s+/).filter((s) => s && !PRIVATE.test(s));
  return text(parts.join(" ").replace(/[;,]\s*$/, ""), max);
}

const list = <T>(v: unknown, f: (x: any) => T | null): T[] =>
  (Array.isArray(v) ? v : []).map(f).filter((x): x is T => x != null).slice(0, MAX_ITEMS);

export interface Summary {
  headline: string; subhead: string;
  window: { start: string; end: string } | null;
  area: string;
  datasets: { label: string; credit: string; sources: { name: string; url: string; license: string }[]; method: string;
              retrieved: string; values_are: string;
              derivations: { measure: string; method: string }[];
              breaks: { period: string; what: string }[] }[];
  measures: { label: string; unit: string }[];
  uploaded_data: boolean;
  film: { seconds: number | null; width: number | null; height: number | null; fps: number | null };
  engine: { commit: string; drawn_at: string };
}

export function summarize(receipt: any, story: any, opts: { uploaded: boolean }): Summary {
  const C = (clip: any, path: string) => pick("clip", clip, path);
  const clipsRaw = pick("top", receipt, "clips");
  const clips: any[] = Array.isArray(clipsRaw) ? clipsRaw : [];
  const storyClips: any[] = Array.isArray(story?.sequence?.clips) ? story.sequence.clips : [];
  const storyTitle = storyClips.find((c) => c?.kind === "title");
  const receiptTitle = clips.find((c) => C(c, "kind") === "title");
  const headline = storyTitle ? storyTitle.headline : C(receiptTitle, "text.headline");
  const subhead = storyTitle ? storyTitle.subhead : C(receiptTitle, "text.subhead");
  // Only render clips carry provenance; titles and the outro have none (CC1, 2026-09-29).
  const withPv = clips.filter((c) => { const pv = C(c, "provenance"); return pv && typeof pv === "object"; });
  const first = withPv[0];

  const byId = new Map<string, Summary["datasets"][number]>();
  if (!opts.uploaded) {
    for (const c of withPv) {
      const key = text(C(c, "provenance.dataset.id"), 200) || text(C(c, "provenance.dataset.label"), 200);
      if (!key || byId.has(key)) continue;
      const dsLicense = text(C(c, "provenance.dataset.license"), 600);   // for sources that don't carry their own
      let sources = list(C(c, "provenance.dataset.sources"), (s) => {
        const name = text(C(s, "provenance.dataset.sources[].name"), 300);
        return name ? { name, url: httpsUrl(C(s, "provenance.dataset.sources[].url")),
                        license: text(C(s, "provenance.dataset.sources[].license"), 600) || dsLicense } : null;
      });
      const source = C(c, "provenance.dataset.source"), url = C(c, "provenance.dataset.url");
      if (!sources.length && (source || url)) {
        sources = [{ name: text(source, 300) || "Source", url: httpsUrl(url), license: dsLicense }];
      }
      byId.set(key, {
        label: text(C(c, "provenance.dataset.label"), 300),
        credit: text(C(c, "provenance.dataset.source_line"), 400),   // the credit the film itself draws
        sources,
        method: publicText(C(c, "provenance.dataset.notes")),
        retrieved: text(C(c, "provenance.data.retrieved"), 40),
        values_are: publicText(C(c, "provenance.data.values_are"), 300),
        derivations: list(C(c, "provenance.data.derivations"), (d) => {
          const measure = text(C(d, "provenance.data.derivations[].measure"), 300);
          const method = publicText(C(d, "provenance.data.derivations[].method"), 600);
          return measure && method ? { measure, method } : null;
        }),
        breaks: list(C(c, "provenance.methodology_breaks"), (b) => {
          const what = publicText(C(b, "provenance.methodology_breaks[].what"), 600);
          return what ? { period: text(C(b, "provenance.methodology_breaks[].period"), 40), what } : null;
        }),
      });
    }
  }

  const seen = new Set<string>();
  const allMeasures = withPv.flatMap((c) => { const m = C(c, "provenance.measures"); return Array.isArray(m) ? m : []; });
  const measures = opts.uploaded ? [] : list(allMeasures, (m) => {
    const label = text(C(m, "provenance.measures[].label_in_full"), 300) || text(C(m, "provenance.measures[].label"), 300);
    if (!label || seen.has(label)) return null;
    seen.add(label);
    return { label, unit: text(C(m, "provenance.measures[].unit"), 60) };
  });

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const canvas = pick("top", receipt, "output.canvas");
  const commit = text(pick("top", receipt, "inputs.code.commit"), 40);
  const start = first ? C(first, "provenance.window.start") : undefined;
  const end = first ? C(first, "provenance.window.end") : undefined;
  return {
    headline: text(headline, 200),
    subhead: text(subhead, 300),
    window: start != null && end != null ? { start: text(start, 20), end: text(end, 20) } : null,
    area: opts.uploaded || !first ? ""
      : [text(C(first, "provenance.geography.level"), 120), text(C(first, "provenance.geography.region"), 120)].filter(Boolean).join(", "),
    datasets: opts.uploaded
      ? [{ label: "The maker’s own data", credit: "", sources: [], method: "", retrieved: "", values_are: "", derivations: [], breaks: [] }]
      : [...byId.values()],
    measures,
    uploaded_data: opts.uploaded,
    film: { seconds: num(pick("top", receipt, "output.seconds")),
            width: num(Array.isArray(canvas) ? canvas[0] : null), height: num(Array.isArray(canvas) ? canvas[1] : null),
            fps: num(pick("top", receipt, "output.fps")) },
    engine: { commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 12) : "", drawn_at: text(pick("top", receipt, "drawn_at"), 40) },
  };
}
