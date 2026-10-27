"""The live preview editor, the AI half (migrations/20261027000400_live_editor.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 141.

Same setup as test_connect.py (its helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_live_editor.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the new scope 'edit' is offered; a token without it cannot change the draft (it can still READ the state); a revoked grant ends the AI's access
  * the draft has a revision: a stale base revision is refused and changes nothing; a batch is all-or-nothing; 1 to 20 changes a call
  * the vocabulary is closed (the same op names and fields as the page's editor core): unknown op, unknown field, unknown look key, wrong value type, out-of-range number, bad colour, places, web addresses, markup, control characters
  * a change is undoable: every op has its inverse; the person's undo restores the state; undoing never clobbers a NEWER change; an AI cannot repeat exactly what the person just undid
  * the person's editor and the AI use the same draft and log; the AI is limited (60 a minute, 600 a day); the person is not
  * compilation mode: the AI sees tracks and queues ops only when the person ticked; unticking drops the summary and rejects the AI's waiting ops; the summary holds names and times only
  * nothing here touches a story, a job, a credit or a plan; the connector's role has no table privilege; every function is callable by exactly the roles intended
"""
import json
import random
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

SCOPES = ("read", "write", "render_free", "edit")
LOOK = lambda key, value: {"op": "set_look", "key": key, "value": value}  # noqa: E731
UNSET = lambda key: {"op": "unset_look", "key": key}  # noqa: E731
DARK, LIGHT = "#101010", "#f0f0f0"
CASES = json.loads((Path(__file__).resolve().parents[2] / "tests" / "edit-op-cases.json").read_text(encoding="utf-8"))
SUMMARY = {"duration": 20, "clips": [
    {"id": "v1", "track": "video", "start": 0, "len": 5, "label": "great news", "file": "interview-3.mp4"},
    {"id": "v2", "track": "video", "start": 5, "len": 4, "label": "good news", "file": "interview-4.mp4"},
    {"id": "t1", "track": "text", "start": 1, "len": 3, "label": "title", "text": "Hello"},
    {"id": "p1", "track": "pictures", "start": 2, "len": 2, "label": "logo", "picture": "logo.png"}]}


class LiveEditor(core.Base):
    def setUp(self):                      # the same fixtures as test_connect.Connect.setUp (its zero-argument super() cannot be borrowed)
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

    # ---- helpers
    def alice(self, scopes=SCOPES):
        _, a, _ = self.connect(ALICE, scopes=scopes)
        return a

    def project(self, access, title="Film"):
        return self.runner().one("select connect_create_project(%s, %s)", h(access), title)["id"]

    def ai(self, access, project, ops, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        return self.runner().one("select connect_edit_ops(%s, %s, %s, %s, %s::jsonb)", h(access), project, mode, base, json.dumps(ops))

    def ai_fails(self, access, project, ops, code=None, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one("select connect_edit_ops(%s, %s, %s, %s, %s::jsonb)", h(access), project, mode, base, json.dumps(ops))
        if code:
            self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        return str(cm.exception)

    def state(self, access, project):
        return self.runner().one("select connect_edit_state(%s, %s)", h(access), project)

    def revision(self, project, mode="data"):
        return self.admin("select coalesce((select revision from public.edit_drafts where project_id = %s and mode = %s), 0)", project, mode)

    def look(self, project):
        return self.admin("select coalesce((select state -> 'look' from public.edit_drafts where project_id = %s and mode = 'data'), '{}'::jsonb)", project)

    def person(self, who, project, ops, base=None, mode="data"):
        if base is None:
            base = self.revision(project, mode)
        return self.app(who).one("select editor_apply_ops(%s, %s, %s, %s::jsonb)", project, mode, base, json.dumps(ops))

    def logged(self, project, mode="data"):
        return self.admin("select count(*) from public.edit_ops where project_id = %s and mode = %s", project, mode)

    def mirror(self, project, ai_visible=True, summary=SUMMARY):
        """What the desktop app does: post the track summary (the page and, if ticked, the AI see it)."""
        self.run_sql("insert into public.edit_drafts (project_id, mode, owner_id, revision, mirrored, ai_visible, state) values (%s, 'compilation', %s, 1, true, %s, %s::jsonb) "
                     "on conflict (project_id, mode) do update set revision = 1, mirrored = true, ai_visible = excluded.ai_visible, state = excluded.state", project, ALICE, ai_visible, json.dumps(summary))

    # ---------------------------------------------------------------------------------------------- the shared cases (the same file the node twin runs)
    def test_the_shared_op_cases_agree_with_the_sql_vocabulary(self):
        self.run_sql("insert into public.edit_look_keys (key, kind, choices, min_value, max_value, stand_in) values "
                     "('test.shape', 'enum', array['circle','square'], null, null, true), ('test.width', 'number', null, 0, 8, true), ('test.glow', 'bool', null, null, null, true)")
        for case in CASES["cases"]:
            got = self.admin("select ryagram_private.edit_op_problem(%s, %s::jsonb)", case["mode"], json.dumps(case["op"]))
            if case["ok"]:
                self.assertIsNone(got, json.dumps(case["op"]))
            else:
                self.assertIsNotNone(got, json.dumps(case["op"]))
                self.assertIn(case["word"], got, json.dumps(case["op"]))

    def test_the_look_key_rows_in_the_migration_are_the_nine_the_worker_accepts_today(self):
        rows = self.admin("select array_agg(key order by key) from public.edit_look_keys")
        self.assertEqual(rows, sorted(CASES["look_keys"]))
        self.assertEqual(self.admin("select count(*) from public.edit_look_keys where stand_in"), 0)
        self.assertEqual(self.admin("select array_agg(key order by key) from public.edit_look_keys where kind <> 'colour'"), ["sequence.theme", "state.outline_width"])

    # ---------------------------------------------------------------------------------------------- the scope
    def test_edit_is_an_offered_scope_and_a_token_without_it_can_read_but_not_change(self):
        self.assertIn("edit", self.admin("select ryagram_private.connect_offered_scopes()"))
        a = self.alice()
        p = self.project(a)
        self.assertEqual(self.ai(a, p, [LOOK("network.color", DARK)])["revision"], 1)                      # control: with the scope it works
        _, plain, _ = self.connect(ALICE, scopes=("read", "write", "render_free"))
        self.assertEqual(self.state(plain, p)["data"]["look"], {"network.color": DARK})                    # reading needs only 'read'
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one("select connect_edit_ops(%s, %s, 'data', 1, %s::jsonb)", h(plain), p, json.dumps([LOOK("network.color", LIGHT)]))
        self.assertEqual(cm.exception.sqlstate, "PT403")
        with self.assertRaises(psycopg.Error) as cm2:
            self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(plain), p)
        self.assertEqual(cm2.exception.sqlstate, "PT403")
        self.assertEqual(self.look(p), {"network.color": DARK})

    def test_a_revoked_grant_ends_the_ais_access_at_once(self):
        a = self.alice()
        p = self.project(a)
        self.ai(a, p, [LOOK("network.color", DARK)])
        self.run_sql("update public.connect_grants set revoked_at = now() where owner_id = %s", ALICE)
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one("select connect_edit_state(%s, %s)", h(a), p)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.ai_fails(a, p, [LOOK("network.color", LIGHT)], code="PT403", base=1)

    # ---------------------------------------------------------------------------------------------- the draft, the revision, the log
    def test_changes_are_applied_logged_with_their_inverses_and_the_revision_moves_once_per_call(self):
        a = self.alice()
        p = self.project(a)
        r = self.ai(a, p, [LOOK("network.color", DARK), LOOK("state.fill", "#1a73e8"), LOOK("page.background", "#ffffff")])
        self.assertEqual((r["revision"], r["changes"]), (1, 3))
        self.assertEqual(r["state"]["look"], {"network.color": DARK, "state.fill": "#1a73e8", "page.background": "#ffffff"})
        r2 = self.ai(a, p, [LOOK("network.color", LIGHT), UNSET("state.fill")], base=1)
        self.assertEqual((r2["revision"], r2["state"]["look"]), (2, {"network.color": LIGHT, "page.background": "#ffffff"}))
        rows = self.admin("select jsonb_agg(jsonb_build_object('rev', revision, 'actor', actor, 'client', client_label, 'status', status, 'inverse', inverse) order by id) from public.edit_ops where project_id = %s", p)
        self.assertEqual([x["rev"] for x in rows], [1, 1, 1, 2, 2])
        self.assertTrue(all(x["actor"] == "ai" and x["client"] == "Claude" and x["status"] == "applied" for x in rows))
        self.assertEqual(rows[0]["inverse"], {"op": "unset_look", "key": "network.color"})                 # it was unset before
        self.assertEqual(rows[3]["inverse"], {"op": "set_look", "key": "network.color", "value": DARK})    # and DARK before the second call
        self.assertEqual(self.admin("select updated_by from public.edit_drafts where project_id = %s and mode = 'data'", p), "Claude")

    def test_a_stale_revision_is_refused_with_the_current_one_and_changes_nothing(self):
        a = self.alice()
        p = self.project(a)
        self.ai(a, p, [LOOK("network.color", DARK)])
        msg = self.ai_fails(a, p, [LOOK("network.color", LIGHT)], code="PT409", base=0)
        self.assertIn("revision 1", msg)
        self.ai_fails(a, p, [LOOK("network.color", LIGHT)], code="PT409", base=7)
        self.assertEqual((self.look(p), self.revision(p), self.logged(p)), ({"network.color": DARK}, 1, 1))
        self.assertEqual(self.ai(a, p, [LOOK("network.color", LIGHT)], base=1)["revision"], 2)             # control: the right revision works

    def test_a_batch_is_all_or_nothing(self):
        a = self.alice()
        p = self.project(a)
        self.ai_fails(a, p, [LOOK("network.color", DARK), LOOK("state.fill", "#112233"), LOOK("state.fill", "red")], code="22023")
        self.assertEqual((self.look(p), self.revision(p), self.logged(p)), ({}, 0, 0))
        self.ai(a, p, [LOOK("network.color", DARK), LOOK("state.fill", "#112233")])
        self.assertEqual(self.logged(p), 2)

    def test_one_to_twenty_changes_a_call(self):
        a = self.alice()
        p = self.project(a)
        for ops in ([], [LOOK("network.color", DARK)] * 21):
            self.ai_fails(a, p, ops, code="22023")
        for bad in (None, {"op": "set_look"}, "x"):
            with self.assertRaises(psycopg.Error):
                self.runner().one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps(bad))
        self.assertEqual(self.ai(a, p, [LOOK("network.color", DARK)] * 20)["changes"], 20)                  # control: exactly 20

    # ---------------------------------------------------------------------------------------------- the closed vocabulary (the details are in tests/edit-op-cases.json, shared with the node twin)
    def test_a_refused_batch_changes_nothing_and_the_vocabulary_has_no_way_to_a_story_a_save_or_a_render(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p)
        for op in ({"op": "save_story"}, {"op": "render"}, {"op": "request_final_render"}, {"op": "submit_job"}, {"op": "set_story", "story": {}}, {"op": "fetch", "url": "https://x.example/a.csv"},
                   {"op": "delete_project"}, {"op": "publish"}, {"op": "spend", "credits": 5}):
            self.ai_fails(a, p, [op], code="22023")
            self.ai_fails(a, p, [op], code="22023", mode="compilation")
        self.assertEqual((self.logged(p), self.logged(p, "compilation"), self.revision(p), self.revision(p, "compilation")), (0, 0, 0, 1))

    def test_no_place_on_a_computer_no_web_address_no_markup_no_control_character_in_a_clip_text_or_a_picture(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p)
        for text in ("C:\\Users\\Sam\\secret", "\\\\server\\share", "see ../../etc/passwd", "/etc/passwd", "https://evil.example/x?q=1", "file:///c:/x", "tab\there", "line\nbreak", "rtl\u202eevil", "<b>bold</b>", ""):
            self.ai_fails(a, p, [{"op": "set_clip_text", "id": "t1", "text": text}], code="22023", mode="compilation", base=1)
            self.ai_fails(a, p, [{"op": "add_clip", "track": "text", "start": 1, "len": 2, "text": text}], code="22023", mode="compilation", base=1)
        for pic in ("C:\\x\\a.png", "../a.png", "a/b.png", "a.exe", "a.png.exe", "", "x" * 101 + ".png", "a:b.png"):
            self.ai_fails(a, p, [{"op": "add_clip", "track": "pictures", "start": 1, "len": 2, "picture": pic}], code="22023", mode="compilation", base=1)
        self.assertEqual(self.logged(p, "compilation"), 0)
        ok = self.ai(a, p, [{"op": "set_clip_text", "id": "t1", "text": "Great news, everyone"}, {"op": "add_clip", "track": "pictures", "start": 4, "len": 3, "picture": "logo.PNG"}], mode="compilation", base=1)
        self.assertEqual(ok["changes"], 2)

    def test_the_compilation_ops_are_queued_pending_and_nothing_else_changes(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p)
        good = [{"op": "move_clip", "id": "t1", "start": 12.5}, {"op": "trim_clip", "id": "v1", "edge": "end", "to": 4.25}, {"op": "reorder_clip", "id": "v2", "index": 0},
                {"op": "set_clip_text", "id": "t1", "text": "New words"}, {"op": "delete_clip", "id": "p1"}, {"op": "add_clip", "track": "text", "start": 3, "len": 2.5, "text": "Added"}]
        r = self.ai(a, p, good, mode="compilation", base=1)
        self.assertEqual((r["revision"], r["changes"], r["pending"]), (2, 6, True))
        self.assertEqual(self.admin("select count(*) from public.edit_ops where project_id = %s and status = 'pending' and actor = 'ai'", p), 6)
        self.assertEqual(self.admin("select state -> 'clips' -> 0 ->> 'id' from public.edit_drafts where project_id = %s and mode = 'compilation'", p), "v1")     # the summary is the app's to change
        self.assertEqual(self.look(p), {})                                                                  # a compilation op never touches the data draft

    def test_an_add_clip_on_a_track_the_summarys_lanes_do_not_list_is_refused_in_plain_words_and_no_lanes_means_no_such_rule(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p, summary=dict(SUMMARY, lanes=["video", "text"]))
        pic = {"op": "add_clip", "track": "pictures", "start": 1, "len": 2, "picture": "logo.png"}
        msg = self.ai_fails(a, p, [{"op": "add_clip", "track": "text", "start": 0, "len": 1, "text": "ok"}, pic], code="22023", mode="compilation", base=1)
        self.assertIn("cannot add to the pictures track yet", msg)
        self.assertEqual(self.admin("select count(*) from public.edit_ops where project_id = %s", p), 0)           # all or none: the good first change did not queue either
        self.assertEqual(self.ai(a, p, [{"op": "add_clip", "track": "text", "start": 0, "len": 1, "text": "ok"}], mode="compilation", base=1)["changes"], 1)     # control
        p2 = self.project(a, "no lanes")
        self.mirror(p2)                                                                                           # SUMMARY has no lanes: the old behaviour
        self.assertEqual(self.ai(a, p2, [pic], mode="compilation", base=1)["changes"], 1)

    def test_the_persons_undo_of_a_waiting_ai_change_blocks_a_repeat_but_the_apps_refusal_does_not(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p)
        op = {"op": "delete_clip", "id": "p1"}
        self.ai(a, p, [op], mode="compilation", base=1)
        op_id = self.admin("select max(id) from public.edit_ops where project_id = %s", p)
        r = self.app(ALICE).one("select editor_undo(%s, 'compilation', %s)", p, op_id)
        self.assertEqual(r["undone"], 1)
        self.assertEqual(self.admin("select status || '/' || ended_by from public.edit_ops where id = %s", op_id), "rejected/person")
        self.assertIn("undid exactly this", self.ai_fails(a, p, [op], code="PT409", mode="compilation"))          # the person's undo of a WAITING change counts
        self.assertEqual(self.state(a, p)["recently_undone"][0]["op"], op)
        # the app refusing a change (it could not apply it) is not the person saying no
        p2 = self.project(a, "app refuses")
        self.mirror(p2)
        self.ai(a, p2, [op], mode="compilation", base=1)
        self.run_sql("update public.edit_ops set status = 'rejected', undone_at = now(), ended_by = 'app' where project_id = %s", p2)
        self.assertEqual(self.ai(a, p2, [op], mode="compilation")["changes"], 1)
        # the AI taking back its own change is not the person saying no either
        p3 = self.project(a, "ai undoes itself")
        self.mirror(p3)
        self.ai(a, p3, [op], mode="compilation", base=1)
        self.runner().one("select connect_edit_undo_ai(%s, %s, 'compilation')", h(a), p3)
        self.assertEqual(self.admin("select ended_by from public.edit_ops where project_id = %s", p3), "ai")
        self.assertEqual(self.ai(a, p3, [op], mode="compilation")["changes"], 1)

    # ---------------------------------------------------------------------------------------------- the person's editor, undo, and the person winning
    def test_the_person_edits_the_same_draft_through_the_same_function_and_is_logged_as_the_person(self):
        a = self.alice()
        p = self.project(a)
        self.assertEqual(self.person(ALICE, p, [LOOK("network.color", DARK)])["revision"], 1)
        self.ai(a, p, [LOOK("state.fill", "#00ff00")])
        self.assertEqual(self.look(p), {"network.color": DARK, "state.fill": "#00ff00"})
        feed = self.app(ALICE).one("select my_edit_ops_since(%s, 'data', 0)", p)
        self.assertEqual((feed["revision"], [x["actor"] for x in feed["ops"]], feed["ops"][1]["client"]), (2, ["person", "ai"], "Claude"))
        self.assertEqual(self.app(ALICE).one("select my_edit_ops_since(%s, 'data', 1)", p)["ops"][0]["op"], LOOK("state.fill", "#00ff00"))        # only what is newer
        self.assertEqual(self.app(ALICE).one("select my_edit_ops_since(%s, 'data', 2)", p)["ops"], [])
        with self.assertRaises(psycopg.Error) as cm:                                                         # the person is held to the same revision rule
            self.person(ALICE, p, [LOOK("network.color", LIGHT)], base=0)
        self.assertEqual(cm.exception.sqlstate, "PT409")

    def test_the_persons_undo_restores_the_state_and_marks_the_op_and_the_ai_cannot_repeat_it_for_ten_minutes(self):
        a = self.alice()
        p = self.project(a)
        self.person(ALICE, p, [LOOK("state.fill", "#111111")])
        self.ai(a, p, [LOOK("state.fill", "#ff0000")])
        op_id = self.admin("select max(id) from public.edit_ops where project_id = %s", p)
        r = self.app(ALICE).one("select editor_undo(%s, 'data', %s)", p, op_id)
        self.assertEqual((r["undone"], r["state"]["look"]), (1, {"state.fill": "#111111"}))
        self.assertEqual(self.admin("select status from public.edit_ops where id = %s", op_id), "undone")
        self.assertEqual(self.state(a, p)["recently_undone"][0]["op"], LOOK("state.fill", "#ff0000"))
        msg = self.ai_fails(a, p, [LOOK("state.fill", "#ff0000")], code="PT409")
        self.assertIn("undid exactly this", msg)
        self.assertEqual(self.ai(a, p, [LOOK("state.fill", "#ff0001")])["changes"], 1)                         # a different value is a new idea
        self.run_sql("update public.edit_ops set undone_at = now() - interval '11 minutes' where id = %s", op_id)
        self.assertEqual(self.ai(a, p, [LOOK("state.fill", "#ff0000")])["changes"], 1)                         # after ten minutes it may be proposed again

    def test_undoing_never_clobbers_a_newer_change_and_undo_all_ai_takes_only_the_ais(self):
        a = self.alice()
        p = self.project(a)
        self.ai(a, p, [LOOK("state.fill", "#aa0000")])
        self.person(ALICE, p, [LOOK("state.fill", "#00bb00")])                                                # the person then changes the same setting
        self.ai(a, p, [LOOK("network.color", DARK)])
        r = self.app(ALICE).one("select editor_undo_all_ai(%s, 'data')", p)
        self.assertEqual((r["undone"], r["skipped"]), (1, 1))                                                  # the line colour undone; the fill stands (the person's newer change)
        self.assertEqual(self.look(p), {"state.fill": "#00bb00"})
        self.assertEqual(self.admin("select count(*) from public.edit_ops where project_id = %s and actor = 'person' and status = 'applied'", p), 1)
        # the AI's own undo touches only its latest batch and never the person's
        self.ai(a, p, [LOOK("network.color", LIGHT)])
        self.person(ALICE, p, [LOOK("page.background", "#222222")])
        out = self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
        self.assertEqual((out["undone"], out["state"]["look"]), (1, {"state.fill": "#00bb00", "page.background": "#222222"}))

    def test_applying_random_changes_then_undoing_them_all_in_reverse_restores_the_draft_exactly(self):
        a = self.alice()
        p = self.project(a)
        rng = random.Random(141)
        keys = ["network.color", "network.base_color", "network.context_color", "state.fill", "page.background"]
        colours = ["#111111", "#222222", "#333333", "#abcdef"]
        self.person(ALICE, p, [LOOK("page.background", "#777777")])
        before = self.look(p)
        for _ in range(12):
            ops = []
            for _ in range(rng.randint(1, 4)):
                k = rng.choice(keys)
                ops.append(UNSET(k) if rng.random() < 0.2 else LOOK(k, rng.choice(colours)))
            self.ai(a, p, ops)
        self.assertEqual(before, {"page.background": "#777777"})
        ids = self.admin("select array_agg(id order by id desc) from public.edit_ops where project_id = %s and actor = 'ai'", p)
        for op_id in ids:
            self.app(ALICE).one("select editor_undo(%s, 'data', %s)", p, op_id)
        self.assertEqual(self.look(p), before)

    def test_the_heartbeat_tells_the_ai_whether_an_editor_is_open(self):
        a = self.alice()
        p = self.project(a)
        self.assertFalse(self.state(a, p)["data"]["editor_open"])
        self.app(ALICE).one("select editor_heartbeat(%s, 'data') is null", p)
        self.assertTrue(self.state(a, p)["data"]["editor_open"])
        self.run_sql("update public.edit_drafts set editor_seen_at = now() - interval '31 seconds' where project_id = %s", p)
        self.assertFalse(self.state(a, p)["data"]["editor_open"])
        with self.assertRaises(psycopg.Error):
            self.app(BOB).one("select editor_heartbeat(%s, 'data')", p)                                       # not Bob's project

    # ---------------------------------------------------------------------------------------------- the limits
    def test_sixty_changes_a_minute_and_six_hundred_a_day_for_the_ai_not_for_the_person(self):
        a = self.alice()
        p = self.project(a)
        for _ in range(3):
            self.ai(a, p, [LOOK("page.background", "#000000")] * 20)
        msg = self.ai_fails(a, p, [LOOK("page.background", "#ffffff")], code="PT429")
        self.assertIn("60 changes in a minute", msg)
        self.assertEqual(self.person(ALICE, p, [LOOK("page.background", "#ffffff")] * 20)["changes"], 20)    # the person has no such limit
        self.run_sql("update public.edit_ops set created_at = now() - interval '2 hours' where actor = 'ai'")
        for _ in range(3):
            self.ai(a, p, [LOOK("page.background", "#000000")] * 20)
        self.run_sql("update public.edit_ops set created_at = now() - interval '2 hours' where actor = 'ai'")
        self.run_sql("insert into public.edit_ops (project_id, mode, owner_id, revision, actor, op, status, created_at) select %s, 'data', %s, 1, 'ai', %s::jsonb, 'applied', now() - interval '3 hours' from generate_series(1, 540)",
                     p, ALICE, json.dumps(LOOK("page.background", "#000000")))
        msg2 = self.ai_fails(a, p, [LOOK("page.background", "#ffffff")] * 20, code="PT429")
        self.assertIn("600 changes in a day", msg2)

    # ---------------------------------------------------------------------------------------------- compilation mode (the app is the source of truth)
    def test_the_ai_sees_no_tracks_and_queues_nothing_until_the_person_ticks(self):
        a = self.alice()
        p = self.project(a)
        st = self.state(a, p)["compilation"]
        self.assertEqual((st["shared"], st["tracks"]), (False, None))
        msg = self.ai_fails(a, p, [{"op": "move_clip", "id": "v1", "start": 3}], code="PT403", mode="compilation")
        self.assertIn("Let my AI see my track list", msg)
        self.mirror(p, ai_visible=False)                                                                       # mirrored for the person's page, still not visible to the AI
        self.assertIsNone(self.state(a, p)["compilation"]["tracks"])
        self.ai_fails(a, p, [{"op": "move_clip", "id": "v1", "start": 3}], code="PT403", mode="compilation", base=1)
        self.assertEqual(self.logged(p, "compilation"), 0)

    def test_a_ticked_summary_lets_the_ai_read_tracks_and_queue_ops_and_unticking_drops_both(self):
        a = self.alice()
        p = self.project(a)
        self.mirror(p)
        st = self.state(a, p)["compilation"]
        self.assertTrue(st["shared"])
        self.assertEqual(st["tracks"]["clips"][0]["file"], "interview-3.mp4")
        r = self.ai(a, p, [{"op": "move_clip", "id": "t1", "start": 5}], mode="compilation", base=1)
        self.assertEqual((r["revision"], r["pending"]), (2, True))
        self.assertEqual(self.state(a, p)["compilation"]["pending"], 1)
        self.run_sql("update public.edit_drafts set ai_visible = false where project_id = %s and mode = 'compilation'", p)
        self.assertIsNone(self.state(a, p)["compilation"]["tracks"])
        self.ai_fails(a, p, [{"op": "move_clip", "id": "t1", "start": 6}], code="PT403", mode="compilation", base=2)

    def test_the_person_can_edit_tracks_in_the_web_editor_only_when_the_app_mirrors_them(self):
        a = self.alice()
        p = self.project(a)
        with self.assertRaises(psycopg.Error) as cm:
            self.person(ALICE, p, [{"op": "move_clip", "id": "t1", "start": 1}], mode="compilation")
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.mirror(p, ai_visible=False)
        self.assertTrue(self.person(ALICE, p, [{"op": "move_clip", "id": "t1", "start": 1}], mode="compilation", base=1)["pending"])
        self.assertIsNone(self.state(a, p)["compilation"]["tracks"])                                          # mirrored for the page, not visible to the AI

    # ---------------------------------------------------------------------------------------------- what it cannot do, and who can call what
    def test_other_peoples_projects_look_absent_and_the_connector_has_no_table_access(self):
        a = self.alice()
        _, b, _ = self.connect(BOB, scopes=SCOPES)
        pa = self.project(a)
        self.assertIsNone(self.state(b, pa))                                                                   # Bob cannot read Alice's editor
        msg = self.ai_fails(b, pa, [LOOK("network.color", DARK)], code="PT404", base=0)
        self.assertIn("not found", msg)
        self.assertEqual(self.logged(pa), 0)
        for tbl in ("edit_drafts", "edit_ops", "edit_look_keys"):
            with self.assertRaises(psycopg.Error, msg=tbl):
                self.runner().one(f"select count(*) from public.{tbl}")
            for who in ("anon", ALICE, "service"):
                if tbl == "edit_ops" and who == ALICE:
                    continue
                with self.assertRaises(psycopg.Error, msg=f"{who} {tbl}"):
                    self.db.as_(who).one(f"select count(*) from public.{tbl}")
        self.person(ALICE, pa, [LOOK("network.color", DARK)])
        self.assertEqual(self.db.as_(ALICE).one("select count(*) from public.edit_ops"), 1)                      # the person reads their own log...
        self.assertEqual(self.db.as_(BOB).one("select count(*) from public.edit_ops"), 0)                       # ...and nobody else's
        for stmt in ("insert into public.edit_ops (project_id, mode, owner_id, revision, actor, op) values (gen_random_uuid(), 'data', gen_random_uuid(), 1, 'ai', '{}')",
                     "update public.edit_ops set op = '{}'", "delete from public.edit_ops"):
            with self.assertRaises(psycopg.Error, msg=stmt):
                self.db.as_(ALICE).c.execute(stmt)

    def test_get_edit_state_without_a_project_answers_for_the_editor_that_is_open_now(self):
        a = self.alice()
        p1 = self.project(a, "Film one")
        p2 = self.project(a, "Film two")
        none = self.runner().one("select connect_edit_state(%s, null)", h(a))
        self.assertEqual(none, {"open_editor": False})                                                         # no editor open: said in a few words, nothing else
        self.app(ALICE).one("select editor_heartbeat(%s, 'data')", p1)
        self.run_sql("select pg_sleep(0.05)")
        self.app(ALICE).one("select editor_heartbeat(%s, 'compilation')", p2)
        s = self.runner().one("select connect_edit_state(%s)", h(a))                                           # the argument may be left out entirely
        self.assertEqual(s["project_id"], p2)                                                                  # the newest heartbeat wins, and the answer names its project
        self.assertEqual(self.state(a, p1)["project_id"], p1)                                                  # naming a project still works
        self.run_sql("update public.edit_drafts set editor_seen_at = now() - interval '5 minutes' where project_id = %s", p2)
        self.assertEqual(self.runner().one("select connect_edit_state(%s)", h(a))["project_id"], p1)          # an editor closed more than two minutes ago is not 'open'
        self.run_sql("update public.edit_drafts set editor_seen_at = now() - interval '5 minutes'")
        self.assertEqual(self.runner().one("select connect_edit_state(%s)", h(a)), {"open_editor": False})
        b = self.connect(BOB, scopes=SCOPES)[1]                                                                # another person's open editor is never shown
        pb = self.project(b, "Bobs")
        self.app(BOB).one("select editor_heartbeat(%s, 'data')", pb)
        self.assertEqual(self.runner().one("select connect_edit_state(%s)", h(a)), {"open_editor": False})

    def test_the_edit_tools_have_no_way_to_a_render_a_credit_a_story_a_job_or_a_plan(self):
        a = self.alice()
        p = self.project(a)
        vid = self.runner().one("select connect_current_version(%s, %s)", h(a), p)
        self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, tc.STORY)
        snap = "select jsonb_build_object('stories', (select jsonb_agg(story_sha256 order by id) from public.versions), 'jobs', (select count(*) from public.jobs), 'projects', (select count(*) from public.projects))"
        before = self.admin(snap)
        self.ai(a, p, [LOOK("network.color", DARK), LOOK("page.background", "#101010")])
        self.person(ALICE, p, [LOOK("state.fill", "#445566")])
        self.runner().one("select connect_edit_undo_ai(%s, %s, 'data')", h(a), p)
        self.state(a, p)
        self.assertEqual(before, self.admin(snap))                                                              # the saved story, the jobs and the projects are untouched
        names = self.admin("select array_agg(proname order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'connect\\_edit%%'")
        self.assertEqual(names, ["connect_edit_ops", "connect_edit_state", "connect_edit_undo_ai"])             # exactly three connector doors, none named for a render, save or fetch

    def test_every_function_is_callable_by_exactly_the_roles_intended_also_under_supabases_default_privileges(self):
        sigs = {"connector": ["connect_edit_state(text,uuid)", "connect_edit_ops(text,uuid,text,bigint,jsonb)", "connect_edit_undo_ai(text,uuid,text)"],
                "person": ["editor_apply_ops(uuid,text,bigint,jsonb)", "editor_undo(uuid,text,bigint)", "editor_undo_all_ai(uuid,text)", "my_edit_ops_since(uuid,text,bigint)", "editor_heartbeat(uuid,text)"],
                "node": ["node_edit_pending(text)", "node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)"],
                "nobody": ["ryagram_private.apply_edit_ops(uuid,uuid,text,bigint,text,text,jsonb)", "ryagram_private.undo_edit_ops(uuid,uuid,text,bigint[],text)", "ryagram_private.edit_op_problem(text,jsonb)",
                           "ryagram_private.edit_text_ok(text,integer)", "ryagram_private.edit_purge()"]}
        expect = {"connector": {"connect_runner"}, "person": {"authenticated"}, "node": {"node_runner"}, "nobody": set()}
        name = "le" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role") and l.strip() not in drop]
        c = psycopg.connect(core._server.get_uri(database=name), autocommit=True)
        try:
            c.execute("".join(lines))
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            for path in core.MIGRATIONS:
                c.execute(path.read_text(encoding="utf-8"))
            roles = ("anon", "authenticated", "service_role", "connect_runner", "node_runner", "public")
            for who, lst in sigs.items():
                for sig in lst:
                    schema = "" if "." in sig else "public."
                    got = {r for r in roles if c.execute(f"select has_function_privilege('{r}', '{schema}{sig}', 'EXECUTE')").fetchone()[0]}
                    self.assertEqual(got, expect[who], sig)
            for tbl in ("edit_drafts", "edit_look_keys"):
                for role in roles:
                    self.assertFalse(c.execute(f"select has_table_privilege('{role}', 'public.{tbl}', 'select,insert,update,delete')").fetchone()[0], f"{role} {tbl}")
            for role in ("anon", "service_role", "connect_runner", "node_runner", "public"):
                self.assertFalse(c.execute(f"select has_table_privilege('{role}', 'public.edit_ops', 'select,insert,update,delete')").fetchone()[0], f"{role} edit_ops")
            self.assertTrue(c.execute("select has_table_privilege('authenticated', 'public.edit_ops', 'select')").fetchone()[0])
            self.assertFalse(c.execute("select has_table_privilege('authenticated', 'public.edit_ops', 'insert,update,delete')").fetchone()[0])
        finally:
            c.close()
            with psycopg.connect(core._server.get_uri(), autocommit=True) as c2:
                c2.execute(f"drop database {name}")

    def test_a_connect_token_cannot_reach_the_persons_own_functions_and_the_person_cannot_reach_the_connectors(self):
        a = self.alice()
        p = self.project(a)
        with self.assertRaises(psycopg.Error):
            self.runner().one("select editor_apply_ops(%s, 'data', 0, %s::jsonb)", p, json.dumps([LOOK("network.color", DARK)]))
        with self.assertRaises(psycopg.Error):
            self.app(ALICE).one("select connect_edit_ops(%s, %s, 'data', 0, %s::jsonb)", h(a), p, json.dumps([LOOK("network.color", DARK)]))
        with self.assertRaises(psycopg.Error):                                                                   # an OAuth-style token (it carries a client_id) is refused by the person's functions
            self.app(ALICE, claims=json.dumps({"sub": ALICE, "client_id": "someone"})).one("select editor_apply_ops(%s, 'data', 0, %s::jsonb)", p, json.dumps([LOOK("network.color", DARK)]))
        self.assertEqual(self.logged(p), 0)

    def test_deleting_the_project_deletes_its_draft_and_log_and_the_purge_drops_old_summaries_and_ops(self):
        a = self.alice()
        p = self.project(a)
        self.ai(a, p, [LOOK("network.color", DARK)])
        self.run_sql("insert into public.edit_drafts (project_id, mode, owner_id, mirrored, state, editor_seen_at) values (%s, 'compilation', %s, true, %s::jsonb, now() - interval '25 hours')", p, ALICE, json.dumps({"clips": []}))
        self.run_sql("update public.edit_ops set created_at = now() - interval '8 days'")
        out = self.admin("select ryagram_private.edit_purge()")
        self.assertEqual((out["summaries_dropped"], out["ops_deleted"]), (1, 1))
        self.assertEqual(self.admin("select mirrored::text || state::text from public.edit_drafts where project_id = %s and mode = 'compilation'", p), "false{}")
        self.run_sql("delete from public.projects where id = %s", p)
        self.assertEqual(self.admin("select count(*) from public.edit_drafts"), 0)

    def test_the_after_migration_check_for_ryan_is_all_true_and_goes_false_when_things_are_opened(self):
        sql = (core.ROOT / "live-steps" / "07_live_editor_after_check.sql").read_text(encoding="utf-8")
        rows = self.db.as_(None).c.execute(sql).fetchall()
        self.assertGreaterEqual(len(rows), 6)
        self.assertEqual([r[0] for r in rows if not r[1]], [])
        faults = (("grant execute on function public.connect_edit_ops(text,uuid,text,bigint,jsonb) to authenticated", "revoke execute on function public.connect_edit_ops(text,uuid,text,bigint,jsonb) from authenticated", "ONLY the connector"),
                  ("grant select on public.edit_drafts to authenticated", "revoke select on public.edit_drafts from authenticated", "untouchable"),
                  ("grant insert on public.edit_ops to authenticated", "revoke insert on public.edit_ops from authenticated", "READ their own"))
        for fault, undo, word in faults:
            self.db.as_(None).c.execute(fault)
            bad = [r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]]
            self.assertEqual(len(bad), 1, fault)
            self.assertIn(word, bad[0], fault)
            self.db.as_(None).c.execute(undo)
            self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [], "after undoing: " + fault)

    def test_the_rollback_removes_everything_and_puts_the_old_scope_list_back(self):
        a = self.alice()
        p = self.project(a)
        self.ai(a, p, [LOOK("network.color", DARK)])
        rb = (core.ROOT / "rollbacks" / "20261027000400_live_editor_rollback.sql").read_text(encoding="utf-8")
        self.db.as_(None).c.execute(rb)
        self.assertEqual(self.admin("select ryagram_private.connect_offered_scopes()"), ["read", "write", "render_free"])
        for obj in ("edit_drafts", "edit_ops", "edit_look_keys"):
            self.assertIsNone(self.admin("select to_regclass(%s)", "public." + obj))
        self.assertEqual(self.admin("select count(*) from pg_proc where proname like 'connect_edit%%' or proname like 'editor_%%' or proname like 'node_edit%%' or proname like 'my_edit%%'"), 0)
        self.db.as_(None).c.execute((core.ROOT / "migrations" / "20261027000400_live_editor.sql").read_text(encoding="utf-8"))               # and it applies again
        self.assertIn("edit", self.admin("select ryagram_private.connect_offered_scopes()"))


if __name__ == "__main__":
    unittest.main()
