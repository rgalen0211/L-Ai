// What a public film page may say, built from the film's receipt by ALLOWLIST: every field is
// named here and copied as capped plain text. Anything else in the receipt (machine paths,
// cache fingerprints, reproduce commands, per-period coverage) never reaches the page.
// A film made from the owner's own upload names only "the maker's own data": no labels,
// links, notes or measures from the upload (marketing strategy: never uploaded data unless
// the owner chooses; that choice is not built yet).

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
  datasets: { label: string; sources: { name: string; url: string; license: string }[]; method: string;
              retrieved: string; values_are: string;
              derivations: { measure: string; method: string }[];
              breaks: { period: string; what: string }[] }[];
  measures: { label: string; unit: string }[];
  uploaded_data: boolean;
  film: { seconds: number | null; width: number | null; height: number | null; fps: number | null };
  engine: { commit: string; drawn_at: string };
}

export function summarize(receipt: any, story: any, opts: { uploaded: boolean }): Summary {
  const clips: any[] = Array.isArray(receipt?.clips) ? receipt.clips : [];
  const storyClips: any[] = Array.isArray(story?.sequence?.clips) ? story.sequence.clips : [];
  const title = storyClips.find((c) => c?.kind === "title") ?? clips.find((c) => c?.kind === "title")?.text ?? {};
  const pvs = clips.map((c) => c?.provenance).filter((p) => p && typeof p === "object");
  const first = pvs[0] ?? {};

  const byId = new Map<string, Summary["datasets"][number]>();
  if (!opts.uploaded) {
    for (const pv of pvs) {
      const ds = pv.dataset ?? {};
      const key = text(ds.id, 200) || text(ds.label, 200);
      if (!key || byId.has(key)) continue;
      let sources = list(ds.sources, (s) => {
        const name = text(s?.name, 300);
        return name ? { name, url: httpsUrl(s?.url), license: text(s?.license, 600) } : null;
      });
      if (!sources.length && (ds.source || ds.url)) {
        sources = [{ name: text(ds.source, 300) || "Source", url: httpsUrl(ds.url), license: text(ds.license, 600) }];
      }
      byId.set(key, {
        label: text(ds.label, 300),
        sources,
        method: publicText(ds.notes),
        retrieved: text(pv.data?.retrieved, 40),
        values_are: publicText(pv.data?.values_are, 300),
        derivations: list(pv.data?.derivations, (d) => {
          const measure = text(d?.measure, 300), method = publicText(d?.method, 600);
          return measure && method ? { measure, method } : null;
        }),
        breaks: list(pv.methodology_breaks, (b) => {
          const what = publicText(b?.what, 600);
          return what ? { period: text(b?.period, 40), what } : null;
        }),
      });
    }
  }

  const seen = new Set<string>();
  const measures = opts.uploaded ? [] : list(pvs.flatMap((pv) => (Array.isArray(pv.measures) ? pv.measures : [])), (m) => {
    const label = text(m?.label_in_full, 300) || text(m?.label, 300);
    if (!label || seen.has(label)) return null;
    seen.add(label);
    return { label, unit: text(m?.unit, 60) };
  });

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out = receipt?.output ?? {};
  const commit = text(receipt?.inputs?.code?.commit, 40);
  const geo = first.geography ?? {};
  return {
    headline: text(title.headline, 200),
    subhead: text(title.subhead, 300),
    window: first.window?.start != null && first.window?.end != null
      ? { start: text(first.window.start, 20), end: text(first.window.end, 20) } : null,
    area: opts.uploaded ? "" : [text(geo.level, 120), text(geo.region, 120)].filter(Boolean).join(", "),
    datasets: opts.uploaded
      ? [{ label: "The maker\u2019s own data", sources: [], method: "", retrieved: "", values_are: "", derivations: [], breaks: [] }]
      : [...byId.values()],
    measures,
    uploaded_data: opts.uploaded,
    film: { seconds: num(out.seconds), width: num(out.canvas?.[0]), height: num(out.canvas?.[1]), fps: num(out.fps) },
    engine: { commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 12) : "", drawn_at: text(receipt?.drawn_at, 40) },
  };
}
