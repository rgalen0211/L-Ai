// The live editor INSIDE THE AI CHAT, server side (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md section 3).
// Six tools, all behind the connector's second switch (CONNECT_CHAT_EDITOR=on, with CONNECT_MCP_APP): one the AI sees, five only the chat panel calls.
//   open_editor        (the AI sees it; scope edit) opens the panel for one of the person's films and names it in a result the panel reads
//   editor_apply_ops, editor_undo, editor_undo_all_ai, my_edit_ops_since, editor_heartbeat
//                      (visibility "app": the host keeps them out of the AI's tool list and forwards the panel's calls) the same five names the website's editor has always called, each a thin shell over
//                      migrations/20261105000100_chat_editor.sql. Hiding them is a courtesy to the model, NOT the security: a client that calls one by name gets exactly what the AI's own edit tools give
//                      (scope edit, the grant check on every call, the AI's limits, the track list only when shared, undo only of the AI side's own changes), all of it enforced in SQL.
// An app-only answer is { data } or, with isError, { error: { code, message } }: the panel's page reads exactly that.
import { untrusted } from "../ai-editor/prompt.ts";
import type { Data, ToolCtx, ToolDef, ToolResult } from "./types.ts";

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
      if (!call) return { text: "The editor panel is not available yet.", isError: true, code: "unavailable", data: { error: { code: null, message: "The editor panel is not available yet." } } };
      try {
        const data = await call.call(ctx.data, name, a);
        return ok("Done.", { data: data === undefined ? null : data });
      } catch (e) {
        const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code).slice(0, 16) : null;
        const message = friendly(e);
        return { text: message, isError: true, code: code ?? "error", data: { error: { code, message } } };
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

  return [
    openEditor,
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
