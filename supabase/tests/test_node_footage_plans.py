"""The desktop app's half of footage plans (migrations/20261030000200_footage_plans.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 168, slice P1b.

Same setup as test_node_download_plans.py (test_r9_node's helpers and its signed-in computer are borrowed); the live-editor migration (the plain-words text rule), the download-plans migration (the scope) and the footage
migration are applied on top of its template database. Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_node_footage_plans.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * a signed-in computer reads ITS person's waiting and running plans (newest first, at most 5) and nobody else's; no owner id comes back; the node route answers even while the AI-side switch is off
  * the app tells the state: waiting -> downloading -> done / refused / cancelled, or waiting -> declined; nothing else; the same state twice is fine; another person's plan looks absent
  * a receipt comes only with 'done', in a closed shape that must name the plan's own source and item; a file name, a title, a path, an address, an unknown field or a wrong type is refused and the state does not move
  * a missing, junk, revoked or worker token is refused; only the node role may run either function and it has no table privilege on the plans
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

MIGRATIONS = [r9.ROOT / "migrations" / n for n in ("20261027000400_live_editor.sql", "20261027000500_download_plans.sql", "20261030000200_footage_plans.sql")]
GET = "node_footage_plans"
UPD = "node_footage_update"
RECEIPT = {"source": "nasa", "item_id": "NHQ_2019_0716", "rights_label_as_shown": "NASA media guidelines: generally not subject to copyright in the United States; NASA asks to be acknowledged.",
           "retrieved": "2026-10-30", "host": "images-assets.nasa.gov", "bytes": 123456, "sha256": "a" * 64}


def setUpModule():
    r9.setUpModule()
    with psycopg.connect(r9._server.get_uri(database="tmplr9"), autocommit=True) as c:
        for m in MIGRATIONS:
            c.execute(m.read_text(encoding="utf-8"))


class NodeFootage(r9.R9):
    def signed(self, who, name="Sam-PC"):
        self.make_tester(who)
        return self.node(who, name)

    def plan(self, who, item="NHQ_2019_0716", state="waiting", at=None, source="nasa"):
        return self.admin("insert into public.footage_plans (owner_id, source, item_id, why, state, created_at) values (%s, %s, %s, 'for the film', %s, coalesce(%s::timestamptz, now())) returning id",
                          who, source, item, state, at)

    def get(self, token):
        return self.runner().one(f"select {GET}(%s)", h(token))

    def upd(self, token, pid, state, receipt=None):
        return self.runner().one(f"select {UPD}(%s, %s, %s, %s::jsonb)", h(token), pid, state, json.dumps(receipt) if receipt is not None else None)

    def state_of(self, pid):
        return self.admin("select state from public.footage_plans where id = %s", pid)

    def refused(self, token, pid, state, receipt=None, code="22023"):
        before = self.state_of(pid)
        with self.assertRaises(psycopg.Error) as cm:
            self.upd(token, pid, state, receipt)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        self.assertEqual(self.state_of(pid), before)                                                           # the state did not move
        return str(cm.exception)

    def test_a_computer_reads_its_persons_open_plans_newest_first_and_nobody_elses_and_the_switch_does_not_matter(self):
        self.assertFalse(self.admin("select footage_enabled from public.connect_flags"))                       # the AI-side switch is OFF here, as shipped
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        old = self.plan(SAM, "NHQ_OLD_0001", at="2026-10-01 10:00+00")
        new = self.plan(SAM, "NHQ_NEW_0002", at="2026-10-02 10:00+00")
        self.plan(SAM, "NHQ_FIN_0003", state="done")
        self.plan(BOB, "NHQ_BOB_0004")
        got = self.get(sam)
        self.assertEqual([r["id"] for r in got], [str(new), str(old)])
        self.assertTrue(all(set(r) == {"id", "source", "item_id", "why", "state"} for r in got))             # no owner id, nothing about the account
        self.assertEqual([r["item_id"] for r in self.get(bob)], ["NHQ_BOB_0004"])                            # control: Bob gets his own
        for i in range(8):
            self.plan(SAM, f"NHQ_N{i}_00{i}")
        self.assertEqual(len(self.get(sam)), 5)

    def test_the_states_move_one_way_and_only_for_the_owner(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        p = self.plan(SAM)
        self.assertIsNone(self.upd(bob, p, "downloading"))                                                    # not Bob's plan: looks absent
        self.assertEqual(self.state_of(p), "waiting")
        for bad in ("done", "refused", "waiting", "unpacking", "exploded"):
            self.refused(sam, p, bad)
        self.assertEqual(self.upd(sam, p, "downloading"), "downloading")
        self.assertEqual(self.upd(sam, p, "downloading"), "downloading")                                       # the same thing twice is fine
        self.refused(sam, p, "declined")                                                                       # a running download is cancelled, not declined
        self.assertEqual(self.upd(sam, p, "done", RECEIPT), "done")
        self.refused(sam, p, "downloading")                                                                    # finished is final
        q = self.plan(SAM, "NHQ_Q_0001")
        self.assertEqual(self.upd(sam, q, "declined"), "declined")
        self.refused(sam, q, "downloading")
        for final in ("refused", "cancelled"):
            r = self.plan(SAM, f"NHQ_{final}_01")
            self.upd(sam, r, "downloading")
            self.assertEqual(self.upd(sam, r, final), final)
        self.assertEqual(self.get(sam), [])                                                                    # none of them is open any more

    def test_a_receipt_names_the_plans_own_item_is_a_closed_shape_and_comes_only_with_done(self):
        sam = self.signed(SAM)
        p = self.plan(SAM, state="downloading")
        self.refused(sam, p, "refused", RECEIPT)                                                               # a receipt only with 'done'
        bads = {"a file name": dict(RECEIPT, file="launch.mp4"), "a title": dict(RECEIPT, title="Apollo 11 launch"), "a folder": dict(RECEIPT, folder="Footage"), "an unknown field": dict(RECEIPT, extra=1),
                "another item": dict(RECEIPT, item_id="OTHER_ITEM_9"), "another source": dict(RECEIPT, source="nara"), "a bad sha": dict(RECEIPT, sha256="xyz"),
                "a host with a path": dict(RECEIPT, host="images-assets.nasa.gov/a.mp4"), "a bad date": dict(RECEIPT, retrieved="yesterday"), "a stub size": dict(RECEIPT, bytes=100),
                "text bytes": dict(RECEIPT, bytes="123456"), "a huge size": dict(RECEIPT, bytes=3_000_000_000), "markup in the wording": dict(RECEIPT, rights_label_as_shown="<b>free</b>"),
                "an address in the wording": dict(RECEIPT, rights_label_as_shown="see https://nasa.example for the rules"), "no wording": dict(RECEIPT, rights_label_as_shown=""),
                "a long wording": dict(RECEIPT, rights_label_as_shown="x" * 1501), "a missing sha": {k: v for k, v in RECEIPT.items() if k != "sha256"}, "not an object": ["a"]}
        for label, rec in bads.items():
            self.refused(sam, p, "done", rec)
        self.assertIsNone(self.admin("select receipt from public.footage_plans where id = %s", p))
        self.assertEqual(self.upd(sam, p, "done", RECEIPT), "done")
        self.assertEqual(self.admin("select receipt ->> 'sha256' from public.footage_plans where id = %s", p), "a" * 64)
        q = self.plan(SAM, "NHQ_Q_0002", state="downloading")
        self.assertEqual(self.upd(sam, q, "done"), "done")                                                     # done with no receipt is allowed (the app may be old)

    def test_a_missing_junk_revoked_or_worker_token_is_refused(self):
        sam = self.signed(SAM)
        p = self.plan(SAM)
        self.assertEqual(len(self.get(sam)), 1)                                                                # control
        for bad in (None, "junk", "0" * 64, "G" * 64):
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.runner().one(f"select {GET}(%s)", bad)
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.runner().one(f"select {UPD}(%s, %s, 'downloading', null)", bad, p)
        self.admin("update public.node_tokens set revoked_at = now() where token_hash = %s returning 1", h(sam))
        with self.assertRaises(psycopg.Error):
            self.get(sam)
        self.assertEqual(self.state_of(p), "waiting")

    def test_only_the_node_role_may_run_either_function_and_it_has_no_table_privilege(self):
        for fn in ("public.node_footage_plans(text)", "public.node_footage_update(text,uuid,text,jsonb)"):
            self.assertTrue(self.admin("select has_function_privilege('node_runner', %s, 'execute')", fn))
            for role in ("anon", "authenticated", "connect_runner"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")
        for role in ("node_runner", "connect_runner", "anon"):
            self.assertFalse(self.admin("select has_table_privilege(%s, 'public.footage_plans', 'select')", role), role)


if __name__ == "__main__":
    unittest.main()
