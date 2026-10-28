"""The desktop app's half of download plans (migrations/20261027000500_download_plans.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 152.

Same setup as test_r9_node.py (its helpers and its signed-in computer are borrowed); the live-editor migration (the plain-words text rule) and the download-plans migration are applied on top of its template database.
    pgvenv/Scripts/python -m unittest supabase/tests/test_node_download_plans.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * a signed-in computer reads ITS person's waiting and running plans (newest first, at most 5) and nobody else's; finished ones are not returned; no owner id comes back
  * the app tells the state: waiting -> downloading -> unpacking -> done / refused / cancelled, or waiting -> declined; nothing else; the same state twice is fine; another person's plan looks absent
  * a receipt comes only with 'done', in a closed shape (host names, a date, sizes, a SHA-256, plain words): a file name, a path, an unknown field or a wrong type is refused and the state does not move
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

MIGRATIONS = [r9.ROOT / "migrations" / "20261027000400_live_editor.sql", Path(os.environ.get("DOWNLOAD_PLANS_SQL") or r9.ROOT / "migrations" / "20261027000500_download_plans.sql")]
GET = "node_download_plans"
UPD = "node_download_update"
RECEIPT = {"schema": "ryagram.download-receipt/0", "address_host": "www.census.gov", "final_host": "www.census.gov", "retrieved": "2026-10-27", "bytes": 1234, "sha256": "a" * 64, "kind": "text",
           "members": 0, "licence": "not stated", "trust_label": "official", "why": "the county table for your map", "steps": ["downloaded", "the raw file stays on this computer"]}


def setUpModule():
    r9.setUpModule()
    with psycopg.connect(r9._server.get_uri(database="tmplr9"), autocommit=True) as c:
        for m in MIGRATIONS:
            c.execute(m.read_text(encoding="utf-8"))


class NodeDownloads(r9.R9):
    def signed(self, who, name="Sam-PC"):
        self.make_tester(who)
        return self.node(who, name)

    def plan(self, who, url="https://www.census.gov/a.csv", state="waiting", at=None):
        return self.admin("insert into public.download_plans (owner_id, request, host, state, created_at) values (%s, %s::jsonb, 'www.census.gov', %s, coalesce(%s::timestamptz, now())) returning id",
                          who, json.dumps({"schema": "ryagram.download-plan/0", "url": url, "why": "for the map", "folder": "Census"}), state, at)

    def get(self, token):
        return self.runner().one(f"select {GET}(%s)", h(token))

    def upd(self, token, pid, state, receipt=None):
        return self.runner().one(f"select {UPD}(%s, %s, %s, %s::jsonb)", h(token), pid, state, json.dumps(receipt) if receipt is not None else None)

    def state_of(self, pid):
        return self.admin("select state from public.download_plans where id = %s", pid)

    def refused(self, token, pid, state, receipt=None, code="22023"):
        before = self.state_of(pid)
        with self.assertRaises(psycopg.Error) as cm:
            self.upd(token, pid, state, receipt)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        self.assertEqual(self.state_of(pid), before)                                                           # the state did not move
        return str(cm.exception)

    def test_a_computer_reads_its_persons_open_plans_newest_first_and_nobody_elses(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        old = self.plan(SAM, "https://www.census.gov/old.csv", at="2026-10-01 10:00+00")
        new = self.plan(SAM, "https://www.census.gov/new.csv", at="2026-10-02 10:00+00")
        self.plan(SAM, "https://www.census.gov/finished.csv", state="done")
        self.plan(BOB, "https://www.census.gov/bobs.csv")
        got = self.get(sam)
        self.assertEqual([r["id"] for r in got], [str(new), str(old)])
        self.assertTrue(all(set(r) == {"id", "request", "state"} for r in got))                              # no owner id, nothing about the account
        self.assertEqual([r["request"]["url"] for r in self.get(bob)], ["https://www.census.gov/bobs.csv"])  # control: Bob gets his own
        for i in range(8):
            self.plan(SAM, f"https://www.census.gov/n{i}.csv")
        self.assertEqual(len(self.get(sam)), 5)

    def test_the_states_move_one_way_and_only_for_the_owner(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        p = self.plan(SAM)
        self.assertIsNone(self.upd(bob, p, "downloading"))                                                    # not Bob's plan: looks absent
        self.assertEqual(self.state_of(p), "waiting")
        self.refused(sam, p, "done")                                                                           # waiting cannot jump to done
        self.refused(sam, p, "unpacking")
        self.refused(sam, p, "waiting")
        self.refused(sam, p, "exploded")
        self.assertEqual(self.upd(sam, p, "downloading"), "downloading")
        self.assertEqual(self.upd(sam, p, "downloading"), "downloading")                                       # the same thing twice is fine
        self.refused(sam, p, "declined")                                                                       # a running download is cancelled, not declined
        self.assertEqual(self.upd(sam, p, "unpacking"), "unpacking")
        self.assertEqual(self.upd(sam, p, "done", RECEIPT), "done")
        self.refused(sam, p, "downloading")                                                                    # finished is final
        q = self.plan(SAM)
        self.assertEqual(self.upd(sam, q, "declined"), "declined")
        self.refused(sam, q, "downloading")
        r = self.plan(SAM)
        self.upd(sam, r, "downloading")
        self.assertEqual(self.upd(sam, r, "refused"), "refused")
        s = self.plan(SAM)
        self.upd(sam, s, "downloading")
        self.assertEqual(self.upd(sam, s, "cancelled"), "cancelled")
        self.assertEqual(self.get(sam), [])                                                                    # none of them is open any more

    def test_a_receipt_is_a_closed_shape_and_comes_only_with_done(self):
        sam = self.signed(SAM)
        p = self.plan(SAM, state="downloading")
        self.refused(sam, p, "unpacking", RECEIPT)                                                             # not before it is done
        bads = {"a file name": dict(RECEIPT, file="counties.csv"), "a path": dict(RECEIPT, why="saved in C:" + chr(92) + "Users" + chr(92) + "me"), "an unknown field": dict(RECEIPT, extra=1),
                "a folder": dict(RECEIPT, folder="Census"), "a bad sha": dict(RECEIPT, sha256="xyz"), "a bad host": dict(RECEIPT, final_host="www.census.gov/a.csv"),
                "an address in the host": dict(RECEIPT, address_host="https://www.census.gov"), "a bad date": dict(RECEIPT, retrieved="yesterday"), "negative bytes": dict(RECEIPT, bytes=-1),
                "text bytes": dict(RECEIPT, bytes="1234"), "too many members": dict(RECEIPT, members=10001), "a kind we do not take": dict(RECEIPT, kind="exe"),
                "a label we do not take": dict(RECEIPT, trust_label="trusted"), "a markup licence": dict(RECEIPT, licence="<b>open</b>"), "a web address in why": dict(RECEIPT, why="see https://x.example"),
                "too many steps": dict(RECEIPT, steps=["s"] * 11), "a step with a path": dict(RECEIPT, steps=["C:" + chr(92) + "x"]), "another schema": dict(RECEIPT, schema="x/1"),
                "a missing sha": {k: v for k, v in RECEIPT.items() if k != "sha256"}, "a missing licence": {k: v for k, v in RECEIPT.items() if k != "licence"}, "not an object": ["a"]}
        for label, rec in bads.items():
            self.refused(sam, p, "done", rec)
        self.assertIsNone(self.admin("select receipt from public.download_plans where id = %s", p))
        self.assertEqual(self.upd(sam, p, "done", RECEIPT), "done")
        self.assertEqual(self.admin("select receipt ->> 'sha256' from public.download_plans where id = %s", p), "a" * 64)
        q = self.plan(SAM, state="unpacking")
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
        for fn in ("public.node_download_plans(text)", "public.node_download_update(text,uuid,text,jsonb)"):
            self.assertTrue(self.admin("select has_function_privilege('node_runner', %s, 'execute')", fn))
            for role in ("anon", "authenticated", "connect_runner"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")
        for role in ("node_runner", "connect_runner", "anon"):
            self.assertFalse(self.admin("select has_table_privilege(%s, 'public.download_plans', 'select')", role), role)


if __name__ == "__main__":
    unittest.main()
