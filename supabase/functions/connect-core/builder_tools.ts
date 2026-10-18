// ENGINE's guided builder (supabase/functions/_shared/film.ts) for the user's own AI: find a dataset, read what it can and cannot do, and turn a
// film request into a story the worker will accept. All three are PURE: they read the catalog that ships with the function and the person's own
// saved look, and they save nothing. The AI saves a compiled story with set_story, whose checks run again. Nothing here lets a request choose data,
// scale, sources or checks: compileFilm has no field for them and refuses an unknown key.
import { compileFilm, describeDataset, FILM_TYPES, FilmError, searchCatalog } from "../_shared/film.ts";
import { getPreset, ProfileError } from "../_shared/profile.ts";
import type { ToolDef } from "./types.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const period = { type: "string", maxLength: 10, pattern: "^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" };

const searchDatasets: ToolDef = {
  name: "search_datasets", title: "Search the dataset catalog", scope: "read", readOnly: true,
  description: "Find datasets a film can use, by words in the title or measure (for example 'unemployment'). Returns the id, what film types it supports and the years it covers. You cannot upload data: only catalog datasets can be used.",
  inputSchema: obj({ query: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 25 } }),
  async run(a) {
    const rows = searchCatalog(String(a.query ?? ""), { usableOnly: true, limit: typeof a.limit === "number" ? a.limit : 10, audience: "person" });
    if (!rows.length) return { text: "No usable dataset matches. Try fewer or different words, or call search_datasets with no query to see what exists.", data: { datasets: [] } };
    return { text: rows.map((r) => `${r.id}: ${r.title} (${r.film_types.join(", ") || "no film types"}; ${JSON.stringify(r.period)})`).join("\n"), data: { datasets: rows } };
  },
};

const describe: ToolDef = {
  name: "describe_dataset", title: "Describe a catalog dataset", scope: "read", readOnly: true,
  description: "What one catalog dataset measures, where it comes from and under what licence, the years it covers, its measures, the film types it supports, and its known gaps and method changes. Read this before compile_film.",
  inputSchema: obj({ dataset_id: { type: "string", maxLength: 64 } }, ["dataset_id"]),
  async run(a) {
    const d = describeDataset(String(a.dataset_id), { audience: "person" });
    if (!d) return { text: `"${String(a.dataset_id).slice(0, 64)}" is not in the catalog. Use search_datasets.`, isError: true, code: "not_found" };
    return { text: JSON.stringify(d, null, 1), data: { dataset: d } };
  },
};

const compile: ToolDef = {
  name: "compile_film", title: "Compile a film request into a story", scope: "read", readOnly: true,
  description: "Turns a film request (a catalog dataset, a film type map/bars/line, a title, optionally a measure, a year range and a saved look) into a story that the render worker will accept, with the source and licence recorded in it. It saves NOTHING: save the returned story with set_story. Every reason a request is refused is listed at once. It cannot choose a subset of places, hold or hide a gap, or change a scale.",
  inputSchema: obj({
    dataset: { type: "string", maxLength: 64 }, film_type: { type: "string", enum: FILM_TYPES }, title: { type: "string", maxLength: 160 },
    subtitle: { type: "string", maxLength: 320 }, measure: { type: "string", maxLength: 64 },
    years: obj({ start: period, end: period }),
    look_name: { type: "string", maxLength: 64, description: "Apply the person's saved look profile of this name (or a starter look when look_is_preset is true)." },
    look_is_preset: { type: "boolean" },
  }, ["dataset", "film_type", "title"]),
  async run(a, ctx) {
    const req: Record<string, unknown> = { dataset: a.dataset, film_type: a.film_type, title: a.title };
    for (const k of ["subtitle", "measure", "years"]) if (a[k] !== undefined) req[k] = a[k];
    if (typeof a.look_name === "string") {
      try {
        if (a.look_is_preset === true) req.look = getPreset(a.look_name);
        else {
          const row = await ctx.data.profiles?.get(a.look_name);
          if (!row) return { text: `The person has no look profile named "${a.look_name.slice(0, 64)}". Use list_presets, or save one with set_profile.`, isError: true, code: "not_found" };
          req.look = row.spec;
        }
      } catch (e) {
        if (e instanceof ProfileError) return { text: "The look cannot be used: " + e.errors.join("; "), isError: true, code: "refused" };
        throw e;
      }
    }
    try {
      const { story, report } = compileFilm(req, { audience: "person" });
      return {
        text: ["Compiled. This story passed the worker's schema; nothing is saved yet. Save it EXACTLY as returned with set_story.", "",
               "Report:", JSON.stringify(report, null, 1), "", "Story:", JSON.stringify(story)].join("\n"),
        data: { story, report },
      };
    } catch (e) {
      if (e instanceof FilmError) {
        return { text: `Not compiled. ${e.errors.length} problem${e.errors.length === 1 ? "" : "s"}:\n` + e.errors.map((x, i) => `${i + 1}. ${x}`).join("\n"),
                 isError: true, code: "refused", failedChecks: e.errors.length, data: { compiled: false, errors: e.errors } };
      }
      throw e;
    }
  },
};

export const BUILDER_TOOL_DEFS: ToolDef[] = [searchDatasets, describe, compile];
