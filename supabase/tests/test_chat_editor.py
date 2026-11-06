"""The live editor inside the AI chat, the panel's five calls (migrations/20261105000100_chat_editor.sql, NOT APPLIED) on a local Postgres. CONNECT 2026-11-05.

Same setup as test_live_editor.py (its helpers are borrowed). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_chat_editor.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the panel acts through the CONNECTOR token (scope 'edit'), never a website session: a token without the scope, a revoked grant and a switched-off connector refuse every call
  * its changes are the AI's: actor 'ai', the fixed client label 'Ryagram panel', the AI's limits (60 a minute with the AI's own changes counted together), the same vocabulary and revision rules, and the person's undo still stops a repeat
  * a compilation can be read or changed only while the track list is shared with the AI (PT403), exactly as for the AI's own tools; the shared draft shows the same log the website's editor gets
  * an undo touches only ops whose actor is 'ai': never the person's own edits made in the real editor, never another person's
  * the AI's own undo never reverses a change labelled 'Ryagram panel' (a click of the person's), and a client registered under that name cannot get its own change labelled that way; NO "undo all" (the AI's undo, the panel's Undo all, the website's Undo my AI's changes) takes a panel click back, but one click can be undone by id, in the panel and in the website (Q449)
  * another person's project looks absent (PT404) on every call; a mode that is not data/compilation is refused
  * a heartbeat says only "an editor is open" (editor_open in the AI's state) and changes no draft or revision
  * nothing is granted to any API role but the connector's: every function and both helpers
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

LABEL = "Ryagram panel"
SCOPES = ("read", "write", "render_free", "edit")
LOOK = lambda key, value: {"op": "set_look", "key": key, "value": value}  # noqa: E731
DARK, LIGHT = "#101010", "#f0f0f0"
SUMMARY = {"duration": 20, "clips": [
    {"id": "v1", "track": "video", "start": 0, "len": 5, "label": "great news", "file": "interview-3.mp4"},
    {"id": "v2", "track": "video", "start": 5, "len": 4, "label": "good news", "file": "interview-4.mp4"},
    {"id": "t1", "track": "text", "start": 1, "len": 3, "label": "title", "text": "Hello"},
    {"id": "p1", "track": "pictures", "start": 2, "len": 2, "label": "logo", "picture": "logo.png"}]}


class ChatEditor(core.Base):
    def setUp(self):
        core.Base.setUp(self)
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')", (ALICE, BOB, tc.ADMIN, tc.NOBODY))
        c.execute("insert into public.app_admins (user_id) values (%s)", (tc.ADMIN,))
        c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), ('loopback', 'loopback', 'loopback')", (tc.URI,))
        self.counter = 0

    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect
    fails = tc.Connect.fails

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def run_sql(self, sql, *args):
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args)

    def alice(self, scopes=SCOPES):
        _, a, _ = self.connect(ALICE, scopes=scopes)
        return a

    def project(self, access, title="Film"):
        return self.runner().one("select connect_create_project(%s, %s)", h(access), title)["id"]

    def revision(self, project, mode="data"):
        return self.admin("select coalesce((select revision from public.edit_drafts where project_id = %s and mode = %s), 0)", project, mode)

    def look(self, project):
        return self.admin("select coalesce((select state -> 'look' from public.edit_drafts where project_id = %s and mode = 'data'), '{}'::jsonb)", project)

    def state(self, access, project):
        return self.runner().one("select connect_edit_state(%s, %s)", h(access), project)

    def mirror(self, project, ai_visible=True, summary=SUMMARY):
        """What the desktop app does: post the track summary (the page and, if ticked, the AI see it)."""
        self.run_sql("insert into public.edit_drafts (project_id, mode, owner_id, revision, mirrored, ai_visible, state) values (%s, 'compilation', %s, 1, true, %s, %s::jsonb) "
                     "on conflict (project_id, mode) do update set revision = 1, mirrored = true, ai_visible = excluded.ai_visible, state = excluded.state", project, ALICE, ai_visible, json.dumps(summary))

    # ---- the panel's calls
    def apply(self, access, project, ops, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        return self.runner().one("select connect_editor_apply(%s, %s, %s, %s, %s::jsonb)", h(access), project, mode, base, json.dumps(ops))

    def apply_fails(self, access, project, ops, code=None, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one("select connect_editor_apply(%s, %s, %s, %s, %s::jsonb)", h(access), project, mode, base, json.dumps(ops))
        if code:
            self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        return str(cm.exception)

    def since(self, access, project, rev=0, mode="data"):
        return self.runner().one("select connect_editor_since(%s, %s, %s, %s)", h(access), project, mode, rev)

    def undo(self, access, project, op_id, mode="data"):
        return self.runner().one("select connect_editor_undo(%s, %s, %s, %s)", h(access), project, mode, op_id)

    def undo_all(self, access, project, mode="data"):
        return self.runner().one("select connect_editor_undo_ai(%s, %s, %s)", h(access), project, mode)

    def beat(self, access, project, mode="data"):
        return self.runner().one("select connect_editor_heartbeat(%s, %s, %s)", h(access), project, mode)

    def person(self, project, ops, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        return self.app(ALICE).one("select editor_apply_ops(%s, %s, %s, %s::jsonb)", project, mode, base, json.dumps(ops))

    def calls(self, access, project):
        """every one of the five calls with a valid mode, for the rules that apply to all of them"""
        r = self.runner()
        return [
            lambda: r.one("select connect_editor_apply(%s, %s, 'data', 0, %s::jsonb)", h(access), project, json.dumps([LOOK("state.fill", DARK)])),
            lambda: r.one("select connect_editor_undo(%s, %s, 'data', 1)", h(access), project),
            lambda: r.one("select connect_editor_undo_ai(%s, %s, 'data')", h(access), project),
            lambda: r.one("select connect_editor_since(%s, %s, 'data', 0)", h(access), project),
            lambda: r.one("select connect_editor_heartbeat(%s, %s, 'data')", h(access), project),
        ]

    def rows(self, sql, *args):
        self.db.c.execute("reset role")
        return self.db.c.execute(sql, args).fetchall()

    def refused(self, fn, code):
        with self.assertRaises(psycopg.Error) as cm:
            fn()
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))

    # ---------------------------------------------------------------------------------------------- a panel change is the AI's, labelled, and shared
    def test_a_panel_change_is_recorded_as_the_ai_with_the_panel_label_and_is_in_the_shared_log(self):
        a = self.alice()
        p = self.project(a)
        r = self.apply(a, p, [LOOK("state.fill", DARK)])
        self.assertEqual((r["revision"], r["changes"]), (1, 1))
        self.assertEqual(self.look(p), {"state.fill": DARK})
        row = self.admin("select actor || '|' || client_label || '|' || status from public.edit_ops where project_id = %s", p)
        self.assertEqual(row, f"ai|{LABEL}|applied")
        s = self.since(a, p, 0)
        self.assertEqual(sorted(s), ["ai_visible", "mirrored", "ops", "revision", "state"])
        self.assertEqual((s["revision"], [(o["actor"], o["client"], o["op"]["key"]) for o in s["ops"]]), (1, [("ai", LABEL, "state.fill")]))
        self.assertEqual(self.since(a, p, 1)["ops"], [])
        # the website editor's own log read gives the same rows
        web = self.app(ALICE).one("select my_edit_ops_since(%s, 'data', 0)", p)
        self.assertEqual([(o["id"], o["actor"], o["client"]) for o in web["ops"]], [(o["id"], o["actor"], o["client"]) for o in s["ops"]])

    def test_the_label_comes_from_the_server_never_the_caller_and_the_ais_own_label_is_unchanged(self):
        a = self.alice()
        p = self.project(a)
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("page.background", DARK)]))
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)
        labels = [r[0] for r in self.rows("select client_label from public.edit_ops where project_id = %s order by id", p)]
        self.assertEqual(labels[1], LABEL)
        self.assertNotEqual(labels[0], LABEL, "the AI's own client keeps its own name")
        self.assertEqual(self.admin("select ryagram_private.chat_editor_label()"), LABEL)

    def test_the_same_vocabulary_and_revision_rules_as_the_ais_tools(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        msg = self.apply_fails(a, p, [LOOK("state.fill", LIGHT)], "PT409", base=0)
        self.assertIn("revision 1", msg)
        self.apply_fails(a, p, [{"op": "set_look", "key": "no.such.key", "value": DARK}], "22023")
        self.apply_fails(a, p, [{"op": "delete_everything"}], "22023")
        self.apply_fails(a, p, [], "22023")
        self.apply_fails(a, p, [LOOK("state.fill", DARK)] * 21, "22023")
        self.assertEqual(self.revision(p), 1)
        self.assertEqual(self.look(p), {"state.fill": DARK})

    def test_the_ais_limits_apply_to_the_panel_and_count_with_the_ais_own_changes(self):
        a = self.alice()
        p = self.project(a)
        for i in range(2):
            self.runner().one("select connect_edit_ops(%s, %s, 'data', %s, %s::jsonb)", h(a), p, i, json.dumps([LOOK("state.outline_width", i + 1)] * 20))
        self.apply(a, p, [LOOK("state.outline_width", 3)] * 20, base=2)
        msg = self.apply_fails(a, p, [LOOK("state.outline_width", 4)], "PT429", base=3)
        self.assertIn("60 changes in a minute", msg)

    def test_a_change_the_person_just_undid_cannot_be_repeated_by_the_panel(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        op_id = self.admin("select id from public.edit_ops where project_id = %s", p)
        self.app(ALICE).one("select editor_undo(%s, 'data', %s)", p, op_id)
        self.assertEqual(self.look(p), {})
        msg = self.apply_fails(a, p, [LOOK("state.fill", DARK)], "PT409")
        self.assertIn("the person undid exactly this", msg)

    # ---------------------------------------------------------------------------------------------- who may call
    def test_a_token_without_the_edit_scope_cannot_make_any_of_the_five_calls(self):
        a = self.alice(scopes=("read", "write", "render_free"))
        p = self.project(a)
        for fn in self.calls(a, p):
            self.refused(fn, "PT403")
        self.assertEqual(self.revision(p), 0)

    def test_a_revoked_grant_and_a_switched_off_connector_refuse_every_call(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        self.run_sql("update public.connect_grants set revoked_at = now() where owner_id = %s", ALICE)
        for fn in self.calls(a, p):
            self.refused(fn, "PT403")
        self.run_sql("update public.connect_grants set revoked_at = null where owner_id = %s", ALICE)
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)
        self.run_sql("update public.connect_flags set connections_enabled = false where id")
        for fn in self.calls(a, p):
            self.refused(fn, "PT403")

    def test_no_token_a_bad_token_and_a_website_session_all_fail(self):
        a = self.alice()
        p = self.project(a)
        for bad in (None, "", "x", "0" * 64):
            with self.assertRaises(psycopg.Error) as cm:
                self.runner().one("select connect_editor_since(%s, %s, 'data', 0)", bad, p)
            self.assertIn(cm.exception.sqlstate, ("PT401", "22023", "42883", "PT403"), str(cm.exception))
        with self.assertRaises(psycopg.Error):
            self.app(ALICE).one("select connect_editor_since(%s, %s, 'data', 0)", h(a), p)          # a signed-in website session is not the connector's role
        with self.assertRaises(psycopg.Error):
            self.app(ALICE).one("select connect_editor_apply(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("state.fill", DARK)]))

    def test_another_persons_project_looks_absent_on_every_call(self):
        _, a, _ = self.connect(ALICE, scopes=SCOPES)
        _, b, _ = self.connect(BOB, scopes=SCOPES)
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        before = (self.revision(p), self.admin("select count(*) from public.edit_ops"), self.admin("select count(*) from public.edit_drafts"))
        for fn in self.calls(b, p):
            self.refused(fn, "PT404")
        self.refused(lambda: self.runner().one("select connect_editor_since(%s, %s, 'data', 0)", h(b), "00000000-0000-4000-8000-000000000000"), "PT404")
        self.assertEqual(before, (self.revision(p), self.admin("select count(*) from public.edit_ops"), self.admin("select count(*) from public.edit_drafts")))
        self.assertEqual(self.look(p), {"state.fill": DARK})

    def test_a_mode_that_is_not_data_or_compilation_is_refused(self):
        a = self.alice()
        p = self.project(a)
        for mode in ("", "video", "DATA", None):
            self.refused(lambda: self.runner().one("select connect_editor_since(%s, %s, %s, 0)", h(a), p, mode), "22023")
            self.refused(lambda: self.runner().one("select connect_editor_heartbeat(%s, %s, %s)", h(a), p, mode), "22023")

    # ---------------------------------------------------------------------------------------------- the track list belongs to the person
    def test_a_compilation_is_closed_until_the_track_list_is_shared_with_the_ai_and_closes_again_when_it_is_not(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p, ai_visible=False)
        for mode in ("compilation",):
            self.refused(lambda: self.runner().one("select connect_editor_since(%s, %s, 'compilation', 0)", h(a), p), "PT403")
            self.refused(lambda: self.runner().one("select connect_editor_heartbeat(%s, %s, 'compilation')", h(a), p), "PT403")
            self.refused(lambda: self.runner().one("select connect_editor_undo_ai(%s, %s, 'compilation')", h(a), p), "PT403")
            msg = self.apply_fails(a, p, [{"op": "move_clip", "id": "v1", "start": 1}], "PT403", base=1, mode=mode)
            self.assertIn("has not shared their track list", msg)
        self.assertEqual(self.admin("select count(*) from public.edit_ops where project_id = %s", p), 0)
        self.mirror(p, ai_visible=True)
        s = self.since(a, p, 0, "compilation")
        self.assertEqual([c["id"] for c in s["state"]["clips"]], ["v1", "v2", "t1", "p1"])
        r = self.apply(a, p, [{"op": "move_clip", "id": "v1", "start": 1}], base=1, mode="compilation")
        self.assertTrue(r["pending"])
        self.assertEqual(self.admin("select actor || '|' || client_label || '|' || status from public.edit_ops where project_id = %s", p), f"ai|{LABEL}|pending")
        self.mirror(p, ai_visible=False)                                        # the person unticks it
        self.refused(lambda: self.runner().one("select connect_editor_since(%s, %s, 'compilation', 0)", h(a), p), "PT403")

    # ---------------------------------------------------------------------------------------------- undo: only the AI side's ops
    def test_the_panel_can_undo_its_own_change_and_the_ais_but_never_the_persons(self):
        a = self.alice()
        p = self.project(a)
        self.person(p, [LOOK("page.background", DARK)])                                  # made in the real editor, actor person
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)                            # made in the panel
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 2, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))   # made by the AI itself
        ids = {r[0]: r[1] for r in self.rows("select op ->> 'key', id from public.edit_ops where project_id = %s", p)}
        r = self.undo(a, p, ids["page.background"])                                      # the person's own: nothing happens
        self.assertEqual((r["undone"], r["skipped"]), (0, 0))
        self.assertEqual(self.look(p), {"page.background": DARK, "state.fill": LIGHT, "network.color": DARK})
        self.assertEqual(self.undo(a, p, ids["state.fill"])["undone"], 1)                # the panel's own
        self.assertEqual(self.admin("select ended_by from public.edit_ops where id = %s", ids["state.fill"]), "ai")      # an undo by the AI side is not "the person undid it"
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=self.revision(p))               # so the same change may be made again at once (the 10-minute stop is only for the person's undo)
        self.assertEqual(self.undo(a, p, ids["network.color"])["undone"], 1)             # the AI's
        self.assertEqual(self.look(p), {"page.background": DARK, "state.fill": LIGHT})
        self.assertEqual(self.admin("select status from public.edit_ops where id = %s", ids["page.background"]), "applied")

    # ---------------------------------------------------------------------------------------------- the AI can never undo a click of the person's, and cannot make its own change look like one
    def test_the_ais_undo_never_reverses_a_panel_change_and_still_takes_back_its_own_batch(self):
        a = self.alice()
        p = self.project(a)
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))      # the AI's own batch, revision 1
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)                                                                               # a click in the panel, revision 2 (the latest batch)
        r = self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
        self.assertEqual(r["undone"], 1, "the AI's undo took back its own batch, not the click")
        self.assertEqual(self.look(p), {"state.fill": LIGHT}, "the person's click is still in place")
        self.assertEqual(self.admin("select status from public.edit_ops where project_id = %s and op ->> 'key' = 'state.fill'", p), "applied")
        again = self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
        self.assertEqual(again["undone"], 0)
        self.assertEqual(self.look(p), {"state.fill": LIGHT})

    def test_with_only_panel_changes_the_ais_undo_does_nothing(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", LIGHT)])
        self.apply(a, p, [LOOK("network.color", DARK)], base=1)
        r = self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
        self.assertEqual((r["undone"], r["skipped"]), (0, 0))
        self.assertEqual(self.look(p), {"state.fill": LIGHT, "network.color": DARK})
        self.assertEqual([r[0] for r in self.rows("select status from public.edit_ops where project_id = %s order by id", p)], ["applied", "applied"])

    def test_a_client_registered_under_the_panel_name_cannot_make_its_own_change_look_like_a_click(self):
        for name in (LABEL, "  ryagram PANEL ", "RYAGRAM PANEL"):
            with self.subTest(name=name):
                cid = self.runner().one("select connect_register_client(%s, array[%s])", name, tc.URI)
                _, a, _ = self.connect(ALICE, scopes=SCOPES, client=cid)
                p = self.project(a, title="Film " + name.strip())
                self.runner().one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("state.fill", DARK)]))
                label = self.admin("select client_label from public.edit_ops where project_id = %s", p)
                self.assertNotEqual(label.strip().lower(), LABEL.lower(), "the AI's own change must not carry the panel's label")
                r = self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
                self.assertEqual(r["undone"], 1, "so the AI's undo may still take it back")
                self.assertEqual(self.look(p), {})

    def test_only_the_panels_own_calls_write_the_panel_label(self):
        a = self.alice()
        p = self.project(a)
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)
        self.assertEqual([r[0] for r in self.rows("select client_label = %s from public.edit_ops where project_id = %s order by id", LABEL, p)], [False, True])

    def test_a_panel_click_is_undone_by_id_but_never_by_any_undo_all(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", LIGHT)])
        self.apply(a, p, [LOOK("network.color", DARK)], base=1)
        self.assertEqual(self.undo_all(a, p)["undone"], 0, "the panel's own Undo all leaves the person's clicks alone")
        self.assertEqual(self.look(p), {"state.fill": LIGHT, "network.color": DARK})
        r = self.app(ALICE).one("select editor_undo_all_ai(%s, 'data')", p)
        self.assertEqual(r["undone"], 0, "so does the website's Undo my AI's changes")
        self.assertEqual(self.look(p), {"state.fill": LIGHT, "network.color": DARK})
        self.assertEqual([r[0] for r in self.rows("select status from public.edit_ops where project_id = %s order by id", p)], ["applied", "applied"])
        op = self.admin("select id from public.edit_ops where project_id = %s and op ->> 'key' = 'state.fill'", p)
        self.assertEqual(self.undo(a, p, op)["undone"], 1, "one click can still be taken back, by id, in the panel")
        self.assertEqual(self.look(p), {"network.color": DARK})
        op2 = self.admin("select id from public.edit_ops where project_id = %s and op ->> 'key' = 'network.color'", p)
        self.assertEqual(self.app(ALICE).one("select editor_undo(%s, 'data', %s)", p, op2)["undone"], 1, "and by id in the website's editor")
        self.assertEqual(self.look(p), {})

    def test_the_websites_undo_all_ai_takes_back_the_ais_changes_and_leaves_a_panel_click_in_place(self):
        a = self.alice()
        p = self.project(a)
        self.person(p, [LOOK("page.background", DARK)])
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)                                                                      # a click in the chat panel
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 2, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))   # the AI's own change
        r = self.app(ALICE).one("select editor_undo_all_ai(%s, 'data')", p)
        self.assertEqual(r["undone"], 1)
        self.assertEqual(self.look(p), {"page.background": DARK, "state.fill": LIGHT}, "the AI's change is gone; the person's edit and the person's panel click stay")
        self.assertEqual(self.admin("select status from public.edit_ops where project_id = %s and op ->> 'key' = 'state.fill'", p), "applied")
        self.assertEqual(self.admin("select ended_by from public.edit_ops where project_id = %s and op ->> 'key' = 'network.color'", p), "person")
        self.assertEqual(self.app(ALICE).one("select editor_undo_all_ai(%s, 'data')", p)["undone"], 0)

    def test_undo_all_in_the_panel_takes_back_the_ais_changes_and_nothing_the_person_or_the_panel_did(self):
        a = self.alice()
        p = self.project(a)
        self.person(p, [LOOK("page.background", DARK)])
        self.apply(a, p, [LOOK("state.fill", LIGHT)], base=1)
        self.runner().one("select connect_edit_ops(%s, %s, 'data', 2, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))
        r = self.undo_all(a, p)
        self.assertEqual(r["undone"], 1)
        self.assertEqual(self.look(p), {"page.background": DARK, "state.fill": LIGHT})
        self.assertEqual(self.undo_all(a, p)["undone"], 0)
        self.assertEqual(self.admin("select ended_by from public.edit_ops where project_id = %s and op ->> 'key' = 'network.color'", p), "ai")

    def test_an_undo_by_id_in_another_persons_project_or_another_mode_does_nothing(self):
        _, a, _ = self.connect(ALICE, scopes=SCOPES)
        _, b, _ = self.connect(BOB, scopes=SCOPES)
        pa, pb = self.project(a), self.project(b)
        self.apply(a, pa, [LOOK("state.fill", DARK)])
        op = self.admin("select id from public.edit_ops where project_id = %s", pa)
        self.refused(lambda: self.undo(b, pa, op), "PT404")                              # not Bob's project
        r = self.undo(b, pb, op)                                                         # Bob's own project, Alice's op id: not found there
        self.assertEqual((r["undone"], r["skipped"]), (0, 0))
        self.assertEqual(self.look(pa), {"state.fill": DARK})
        self.refused(lambda: self.runner().one("select connect_editor_undo(%s, %s, 'compilation', %s)", h(a), pa, op), "PT403")   # right id, wrong mode (and not shared)
        self.assertEqual(self.look(pa), {"state.fill": DARK})

    # ---------------------------------------------------------------------------------------------- heartbeat
    def test_a_heartbeat_marks_the_editor_open_and_changes_no_draft(self):
        a = self.alice()
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        self.assertFalse(self.state(a, p)["data"]["editor_open"])
        before = (self.revision(p), self.look(p), self.admin("select count(*) from public.edit_ops"))
        self.assertIsNone(self.beat(a, p))
        self.assertTrue(self.state(a, p)["data"]["editor_open"])
        self.assertEqual(before, (self.revision(p), self.look(p), self.admin("select count(*) from public.edit_ops")))
        self.run_sql("update public.edit_drafts set editor_seen_at = now() - interval '2 minutes' where project_id = %s", p)
        self.assertFalse(self.state(a, p)["data"]["editor_open"])
        q = self.project(a, "Fresh")                                                    # a heartbeat on a film with no draft yet creates the empty draft only
        self.beat(a, q)
        self.assertEqual((self.revision(q), self.look(q)), (0, {}))

    def test_a_heartbeat_cannot_touch_another_persons_draft(self):
        _, a, _ = self.connect(ALICE, scopes=SCOPES)
        _, b, _ = self.connect(BOB, scopes=SCOPES)
        p = self.project(a)
        self.apply(a, p, [LOOK("state.fill", DARK)])
        self.run_sql("update public.edit_drafts set editor_seen_at = null where project_id = %s", p)
        self.refused(lambda: self.beat(b, p), "PT404")
        self.assertIsNone(self.admin("select editor_seen_at from public.edit_drafts where project_id = %s", p))

    # ---------------------------------------------------------------------------------------------- grants, and nothing else touched
    def test_only_the_connector_role_can_run_these_functions_and_the_helpers_are_private(self):
        a = self.alice()
        p = self.project(a)
        sigs = ["connect_editor_apply(text, uuid, text, bigint, jsonb)", "connect_editor_undo(text, uuid, text, bigint)", "connect_editor_undo_ai(text, uuid, text)",
                "connect_editor_since(text, uuid, text, bigint)", "connect_editor_heartbeat(text, uuid, text)"]
        for sig in sigs:
            for role in ("anon", "authenticated", "service_role", "public"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role if role != "public" else "public", f"public.{sig}") if role != "public" else self.admin("select exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = %s::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE')", f"public.{sig}"), f"{role} may run {sig}")
            self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", f"public.{sig}"), sig)
        for sig in ("ryagram_private.chat_editor_gate(uuid, uuid, text)", "ryagram_private.chat_editor_label()"):
            for role in ("anon", "authenticated", "service_role", "connect_runner"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, sig), f"{role} may run {sig}")
        self.assertEqual(self.revision(p), 0)

    def test_nothing_but_the_draft_and_its_log_is_touched(self):
        a = self.alice()
        p = self.project(a)
        tables = ("versions", "jobs", "projects", "connect_grants", "connect_tokens")
        count = lambda: [self.admin(f"select count(*) from public.{t}") for t in tables]  # noqa: E731
        before = count()
        self.apply(a, p, [LOOK("state.fill", DARK)])
        self.undo_all(a, p)
        self.beat(a, p)
        self.since(a, p, 0)
        self.assertEqual(before, count())

    def test_the_live_step_after_check_names_its_columns_and_every_row_is_true(self):
        """supabase/live-steps/23_chat_editor_after_check.sql: what Ryan runs right after the migration. The harness (live_steps_harness.py chat-editor) proves the other halves: false rows, never an error, on a database without it, and one false row per planted fault."""
        c = self.db.as_(None).c
        with c.cursor() as cur:
            cur.execute((core.ROOT / "live-steps" / "23_chat_editor_after_check.sql").read_text(encoding="utf-8"))
            cols = [d.name for d in cur.description]
            rows = cur.fetchall()
        self.assertEqual(cols, ["check_name", "ok"])
        self.assertGreaterEqual(len(rows), 15)
        self.assertEqual([r[0] for r in rows if r[1] is not True], [])
        self.assertEqual(len({r[0] for r in rows}), len(rows), "every row has its own name")

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        sql = (core.ROOT / "migrations" / "20261105000100_chat_editor.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])

    def test_the_rollback_removes_exactly_these_functions(self):
        sql = (core.ROOT / "rollbacks" / "20261105000100_chat_editor_rollback.sql").read_text(encoding="utf-8")
        names = ("connect_editor_apply", "connect_editor_undo", "connect_editor_undo_ai", "connect_editor_since", "connect_editor_heartbeat", "chat_editor_gate", "chat_editor_label")
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = any (%s)", list(names)), 7)
        self.run_sql(sql)
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = any (%s)", list(names)), 0)
        self.assertEqual(self.admin("select count(*) from pg_proc where proname in ('apply_edit_ops', 'connect_edit_ops', 'editor_apply_ops')"), 3)


if __name__ == "__main__":
    unittest.main()
