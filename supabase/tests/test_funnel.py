"""First-party funnel tracking (migrations/20261017000900_funnel_events.sql) on a local Postgres with the 2B credits ledger:
anonymous steps, steps written by triggers on the real tables, the account's source (first answer wins), return visits, Ryan's view, who can read what, retention.

Same setup as test_creator_flow.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_funnel.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402
import test_creator_flow as flow  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = flow.setUpModule


class Funnel(unittest.TestCase):
    admin, denied, grant = credits.Ledger.admin, credits.Ledger.denied, credits.Ledger.grant
    make_ryan_admin, ryan, svc = flow.CreatorFlow.make_ryan_admin, flow.CreatorFlow.ryan, flow.CreatorFlow.svc

    def setUp(self):
        credits.Ledger.setUp(self)
        self.admin("select ryagram_private.funnel_install_triggers()")          # the credits ledger was applied after the migration

    tearDown = credits.Ledger.tearDown

    def events(self, where="true"):
        return [tuple(r) for r in self.db.as_(None).all(f"select event, user_id::text, utm_source, utm_medium, utm_campaign, referrer_domain from public.funnel_events where {where} order by id")]

    def names(self, user=None):
        return [r[0] for r in self.events(f"user_id = '{user}'" if user else "true")]

    def project(self, owner=RYAN):
        return self.admin("insert into public.projects (owner_id, title) values (%s, 'A film') returning id", owner)

    # ---- anonymous steps
    def test_anonymous_steps_are_recorded_cleaned_and_only_the_two_allowed_ones(self):
        anon = self.db.as_("anon")
        anon.one("select funnel_anon('landing_view', 'YouTube!!', 'Social Media', 'Oct-Launch', 'WWW.Youtube.com')")
        anon.one("select funnel_anon('signup_started')")
        anon.one("select funnel_anon('purchase', 'x')")                          # not an anonymous step: ignored
        anon.one("select funnel_anon('first_project')")
        self.assertEqual(self.events(), [("landing_view", None, "youtube", "socialmedia", "oct-launch", "www.youtube.com"), ("signup_started", None, "", "", "", "")])
        anon.one("select funnel_anon('landing_view', %s)", "x" * 200)
        self.assertEqual(self.admin("select max(char_length(utm_source)) from public.funnel_events"), 60)       # a long source is cut, not refused

    def test_a_flood_of_anonymous_steps_stops_at_5000_an_hour(self):
        self.admin("insert into public.funnel_events (event) select 'landing_view' from generate_series(1, 5000) returning 1")
        self.db.as_("anon").one("select funnel_anon('landing_view')")
        self.assertEqual(self.admin("select count(*) from public.funnel_events where event = 'landing_view'"), 5000)
        self.db.as_("anon").one("select funnel_anon('signup_started')")          # another step has its own allowance
        self.assertEqual(self.admin("select count(*) from public.funnel_events where event = 'signup_started'"), 1)

    # ---- triggers on the real tables
    def test_account_steps_come_from_triggers_once_per_account_and_the_page_cannot_invent_them(self):
        self.project(); self.project()
        self.assertEqual(self.names(RYAN), ["first_project"])                    # the second project is not a new step
        self.assertEqual(self.admin("select count(*) from public.funnel_events"), 1)
        for who in ("anon", OTHER, "service"):                                   # nobody can write the table (not even the service role)
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("insert into public.funnel_events (event, user_id) values ('purchase', %s)", RYAN)

    def test_jobs_requests_purchases_and_subscriptions_are_counted_where_they_happen(self):
        self.make_ryan_admin()
        project = self.project()
        version = self.admin("insert into public.versions (project_id, owner_id, number) values (%s, %s, 1) returning id", project, RYAN)
        story = '{"sequence":{"clips":[]}}'
        for kind, params in (("contact_sheet", "{}"), ("preview", '{"window_s": [0, 5]}')):
            self.admin("insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, params) values (%s, %s, %s, %s, %s::jsonb, repeat('a', 64), %s::jsonb) returning 1",
                       RYAN, project, version, kind, story, params)
        self.assertEqual(self.names(RYAN), ["first_project", "contact_sheet", "preview"])
        self.grant(10, entry="purchase", event="evt_abc1")
        self.grant(10, entry="purchase", event="evt_abc2")                       # a second purchase is another row (purchases repeat)
        self.assertEqual(self.names(RYAN).count("purchase"), 2)
        self.admin("insert into public.film_requests (owner_id, question, credits) values (%s, 'Which states built the most apartments?', 10) returning 1", RYAN)
        rid = self.admin("select id from public.film_requests")
        self.admin("update public.film_requests set status = 'delivered', delivered_url = 'https://example.com/f' where id = %s returning 1", rid)
        self.admin("update public.film_requests set admin_note = 'again' where id = %s returning 1", rid)
        self.assertEqual(self.names(RYAN).count("film_requested"), 1)
        self.assertEqual(self.names(RYAN).count("film_delivered"), 1)
        self.db.as_(None).c.execute("create table if not exists public.stripe_subscriptions (subscription_id text primary key, owner_id uuid not null references auth.users (id), price_code text, "
                   "status text not null, current_period_end timestamptz, cancel_at_period_end boolean not null default false, event_created timestamptz not null default now(), updated_at timestamptz not null default now())")
        self.admin("select ryagram_private.funnel_install_triggers()")
        self.admin("insert into public.stripe_subscriptions (subscription_id, owner_id, price_code, status) values ('sub_1', %s, 'sub_creator', 'active') returning 1", RYAN)
        self.admin("update public.stripe_subscriptions set cancel_at_period_end = true where subscription_id = 'sub_1' returning 1")
        self.admin("update public.stripe_subscriptions set status = 'canceled' where subscription_id = 'sub_1' returning 1")
        self.assertEqual(self.names(RYAN).count("subscription_start"), 1)
        self.assertEqual(self.names(RYAN).count("subscription_cancel"), 1)       # cancel at period end, then it really ends: ONE cancel, not two

    def test_render_ordered_and_render_approved_come_from_the_order_tables(self):
        """Ryan 2026-10-18: the first order is render_ordered (a full render requested and accepted); render_approved is Ryan's approval, never a decline."""
        def order(owner, want, key):
            project = self.project(owner)
            version = self.admin("insert into public.versions (project_id, owner_id, number) values (%s, %s, 1) returning id", project, owner)
            oid = self.admin("insert into public.render_orders (owner_id, idempotency_key, source, want, project_id, version_id, story_sha256) values (%s, %s, 'app', %s, %s, %s, repeat('a', 64)) returning id",
                             owner, key, want, project, version)
            return oid, self.admin("insert into public.render_stages (order_id, owner_id, stage, idempotency_key, state, credits_quoted, awaiting_since) "
                                   "values (%s, %s, 'final_render', %s, 'awaiting_approval', 10, now()) returning id", oid, owner, key + ":final_render")
        order(RYAN, "preview", "key-preview-0001")                               # a preview-only order is not an order for a film
        self.assertNotIn("render_ordered", self.names(RYAN))
        oid, stage = order(RYAN, "final", "key-final-00001")
        self.assertEqual(self.names(RYAN).count("render_ordered"), 1)
        order(RYAN, "final", "key-final-00002")                                  # a second order: the first order is already counted
        self.assertEqual(self.names(RYAN).count("render_ordered"), 1)
        self.admin("update public.render_stages set admin_note = 'looking' where id = %s returning 1", stage)
        self.assertNotIn("render_approved", self.names(RYAN))                    # a note is not a decision
        self.admin("update public.render_stages set admin_decided_by = %s, admin_decided_at = now() where id = %s returning 1", RYAN, stage)     # what admin_render_decide(approve) does first
        self.assertEqual(self.names(RYAN).count("render_approved"), 1)
        self.admin("update public.render_stages set state = 'running' where id = %s returning 1", stage)
        self.assertEqual(self.names(RYAN).count("render_approved"), 1)
        # a decline stamps the decision AND closes the stage in the same update: not an approval
        _, declined = order(OTHER, "final", "key-final-00003")
        self.assertEqual(self.names(OTHER), ["first_project", "render_ordered"])
        self.admin("update public.render_stages set state = 'declined', admin_decided_by = %s, admin_decided_at = now() where id = %s returning 1", RYAN, declined)
        self.assertNotIn("render_approved", self.names(OTHER))
        # Ryan's view lists both steps
        self.make_ryan_admin()
        steps = [x["event"] for x in self.db.as_(RYAN).one("select admin_funnel(4)")["steps"]]
        self.assertEqual(steps[5:8], ["preview", "render_ordered", "render_approved"])

    def test_signup_done_is_the_first_confirmed_email_once(self):
        a, b, c = (str(uuid.uuid4()) for _ in range(3))
        self.admin("insert into auth.users (id, email) values (%s, 'a@example.com') returning 1", a)
        self.assertEqual(self.names(a), [])                                      # an unconfirmed invite is not a signup yet
        self.admin("update auth.users set email_confirmed_at = now() where id = %s returning 1", a)
        self.admin("update auth.users set email_confirmed_at = now() where id = %s returning 1", a)
        self.assertEqual(self.names(a), ["signup_done"])
        self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, 'b@example.com', now()) returning 1", b)
        self.assertEqual(self.names(b), ["signup_done"])                         # created already confirmed (made in the dashboard)

    def test_counting_never_breaks_the_thing_counted(self):
        self.db.as_(None).c.execute("alter table public.funnel_events rename to funnel_events_gone")      # the table is missing: the trigger swallows it
        pid = self.project()
        self.assertTrue(pid)
        self.assertEqual(self.admin("select count(*) from public.projects"), 1)

    # ---- the account's source
    def test_the_source_is_attached_once_the_first_answer_wins_and_earlier_steps_take_it(self):
        u = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, 'u@example.com', now()) returning 1", u)
        self.assertEqual(self.events(f"user_id = '{u}'"), [("signup_done", u, "", "", "", "")])
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select funnel_attach_source('youtube')")      # needs a signed-in person
        self.assertTrue(self.db.as_(u).one("select funnel_attach_source('YouTube', 'video', 'launch', 'youtube.com')"))
        self.assertFalse(self.db.as_(u).one("select funnel_attach_source('google', 'cpc', '', 'google.com')"))     # a later call changes nothing
        self.assertEqual(self.events(f"user_id = '{u}'"), [("signup_done", u, "youtube", "video", "launch", "youtube.com")])
        self.assertEqual(tuple(self.admin("select utm_source, referrer_domain from public.funnel_accounts where user_id = %s", u)), ("youtube", "youtube.com"))
        self.admin("insert into public.projects (owner_id, title) values (%s, 'x') returning 1", u)
        self.assertEqual(self.events(f"user_id = '{u}' and event = 'first_project'"), [("first_project", u, "youtube", "video", "launch", "youtube.com")])   # later steps carry it

    def test_a_person_with_no_source_counts_as_direct_and_nothing_else_personal_is_stored(self):
        cols = [r[0] for r in self.db.as_(None).all("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('funnel_events', 'funnel_accounts')")]
        self.assertFalse([c for c in cols if any(w in c for w in ("email", "ip", "agent", "name", "address", "cookie", "path", "url", "device"))], cols)
        self.assertEqual(sorted(set(cols)), sorted({"id", "at", "event", "user_id", "utm_source", "utm_medium", "utm_campaign", "referrer_domain", "attached_at"}))

    # ---- return visits
    def test_a_return_visit_counts_at_7_and_30_days_after_signup_once(self):
        users = {d: str(uuid.uuid4()) for d in (2, 8, 31)}
        for d, u in users.items():
            self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now() - make_interval(days => %s)) returning 1", u, f"d{d}@example.com", d)
            self.db.as_(u).one("select funnel_return_visit()")
            self.db.as_(u).one("select funnel_return_visit()")
        self.assertEqual(self.names(users[2]), ["signup_done"])
        self.assertEqual(self.names(users[8]), ["signup_done", "return_7d"])
        self.assertEqual(self.names(users[31]), ["signup_done", "return_7d", "return_30d"])
        self.denied("anon", "select funnel_return_visit()")                      # only a signed-in person can call it

    # ---- who reads what, and Ryan's view
    def test_only_ryan_reads_the_tables_and_the_view(self):
        self.make_ryan_admin()
        self.db.as_("anon").one("select funnel_anon('landing_view', 'x')")
        self.project()
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from public.funnel_events"), 2)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from public.funnel_events"), 0)       # RLS: another signed-in person sees nothing
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from public.funnel_accounts"), 0)
        for who in ("anon", "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select count(*) from public.funnel_events")
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_funnel(8)")
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("delete from public.funnel_events")
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("delete from public.funnel_events")            # even Ryan cannot edit by hand through the API (the purge job is the only deleter)

    def test_the_funnel_counts_distinct_accounts_per_step_by_week_and_source_with_direct_as_the_default(self):
        self.make_ryan_admin()
        anon = self.db.as_("anon")
        for src in ("youtube", "youtube", "", "reddit"):
            anon.one("select funnel_anon('landing_view', %s)", src)
        anon.one("select funnel_anon('signup_started', 'youtube')")
        a, b = str(uuid.uuid4()), str(uuid.uuid4())
        for u, e in ((a, "a@example.com"), (b, "b@example.com")):
            self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now()) returning 1", u, e)
        self.db.as_(a).one("select funnel_attach_source('youtube')")
        self.admin("insert into public.projects (owner_id, title) values (%s, 'one') returning 1", a)
        self.admin("insert into public.projects (owner_id, title) values (%s, 'two') returning 1", a)       # the same account again: still one
        self.admin("insert into public.projects (owner_id, title) values (%s, 'three') returning 1", b)
        f = self.ryan().one("select admin_funnel(4)")
        steps = {s["event"]: s for s in f["steps"]}
        self.assertEqual([s["event"] for s in f["steps"]][:4], ["landing_view", "signup_started", "signup_done", "first_project"])
        self.assertEqual(steps["landing_view"]["total"], 4)
        self.assertEqual(steps["landing_view"]["by_source"], {"youtube": 2, "direct": 1, "reddit": 1})
        self.assertEqual(steps["signup_done"]["total"], 2)
        self.assertEqual(steps["first_project"]["total"], 2)                     # two accounts, three projects
        self.assertEqual(steps["first_project"]["by_source"], {"youtube": 1, "direct": 1})
        self.assertEqual(steps["purchase"]["total"], 0)
        self.assertEqual(len(f["weeks"]), 4)
        self.assertEqual(sum(steps["landing_view"]["by_week"].values()), 4)
        self.assertEqual(set(steps["landing_view"]["by_week"]) - set(f["weeks"]), set())
        old = self.admin("insert into public.funnel_events (event, at) values ('landing_view', now() - interval '10 weeks') returning id")
        self.assertEqual({s["event"]: s for s in self.ryan().one("select admin_funnel(4)")["steps"]}["landing_view"]["total"], 4)     # outside the window
        self.assertEqual({s["event"]: s for s in self.ryan().one("select admin_funnel(12)")["steps"]}["landing_view"]["total"], 5)
        self.assertTrue(old)

    # ---- retention and account deletion
    def test_raw_events_are_deleted_13_months_after_they_happened_and_nothing_else_is_touched(self):
        self.db.as_("anon").one("select funnel_anon('landing_view')")
        self.db.as_("anon").one("select funnel_anon('signup_started')")
        self.db.as_("anon").one("select funnel_anon('landing_view')")
        ids = [r[0] for r in self.db.as_(None).all("select id from public.funnel_events order by id")]
        self.admin("update public.funnel_events set at = now() - interval '13 months 1 day' where id = %s returning 1", ids[0])
        self.admin("update public.funnel_events set at = now() - interval '12 months 27 days' where id = %s returning 1", ids[1])
        u = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email) values (%s, 'u@example.com') returning 1", u)
        self.db.as_(u).one("select funnel_attach_source('youtube')")
        r = self.svc().one("select retention_purge()")
        self.assertEqual((r["skipped"], r["funnel_events"]), (False, 1))
        self.assertEqual(self.admin("select count(*) from public.funnel_events"), 2)
        self.assertEqual(self.admin("select count(*) from public.funnel_accounts"), 1)         # the account's source stays while the account does
        self.assertEqual((r["applications"], r["help_requests"], r["reports"], r["person_invites"]), (0, 0, 0, 0))

    def test_deleting_an_account_removes_its_source_and_cuts_the_link_from_its_events_but_the_counts_stay(self):
        u = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, 'u@example.com', now()) returning 1", u)
        self.db.as_(u).one("select funnel_attach_source('youtube')")
        self.admin("delete from auth.users where id = %s returning 1", u)
        self.assertEqual(self.admin("select count(*) from public.funnel_accounts"), 0)
        self.assertEqual(self.events(), [("signup_done", None, "youtube", "", "", "")])


if __name__ == "__main__":
    unittest.main()
