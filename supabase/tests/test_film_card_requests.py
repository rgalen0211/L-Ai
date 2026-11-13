"""FILM LOOK CARDS (migrations/20261109000100_film_cards.sql) on a local Postgres, with the waiting-accounts gate (20261104000100) in place.

Same setup as test_geo_requests.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_film_card_requests.py -v

What this proves: the panel asks for a card of the film's CURRENT SAVED story (the database finds the story; the caller cannot name one), asking twice is one request, a person only ever sees their own films' cards,
a card of an older save is returned and called stale, the table is closed to every API role, the house worker claims the story, answers with a card that must be drawn from THAT story, or fails with a known code, and
nobody else can; limits and keep times hold; a WAITING account is refused everywhere; the rollback removes exactly these objects.
"""
import base64
import hashlib
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
import test_waiting_accounts as tw  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, WAITER = (str(uuid.UUID(int=i)) for i in (401, 402, 403))
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
STORY = {"title": "invented story one", "look": {"network.color": "#112233"}}
STORY2 = {"title": "invented story two", "look": {"network.color": "#445566"}}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def card(sha, **over):
    c = {"schema": 1, "basis": {"story_sha256": sha, "view": "network", "theme": "dark3"},
         "look": {"network.color": "#6fd1bd", "network.base_color": "#c9a66b", "network.context_color": "#5a5a66", "state.fill": "#23232d", "page.background": "#0d0d11"},
         "frame": {"label": "2024", "width": 960, "height": 540, "svg": "<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540'><rect width='960' height='540' fill='#0d0d11'/></svg>"}}
    c.update(over)
    return c


class FilmCards(core.Base):
    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'waiter@x')", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s), (%s)", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    # -- helpers (the same OAuth dance as test_geo_requests.py)
    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role connect_runner")
        return self.db

    def app(self, who):
        self.db.as_(who)
        self.db.c.execute("select set_config('request.jwt.claims', '', false)")
        return self.db

    def connect(self, who):
        self.counter += 1
        client = self.runner().one("select connect_register_client('Claude', array[%s])", URI)
        req = self.runner().one("select connect_begin_authorization(%s,%s,'st',%s,'S256','read write',null)", client, URI, s256(VER))
        out = self.app(who).one("select connect_consent_decide(%s, true, %s)", req, ["read", "write"])
        code = out["redirect_to"].split("code=")[1].split("&")[0]
        access, refresh = f"acc{self.counter}-" + uuid.uuid4().hex, f"ref{self.counter}-" + uuid.uuid4().hex
        self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h(access), h(refresh))
        return h(access)

    def film(self, token, title="Invented film", story=STORY):
        """A project of the person's with one saved story; returns (project id, version id, the story's sha-256)."""
        p = self.runner().one("select connect_create_project(%s, %s)", token, title)["id"]
        v = str(self.runner().one("select connect_current_version(%s, %s)", token, p))
        sha = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", token, v, json.dumps(story))
        return p, v, sha

    def ask(self, token, project):
        return self.runner().one("select connect_film_card_ask(%s, %s)", token, project)

    def get(self, token, project):
        return self.runner().one("select connect_film_card_get(%s, %s)", token, project)

    def fails(self, who, sql, *args, code=None):
        with self.assertRaises(psycopg.Error) as cm:
            who().one(sql, *args)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def worker(self):
        return self.db.as_(core.WORKER)

    def claim(self):
        return self.worker().c.execute("select request_id, project_id, version_id, story_sha256, story, dataset_id from public.claim_next_film_card()").fetchall()

    def finish(self, rid, c):
        return self.worker().one("select public.finish_film_card(%s, %s::jsonb)", rid, json.dumps(c))

    # ------------------------------------------------------------------------------------------------ asking
    def test_an_ask_is_for_the_saved_story_and_asking_again_is_one_request(self):
        p, v, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.assertEqual((r["state"], r["repeat"]), ("asked", False))
        row = self.owner("select owner_id, project_id, version_id, story_sha256, state from public.film_card_requests where id = %s", r["id"]).fetchone()
        self.assertEqual((str(row[0]), str(row[1]), str(row[2]), row[3], row[4]), (ALICE, p, v, sha, "asked"))
        again = self.ask(self.a, p)
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True))
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 1)

    def test_saving_the_film_again_makes_a_new_request_for_the_new_story_and_leaves_the_old_one(self):
        p, v, sha = self.film(self.a)
        r1 = self.ask(self.a, p)
        sha2 = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        self.assertNotEqual(sha, sha2)
        r2 = self.ask(self.a, p)
        self.assertNotEqual(r1["id"], r2["id"])
        self.assertEqual(self.owner("select story_sha256 from public.film_card_requests where id = %s", r2["id"]).fetchone()[0], sha2)
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 2)

    def test_a_film_that_is_not_yours_or_does_not_exist_is_refused_in_one_sentence_that_names_nothing(self):
        p, _, _ = self.film(self.a)
        for token, proj in ((self.b, p), (self.a, str(uuid.uuid4()))):
            e = self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", token, proj, code="22023")
            self.assertEqual(e.diag.message_primary, "That film was not found among your projects.")
            self.assertNotIn(proj, e.diag.message_primary + (e.diag.message_detail or ""))
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 0)
        self.assertIsNone(self.get(self.b, p), "Bob cannot see that Alice's film exists")
        self.assertIsNone(self.get(self.a, str(uuid.uuid4())))
        self.fails(lambda: self.runner(), "select connect_film_card_get(%s, %s)", "0" * 64, p)           # a token that is not live

    def test_an_archived_film_cannot_be_asked_about(self):
        p, _, _ = self.film(self.a)
        self.owner("update public.projects set archived_at = now() where id = %s", p)
        self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", self.a, p, code="22023")
        self.assertIsNone(self.get(self.a, p))

    def test_five_open_at_once_and_one_hundred_a_day(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(6)]
        for p in films[:5]:
            self.ask(self.a, p)
        self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", self.a, films[5], code="PT429")
        self.owner("update public.film_card_requests set state = 'failed', fail_code = 'view_not_supported', finished_at = now()")
        self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, finished_at) "
                   "select %s, %s, v.id, lpad(to_hex(g), 64, '0'), 'failed', now() from generate_series(1, 95) g, public.versions v where v.project_id = %s limit 95", ALICE, films[0], films[0])
        self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", self.a, films[5], code="PT429")
        pb = self.film(self.b)[0]
        try:
            got = self.ask(self.b, pb)
        except psycopg.Error as e:
            self.fail(f"another person was held up by Alice's limits (sqlstate {e.sqlstate})")
        self.assertTrue(got["id"], "another person is not held up by Alice's limits")

    # ------------------------------------------------------------------------------------------------ two asks in flight at once (WORKER's finding for the county and place asks, CC1 20:50: the same gap, so the same lock)
    def other(self):
        c = psycopg.connect(self.db.c.info.dsn, autocommit=False)
        c.execute("set role connect_runner")
        return c

    def race(self, first_ask, second_ask):
        """Two asks at the same moment on two connections. The first is held open (uncommitted) until the second is waiting behind it on an advisory lock (or has finished: it did not wait).
        Returns (first, second, waited): each the answer or the database error, and whether the second had to wait."""
        # a token's last-used time is written by the first call of each minute, and that write would queue a second ask behind the first by itself; a warm token (the usual case) leaves the lock as the ONLY thing that can hold it
        self.owner("update public.connect_tokens set last_used_at = now()")
        sql = "select connect_film_card_ask(%s, %s)"
        c1, c2, c3 = self.other(), self.other(), psycopg.connect(self.db.c.info.dsn, autocommit=True)
        out = {}
        waited = False

        def second():
            try:
                out["b"] = c2.execute(sql, second_ask).fetchone()[0]
            except psycopg.Error as e:
                out["b"] = e
        try:
            try:
                first = c1.execute(sql, first_ask).fetchone()[0]
            except psycopg.Error as e:
                first = e
            t = threading.Thread(target=second)
            t.start()
            end = time.time() + 5
            while t.is_alive() and time.time() < end:
                if c3.execute("select count(*) from pg_locks where locktype = 'advisory' and not granted").fetchone()[0]:
                    waited = True
                    break
                time.sleep(0.05)
            if isinstance(first, psycopg.Error):
                c1.rollback()
            else:
                c1.commit()
            t.join(10)
            self.assertFalse(t.is_alive(), "the second ask never finished")
            if isinstance(out["b"], psycopg.Error):
                c2.rollback()
            else:
                c2.commit()
        finally:
            for c in (c1, c2, c3):
                c.close()
        return first, out["b"], waited

    def counts(self):
        return self.owner("select count(*) filter (where state in ('asked','claimed')), count(*) from public.film_card_requests where owner_id = %s", ALICE).fetchone()

    def test_two_asks_for_different_films_at_four_open_leave_at_most_five_and_the_second_is_told_in_words(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(6)]
        for p in films[:4]:
            self.ask(self.a, p)
        first, second, waited = self.race((self.a, films[4]), (self.a, films[5]))
        self.assertTrue(waited, "the second ask waits behind the first (a lock per person)")
        self.assertIsInstance(first, dict, "the first ask is accepted")
        self.assertIsInstance(second, psycopg.Error, "the second ask is refused (limit 5), not accepted")
        self.assertEqual(second.sqlstate, "PT429")
        self.assertIn("5 film pictures waiting", second.diag.message_primary)
        self.assertEqual(self.counts()[0], 5)

    def test_two_asks_at_ninety_nine_in_a_day_leave_at_most_one_hundred(self):
        films = [self.film(self.a, f"Invented film {i}", {"title": f"s{i}"})[0] for i in range(2)]
        self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, finished_at) "
                   "select %s, %s, v.id, lpad(to_hex(g), 64, '0'), 'failed', now() from generate_series(1, 99) g, public.versions v where v.project_id = %s limit 99", ALICE, films[0], films[0])
        first, second, waited = self.race((self.a, films[0]), (self.a, films[1]))
        self.assertTrue(waited, "the second ask waits behind the first (a lock per person)")
        self.assertIsInstance(first, dict, "the first ask is accepted")
        self.assertIsInstance(second, psycopg.Error, "the second ask is refused (limit 100 a day)")
        self.assertEqual(second.sqlstate, "PT429")
        self.assertEqual(self.counts()[1], 100)

    def test_the_same_film_asked_twice_at_once_is_one_request(self):
        p = self.film(self.a)[0]
        first, second, waited = self.race((self.a, p), (self.a, p))
        self.assertTrue(waited)
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "the repeat is answered, not refused or stored twice")
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second.get("repeat"))
        self.assertEqual(self.counts()[1], 1)

    def test_two_people_asking_at_once_do_not_wait_for_each_other(self):
        pa, pb = self.film(self.a)[0], self.film(self.b)[0]
        first, second, waited = self.race((self.a, pa), (self.b, pb))
        self.assertFalse(waited, "another person's ask does not wait for Alice's")
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "Bob's ask is not held up by Alice's lock")
        self.assertNotEqual(first["id"], second["id"])

    # ------------------------------------------------------------------------------------------------ privacy
    def test_the_table_is_closed_to_every_api_role(self):
        p, _, _ = self.film(self.a)
        self.ask(self.a, p)
        for who in ("anon", ALICE, "service"):
            for sql in ("select * from public.film_card_requests", "update public.film_card_requests set state = 'answered'", "delete from public.film_card_requests"):
                with self.assertRaises(psycopg.Error, msg=f"{who}: {sql}"):
                    self.db.as_(who).c.execute(sql)
        for sql in ("select * from public.film_card_requests", "delete from public.film_card_requests"):
            with self.assertRaises(psycopg.Error):
                self.runner().c.execute(sql)

    # ------------------------------------------------------------------------------------------------ the worker's side, and the answer coming back
    def test_the_worker_claims_the_story_answers_with_a_card_and_the_person_reads_it(self):
        p, v, sha = self.film(self.a)
        r = self.ask(self.a, p)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("select * from public.claim_next_film_card()")
        got = self.claim()
        self.assertEqual(len(got), 1)
        g = got[0]
        self.assertEqual((str(g[0]), str(g[1]), str(g[2]), g[3], g[4]), (r["id"], p, v, sha, STORY))
        self.assertEqual(self.owner("select state, claimed_at is not null from public.film_card_requests").fetchone(), ("claimed", True))
        self.assertEqual(self.claim(), [], "a claimed request is not handed out twice")
        self.assertEqual(self.get(self.a, p)["state"], "claimed")
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.finish_film_card(%s, %s::jsonb)", r["id"], json.dumps(card(sha)))
        self.finish(r["id"], card(sha))
        done = self.get(self.a, p)
        self.assertEqual((done["state"], done["stale"], done["card"]["frame"]["label"], done["built_sha256"], done["current_sha256"]), ("ready", False, "2024", sha, sha))
        self.assertIsNone(self.get(self.b, p))
        with self.assertRaises(psycopg.Error) as cm:
            self.finish(r["id"], card(sha))
        self.assertEqual(cm.exception.sqlstate, "PT404", "a request is answered once")

    def test_the_database_refuses_what_is_not_a_card_or_a_card_of_another_story(self):
        p, _, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        good = card(sha)
        bads = [
            ("not an object", None), ("an array", [1]), ("another schema number", card(sha, schema=2)), ("a string schema", card(sha, schema="1")),
            ("no look", {k: v for k, v in good.items() if k != "look"}), ("a look that is a list", card(sha, look=[1])),
            ("no frame", {k: v for k, v in good.items() if k != "frame"}), ("a frame with no svg", card(sha, frame={"label": "x", "width": 100, "height": 100})),
            ("an svg that is a number", card(sha, frame={"label": "x", "width": 100, "height": 100, "svg": 5})),
            ("another story's card", card("a" * 64)), ("no basis", {k: v for k, v in good.items() if k != "basis"}),
            ("over the cap", card(sha, notes=["x" * 100] * 3000)),
        ]
        for name, bad in bads:
            with self.assertRaises(psycopg.Error, msg=name) as cm:
                self.worker().one("select public.finish_film_card(%s, %s::jsonb)", r["id"], json.dumps(bad))
            self.assertEqual(cm.exception.sqlstate, "22023", name)
        self.assertEqual(self.owner("select state from public.film_card_requests").fetchone()[0], "claimed", "nothing refused changed the request")
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_film_card(%s, %s::jsonb)", str(uuid.uuid4()), json.dumps(good))
        self.assertEqual(cm.exception.sqlstate, "PT404")

    def test_a_card_for_an_older_save_is_returned_and_called_stale_until_the_new_one_arrives(self):
        p, v, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        self.finish(r["id"], card(sha))
        sha2 = self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        old = self.get(self.a, p)
        self.assertEqual((old["state"], old["stale"], old["built_sha256"], old["current_sha256"]), ("ready", True, sha, sha2))
        self.assertIsNone(old["refresh"], "nothing has been asked for the new save yet")
        r2 = self.ask(self.a, p)
        self.assertEqual(r2["state"], "asked")
        still = self.get(self.a, p)
        self.assertEqual((still["state"], still["stale"]), ("ready", True), "the old card is still shown while the new one is drawn")
        self.assertEqual(still["refresh"], {"state": "asked", "fail_code": None, "retry": False}, "and the answer says the new one is being asked for")
        got = self.claim()
        self.assertEqual(got[0][3], sha2)
        self.finish(r2["id"], card(sha2))
        fresh = self.get(self.a, p)
        self.assertEqual((fresh["state"], fresh["stale"], fresh["built_sha256"]), ("ready", False, sha2))
        self.assertIsNone(fresh["refresh"])

    def test_where_the_request_stands_before_any_card_exists(self):
        p, _, sha = self.film(self.a)
        self.assertEqual(self.get(self.a, p), {"state": "none", "current_sha256": sha})
        r = self.ask(self.a, p)
        g = self.get(self.a, p)
        self.assertEqual((g["state"], g["id"], g["current_sha256"]), ("asked", r["id"], sha))
        self.assertIsInstance(g["waited_s"], int)

    def test_fail_film_card_records_a_known_code_and_the_person_can_read_it(self):
        p, _, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        with self.assertRaisesRegex(psycopg.Error, "Unknown failure code"):
            self.worker().one("select public.fail_film_card(%s, 'because', 'x')", r["id"])
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.fail_film_card(%s, 'engine_error', 'x')", r["id"])
        self.worker().one("select public.fail_film_card(%s, 'view_not_supported', %s)", r["id"], "the hatch view has no card yet" + "x" * 400)
        g = self.get(self.a, p)
        self.assertEqual((g["state"], g["fail_code"]), ("failed", "view_not_supported"))
        self.assertEqual(len(g["fail_detail"]), 300)
        again = self.ask(self.a, p)
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True), "a film the engine cannot draw is not asked again for the same save")
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.fail_film_card(%s, 'engine_error', 'x')", r["id"])
        self.assertEqual(cm.exception.sqlstate, "PT404", "only a claimed request can be failed")

    def test_an_engine_error_may_be_tried_again_after_ten_minutes_and_not_before(self):
        p, _, _ = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'engine_error', 'it broke')", r["id"])
        self.assertTrue(self.ask(self.a, p)["repeat"], "not before ten minutes")
        self.owner("update public.film_card_requests set finished_at = now() - interval '11 minutes'")
        again = self.ask(self.a, p)
        self.assertEqual((again["state"], again["repeat"]), ("asked", False))
        self.assertNotEqual(again["id"], r["id"])
        self.assertEqual(self.owner("select count(*) from public.film_card_requests").fetchone()[0], 1)

    def test_the_read_says_when_a_failed_picture_may_be_asked_for_again_the_same_rule_as_the_ask(self):
        """The connector asks again for a failed picture ONLY when this says so (before this, a failed picture was never asked for again, whatever the words promised)."""
        p, _, _ = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'engine_error', 'it broke')", r["id"])
        g = self.get(self.a, p)
        self.assertEqual((g["state"], g["fail_code"], g.get("retry")), ("failed", "engine_error", False), "not before ten minutes")
        self.owner("update public.film_card_requests set finished_at = now() - interval '9 minutes'")
        self.assertFalse(self.get(self.a, p).get("retry"), "nine minutes is not ten")
        self.owner("update public.film_card_requests set finished_at = now() - interval '11 minutes'")
        self.assertTrue(self.get(self.a, p).get("retry"), "after ten minutes an engine error may be asked for again")
        again = self.ask(self.a, p)
        self.assertEqual((again["state"], again["repeat"]), ("asked", False), "and the ask the connector then makes is accepted")
        self.assertEqual(self.get(self.a, p)["state"], "asked")

    def test_a_failure_that_is_not_an_engine_error_is_never_offered_again(self):
        for code in ("view_not_supported", "card_rejected", "story_not_found"):
            p, _, _ = self.film(self.a, f"Invented film {code}", {"title": code})
            r = self.ask(self.a, p)
            self.claim()
            self.worker().one("select public.fail_film_card(%s, %s, 'x')", r["id"], code)
            self.owner("update public.film_card_requests set finished_at = now() - interval '2 hours' where id = %s", r["id"])
            g = self.get(self.a, p)
            self.assertEqual((g["state"], g["fail_code"], g.get("retry")), ("failed", code, False), code)

    def test_a_failed_refresh_says_when_it_may_be_asked_for_again_too(self):
        p, v, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        self.finish(r["id"], card(sha))
        self.runner().one("select connect_save_story(%s, %s, %s::jsonb)", self.a, v, json.dumps(STORY2))
        r2 = self.ask(self.a, p)
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'engine_error', 'it broke')", r2["id"])
        self.assertEqual(self.get(self.a, p)["refresh"], {"state": "failed", "fail_code": "engine_error", "retry": False})
        self.owner("update public.film_card_requests set finished_at = now() - interval '11 minutes' where id = %s", r2["id"])
        g = self.get(self.a, p)
        self.assertEqual((g["state"], g["stale"], g["refresh"].get("retry")), ("ready", True, True), "the old picture stays on show and a new ask is allowed")

    def test_two_finishes_for_one_claim_leave_the_first_card_and_the_second_is_told_the_claim_is_gone(self):
        """A claim that came back after ten minutes can be finished by two workers (or twice by one): the row is locked, so the second waits and then finds the request answered; the first card stands."""
        p, _, sha = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        dsn = self.db.c.info.dsn

        def as_worker():
            c = psycopg.connect(dsn, autocommit=False)
            c.execute("set role authenticated")
            c.execute("select set_config('request.jwt.claim.sub', %s, false)", (core.WORKER,))
            return c
        first_card, second_card = card(sha, frame={"label": "first", "width": 960, "height": 540, "svg": card(sha)["frame"]["svg"]}), card(sha, frame={"label": "second", "width": 960, "height": 540, "svg": card(sha)["frame"]["svg"]})
        c1, c2, c3 = as_worker(), as_worker(), psycopg.connect(dsn, autocommit=True)
        out = {}

        def second():
            try:
                out["b"] = c2.execute("select public.finish_film_card(%s, %s::jsonb)", (r["id"], json.dumps(second_card))).fetchone()
            except psycopg.Error as e:
                out["b"] = e
        waited = False
        try:
            c1.execute("select public.finish_film_card(%s, %s::jsonb)", (r["id"], json.dumps(first_card)))
            t = threading.Thread(target=second)
            t.start()
            end = time.time() + 5
            while t.is_alive() and time.time() < end:
                if c3.execute("select count(*) from pg_locks where not granted and locktype in ('transactionid', 'tuple')").fetchone()[0]:
                    waited = True
                    break
                time.sleep(0.05)
            c1.commit()
            t.join(10)
            self.assertFalse(t.is_alive(), "the second finish never ended")
            if isinstance(out["b"], psycopg.Error):
                c2.rollback()
            else:
                c2.commit()
        finally:
            for c in (c1, c2, c3):
                c.close()
        self.assertTrue(waited, "the second finish waits behind the first")
        self.assertIsInstance(out["b"], psycopg.Error, "the second finish is refused, not stored over the first")
        self.assertEqual(out["b"].sqlstate, "PT404")
        self.assertEqual(self.get(self.a, p)["card"]["frame"]["label"], "first")

    def test_only_an_engine_error_is_retried_a_film_the_engine_cannot_draw_stays_failed(self):
        p, _, _ = self.film(self.a)
        r = self.ask(self.a, p)
        self.claim()
        self.worker().one("select public.fail_film_card(%s, 'view_not_supported', 'no card for this view')", r["id"])
        self.owner("update public.film_card_requests set finished_at = now() - interval '2 hours'")
        again = self.ask(self.a, p)
        self.assertEqual((again["id"], again["repeat"], again["state"]), (r["id"], True, "failed"), "not retried, however long ago")

    def test_a_claim_nobody_finished_comes_back_after_ten_minutes_and_claims_off_means_none(self):
        p, _, _ = self.film(self.a)
        self.ask(self.a, p)
        self.claim()
        self.assertEqual(self.claim(), [])
        self.owner("update public.film_card_requests set claimed_at = now() - interval '11 minutes'")
        self.assertEqual(len(self.claim()), 1)
        self.owner("update public.film_card_requests set state = 'asked'")
        self.owner("update public.control set claims_enabled = false")
        self.assertEqual(self.claim(), [])

    def test_nothing_survives_its_keep_time_through_an_ask_a_read_or_the_purge(self):
        pa, _, sha = self.film(self.a)
        pb, _, shb = self.film(self.b)
        for how in range(3):
            self.owner("delete from public.film_card_requests")
            self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, finished_at, asked_at) "
                       "select %s, p.id, v.id, lpad('1', 64, '0'), 'answered', now() - interval '31 days', now() - interval '32 days' from public.projects p join public.versions v on v.project_id = p.id where p.id = %s", ALICE, pa)
            self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, asked_at) "
                       "select %s, p.id, v.id, lpad('2', 64, '0'), 'asked', now() - interval '8 days' from public.projects p join public.versions v on v.project_id = p.id where p.id = %s", BOB, pb)
            self.owner("insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256, state, finished_at, asked_at) "
                       "select %s, p.id, v.id, lpad('3', 64, '0'), 'failed', now() - interval '29 days', now() - interval '29 days' from public.projects p join public.versions v on v.project_id = p.id where p.id = %s", ALICE, pa)
            if how == 0:
                self.ask(self.a, pa)
            elif how == 1:
                self.get(self.a, pa)
            else:
                self.assertEqual(self.db.as_("service").one("select public.film_card_purge()"), 2)
            left = self.owner("select lpad(ltrim(story_sha256, '0'), 1) from public.film_card_requests where story_sha256 like '000%' order by 1").fetchall()
            self.assertEqual([x[0] for x in left], ["3"], f"{how}: the 31-day-old finished one and the 8-day-old unanswered one are gone, the 29-day-old one stays")
        for who in ("anon", ALICE):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.film_card_purge()")

    # ------------------------------------------------------------------------------------------------ the waiting-list gate and the undo
    def test_a_waiting_account_cannot_ask_and_the_gate_covers_every_new_function(self):
        p, _, _ = self.film(self.a)
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        self.fails(lambda: self.runner(), "select connect_film_card_ask(%s, %s)", self.a, p)
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.ask(self.a, p)["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "claim_next_film_card, finish_film_card and fail_film_card carry the waiting-list check")

    def test_the_rollback_removes_every_film_card_object_and_nothing_else(self):
        p, _, _ = self.film(self.a)
        self.ask(self.a, p)
        # the site's own twins (20261113000500) are undone first: the order of undo is the reverse of the order of the migrations
        self.owner((core.ROOT / "rollbacks" / "20261113000500_my_film_cards_rollback.sql").read_text(encoding="utf-8"))
        self.owner((core.ROOT / "rollbacks" / "20261109000100_film_cards_rollback.sql").read_text(encoding="utf-8"))
        left = self.owner("""select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ryagram_private') and p.proname like '%film_card%'),
                                  (select count(*) from pg_class where relname = 'film_card_requests')""").fetchone()
        self.assertEqual(left, (0, 0))
        self.assertIsNotNone(self.owner("select to_regprocedure('public.connect_create_project(text,text)')").fetchone()[0])

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        """A later migration that ends with gate_apply() re-applies the check to every signed-in function, so a mutant that takes the line out of THIS migration would be healed by the next one and never fail:
        this test reads the file itself: its last statement before commit must be the gate."""
        sql = (core.ROOT / "migrations" / "20261109000100_film_cards.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])


if __name__ == "__main__":
    unittest.main()
