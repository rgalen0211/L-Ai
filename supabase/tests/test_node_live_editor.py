"""The desktop app's half of the live preview editor (migrations/20261027000400_live_editor.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 141.

Same setup as test_r9_node.py (its helpers and its signed-in computer are borrowed); the live-editor migration is applied on top of its template database.
    pgvenv/Scripts/python -m unittest supabase/tests/test_node_live_editor.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * node_edit_post_summary mirrors the track summary of one of ITS person's projects and nobody else's; the summary is a closed shape of names and times (no place, no unknown field)
  * node_edit_pending returns the waiting changes of ITS person's mirrored drafts, newest last, and none of anybody else's; nothing waits once nothing is mirrored
  * the app's acknowledgement turns a waiting change into applied or rejected, only for its own person's project; unticking "let my AI see my track list" drops the AI's waiting changes
  * only the node role may run either function, and it has no table privilege on the editor tables
"""
import json
import os
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_r9_node as r9  # noqa: E402
from test_r9_node import BOB, SAM, h, tearDownModule  # noqa: E402,F401  (tearDownModule is what unittest calls)

MIGRATIONS = [Path(os.environ.get("LIVE_EDITOR_SQL") or r9.ROOT / "migrations" / "20261027000400_live_editor.sql")]      # LIVE_EDITOR_SQL: a mutant copy, for the must-fail probe
PEND = "public.node_edit_pending(text)"
POST = "public.node_edit_post_summary(text,uuid,boolean,boolean,jsonb,jsonb)"
SUMMARY = {"duration": 12, "clips": [
    {"id": "c1", "track": "video", "start": 0, "len": 4, "label": "Intro", "file": "intro.mp4"},
    {"id": "c2", "track": "text", "start": 4, "len": 3, "text": "Hello there"},
    {"id": "c3", "track": "pictures", "start": 7, "len": 2, "picture": "cheer.png"}]}
SUMMARY2 = {"duration": 10, "clips": [{"id": "c1", "track": "video", "start": 0, "len": 4, "label": "Intro", "file": "intro.mp4"}]}


def setUpModule():
    r9.setUpModule()
    with psycopg.connect(r9._server.get_uri(database="tmplr9"), autocommit=True) as c:
        for m in MIGRATIONS:
            c.execute(m.read_text(encoding="utf-8"))


class NodeEditor(r9.R9):
    def signed(self, who, name="Sam-PC"):
        self.make_tester(who)                                  # a computer can be signed in only for a tester (r9)
        return self.node(who, name)

    def project(self, who, title="film"):
        return self.db.as_(who).one("insert into projects (title) values (%s) returning id", title)

    def post(self, token, project, mirror=True, ai_visible=True, summary=SUMMARY, applied=None):
        return self.runner().one("select node_edit_post_summary(%s, %s, %s, %s, %s::jsonb, %s::jsonb)", h(token), project, mirror, ai_visible,
                                 json.dumps(summary) if summary is not None else None, json.dumps(applied or []))

    def pending(self, token):
        return self.runner().one("select node_edit_pending(%s)", h(token))

    def ai_queue(self, who, project, base, ops):
        """What the person's AI does (through connect_edit_ops in the real thing): queue compilation changes."""
        return self.admin("select ryagram_private.apply_edit_ops(%s, %s, 'compilation', %s, 'ai', 'Claude', %s::jsonb)", who, project, base, json.dumps(ops))

    def status(self, project):
        return self.admin("select jsonb_agg(status order by id) from public.edit_ops where project_id = %s", project)

    def draft(self, project):
        return self.admin("select to_jsonb(d) - 'updated_at' - 'editor_seen_at' from public.edit_drafts d where project_id = %s and mode = 'compilation'", project)

    # ---------------------------------------------------------------------------------------------- mirror and pending
    def test_the_app_mirrors_the_summary_and_then_sees_exactly_its_persons_waiting_changes(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        p, bp = self.project(SAM), self.project(BOB, "bobs")
        self.assertEqual(self.pending(sam), [])
        r = self.post(sam, p)
        self.assertEqual((r["revision"], r["mirrored"], r["ai_visible"]), (1, True, True))
        self.post(bob, bp)
        self.ai_queue(SAM, p, 1, [{"op": "move_clip", "id": "c2", "start": 5}, {"op": "delete_clip", "id": "c3"}])
        self.ai_queue(BOB, bp, 1, [{"op": "set_clip_text", "id": "c2", "text": "bobs words"}])
        got = self.pending(sam)
        self.assertEqual([x["op"]["op"] for x in got], ["move_clip", "delete_clip"])
        self.assertTrue(all(set(x) == {"id", "project_id", "revision", "client", "op"} for x in got))            # no owner id, nothing about the account
        self.assertEqual({x["project_id"] for x in got}, {str(p)})
        self.assertEqual([x["op"]["text"] for x in self.pending(bob)], ["bobs words"])                          # control: Bob gets his own

    def test_the_acknowledgement_turns_waiting_changes_into_applied_or_rejected_and_stores_the_new_summary(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        self.ai_queue(SAM, p, 1, [{"op": "move_clip", "id": "c2", "start": 5}, {"op": "delete_clip", "id": "c3"}])
        a, b = [x["id"] for x in self.pending(sam)]
        r = self.post(sam, p, summary=SUMMARY2, applied=[{"op_id": a, "ok": True}, {"op_id": b, "ok": False}])
        self.assertEqual(r["revision"], 3)                                                                       # 1 mirror, 2 the AI's batch, 3 the acknowledgement
        self.assertEqual(self.status(p), ["applied", "rejected"])
        self.assertEqual(self.pending(sam), [])
        self.assertEqual(self.draft(p)["state"], SUMMARY2)

    def test_unticking_the_ai_box_drops_the_ais_waiting_changes_but_keeps_the_mirror(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        self.ai_queue(SAM, p, 1, [{"op": "delete_clip", "id": "c3"}])
        self.assertEqual(len(self.pending(sam)), 1)
        r = self.post(sam, p, ai_visible=False)
        self.assertEqual((r["mirrored"], r["ai_visible"]), (True, False))
        self.assertEqual(self.status(p), ["rejected"])
        self.assertEqual(self.pending(sam), [])
        self.assertEqual(self.draft(p)["state"], SUMMARY)                                                        # the person's own page still has its list

    def test_switching_the_mirror_off_drops_the_summary_the_box_and_every_waiting_change(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        self.ai_queue(SAM, p, 1, [{"op": "delete_clip", "id": "c3"}])
        r = self.post(sam, p, mirror=False, ai_visible=True, summary=None)
        self.assertEqual((r["mirrored"], r["ai_visible"]), (False, False))
        d = self.draft(p)
        self.assertEqual((d["state"], d["mirrored"], d["ai_visible"]), ({}, False, False))
        self.assertEqual(self.status(p), ["rejected"])
        self.assertEqual(self.pending(sam), [])

    def test_a_change_waits_only_while_the_draft_is_mirrored(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        self.ai_queue(SAM, p, 1, [{"op": "delete_clip", "id": "c3"}])
        self.assertEqual(len(self.pending(sam)), 1)                                                              # control
        self.admin("update public.edit_drafts set mirrored = false, ai_visible = false where project_id = %s returning 1", p)
        self.assertEqual(self.pending(sam), [])

    def test_at_most_a_hundred_waiting_changes_come_back_oldest_first(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        for i in range(6):
            self.ai_queue(SAM, p, 1 + i, [{"op": "move_clip", "id": "c2", "start": i} for _ in range(20)])    # 120 changes in six batches (the AI's own limit is 60 a minute, so lift it for the test)
            self.admin("update public.edit_ops set created_at = now() - interval '2 hours' where project_id = %s returning 1", p)
        got = self.pending(sam)
        self.assertEqual(len(got), 100)
        self.assertEqual([x["id"] for x in got], sorted(x["id"] for x in got))

    # ---------------------------------------------------------------------------------------------- refusals
    def test_a_missing_junk_or_revoked_token_is_refused_and_a_read_changes_nothing(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        before = self.draft(p)
        for bad in (None, "junk", "0" * 64):
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.runner().one("select node_edit_pending(%s)", bad)
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.runner().one("select node_edit_post_summary(%s, %s, true, true, %s::jsonb, '[]'::jsonb)", bad, p, json.dumps(SUMMARY))
        for _ in range(3):
            self.pending(sam)
        self.assertEqual(self.draft(p), before)
        self.admin("update public.node_tokens set revoked_at = now() where token_hash = %s returning 1", h(sam))
        with self.assertRaises(psycopg.Error):
            self.pending(sam)

    def test_a_computer_cannot_mirror_or_acknowledge_another_persons_project(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        p = self.project(SAM)
        self.post(sam, p)
        self.ai_queue(SAM, p, 1, [{"op": "delete_clip", "id": "c3"}])
        op = self.pending(sam)[0]["id"]
        with self.assertRaises(psycopg.Error) as cm:
            self.post(bob, p)
        self.assertEqual(cm.exception.sqlstate, "PT404")
        self.assertEqual(self.admin("select count(*) from public.edit_drafts where project_id = %s and owner_id <> %s", p, SAM), 0)
        bp = self.project(BOB, "bobs")
        self.post(bob, bp, applied=[{"op_id": op, "ok": True}])                                                  # Bob names Sam's op while posting for his own project: it is ignored
        self.assertEqual(self.status(p), ["pending"])

    def test_an_acknowledgement_only_reaches_changes_of_the_project_it_is_posted_for(self):
        sam = self.signed(SAM)
        p1, p2 = self.project(SAM, "one"), self.project(SAM, "two")
        self.post(sam, p1)
        self.post(sam, p2)
        self.ai_queue(SAM, p1, 1, [{"op": "delete_clip", "id": "c3"}])
        op = self.pending(sam)[0]["id"]
        self.post(sam, p2, applied=[{"op_id": op, "ok": True}])                                                  # the right person, the wrong project: ignored
        self.assertEqual(self.status(p1), ["pending"])
        self.post(sam, p1, applied=[{"op_id": op, "ok": True}])                                                  # control: the right project works
        self.assertEqual(self.status(p1), ["applied"])

    def test_the_makers_read_only_fields_lanes_and_limits_are_accepted_and_their_wrong_shapes_refused(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        rich = {"duration": 9, "lanes": ["video", "text"], "limits": {"text_chars": 120, "clips": 600, "slides": {"min": 0.5, "max": 10}},
                "clips": [{"id": "v1", "track": "video", "start": 0, "len": 4, "source": "beach.mp4", "source_start": 12.5, "min_len": 0.3, "max_len": 30},
                          {"id": "t1", "track": "text", "start": 1, "len": 2, "text": "Hi", "position": "lower_third", "size": "large", "min_len": 0.5, "max_len": 30}]}
        self.assertEqual(self.post(sam, p, summary=rich)["revision"], 1)
        self.assertEqual(self.draft(p)["state"], rich)
        clip = rich["clips"][0]
        bad = [dict(rich, lanes=["video", "audio"]), dict(rich, lanes="video"), dict(rich, lanes=["video"] * 5), dict(rich, limits={"Text Chars": 1}), dict(rich, limits={"a": "x"}),
               dict(rich, limits={"a": {"b": "x"}}), dict(rich, limits={"k%d" % i: 1 for i in range(11)}), dict(rich, limits=[1]),
               dict(rich, clips=[dict(clip, source="C:\\\\clips\\\\beach.mp4")]), dict(rich, clips=[dict(clip, source="a/b.mp4")]), dict(rich, clips=[dict(clip, source_start=-1)]),
               dict(rich, clips=[dict(clip, max_len="long")]), dict(rich, clips=[dict(clip, min_len=90000)]),
               dict(rich, clips=[dict(rich["clips"][1], position="middle")]), dict(rich, clips=[dict(rich["clips"][1], size="huge")])]
        for s in bad:
            with self.assertRaises(psycopg.Error, msg=json.dumps(s)[:90]) as cm:
                self.post(sam, p, summary=s)
            self.assertEqual(cm.exception.sqlstate, "22023", json.dumps(s)[:90])
        self.assertEqual(self.draft(p)["state"], rich)

    def test_a_clip_showing_altered_footage_and_the_makers_schema_name_are_accepted_read_only_and_wrong_shapes_refused(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        marked = {"schema": "ryagram.edit-tracks/0", "duration": 5, "lanes": ["video", "text"],
                  "clips": [{"id": "v1", "track": "video", "start": 0, "len": 5, "source": "a.mp4", "source_start": 0, "ai_altered": True, "ai_altered_by": "a face swapped by the Ryagram app"}]}
        self.assertEqual(self.post(sam, p, summary=marked)["revision"], 1)                                      # the first marked clip does not make the post fail
        self.assertEqual(self.draft(p)["state"], marked)
        derived = dict(marked, clips=[dict(marked["clips"][0], ai_altered_derived=True)])                       # BUILDER's state also says WHY a clip is marked (it shows registered footage)
        self.assertEqual(self.post(sam, p, summary=derived)["revision"], 2)
        self.assertEqual(self.draft(p)["state"], derived)
        with self.assertRaises(psycopg.Error) as cm0:
            self.post(sam, p, summary=dict(marked, clips=[dict(marked["clips"][0], ai_altered_derived="yes")]))
        self.assertEqual(cm0.exception.sqlstate, "22023")
        marked = derived
        clip = marked["clips"][0]
        for s in (dict(marked, schema="other/1"), dict(marked, schema=1), dict(marked, clips=[dict(clip, ai_altered="yes")]), dict(marked, clips=[dict(clip, ai_altered_by=5)]),
                  dict(marked, clips=[dict(clip, ai_altered_by="see C:\\\\x\\\\y.txt")]), dict(marked, clips=[dict(clip, ai_altered_by="x" * 201)])):
            with self.assertRaises(psycopg.Error, msg=json.dumps(s)[:90]) as cm:
                self.post(sam, p, summary=s)
            self.assertEqual(cm.exception.sqlstate, "22023")
        self.assertEqual(self.draft(p)["state"], marked)
        self.ai_queue(SAM, p, 2, [{"op": "delete_clip", "id": "v1"}])
        with self.assertRaises(psycopg.Error):                                                                  # no op can set the marker: the vocabulary has no such field
            self.ai_queue(SAM, p, 3, [{"op": "set_clip_text", "id": "v1", "text": "x", "ai_altered": False}])

    def test_text_slides_and_timed_pictures_of_the_makers_state_are_accepted_and_their_wrong_shapes_refused(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        state = {"schema": "ryagram.edit-tracks/0", "duration": 8, "lanes": ["video", "pictures", "text"], "clips": [
            {"id": "s1", "track": "video", "start": 0, "len": 2, "label": "Opening", "slide": True, "text": "Opening", "min_len": 0.5, "max_len": 10},
            {"id": "s2", "track": "video", "start": 2, "len": 2, "slide": True, "picture": "title.png", "min_len": 0.5, "max_len": 10},
            {"id": "p1", "track": "pictures", "start": 1, "len": 2, "picture": "logo.png", "mode": "corner", "fade_s": 0.3, "min_len": 0.5, "max_len": 30}]}
        self.assertEqual(self.post(sam, p, summary=state)["revision"], 1)
        self.assertEqual(self.draft(p)["state"], state)
        c = state["clips"]
        for bad in (dict(c[0], slide="yes"), dict(c[2], mode="middle"), dict(c[2], mode=3), dict(c[2], fade_s=2), dict(c[2], fade_s="slow"), dict(c[2], fade_s=-0.1)):
            with self.assertRaises(psycopg.Error, msg=json.dumps(bad)[:80]) as cm:
                self.post(sam, p, summary=dict(state, clips=[bad]))
            self.assertEqual(cm.exception.sqlstate, "22023")
        self.assertEqual(self.draft(p)["state"], state)

    def test_a_summary_with_a_place_an_unknown_field_or_a_wrong_shape_is_refused_whole(self):
        sam = self.signed(SAM)
        p = self.project(SAM)
        self.post(sam, p)
        before = self.draft(p)
        clip = SUMMARY["clips"][1]
        bad = [
            {"clips": [dict(clip, text="see C:\\Users\\me\\secret.txt")]},
            {"clips": [dict(clip, text="see https://evil.test/x")]},
            {"clips": [dict(clip, text="<b>x</b>")]},
            {"clips": [{"id": "c9", "track": "pictures", "start": 0, "len": 1, "picture": "..\\x.png"}]},
            {"clips": [{"id": "c9", "track": "video", "start": 0, "len": 1, "file": "D:\\videos\\a.mp4"}]},
            {"clips": [dict(clip, path="C:\\x")]},
            {"clips": [dict(clip, track="audio")]},
            {"clips": [dict(clip, start="soon")]},
            {"clips": [dict(clip, id="bad id!")]},
            {"clips": "nope"},
            {"clips": [dict(clip, id="c%d" % i) for i in range(301)]},
            {"clips": [], "duration": -1},
            {"clips": [], "duration": 90000},
            {"clips": [], "overlays": []},
        ]
        for s in bad:
            with self.assertRaises(psycopg.Error, msg=json.dumps(s)[:80]) as cm:
                self.post(sam, p, summary=s)
            self.assertEqual(cm.exception.sqlstate, "22023", json.dumps(s)[:80])
        for s in (None, [], "text"):
            with self.assertRaises(psycopg.Error, msg=str(s)):
                self.post(sam, p, summary=s) if s is not None else self.runner().one("select node_edit_post_summary(%s, %s, true, true, null, '[]'::jsonb)", h(sam), p)
        self.assertEqual(self.draft(p), before)                                                                  # not one refused summary changed anything
        self.post(sam, p, summary=SUMMARY2)                                                                      # control: a good one still goes in

    # ---------------------------------------------------------------------------------------------- privileges
    def test_only_the_node_role_may_run_either_function_and_it_has_no_table_privilege_on_the_editor_tables(self):
        for fn in (PEND, POST):
            for role in ("anon", "authenticated", "connect_runner", "service_role", "public"):
                if role != "public" and not self.admin("select count(*) from pg_roles where rolname = %s", role):
                    continue
                self.assertFalse(self.admin(f"select has_function_privilege('{role}', '{fn}', 'EXECUTE')"), f"{role} {fn}")
            self.assertTrue(self.admin(f"select has_function_privilege('node_runner', '{fn}', 'EXECUTE')"), fn)
            self.assertTrue(self.admin(f"select prosecdef from pg_proc where oid = '{fn}'::regprocedure"), fn)
            self.assertNotRegex(self.admin(f"select pg_get_function_arguments('{fn}'::regprocedure)"), r"owner|user")
        for t in ("edit_drafts", "edit_ops", "edit_look_keys"):
            self.assertFalse(self.admin(f"select has_table_privilege('node_runner', 'public.{t}', 'select,insert,update,delete')"), t)
        callable_now = r9.Review1411.callable_by_runner(self)
        self.assertEqual(callable_now, sorted(r9.Review1411.NODE_FNS + [PEND, POST]))                              # the node role's WHOLE reach is the old list plus these two
        sam = self.signed(SAM)
        with self.assertRaises(psycopg.Error):                                                                     # a signed-in person cannot call it, even with a real token hash
            self.db.as_(SAM).one("select node_edit_pending(%s)", h(sam))


if __name__ == "__main__":
    unittest.main()
