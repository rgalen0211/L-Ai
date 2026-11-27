"""CLOUD-SITE 11-02 round 2: must-fail cases for the connector's sign-in and token flow (migrations/20261018000100_connect_ai.sql and later),
on a local Postgres, the same setup as test_connect.py (whose helpers this file borrows). They pin what the SQL ALREADY does; nothing here changes it.

Gaps they close (test_connect.py covers the rest): expiry on EVERY tool door, not only whoami; a person who becomes an administrator or a render
worker AFTER connecting (their code, refresh and token all stop at once); tokens used as the wrong kind or by the wrong client; and a sweep of every
connect_* function against every scope, so a function that forgets its scope check fails here.

Run from the repo root (local throwaway database only):
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_oauth_mustfail.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg  # noqa: F401  (the helpers raise psycopg errors)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, ADMIN, NOBODY = tc.ALICE, tc.BOB, tc.ADMIN, tc.NOBODY
URI, VER, h, s256 = tc.URI, tc.VER, tc.h, tc.s256
BAD = {"error": "invalid_grant"}
ALL = ("read", "write", "render_free", "edit", "fetch_data")
Z = "00000000-0000-4000-8000-000000000999"            # an id that is nobody's

# Every connect_* function an AI token reaches, the scope it needs, and its call with harmless arguments.
DOORS = [
    ("read", "select connect_whoami(%s)", ()),
    ("read", "select connect_list_projects(%s)", ()),
    ("read", "select connect_current_version(%s, %s)", (Z,)),
    ("read", "select connect_list_versions(%s, %s)", (Z,)),
    ("read", "select connect_job(%s, %s)", (Z,)),
    ("read", "select connect_edit_state(%s, %s)", (Z,)),
    ("read", "select connect_list_downloads(%s)", ()),
    ("read", "select connect_rendering_state(%s)", ()),
    ("read", "select connect_current_engine(%s)", ()),
    ("write", "select connect_create_project(%s, 'x')", ()),
    ("write", "select connect_create_version(%s, %s, %s)", (Z, Z)),
    ("write", "select connect_save_story(%s, %s, %s::jsonb)", (Z, tc.STORY)),
    ("write", "select connect_set_compilation_request(%s, %s, '{}'::jsonb)", (Z,)),
    ("render_free", "select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", (Z,)),
    ("edit", "select connect_edit_ops(%s, %s, 'data', 0, '[]'::jsonb)", (Z,)),
    ("edit", "select connect_edit_undo_ai(%s, %s, 'data')", (Z,)),
    ("fetch_data", "select connect_request_download(%s, 'https://www.example.org/a.csv', 'for a film', '')", ()),
]


class OAuthMustFail(core.Base):
    # the helpers of test_connect.Connect, borrowed (subclassing would run its 66 tests again)
    def setUp(self):                                    # test_connect.Connect.setUp's body (it calls super(), so it cannot be borrowed as it is)
        core.Base.setUp(self)
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')", (ALICE, BOB, ADMIN, NOBODY))
        d.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), ('loopback', 'loopback', 'loopback')", (URI,))
        self.counter = 0

    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect
    fails = tc.Connect.fails

    def state(self, sql, token, args):
        """The SQLSTATE a door answers for this token ('ok' when it answers)."""
        try:
            self.runner().one(sql, h(token), *args)
            return "ok"
        except psycopg.Error as e:
            return e.sqlstate

    def code_for(self, who=ALICE, client=None, scopes=("read",)):
        client = client or self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256',%s,null)", client, URI, s256(VER), " ".join(scopes))
        url = self.app(who).one("select connect_consent_decide(%s, true, %s)", req, list(scopes))["redirect_to"]
        return client, url.split("code=")[1].split("&")[0]

    # ---------------------------------------------------------------------------------------------------------- expired
    def test_an_expired_token_is_refused_at_every_door_with_sign_in(self):
        _, a, _ = self.connect(ALICE, scopes=ALL)
        self.db.as_(None).c.execute("update public.connect_tokens set access_expires_at = now() - interval '1 second' where access_hash = %s", (h(a),))
        for scope, sql, args in DOORS:
            self.assertEqual(self.state(sql, a, args), "PT401", sql)
        self.assertIsNone(self.runner().one("select connect_scopes(%s)", h(a)), "an expired token has no scopes, so the function answers 401")

    def test_an_expired_access_token_can_be_refreshed_but_the_new_one_keeps_only_its_scopes(self):
        client, a, ref = self.connect(ALICE, scopes=("read",))
        self.db.as_(None).c.execute("update public.connect_tokens set access_expires_at = now() - interval '1 second' where access_hash = %s", (h(a),))
        self.db.as_(None).c.execute("update public.connect_grants set scopes = array['read','write'] where owner_id = %s", (ALICE,))
        out = self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("new-access"), h("new-refresh"))
        self.assertNotIn("error", out)
        self.assertEqual(self.runner().one("select connect_scopes(%s)", h("new-access")), ["read"], "a refresh never widens a token")
        self.assertEqual(self.state("select connect_create_project(%s, 'x')", "new-access", ()), "PT403")
        self.assertEqual(self.state("select connect_whoami(%s)", a, ()), "PT401", "the old expired token stays dead")

    # ---------------------------------------------------------------------------------------------------------- revoked
    def test_revoking_the_access_token_by_its_hash_ends_the_refresh_token_too_and_the_reverse(self):
        for which in ("access", "refresh"):
            client, a, ref = self.connect(ALICE)
            self.runner().one("select connect_revoke(%s)", h(a if which == "access" else ref))
            self.assertEqual(self.state("select connect_whoami(%s)", a, ()), "PT401", which)
            self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(which + "x"), h(which + "y")), BAD, which)

    def test_revoke_with_a_raw_token_or_garbage_changes_nothing_and_never_errors(self):
        _, a, _ = self.connect(ALICE)
        for junk in (a, "", "0" * 64, "x" * 500):
            self.runner().one("select connect_revoke(%s)", junk)
        self.assertEqual(self.state("select connect_whoami(%s)", a, ()), "ok")

    def test_a_revoked_grant_stops_every_door(self):
        _, a, _ = self.connect(ALICE, scopes=ALL)
        self.db.as_(None).c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        for scope, sql, args in DOORS:
            self.assertEqual(self.state(sql, a, args), "PT403", sql)

    # ----------------------------------------------------------------------------------------- admin and worker accounts
    def test_a_person_who_becomes_an_admin_after_connecting_loses_code_refresh_and_token_at_once(self):
        client, code = self.code_for(ALICE)                     # consented, code not yet exchanged
        client2, a, ref = self.connect(ALICE, scopes=ALL)
        self.db.as_(None).c.execute("insert into public.app_admins (user_id) values (%s)", (ALICE,))
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h("ea"), h("eb")), BAD, "exchange")
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client2, h("ra"), h("rb")), BAD, "refresh")
        for scope, sql, args in DOORS:
            self.assertEqual(self.state(sql, a, args), "PT403", sql)

    def test_a_person_who_becomes_a_render_worker_after_connecting_loses_everything_at_once(self):
        client, a, ref = self.connect(BOB, scopes=ALL)
        self.db.as_(None).c.execute("insert into public.workers (user_id, name) values (%s, 'bob-pc')", (BOB,))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("wa"), h("wb")), BAD)
        for scope, sql, args in DOORS:
            self.assertEqual(self.state(sql, a, args), "PT403", sql)

    def test_an_admin_never_gets_a_token_even_with_access_enabled_by_hand(self):
        self.db.as_(None).c.execute("insert into public.connect_access (user_id) values (%s)", (ADMIN,))
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        self.app(ADMIN)
        self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_codes"), 0)
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_tokens"), 0)

    # ------------------------------------------------------------------------------------------------- wrong account
    def test_a_code_is_bound_to_its_client_redirect_and_verifier(self):
        client, code = self.code_for(ALICE)
        other = self.register()
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), other, URI, VER, h("1a"), h("1b")), BAD, "another client")
        client, code = self.code_for(ALICE)
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI + "x", VER, h("2a"), h("2b")), BAD, "another address")
        client, code = self.code_for(ALICE)
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", code, client, URI, VER, h("3a"), h("3b")), BAD, "the raw code, not its hash")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_tokens"), 0)

    def test_tokens_cannot_be_used_as_the_other_kind(self):
        client, a, ref = self.connect(ALICE)
        self.assertEqual(self.state("select connect_whoami(%s)", ref, ()), "PT401", "a refresh token is not an access token")
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(a), client, h("ka"), h("kb")), BAD, "an access token is not a refresh token")

    def test_alices_token_acts_as_alice_only_even_on_a_door_bob_has_used(self):
        _, a, _ = self.connect(ALICE, scopes=ALL)
        _, b, _ = self.connect(BOB, scopes=ALL)
        r = self.runner()
        pb = r.one("select connect_create_project(%s, 'Bob only')", h(b))["id"]
        self.assertEqual(r.one("select connect_list_projects(%s)", h(a)), [])
        self.assertIsNone(r.one("select connect_current_version(%s, %s)", h(a), pb))
        self.assertEqual(r.one("select connect_list_versions(%s, %s)", h(a), pb), [])
        self.assertEqual(self.state("select connect_set_compilation_request(%s, %s, %s::jsonb)", a, (pb, '{"schema": "ryagram.compilation-request/0"}')), "ok")
        self.assertIsNone(r.one("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(a), pb, '{"schema": "ryagram.compilation-request/0"}'), "Bob's project looks absent")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.compilation_requests"), 0)
        self.assertNotEqual(r.one("select connect_whoami(%s)", h(a)), r.one("select connect_whoami(%s)", h(b)), "each token answers as its own person")

    # ---------------------------------------------------------------------------------------------------- scope limits
    def test_every_door_refuses_a_token_without_its_scope_and_opens_with_it(self):
        _, full, _ = self.connect(ALICE, scopes=ALL)
        for scope, sql, args in DOORS:
            self.assertNotEqual(self.state(sql, full, args), "PT403", f"with every scope, {sql} must not be a scope refusal")
        for missing in ALL:
            if missing == "read":
                continue                                        # read is always granted (the least scope)
            kept = tuple(s for s in ALL if s != missing)
            _, t, _ = self.connect(ALICE, scopes=kept)
            for scope, sql, args in DOORS:
                if scope == missing:
                    self.assertEqual(self.state(sql, t, args), "PT403", f"without {missing}: {sql}")

    def test_render_final_and_unknown_scopes_can_never_be_granted(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256',%s,null)", client, URI, s256(VER), "read write render_free edit fetch_data render_final admin service_role")
        asked = self.db.as_(None).one("select scopes from public.connect_requests where id = %s", req)
        self.assertNotIn("render_final", asked); self.assertNotIn("admin", asked); self.assertNotIn("service_role", asked)
        self.app(ALICE).one("select connect_consent_decide(%s, true, %s)", req, ["read", "render_final", "admin", "service_role"])
        self.assertEqual(self.db.as_(None).one("select scopes from public.connect_grants where owner_id = %s", ALICE), ["read"])


if __name__ == "__main__":
    unittest.main()
