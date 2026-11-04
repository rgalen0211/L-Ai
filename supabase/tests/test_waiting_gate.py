"""CLOUD-SITE 11-04: MUST-FAIL tests for Ryan's WAITING accounts (Ryan chose real accounts that are locked in a 'waiting' state; the server side is CONNECT's and does not exist yet).

A waiting account may reach ONLY: the "You are on the list" page (its status), its settings, and deleting the account. Everything else must be refused ON THE SERVER, whatever the
page shows: every app database function (projects, versions, jobs, uploads, renders, credits, support, departments, the editor ...), the functions behind checkout, credits, the
desktop download and film delivery, and connector sign-in (OAuth consent) and any connector token.

SKIPPED UNTIL THE GATE EXISTS: the whole class skips while the schema has no ryagram_private.is_waiting(uuid). When CONNECT adds the gate these tests run, and they are the
contract: each refused function must say 42501 BEFORE it looks at its arguments (so a waiting account learns nothing and nothing runs), the allowed ones must work.

TWO PLACES FOR CONNECT TO ADAPT (if the gate is shaped differently): mark_waiting() below (how an account is put in the waiting state), and WAITING_STATUS_FN (the function
the "You are on the list" page reads). Everything else follows the app's own calls (assets/app-data.js and the edge functions), listed here so a NEW app function must be added.

Run from the repo root (local throwaway database only):
    pgvenv/Scripts/python -m unittest supabase/tests/test_waiting_gate.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

# checkout and credits live in phase-2b (applied with the 2B ledger, as test_stripe.py does); load them so their functions are swept too
for extra in (core.ROOT / "phase-2b" / "credits_ledger.sql", core.ROOT / "phase-2b" / "stripe_test_mode.sql"):
    if extra not in core.MIGRATIONS:
        core.MIGRATIONS.append(extra)
setUpModule = core.setUpModule
WAITER, MEMBER = (str(uuid.UUID(int=i)) for i in (401, 402))
GATE = "ryagram_private.is_waiting(uuid)"
WAITING_STATUS_FN = "my_access_status"          # CONNECT: the function the "You are on the list" page reads; it must answer for a waiting account and say it is waiting
SKIP_REASON = ("skipped until the waiting-account gate exists (CONNECT's server side, Ryan 11-04): the schema has no " + GATE +
               ". These are the must-fail tests for it; they run as soon as it lands.")

# Every database function the app calls (assets/app-data.js, 11-04) that a waiting account must NOT reach, and the ones behind the edge functions:
# stripe-checkout (checkout, credits), app-download (the desktop app), get-delivery-url (films). admin_* are admin-only already (test_invite_signup_mustfail.py).
APP_FUNCTIONS = [
    "attach_upload_to_version", "cancel_job", "cancel_render_order", "confirm_dataset_mapping", "create_upload", "create_version", "credit_quote", "current_engine_commit",
    "device_decide", "device_request_check", "disconnect_ai", "editor_apply_ops", "editor_heartbeat", "editor_undo", "editor_undo_all_ai", "film_request_cost", "film_unpublish",
    "finish_upload", "my_computers", "my_connected_ais", "my_department_interests", "my_departments", "my_edit_ops_since", "queue_position", "register_department_interest",
    "remove_computer", "render_order_status", "request_dataset_deletion", "request_film", "request_final_render", "set_dataset_provenance", "set_engine_profile",
    "submit_job", "submit_support", "sync_version_sources", "withdraw_department_interest",
    # connector sign-in (the consent page)
    "connect_consent_check", "connect_consent_decide",
]
# The edge functions check the person's login, then call these AS THE SERVICE ROLE with p_owner = that person: stripe-checkout (checkout and credits), app-download (the
# desktop app), get-delivery-url (films). The gate must refuse them for a waiting owner too, before anything else.
SERVICE_FUNCTIONS = ["stripe_checkout_context", "stripe_set_customer", "request_app_download", "delivery_object_for", "compilation_object_for"]
# What a waiting account keeps: the plain "am I an admin" and status reads the page needs (app session), and deleting the account (delete-account, service role, p_owner).
ALLOWED_FUNCTIONS = ["is_app_admin", "service_status"]
ALLOWED_SERVICE_FUNCTIONS = ["account_deletion_check"]
# The tables the app writes directly; a waiting account writes none of them except its own settings.
REFUSED_WRITES = [
    ("insert a project", "insert into public.projects (title) values ('mine')"),
    ("upsert an engine profile", "insert into public.engine_profiles (name) values ('x')"),
]


def gate_exists():
    try:
        db = core.Db(core._server.get_uri(database="tmpl"))
        ok = db.one("select to_regprocedure(%s) is not null", GATE)
        db.c.close()
        return bool(ok)
    except Exception:
        return False


class WaitingGate(core.Base):
    @classmethod
    def setUpClass(cls):
        if not gate_exists():
            raise unittest.SkipTest(SKIP_REASON)

    def setUp(self):
        super().setUp()
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'waiting@x.example'),(%s,'member@x.example')", (WAITER, MEMBER))
        self.mark_waiting(WAITER)

    def mark_waiting(self, uid):
        """CONNECT: put an account in the waiting state, the way the gate stores it. Assumed: a row in public.waiting_accounts."""
        self.db.as_(None).c.execute("insert into public.waiting_accounts (user_id) values (%s)", (uid,))

    def as_app(self, who):
        self.db.as_(who)
        self.db.c.execute("select set_config('request.jwt.claims', '', false)")          # an app session (no client_id)
        return self.db

    def call_service(self, name, owner):
        """As the edge functions do: the service role, p_owner (the first uuid argument) = the person, every other argument null."""
        types = self.db.as_(None).one("""select coalesce(array_to_string(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t), ','), '')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = %s order by p.pronargs limit 1""", name)
        if types is None:
            return "missing"
        ts = [t for t in types.split(",") if t]
        args = ", ".join((f"'{owner}'::uuid" if i == 0 and t == "uuid" else f"null::{t}") for i, t in enumerate(ts))
        try:
            self.db.as_("service").one(f"select public.{name}({args})")
            return "ran"
        except psycopg.Error as e:
            return e.sqlstate

    def call(self, who, name):
        types = self.db.as_(None).one("""select coalesce(array_to_string(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t), ','), '')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = %s order by p.pronargs limit 1""", name)
        if types is None:
            return "missing"
        args = ", ".join(f"null::{t}" for t in types.split(",") if t)
        try:
            self.as_app(who).one(f"select public.{name}({args})")
            return "ran"
        except psycopg.Error as e:
            return e.sqlstate

    # ---------------------------------------------------------------------------------------------------- what is refused
    def test_every_app_function_refuses_a_waiting_account_before_it_reads_its_arguments(self):
        wrong = [f"{n}: {got}" for n in APP_FUNCTIONS if (got := self.call(WAITER, n)) not in ("42501", "missing")]
        wrong += [f"{n} (service, p_owner = the waiting account): {got}" for n in SERVICE_FUNCTIONS if (got := self.call_service(n, WAITER)) not in ("42501", "missing")]
        self.assertEqual(wrong, [], "each must refuse a waiting account with 42501, before any argument check (22023/P0002/PT404 means it got past the gate)")

    def test_a_waiting_account_writes_no_app_table(self):
        for what, sql in REFUSED_WRITES:
            with self.assertRaises(psycopg.Error, msg=what):
                self.as_app(WAITER).one(sql + " returning 1")
            self.db.c.execute("select 1")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.projects where owner_id = %s", WAITER), 0)

    def test_a_waiting_account_cannot_upload_a_file(self):
        with self.assertRaises(psycopg.Error):
            self.as_app(WAITER).one("insert into storage.objects (bucket_id, name, owner) values ('ryagram-uploads', %s, %s) returning 1", f"{WAITER}/x.csv", WAITER)
        self.assertEqual(self.db.as_(None).one("select count(*) from storage.objects where name like %s", f"{WAITER}/%"), 0)

    def test_a_waiting_account_has_no_credits_to_spend_and_cannot_buy_any(self):
        self.assertEqual(self.call(WAITER, "credit_quote"), "42501")
        self.assertEqual(self.call_service("stripe_checkout_context", WAITER), "42501", "checkout (stripe-checkout calls it as the service role for the person)")
        self.assertEqual(self.as_app(WAITER).one("select count(*) from public.credit_ledger"), 0)

    def test_connector_sign_in_and_any_token_refuse_a_waiting_account(self):
        d = self.db.as_(None).c
        d.execute("insert into public.connect_access (user_id) values (%s) on conflict do nothing", (WAITER,))       # even if someone switched it on by hand
        self.assertFalse(self.db.as_(None).one("select ryagram_private.connect_person_ok(%s)", WAITER), "connect_person_ok must say no for a waiting account")
        self.assertEqual(self.call(WAITER, "connect_consent_decide"), "42501")

    # ---------------------------------------------------------------------------------------------------- what is allowed
    def test_the_on_the_list_page_answers_for_a_waiting_account_and_says_it_is_waiting(self):
        got = self.as_app(WAITER).one(f"select public.{WAITING_STATUS_FN}()")
        self.assertTrue(got and (got is True or (isinstance(got, dict) and got.get("waiting") is True)), f"{WAITING_STATUS_FN}() must say waiting: {got!r}")

    def test_settings_and_delete_account_still_work_for_a_waiting_account(self):
        # exactly what the app sends (app-data.js: upsert { upload_retention } on owner_id; the owner defaults to the signed-in account)
        self.as_app(WAITER).one("insert into public.account_settings (upload_retention) values ('dont_keep') on conflict (owner_id) do update set upload_retention = 'dont_keep' returning 1")
        self.assertEqual(self.db.as_(None).one("select upload_retention::text from public.account_settings where owner_id = %s", WAITER), "dont_keep")
        for n in ALLOWED_FUNCTIONS:
            self.assertNotEqual(self.call(WAITER, n), "42501", f"{n} must stay open to a waiting account")
        for n in ALLOWED_SERVICE_FUNCTIONS:
            self.assertEqual(self.call_service(n, WAITER), "ran", f"{n} (delete-account, as the service role) must work for a waiting account")
        self.db.as_("service").one("select public.account_request_deletion(%s::uuid, 'waiting@x.example', 'leaving')", WAITER)          # deleting the account works
        self.assertEqual(self.db.as_(None).one("select count(*) from public.account_deletion_requests where owner_id = %s", WAITER), 1, "the deletion request is recorded")

    # ---------------------------------------------------------------------------------------------------- the control
    def test_control_an_ordinary_account_is_not_stopped_by_the_gate(self):
        self.as_app(MEMBER).one("insert into public.projects (title) values ('mine') returning 1")
        self.assertNotEqual(self.call(MEMBER, "create_version"), "42501")


if __name__ == "__main__":
    unittest.main()
