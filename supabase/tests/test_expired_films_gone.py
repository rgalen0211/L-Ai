"""An expired paid film is marked deleted only once its file is really gone (WORKER 2026-11-21, GEO's privacy review M2;
migrations/20261121000200_expired_films_really_gone.sql).

Before, render_orders_tick() marked the delivery and its artifact deleted BEFORE ops-tick removed the file, so one failed
Storage remove left the customer's film stored for good while every row said it was gone. Now the tick only lists what is
due, and mark_deliveries_removed() marks a delivery deleted only when storage.objects no longer holds its file.

MUST-FAIL (proved on L-Ai main 7cf4a389 without the new migration): test_tick_lists_but_never_marks_while_the_file_is_there
fails there, because the old tick marks the rows deleted at once.

Driven through the worker's own functions, as test_pipe1_orders.py is (the PC worker against this SQL is Ryagram
tests/worker_orders.py). Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_expired_films_gone.py -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2b_credits as credits  # noqa: E402
import test_pipe1_orders as po  # noqa: E402

OTHER, RYAN = po.OTHER, po.RYAN


def setUpModule():
    credits.setUpModule()


class ExpiredFilmsGone(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    setUp = po.Orders.setUp
    admin, denied, grant = credits.Ledger.admin, credits.Ledger.denied, credits.Ledger.grant
    order, order_row, claim, work = po.Orders.order, po.Orders.order_row, po.Orders.claim, po.Orders.work
    work_through_preview, stage_job = po.Orders.work_through_preview, po.Orders.stage_job

    # ---------------------------------------------------------------- helpers
    def delivered(self, key):
        """A paid final film delivered to OTHER, as the worker makes it (its file is in storage.objects)."""
        self.grant(po.GRANT, who=OTHER)
        self.admin("update ops_settings set auto_render = true returning 1")
        oid = self.order(key)
        self.work_through_preview(oid)
        self.work(self.claim(), ["final_video", "thumbnail", "receipt"])
        did = self.admin("select id from render_deliveries where order_id = %s", oid)
        path = self.admin("select a.storage_path from render_deliveries r join artifacts a on a.id = r.artifact_id "
                          "where r.id = %s", did)
        self.assertTrue(self.stored(path), "the delivered film's file is in storage.objects")
        return oid, did, path

    def expire(self, did):
        self.admin("update render_deliveries set expires_at = now() - interval '1 minute' where id = %s returning 1", did)

    def marks(self, did):
        """(delivery marked REALLY GONE, artifact marked UNREADABLE)"""
        return self.admin("select r.deleted_at is not null, a.deleted_at is not null from render_deliveries r "
                          "join artifacts a on a.id = r.artifact_id where r.id = %s", did)

    def owner_can_read(self, path):
        """What the customer's own session can see of the film file in Storage (the owner's read policy)."""
        return self.db.as_(OTHER).one("select count(*) from storage.objects where bucket_id = 'ryagram-artifacts' and name = %s",
                                      path) == 1

    def stored(self, path):
        return self.admin("select count(*) from storage.objects where bucket_id = 'ryagram-artifacts' and name = %s", path) == 1

    def remove_file(self, path):
        """What ops-tick's Storage remove does when it succeeds."""
        self.admin("delete from storage.objects where bucket_id = 'ryagram-artifacts' and name = %s returning 1", path)

    def tick(self):
        return self.db.as_("service").one("select render_orders_tick()")

    def mark(self, *dids):
        return self.db.as_("service").one("select mark_deliveries_removed(%s::uuid[])", [str(d) for d in dids])

    # ---------------------------------------------------------------- scenarios
    def test_tick_lists_but_never_marks_while_the_file_is_there(self):
        """MUST-FAIL on the old code: it marked both rows deleted here, before any file was removed."""
        oid, did, path = self.delivered("gone-0001")
        self.expire(did)
        out = self.tick()
        self.assertIn(path, out["delete_objects"])
        self.assertEqual(self.marks(did), (False, True), "unreadable at once, but NOT marked really gone while its file is stored")
        self.assertIn(str(did), out.get("due_deliveries", []), "the tick names the delivery to mark once its file is gone")
        self.assertEqual(self.order_row(oid), ("expired", "delivery_expired"), "the order still ends as expired")
        self.denied("service", "select delivery_object_for(%s, %s)", OTHER, did)    # and the customer can no longer reach it

    def test_the_owner_cannot_read_the_file_after_expiry_even_while_its_remove_fails(self):
        """CC1 11-27 MEDIUM: the owner's Storage read policy checks artifacts.deleted_at, so it must be set AT expiry."""
        _, did, path = self.delivered("gone-0008")
        self.assertTrue(self.owner_can_read(path), "before expiry the owner can read their film")
        self.expire(did)
        self.tick()
        self.assertTrue(self.stored(path), "the remove has not happened (or failed): the file is still stored")
        self.assertFalse(self.owner_can_read(path), "but the owner can no longer read it")

    def test_a_failed_remove_is_retried_until_the_file_is_gone(self):
        oid, did, path = self.delivered("gone-0002")
        self.expire(did)
        self.tick()
        self.assertEqual(self.mark(did), 0, "the remove failed (the file is still stored): nothing is marked gone")
        self.assertEqual(self.marks(did), (False, True))
        again = self.tick()
        self.assertIn(path, again["delete_objects"], "the next tick lists the same film again (the retry)")
        self.remove_file(path)
        self.assertEqual(self.mark(did), 1, "the file is really gone now: the delivery is marked")
        self.assertEqual(self.marks(did), (True, True), "the delivery AND its artifact are marked deleted")
        self.assertNotIn(path, self.tick()["delete_objects"], "and it is never listed again")

    def test_only_the_films_really_gone_are_marked(self):
        _, gone, gone_path = self.delivered("gone-0003")
        _, kept, kept_path = self.delivered("gone-0004")
        for d in (gone, kept):
            self.expire(d)
        self.tick()
        self.remove_file(gone_path)                              # one remove succeeded, the other failed
        self.assertEqual(self.mark(gone, kept), 1)
        self.assertEqual((self.marks(gone), self.marks(kept)), ((True, True), (False, True)))
        self.assertTrue(self.stored(kept_path))

    def test_a_film_not_yet_expired_is_never_marked_even_with_its_file_missing(self):
        _, did, path = self.delivered("gone-0005")
        self.remove_file(path)                                   # a file lost by accident, inside its 30 days
        self.assertEqual(self.mark(did), 0)
        self.assertEqual(self.marks(did), (False, False))
        self.assertNotIn(str(did), self.tick().get("due_deliveries", []))

    def test_the_order_ends_expired_once(self):
        oid, did, _ = self.delivered("gone-0006")
        self.expire(did)
        self.tick()
        ended = self.admin("select ended_at from render_orders where id = %s", oid)
        self.tick()
        self.assertEqual(self.order_row(oid), ("expired", "delivery_expired"))
        self.assertEqual(self.admin("select ended_at from render_orders where id = %s", oid), ended)

    def test_mark_is_for_the_service_only(self):
        _, did, _ = self.delivered("gone-0007")
        self.denied(OTHER, "select mark_deliveries_removed(%s::uuid[])", [str(did)])

    # ---------------------------------------------------------------- the undo (CC1 11-21 G2) and the after-check (G4: live-steps 39)
    MIG = po.core.ROOT / "migrations" / "20261121000200_expired_films_really_gone.sql"
    RB = po.core.ROOT / "rollbacks" / "20261121000200_expired_films_really_gone_rollback.sql"
    CHECK = po.core.ROOT / "live-steps" / "39_expired_films_gone_after_check.sql"
    TICK_DEF = "select pg_get_functiondef(to_regprocedure('public.render_orders_tick()'))"

    def run_file(self, path):
        return self.db.as_(None).c.execute(path.read_text(encoding="utf-8"))

    def test_the_rollback_restores_the_original_tick_drops_the_mark_and_the_migration_puts_it_back(self):
        self.assertIn("due_deliveries", self.admin(self.TICK_DEF))
        self.run_file(self.RB)
        tick = self.admin(self.TICK_DEF)
        self.assertNotIn("due_deliveries", tick)
        self.assertIn("update public.render_deliveries set deleted_at = now() where id = d.id", tick, "the 20261017000600 body")
        self.assertIsNone(self.admin("select to_regprocedure('public.mark_deliveries_removed(uuid[])')"))
        _, did, _ = self.delivered("gone-rb01")
        self.expire(did)
        self.tick()
        self.assertEqual(self.marks(did), (True, True), "after the undo the tick marks at once again, as before M2")
        self.run_file(self.RB)                                   # a second undo: nothing to do, no error
        self.run_file(self.MIG)                                  # and the change goes back on
        self.assertIn("due_deliveries", self.admin(self.TICK_DEF))
        self.assertIsNotNone(self.admin("select to_regprocedure('public.mark_deliveries_removed(uuid[])')"))

    def test_the_rollback_stops_in_words_on_a_tick_changed_by_hand(self):
        drifted = self.admin(self.TICK_DEF).replace("'due_deliveries', ids", "'due', ids", 1)
        self.db.as_(None).c.execute(drifted)
        with self.assertRaises(Exception) as cm:
            self.run_file(self.RB)
        self.assertIn("neither the M2 one nor the original", str(cm.exception))
        self.db.c.execute("rollback")                            # the file's own transaction ended in the error: close it
        self.assertIsNotNone(self.admin("select to_regprocedure('public.mark_deliveries_removed(uuid[])')"), "nothing was changed")

    def test_the_after_check_is_all_true_after_the_migration_and_false_after_the_undo(self):
        rows = self.run_file(self.CHECK).fetchall()
        self.assertTrue(rows and all(ok for _, ok in rows), rows)
        self.run_file(self.RB)
        after = dict(self.run_file(self.CHECK).fetchall())
        self.assertEqual(sum(1 for v in after.values() if not v), 3, after)


if __name__ == "__main__":
    unittest.main()
