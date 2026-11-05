"""Must-fail proof for supabase/tests/test_chat_editor.py: each mutant breaks ONE rule of the chat-editor migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/chat_editor_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261105000100_chat_editor.sql"
W.TEST = "supabase/tests/test_chat_editor.py"
W.SCRATCH = W.ROOT / ".mut_chated"
W.RUN_TMP = W.base.BASE_TEMP / f"chated-mut-{os.getpid()}"

ACTOR = "declare me uuid := ryagram_private.connect_actor(p_token_hash, 'edit');"


def scope(fn_line):
    """the scope of one function read instead of edit: the function's own header line plus its first two lines, unique in the file"""
    return (f"{fn_line}\nlanguage plpgsql security definer set search_path = '' as $$\n{ACTOR}", f"{fn_line}\nlanguage plpgsql security definer set search_path = '' as $$\ndeclare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');")


def scoped(name, header):
    old, new = scope(header)
    return (f"{name} needs only read permission", old, new)


W.MUTANTS[:] = [
    ("the AI's undo takes back a panel change", "     and e.client_label is distinct from ryagram_private.chat_editor_label()\n     and e.revision = (select max", "     and e.revision = (select max"),
    ("the AI's latest batch counts panel changes", "x.status in ('applied', 'pending')\n                          and x.client_label is distinct from ryagram_private.chat_editor_label());", "x.status in ('applied', 'pending'));"),
    ("a client can be named like the panel", "  if lower(btrim(label)) = lower(ryagram_private.chat_editor_label()) then label := 'AI client (renamed)'; end if;\n", "  null;\n"),
    ("the panel name is compared exactly only", "if lower(btrim(label)) = lower(ryagram_private.chat_editor_label()) then", "if label = ryagram_private.chat_editor_label() then"),
    ("a panel change is recorded as the person's", "p_base_revision, 'ai', ryagram_private.chat_editor_label(), p_ops)", "p_base_revision, 'person', ryagram_private.chat_editor_label(), p_ops)"),
    ("a panel change carries no label", "p_base_revision, 'ai', ryagram_private.chat_editor_label(), p_ops)", "p_base_revision, 'ai', null, p_ops)"),
    ("the label is something else", "select 'Ryagram panel'::text", "select 'Claude'::text"),
    ("the mode is not checked", "  if p_mode is null or p_mode not in ('data', 'compilation') then", "  if false then"),
    ("the project's owner is not checked", "  if p_project is null or not exists (select 1 from public.projects where id = p_project and owner_id = p_owner) then", "  if false then"),
    ("a compilation is open without the track list being shared", "  if p_mode = 'compilation' and not coalesce(", "  if false and not coalesce("),
    scoped("the change call", "create function public.connect_editor_apply(p_token_hash text, p_project uuid, p_mode text, p_base_revision bigint, p_ops jsonb) returns jsonb"),
    scoped("the undo call", "create function public.connect_editor_undo(p_token_hash text, p_project uuid, p_mode text, p_op_id bigint) returns jsonb"),
    scoped("the undo-all call", "create function public.connect_editor_undo_ai(p_token_hash text, p_project uuid, p_mode text) returns jsonb"),
    scoped("the log read", "create function public.connect_editor_since(p_token_hash text, p_project uuid, p_mode text, p_revision bigint) returns jsonb"),
    scoped("the heartbeat", "create function public.connect_editor_heartbeat(p_token_hash text, p_project uuid, p_mode text) returns jsonb"),
    ("an undo by id reaches the person's own edits", "where e.id = p_op_id and e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.actor = 'ai';", "where e.id = p_op_id and e.project_id = p_project and e.mode = p_mode and e.owner_id = me;"),
    # (no mutant for dropping `e.owner_id = me` from the undo by id: the project's owner check and e.project_id = p_project already make it impossible to reach another person's op, so the mutant could not change any answer)
    ("undo-all takes back the person's own edits too", "where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.actor = 'ai' and e.status in ('applied', 'pending');", "where e.project_id = p_project and e.mode = p_mode and e.owner_id = me and e.status in ('applied', 'pending');"),
    ("an undo is recorded as the person's", "  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'ai');\nend $$;\n\n-- Undo everything", "  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'person');\nend $$;\n\n-- Undo everything"),
    ("undo-all is recorded as the person's", "  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'ai');\nend $$;\n\n-- The log since", "  return ryagram_private.undo_edit_ops(me, p_project, p_mode, ids, 'person');\nend $$;\n\n-- The log since"),
    ("the log read ignores the revision asked for", "e.revision > greatest(coalesce(p_revision, 0), 0)", "e.revision > 0"),
    ("a heartbeat changes the draft's revision", "do update set editor_seen_at = now() where public.edit_drafts.owner_id = me;", "do update set editor_seen_at = now(), revision = public.edit_drafts.revision + 1 where public.edit_drafts.owner_id = me;"),
    ("a heartbeat does not mark the editor open", "do update set editor_seen_at = now() where public.edit_drafts.owner_id = me;", "do update set editor_seen_at = public.edit_drafts.editor_seen_at where public.edit_drafts.owner_id = me;"),
    ("a signed-in website session may run the calls", "  public.connect_editor_since(text, uuid, text, bigint), public.connect_editor_heartbeat(text, uuid, text) to connect_runner;", "  public.connect_editor_since(text, uuid, text, bigint), public.connect_editor_heartbeat(text, uuid, text) to connect_runner, authenticated;"),
    ("the helper that gates every call is callable by the connector", "revoke execute on function ryagram_private.chat_editor_label(), ryagram_private.chat_editor_gate(uuid, uuid, text) from public, anon, authenticated, service_role;", "revoke execute on function ryagram_private.chat_editor_label(), ryagram_private.chat_editor_gate(uuid, uuid, text) from public, anon, authenticated, service_role;\ngrant execute on function ryagram_private.chat_editor_gate(uuid, uuid, text) to connect_runner;"),
    ("the waiting-list check is not applied", "select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)", "select 1;                       -- every migration after the gate ends with this line (a test fails otherwise)"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
