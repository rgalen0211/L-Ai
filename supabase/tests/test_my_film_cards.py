"""THE SITE'S OWN FILM LOOK CARD (migrations/20261113000500_my_film_cards.sql) on a local Postgres, with the film cards (20261109000100) and the waiting-accounts gate (20261104000100) in place.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_my_film_cards.py -v

What this proves: my_film_card_ask / my_film_card_get are the SAME two operations as the connector's twins, for the signed-in session instead of a token. The same request row serves the chat and the site (a card asked
for in one place is the card the other shows, asking twice is one request), the answers are identical to the twins', the story is never typed by the caller, another person's film looks absent, the limits (5 open,
100 a day, a failed engine card retried after 10 minutes) hold, a chat ask and a site ask at the same instant are counted one after the other (the same lock key), nobody who is not signed in can run them, a WAITING
account is refused, the table stays closed to every API role, and the rollback removes exactly the two functions.
"""
import json
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_film_card_requests as tf  # noqa: E402
import test_waiting_accounts as tw  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, WAITER = tf.ALICE, tf.BOB, tf.WAITER
STORY, STORY2, card = tf.STORY, tf.STORY2, tf.card


class MyFilmCards(core.Base):
    # the connector-side helpers are the film card suite's own (the same OAuth dance, the same worker calls): borrowed, not copied
    def setUp(self):
        core.Base.setUp(self)
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'waiter@x')", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s), (%s)", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (tf.URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    runner, app, connect, film, owner, worker, claim, finish, fails = (tf.FilmCards.__dict__[n] for n in ("runner", "app", "connect", "film", "owner", "worker", "claim", "finish", "fails"))
    ask, get = tf.FilmCards.ask, tf.FilmCards.get

    def site(self, who=ALICE):
        self.db.as_(who)
        self.db.c.execute("select set_config('request.jwt.claims', '', false)")
        return self.db

    def my_ask(self, project, who=ALICE):
        return self.site(who).one("select my_film_card_ask(%s)", project)

    def my_get(self, project, who=ALICE):
        return self.site(who).one("select my_film_card_get(%s)", project)

    def site_fails(self, who, sql, *args, code=None):
        with self.assertRaises(psycopg.Error) as cm:
            self.site(who).one(sql, *args)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def answered(self, token, project, story=STORY):
        """A card drawn for the saved story and stored by the worker; returns the request id."""
        r = self.ask(token, project)
        got = self.claim()
        self.assertEqual(len(got), 1)
        sha = got[0][3]
        self.finish(got[0][0], card(sha))
        return r["id"], sha

    # ------------------------------------------------------------------------------------------------ asking
    def test_the_site_asks_for_the_saved_story_and_asking_again_is_one_request(self):
        p, v, sha = self.film(self.a)
        r = self.my_ask(p)
        self.assertEqual((r["state"], r["repeat"]), ("asked", False))
        row = self.owner("select owner_id, project_id, version_id, story_sha256, state from public.film_card_requests where id = %s", r["id"]).fetchone()
        self.assertEqual((str(row[0]), str(row[1]), str(row[2]), row[3], row[4]), (ALICE, p, v, sha, "asked"))
        again = self.my_ask(p)
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True))
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 1)

    def test_a_chat_ask_and_a_site_ask_are_one_request_in_either_order(self):
        p, _, _ = self.film(self.a)
        chat = self.ask(self.a, p)
        site = self.my_ask(p)
        self.assertEqual((site["id"], site["repeat"]), (chat["id"], True), "the site finds the request the chat made")
        p2 = self.film(self.a, "Invented film two", {"title": "second"})[0]
        site2 = self.my_ask(p2)
        chat2 = self.ask(self.a, p2)
        self.assertEqual((chat2["id"], chat2["repeat"]), (site2["id"], True), "the chat finds the request the site made")
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 2)

    def test_saving_the_film_again_makes_a_new_request_for_the_new_story(self):
        p, v, sha = self.film(self.a)
        r1 = self.my_ask(p)
        sha2 = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        r2 = self.my_ask(p)
        self.assertNotEqual(r1["id"], r2["id"])
        self.assertEqual(self.owner("select story_sha256 from public.film_card_requests where id = %s", r2["id"]).fetchone()[0], sha2)

    def test_a_film_that_is_not_yours_or_does_not_exist_is_refused_in_one_sentence_that_names_nothing(self):
        p, _, _ = self.film(self.a)
        for who, proj in ((BOB, p), (ALICE, str(uuid.uuid4()))):
            e = self.site_fails(who, "select my_film_card_ask(%s)", proj, code="22023")
            self.assertEqual(e.diag.message_primary, "That film was not found among your projects.")
            self.assertNotIn(proj, e.diag.message_primary + (e.diag.message_detail or ""))
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 0)
        self.assertIsNone(self.my_get(p, BOB), "Bob cannot see that Alice's film exists")
        self.assertIsNone(self.my_get(str(uuid.uuid4())))

    def test_an_archived_film_cannot_be_asked_about(self):
        p, _, _ = self.film(self.a)
        self.owner("update public.projects set archived_at = now() where id = %s", p)
        self.site_fails(ALICE, "select my_film_card_ask(%s)", p, code="22023")
        self.assertIsNone(self.my_get(p))

    def test_the_caller_cannot_name_an_owner_or_a_story(self):
        sigs = self.owner("select oid::regprocedure::text from pg_proc where proname in ('my_film_card_ask', 'my_film_card_get') order by 1").fetchall()
        self.assertEqual([s[0] for s in sigs], ["my_film_card_ask(uuid)", "my_film_card_get(uuid)"])

    # ------------------------------------------------------------------------------------------------ reading: the same answers as the connector's twin
    def test_every_state_reads_the_same_as_the_connector_twin(self):
        p, v, sha = self.film(self.a)
        self.assertEqual(self.my_get(p), self.get(self.a, p))
        self.assertEqual(self.my_get(p)["state"], "none")
        self.my_ask(p)
        self.assertEqual(self.my_get(p)["state"], "asked")
        self.assertEqual(self.my_get(p), self.get(self.a, p))
        got = self.claim()
        self.assertEqual(self.my_get(p)["state"], "claimed")
        self.finish(got[0][0], card(sha))
        ready = self.my_get(p)
        self.assertEqual((ready["state"], ready["stale"], ready["built_sha256"], ready["current_sha256"], ready["refresh"]), ("ready", False, sha, sha, None))
        self.assertEqual(ready["card"]["basis"]["story_sha256"], sha)
        self.assertEqual(ready, self.get(self.a, p), "the site and the chat show the same card, byte for byte")
        # saved again: the old card is shown, called stale, with where the new request stands
        sha2 = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        stale = self.my_get(p)
        self.assertEqual((stale["state"], stale["stale"], stale["built_sha256"], stale["current_sha256"], stale["refresh"]), ("ready", True, sha, sha2, None))
        self.my_ask(p)
        refresh = self.my_get(p)["refresh"]
        self.assertEqual((refresh["state"], refresh["fail_code"], refresh["retry"]), ("asked", None, False))
        self.assertEqual(self.my_get(p), self.get(self.a, p))

    def test_a_failed_card_reads_with_its_reason_and_an_engine_failure_may_be_asked_again_only_after_ten_minutes(self):
        p, _, _ = self.film(self.a)
        r = self.my_ask(p)
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'engine_error', 'it broke')", r["id"])
        got = self.my_get(p)
        self.assertEqual((got["state"], got["fail_code"], got["retry"]), ("failed", "engine_error", False))
        self.assertTrue(self.my_ask(p)["repeat"], "within ten minutes the failure stands")
        self.owner("update public.film_card_requests set finished_at = now() - interval '11 minutes'")
        self.assertTrue(self.my_get(p)["retry"])
        fresh = self.my_ask(p)
        self.assertFalse(fresh["repeat"])
        self.assertNotEqual(fresh["id"], r["id"])
        # a card the engine could not draw for a reason a retry will not fix stands for ever
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'view_not_supported', 'no')", fresh["id"])
        self.owner("update public.film_card_requests set finished_at = now() - interval '11 minutes'")
        self.assertTrue(self.my_ask(p)["repeat"])
        self.assertFalse(self.my_get(p)["retry"])

    def test_the_card_of_the_current_story_is_preferred_to_a_newer_card_of_an_older_story(self):
        p, v, sha1 = self.film(self.a)
        self.my_ask(p)
        self.finish(self.claim()[0][0], card(sha1))
        sha2 = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        self.my_ask(p)
        self.finish(self.claim()[0][0], card(sha2))
        self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY))          # back to the first story
        got = self.my_get(p)
        self.assertEqual((got["state"], got["stale"], got["built_sha256"], got["current_sha256"], got["refresh"]), ("ready", False, sha1, sha1, None))
        self.assertEqual(got, self.get(self.a, p))

    def test_another_persons_card_is_never_returned(self):
        p, _, _ = self.film(self.a)
        self.answered(self.a, p)
        self.assertEqual(self.my_get(p)["state"], "ready")
        self.assertIsNone(self.my_get(p, BOB))

    # ------------------------------------------------------------------------------------------------ limits
    def test_five_open_at_once_and_one_hundred_a_day_and_nobody_else_is_held_up(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(6)]
        for p in films[:5]:
            self.my_ask(p)
        e = self.site_fails(ALICE, "select my_film_card_ask(%s)", films[5], code="PT429")
        self.assertIn("5 film pictures waiting", e.diag.message_primary)
        self.owner("update public.film_card_requests set state = 'failed', fail_code = 'view_not_supported', finished_at = now()")
        self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, finished_at) "
                   "select %s, %s, v.id, lpad(to_hex(g), 64, '0'), 'failed', now() from generate_series(1, 95) g, public.versions v where v.project_id = %s limit 95", ALICE, films[0], films[0])
        e = self.site_fails(ALICE, "select my_film_card_ask(%s)", films[5], code="PT429")
        self.assertIn("100 film pictures in a day", e.diag.message_primary)
        pb = self.film(self.b)[0]
        self.assertTrue(self.my_ask(pb, BOB)["id"], "another person is not held up by Alice's limits")

    def test_the_limits_count_the_chat_and_the_site_together(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(6)]
        for p in films[:3]:
            self.ask(self.a, p)
        for p in films[3:5]:
            self.my_ask(p)
        self.site_fails(ALICE, "select my_film_card_ask(%s)", films[5], code="PT429")
        self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", self.a, films[5], code="PT429")

    # ------------------------------------------------------------------------------------------------ a chat ask and a site ask at the same instant
    def test_a_chat_ask_and_a_site_ask_at_four_open_leave_at_most_five(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(6)]
        for p in films[:4]:
            self.my_ask(p)
        self.owner("update public.connect_tokens set last_used_at = now()")
        c1 = psycopg.connect(self.db.c.info.dsn, autocommit=False)
        c1.execute("set role connect_runner")
        c2 = psycopg.connect(self.db.c.info.dsn, autocommit=False)
        c2.execute("set role authenticated")
        c2.execute("select set_config('request.jwt.claim.sub', %s, false)", (ALICE,))
        c3 = psycopg.connect(self.db.c.info.dsn, autocommit=True)
        out, waited = {}, False

        def second():
            try:
                out["b"] = c2.execute("select my_film_card_ask(%s)", (films[5],)).fetchone()[0]
            except psycopg.Error as e:
                out["b"] = e
        try:
            first = c1.execute("select connect_film_card_ask(%s, %s)", (self.a, films[4])).fetchone()[0]
            t = threading.Thread(target=second)
            t.start()
            end = time.time() + 5
            while t.is_alive() and time.time() < end:
                if c3.execute("select count(*) from pg_locks where locktype = 'advisory' and not granted").fetchone()[0]:
                    waited = True
                    break
                time.sleep(0.05)
            c1.commit()
            t.join(10)
            self.assertFalse(t.is_alive())
            c2.rollback() if isinstance(out["b"], psycopg.Error) else c2.commit()
        finally:
            for c in (c1, c2, c3):
                c.close()
        self.assertTrue(waited, "the site ask waits behind the chat ask (the same lock key)")
        self.assertIsInstance(first, dict)
        self.assertIsInstance(out["b"], psycopg.Error)
        self.assertEqual(out["b"].sqlstate, "PT429")
        self.assertEqual(self.owner("select count(*) from public.film_card_requests where state in ('asked','claimed')").fetchone()[0], 5)

    # ------------------------------------------------------------------------------------------------ who may run them
    def test_only_a_signed_in_session_can_run_them_and_the_table_stays_closed(self):
        p, _, _ = self.film(self.a)
        for fn in ("my_film_card_ask", "my_film_card_get"):
            for who in ("anon", "service"):
                with self.subTest(fn=fn, who=who):
                    with self.assertRaises(psycopg.Error):
                        self.site(who).one(f"select {fn}(%s)", p)
        # authenticated with no person behind it (no sub) is refused by require_signed_in
        self.db.as_(None)
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role authenticated")
        for fn in ("my_film_card_ask", "my_film_card_get"):
            with self.assertRaises(psycopg.Error):
                self.db.one(f"select {fn}(%s)", p)
        grants = self.owner("""select has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('anon', p.oid, 'execute'),
                                      exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                               from pg_proc p where p.proname in ('my_film_card_ask', 'my_film_card_get')""").fetchall()
        self.assertEqual(grants, [(True, False, False), (True, False, False)])
        for who in ("anon", ALICE):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select count(*) from public.film_card_requests")

    def test_a_waiting_account_cannot_ask_or_read_and_the_gate_covers_the_new_functions(self):
        p, _, _ = self.film(self.a)
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        self.site_fails(ALICE, "select my_film_card_ask(%s)", p)
        self.site_fails(ALICE, "select my_film_card_get(%s)", p)
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.my_ask(p)["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "my_film_card_ask and my_film_card_get carry the waiting-list check")

    # ------------------------------------------------------------------------------------------------ the migration and the undo
    def test_the_rollback_removes_exactly_the_two_functions_and_nothing_else(self):
        p, _, _ = self.film(self.a)
        self.my_ask(p)
        self.owner((core.ROOT / "rollbacks" / "20261113000500_my_film_cards_rollback.sql").read_text(encoding="utf-8"))
        names = [r[0] for r in self.owner("select proname from pg_proc where proname like '%film_card%' and pronamespace = 'public'::regnamespace order by 1").fetchall()]
        self.assertEqual(names, ["claim_next_film_card", "connect_film_card_ask", "connect_film_card_get", "fail_film_card", "film_card_purge", "finish_film_card"])
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 1, "the request stays: no data is touched")
        self.assertEqual(self.ask(self.a, p)["repeat"], True, "the connector still works")

    def test_the_migration_ends_with_the_waiting_list_gate(self):
        sql = (core.ROOT / "migrations" / "20261113000500_my_film_cards.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])

    def test_the_after_check_is_all_true(self):
        rows = self.owner((core.ROOT / "live-steps" / "28_my_film_cards_after_check.sql").read_text(encoding="utf-8")).fetchall()
        self.assertGreaterEqual(len(rows), 8)
        self.assertEqual([r[0] for r in rows if r[1] is not True], [], "every check is true")


if __name__ == "__main__":
    unittest.main()
