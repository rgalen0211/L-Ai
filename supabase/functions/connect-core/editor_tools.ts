// The live editor INSIDE THE AI CHAT, server side (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md section 3).
// Six tools, all behind the connector's second switch (CONNECT_CHAT_EDITOR=on, with CONNECT_MCP_APP): one the AI sees, five only the chat panel calls.
//   open_editor        (the AI sees it; scope edit) opens the panel for one of the person's films and names it in a result the panel reads
//   editor_apply_ops, editor_undo, editor_undo_all_ai, my_edit_ops_since, editor_heartbeat
//                      (visibility "app": the host keeps them out of the AI's tool list and forwards the panel's calls) the same five names the website's editor has always called, each a thin shell over
//                      migrations/20261105000100_chat_editor.sql. Hiding them is a courtesy to the model, NOT the security: a client that calls one by name gets exactly what the AI's own edit tools give
//                      (scope edit, the grant check on every call, the AI's limits, the track list only when shared, undo only of the AI side's own changes), all of it enforced in SQL.
// An app-only answer is { data } or, with isError, { error: { code, message } }: the panel's page reads exactly that.
import { untrusted } from "../ai-editor/prompt.ts";
import { checkFilmCard } from "./film_card.ts";
import { LIMITS, type Data, type FilmCardRead, type ToolCtx, type ToolDef, type ToolResult } from "./types.ts";

export const FILM_CARD_TOOL = "editor_film_card";
export const PANEL_NAMES = ["editor_apply_ops", "editor_undo", "editor_undo_all_ai", "my_edit_ops_since", "editor_heartbeat"] as const;

const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const uuid = { type: "string", pattern: UUID };
const MODE = { type: "string", enum: ["data", "compilation"], description: "data = a data film (look settings); compilation = a clip list." };
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const refuse = (text: string, code: string): ToolResult => ({ text, isError: true, code });

type Friendly = (e: unknown) => string;

export function makeEditorTools(friendly: Friendly): ToolDef[] {
  /** One panel call: the database's own answer as { data }, or its sentence and code as { error }. */
  const panel = (name: (typeof PANEL_NAMES)[number], title: string, description: string, props: Record<string, unknown>, readOnly: boolean): ToolDef => ({
    name, title, scope: "edit", readOnly, idempotent: readOnly, chatEditor: "app", description,
    inputSchema: obj(props, ["p_project", "p_mode", ...Object.keys(props).filter((k) => !["p_project", "p_mode"].includes(k))]),
    async run(a, ctx: ToolCtx) {
      const call = (ctx.data as Data).editorCall;
      if (!call) { const error = { code: null, message: "The editor panel is not available yet." }; return { text: JSON.stringify({ error }), isError: true, code: "unavailable", data: { error } }; }
      try {
        const data = await call.call(ctx.data, name, a);
        // the text is the same answer as JSON: only the panel calls these (visibility app), and some hosts hand a panel the text parts and not structuredContent
        const body = { data: data === undefined ? null : data };
        return ok(JSON.stringify(body), body);
      } catch (e) {
        const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code).slice(0, 16) : null;
        const message = friendly(e);
        const error = { code, message };
        return { text: JSON.stringify({ error }), isError: true, code: code ?? "error", data: { error } };
      }
    },
  });

  const openEditor: ToolDef = {
    name: "open_editor", title: "Open the Ryagram editor", scope: "edit", readOnly: true, idempotent: true, chatEditor: "model",
    description: "Opens the Ryagram live editor for ONE of the person's own films, inside this conversation where the assistant can show it. The person can then move through the film, change its look or its clips and see it at once; "
      + "every change they make there is a draft they save or build in the Ryagram app, and you are told in one line when they change something. It changes nothing by itself, costs nothing and starts nothing. "
      + "For a clip film the person must first have shared their track list with you (a tick in the Ryagram app). Read get_edit_state before you change anything yourself.",
    inputSchema: obj({ project_id: uuid, mode: MODE }, ["project_id", "mode"]),
    async run(a, ctx) {
      const id = String(a.project_id), mode = a.mode === "compilation" ? "compilation" : "data";
      const st = await ctx.data.editState(id);
      if (!st) return refuse("That film was not found among your projects.", "not_found");
      if (mode === "compilation" && !st.compilation.shared) {
        return refuse('The person has not shared their track list with their AI. Ask them to tick "Let my AI see my track list" in the Ryagram app, then open the editor again.', "not_shared");
      }
      const title = (await ctx.data.listProjects()).find((p) => p.id === id)?.title ?? "";
      return ok(`The Ryagram editor is open for ${untrusted("project-title", title)} (${mode === "data" ? "a data film" : "a clip film"}). `
        + "The person can change it there; each change is a draft they save or build in the Ryagram app. Read get_edit_state before you change anything yourself.",
        { project_id: id, mode, title });
    },
  };

  /** Editor Step A (migration 20261109000100, contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md): the film's look card for the panel. App-only, behind the chat-editor switch, scope read. It asks the house computer for a card of the film's CURRENT
   *  saved story (p_ask), and reads the newest card or where the request stands. A card is checked here (film_card.ts) before the panel ever sees it; `p_have` (the story hash of a card the panel already holds) keeps a poll from carrying the same card twice. */
  const FAIL_WORDS: Record<string, string> = {
    view_not_supported: "The engine cannot draw a picture of this kind of film yet. The editor keeps its stand-in picture.",
    story_not_found: "The saved film could not be read to draw its picture.",
    engine_error: "Drawing the film's picture did not work this time. Open the editor again in about ten minutes to try again.",
    card_rejected: "The film's picture was drawn but could not be used.",
  };
  /** A picture too big for the card (a county map): the worker says exactly 'too_big <characters> <limit>' (digits only), never free text; anything else is not shown as a size. */
  const tooBig = (detail: unknown): { characters: number; limit: number } | null => {
    const m = typeof detail === "string" ? /^too_big (\d{1,9}) (\d{1,9})$/.exec(detail) : null;
    if (!m) return null;
    const characters = Number(m[1]), limit = Number(m[2]);
    return limit >= 1000 && characters > limit ? { characters, limit } : null;
  };
  const shape = (r: FilmCardRead, have: string | null): Record<string, unknown> => {
    if (r.state === "ready") {
      const sha = (r.card as { basis?: { story_sha256?: unknown } } | null | undefined)?.basis?.story_sha256;
      if (checkFilmCard(r.card).length || sha !== r.built_sha256) return { state: "failed", code: "card_rejected", message: FAIL_WORDS.card_rejected };
      const refresh = r.refresh ? { refresh: { state: r.refresh.state, ...(r.refresh.state === "failed" ? { code: r.refresh.fail_code && FAIL_WORDS[r.refresh.fail_code] ? r.refresh.fail_code : "engine_error" } : {}) } } : {};
      if (have && have === r.built_sha256) return { state: "ready", unchanged: true, stale: r.stale === true, built_sha256: r.built_sha256, ...refresh };
      return { state: "ready", stale: r.stale === true, built_sha256: r.built_sha256, ...refresh, card: r.card };
    }
    if (r.state === "failed") {
      const code = r.fail_code && FAIL_WORDS[r.fail_code] ? r.fail_code : "engine_error";
      const size = code === "view_not_supported" ? tooBig(r.fail_detail) : null;
      if (size) return { state: "failed", code, size, message: `This film's picture is too detailed to draw in the chat: it would be ${size.characters.toLocaleString("en-US")} characters and the limit is ${size.limit.toLocaleString("en-US")}. The editor keeps its stand-in picture.` };
      return { state: "failed", code, message: FAIL_WORDS[code] };
    }
    if (r.state === "asked" || r.state === "claimed") return { state: r.state, waited_seconds: Math.max(0, Math.floor(Number(r.waited_s) || 0)) };
    return { state: "none" };
  };
  const filmCard: ToolDef = {
    name: FILM_CARD_TOOL, title: "Editor panel: the film's picture and colours", scope: "read", readOnly: false, idempotent: true, chatEditor: "app",
    description: "ONLY for the Ryagram editor panel in this conversation; do not call it yourself. Asks for, and reads, the real colours and one real still picture of the person's film (drawn by the Ryagram computer). It changes nothing in the film.",
    inputSchema: obj({ p_project: uuid, p_ask: { type: "boolean" }, p_have: { type: "string", pattern: "^[0-9a-f]{64}$" } }, ["p_project"]),
    async run(a, ctx: ToolCtx) {
      const get = ctx.data.getFilmCard, ask = ctx.data.askFilmCard;
      const answer = (data: Record<string, unknown>, isError = false, code?: string): ToolResult => { const body = isError ? { error: data } : { data }; return { text: JSON.stringify(body), data: body, ...(isError ? { isError: true, code: code ?? "error" } : {}) }; };
      if (!get || !ask) return answer({ code: null, message: "The film picture is not available yet." }, true, "unavailable");
      const id = String(a.p_project), have = typeof a.p_have === "string" ? a.p_have : null;
      try {
        const r = await get.call(ctx.data, id);
        if (!r) return answer({ code: "PT404", message: "That film was not found among your projects." }, true, "not_found");
        // ask when there is no card at all, or only a stale one and nothing has been asked for the current save yet; one ask per save, so a panel that keeps polling never asks twice
        // and again, once, for a picture that failed because the engine broke, when the database says ten minutes have passed (r.retry): a failed picture is otherwise never asked for again, however long ago
        const again = (r.state === "failed" && r.retry === true) || (r.state === "ready" && r.stale === true && r.refresh?.state === "failed" && r.refresh.retry === true);
        if ((r.state === "none" || (r.state === "ready" && r.stale === true && !r.refresh) || again) && a.p_ask === true) {
          if (!(await ctx.policy.hit(ctx.principal, "film_card", LIMITS.filmCardsPerHourPerUser, 3600))) {
            return answer({ code: "PT429", message: `The limit of ${LIMITS.filmCardsPerHourPerUser} film pictures an hour is reached.` }, true, "rate");
          }
          const asked = await ask.call(ctx.data, id);
          if (r.state === "ready") return answer({ ...shape({ ...r, refresh: { state: asked.state } }, have) });          // the old card stays on show while the new one is drawn
          return answer({ state: asked.state === "claimed" ? "claimed" : "asked", waited_seconds: 0 });
        }
        return answer(shape(r, have));
      } catch (e) {
        const raw = (e as { code?: unknown })?.code;
        const code = typeof raw === "string" ? raw.slice(0, 16) : null;
        return answer({ code, message: friendly(e) }, true, code ?? "error");
      }
    },
  };

  return [
    openEditor, filmCard,
    panel("editor_apply_ops", "Editor panel: make changes", "ONLY for the Ryagram editor panel in this conversation; do not call it yourself (use set_look or edit_tracks). Applies the person's changes to the shared draft.",
      { p_project: uuid, p_mode: MODE, p_base_revision: { type: "integer", minimum: 0, maximum: 1_000_000_000 }, p_ops: { type: "array", minItems: 1, maxItems: 20, items: { type: "object" } } }, false),
    panel("editor_undo", "Editor panel: undo one change", "ONLY for the Ryagram editor panel; do not call it yourself. Undoes one earlier change made from the panel or by the AI.",
      { p_project: uuid, p_mode: MODE, p_op_id: { type: "integer", minimum: 1, maximum: 9_007_199_254_740_991 } }, false),
    panel("editor_undo_all_ai", "Editor panel: undo all AI changes", "ONLY for the Ryagram editor panel; do not call it yourself. Takes back everything the AI side has changed and not had undone.",
      { p_project: uuid, p_mode: MODE }, false),
    panel("my_edit_ops_since", "Editor panel: read the changes", "ONLY for the Ryagram editor panel; do not call it yourself (use get_edit_state). Reads the draft and the changes since a revision.",
      { p_project: uuid, p_mode: MODE, p_revision: { type: "integer", minimum: 0, maximum: 1_000_000_000 } }, true),
    panel("editor_heartbeat", "Editor panel: still open", "ONLY for the Ryagram editor panel; do not call it yourself. Says an editor is open; changes nothing else.",
      { p_project: uuid, p_mode: MODE }, false),
  ];
}
