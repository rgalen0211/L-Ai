"""Connect your own AI (migrations/20261018000100_connect_ai.sql) on a local Postgres.

Same setup as test_2a_core.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect.py -v

The boundary under test: connect_runner (a role with NO table/sequence/schema privileges of its own, EXECUTE on connect_*
only) acts for a person ONLY through a live token hash. No connect_* function takes an owner id.
"""
import hashlib
import sys
import unittest
import uuid
import base64
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, ADMIN, NOBODY = (str(uuid.UUID(int=i)) for i in (101, 102, 103, 104))
STORY = '{"schema": 1, "engine": "sequence", "name": "t", "sequence": {}}'
URI = "https://claude.ai/api/mcp/auth_callback"


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


VER = "v" * 43   # a 43-character verifier


class Connect(core.Base):
    def setUp(self):
        super().setUp()
        d = self.db.as_(None)
        self.db.as_(None).c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')",
                    (ALICE, BOB, ADMIN, NOBODY))
        self.db.as_(None).c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        self.db.as_(None).c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        self.db.as_(None).c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), "
                    "('loopback', 'loopback', 'loopback')", (URI,))
        self.counter = 0

    # -- helpers -----------------------------------------------------------------------------------------------
    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role connect_runner")
        return self.db

    def app(self, who, claims=None):
        self.db.as_(who)
        # always set the claims GUC: a previous call's client_id must not leak into this one
        self.db.c.execute("select set_config('request.jwt.claims', %s, false)", (claims or "",))
        return self.db

    def register(self):
        return self.runner().one("select connect_register_client('Claude', array[%s])", URI)

    def connect(self, who=ALICE, scopes=("read", "write", "render_free"), client=None):
        """The whole OAuth dance: register, begin, consent as `who`, exchange. Returns (client_id, access_token, refresh_token)."""
        self.counter += 1
        client = client or self.register()
        challenge = s256(VER)
        req = self.runner().one("select connect_begin_authorization(%s,%s,'st',%s,'S256',%s,null)", client, URI, challenge, " ".join(scopes))
        out = self.app(who).one("select connect_consent_decide(%s, true, %s)", req, list(scopes))
        url = out["redirect_to"]
        self.assertTrue(url.startswith(URI + "?code="), url)
        code = url.split("code=")[1].split("&")[0]
        access, refresh = f"acc{self.counter}-" + uuid.uuid4().hex, f"ref{self.counter}-" + uuid.uuid4().hex
        self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h(access), h(refresh))
        return client, access, refresh

    def fails(self, sql, *args, code=None):
        with self.assertRaises(psycopg.Error) as cm:
            self.db.one(sql, *args)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    # ------------------------------------------------------------------------------------------ privilege boundary
    def test_connect_runner_has_only_connect_execute_and_nothing_else(self):
        assert_runner_boundary(self, self.db.as_(None))

    def test_runner_cannot_forge_claims_and_reach_an_app_function(self):          # (2)
        r = self.runner()
        r.one("select set_config('request.jwt.claims', %s, false)", '{"sub": "%s", "role": "authenticated"}' % ALICE)   # allowed (pg_catalog)...
        r.one("select set_config('request.jwt.claim.sub', %s, false)", ALICE)
        for sql in ("select * from public.projects", "insert into public.projects (title) values ('x')",
                    "select public.submit_job(gen_random_uuid(), 'preview')", "select * from public.create_version(gen_random_uuid())",
                    "select public.queue_position(gen_random_uuid())", "select * from public.credit_quote(gen_random_uuid(), 'preview')",
                    "select * from public.connect_tokens", "select * from ryagram_private.connect_actor('" + "0" * 64 + "', null)"):
            self.fails(sql)
            self.db.c.execute("select 1")         # autocommit: the failed statement left nothing behind
        # ... and the forged claim gets it nothing at the one door it has:
        self.fails("select connect_whoami(%s)", "0" * 64, code="PT401")

    def test_claims_set_by_a_tool_call_do_not_survive_the_call(self):             # (3), here on one connection; also run on the real pooler
        _, access, _ = self.connect(ALICE)
        r = self.runner()
        r.one("select connect_whoami(%s)", h(access))
        self.assertIn(r.one("select coalesce(current_setting('request.jwt.claims', true), '')"), ("", None))
        self.assertIn(r.one("select coalesce(current_setting('request.jwt.claim.sub', true), '')"), ("", None))

    # ----------------------------------------------------------------------------------------------- who is the actor
    def test_token_for_alice_cannot_touch_bobs_rows(self):                         # (4)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        r = self.runner()
        pa = r.one("select connect_create_project(%s, 'Alice film')", h(a))["id"]
        pb = r.one("select connect_create_project(%s, 'Bob film')", h(b))["id"]
        self.assertEqual([p["title"] for p in r.one("select connect_list_projects(%s)", h(a))], ["Alice film"])
        self.assertEqual([p["title"] for p in r.one("select connect_list_projects(%s)", h(b))], ["Bob film"])
        va = r.one("select connect_current_version(%s, %s)", h(a), pa)
        vb = r.one("select connect_current_version(%s, %s)", h(b), pb)
        self.assertIsNone(r.one("select connect_current_version(%s, %s)", h(a), pb))       # Bob's project looks absent to Alice
        self.fails("select connect_get_version(%s, %s)", h(a), vb, code="PT404")
        self.fails("select connect_save_story(%s, %s, %s::jsonb)", h(a), vb, STORY, code="PT404")
        self.fails("select connect_quote(%s, %s, 'preview')", h(a), vb, code="PT404")
        self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vb, '{"window_s": [0, 5]}')
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), va, STORY)
        jb = r.one("select connect_save_story(%s, %s, %s::jsonb)", h(b), vb, STORY)
        sub = r.one("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", h(b), vb)
        self.assertIsNone(r.one("select connect_job(%s, %s)", h(a), sub["id"]))           # Alice cannot see Bob's job
        self.assertIsNotNone(r.one("select connect_job(%s, %s)", h(b), sub["id"]))

    def test_no_connect_function_takes_an_owner_id(self):
        d = self.db.as_(None)
        rows = d.all("""select p.proname, pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname like 'connect\\_%%' """)
        for name, args in rows:
            self.assertNotRegex(args, r"owner|user_id|p_user|p_person", name)

    def test_unknown_malformed_and_wrong_tokens_are_refused(self):
        r = self.runner()
        for bad in ("0" * 64, "short", "", "G" * 64):
            self.fails("select connect_whoami(%s)", bad, code="PT401")
        _, access, _ = self.connect(ALICE)
        self.fails("select connect_whoami(%s)", access, code="PT401")              # the raw token is not the hash

    def test_revoked_expired_removed_and_adminised_tokens_are_refused_at_once(self):   # (5) and CC1's list
        _, a, ref = self.connect(ALICE)
        r = self.runner()
        r.one("select connect_whoami(%s)", h(a))
        d = self.db.as_(None)
        self.db.as_(None).c.execute("update public.connect_tokens set access_expires_at = now() - interval '1 second' where access_hash = %s", (h(a),))
        self.fails("select connect_whoami(%s)", h(a), code="PT401")              # expired
        self.db.as_(None).c.execute("update public.connect_tokens set access_expires_at = now() + interval '1 hour' where access_hash = %s", (h(a),))
        r = self.runner(); r.one("select connect_whoami(%s)", h(a))
        d.as_(None).c.execute("update public.connect_access set enabled = false where user_id = %s", (ALICE,))
        self.fails("select connect_whoami(%s)", h(self.runner() and a), code="PT403")         # no longer invited
        d.as_(None).c.execute("update public.connect_access set enabled = true where user_id = %s", (ALICE,))
        self.runner().one("select connect_whoami(%s)", h(a))
        d.as_(None).c.execute("insert into public.app_admins (user_id) values (%s)", (ALICE,))
        self.fails("select connect_whoami(%s)", h(self.runner() and a), code="PT403")         # became an admin
        d.as_(None).c.execute("delete from public.app_admins where user_id = %s", (ALICE,))
        self.runner().one("select connect_whoami(%s)", h(a))
        d.as_(None).c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        self.fails("select connect_whoami(%s)", h(self.runner() and a), code="PT403")         # grant revoked
        d.as_(None).c.execute("update public.connect_grants set revoked_at = null where owner_id = %s", (ALICE,))
        d.as_(None).c.execute("update public.connect_tokens set revoked_at = now() where access_hash = %s", (h(a),))
        self.fails("select connect_whoami(%s)", h(self.runner() and a), code="PT401")         # token revoked

    def test_an_admin_cannot_consent_even_if_someone_enabled_them_by_hand(self):
        client = self.register()
        self.db.as_(None).c.execute("insert into public.connect_access (user_id) values (%s)", (ADMIN,))
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        chk = self.app(ADMIN).one("select connect_consent_check(%s)", req)
        self.assertFalse(chk["allowed"])
        self.assertIn("Administrator", chk["reason"])
        self.app(ADMIN)
        self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_grants"), 0)

    def test_scope_is_checked_in_sql(self):
        _, a, _ = self.connect(ALICE, scopes=("read",))
        r = self.runner()
        r.one("select connect_list_projects(%s)", h(a))
        self.fails("select connect_create_project(%s, 'x')", h(a), code="PT403")
        self.fails("select connect_submit_job(%s, gen_random_uuid(), 'preview', '{}'::jsonb, null, null)", h(a), code="PT403")

    def test_a_token_keeps_only_the_scopes_it_was_issued_with_when_the_grant_is_widened_later(self):
        _, a, _ = self.connect(ALICE, scopes=("read",))
        self.db.as_(None).c.execute("update public.connect_grants set scopes = array['read','write','render_free'] where owner_id = %s", (ALICE,))
        r = self.runner()
        r.one("select connect_list_projects(%s)", h(a))
        self.fails("select connect_create_project(%s, 'x')", h(a), code="PT403")      # the old token was never given write
        self.assertEqual(r.one("select connect_scopes(%s)", h(a)), ["read"])

    def test_full_render_is_refused_in_sql_even_with_every_switch_on(self):
        _, a, _ = self.connect(ALICE)
        d = self.db.as_(None)
        self.db.as_(None).c.execute("update public.connect_flags set full_render_enabled = true")
        self.db.as_(None).c.execute("update public.connect_grants set scopes = scopes || array['render_final']")
        self.db.as_(None).c.execute("update public.connect_tokens set scopes = scopes || array['render_final']")
        r = self.runner()
        pid = r.one("select connect_create_project(%s, 'F')", h(a))["id"]
        vid = r.one("select connect_current_version(%s, %s)", h(a), pid)
        e = self.fails("select connect_submit_job(%s, %s, 'final_render', '{}'::jsonb, gen_random_uuid(), gen_random_uuid())", h(a), vid, code="42501")
        self.assertIn("Full renders cannot be started", str(e))

    # ------------------------------------------------------------------------------------------------ tools
    def test_tools_use_the_apps_own_rules(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        who = r.one("select connect_whoami(%s)", h(a))
        self.assertEqual(who["label"], "alice@x")
        p1 = r.one("select connect_create_project(%s, '  Same ')", h(a))
        p2 = r.one("select connect_create_project(%s, 'Same')", h(a))
        self.assertTrue(p1["created"]); self.assertFalse(p2["created"]); self.assertEqual(p1["id"], p2["id"])
        vid = r.one("select connect_current_version(%s, %s)", h(a), p1["id"])
        self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}')   # no story yet: the app's own refusal
        sha = r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, STORY)
        self.assertRegex(sha, "^[0-9a-f]{64}$")
        j = r.one("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}')
        self.assertEqual(j["state"], "queued")
        e = self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}')
        self.assertIn("already in progress", str(e))                                  # the app's one-job-in-progress rule, unchanged
        info = r.one("select connect_job(%s, %s)", h(a), j["id"])
        self.assertEqual(info["queue_position"], 1)
        self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 60]}')   # the 10 second rule
        q = r.one("select connect_quote(%s, %s, 'preview')", h(a), vid)
        self.assertEqual(q["credits"], 0)                                              # credits (2B) not installed in this database
        v = r.one("select connect_get_version(%s, %s)", h(a), vid)
        self.assertEqual(len(v["jobs"]), 1)

    def test_a_locked_version_cannot_be_edited_through_a_tool(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        pid = r.one("select connect_create_project(%s, 'L')", h(a))["id"]
        vid = r.one("select connect_current_version(%s, %s)", h(a), pid)
        self.db.as_(None).c.execute("update public.versions set state = 'complete' where id = %s", (vid,))
        e = self.fails("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, STORY, code="42501")
        self.assertIn("locked", str(e))
        nv = self.runner().one("select connect_create_version(%s, %s, %s)", h(a), pid, vid)
        self.assertEqual(nv["number"], 2)

    def test_rate_buckets_count_per_person_and_window(self):
        _, a, _ = self.connect(ALICE); _, b, _ = self.connect(BOB)
        r = self.runner()
        self.assertTrue(all(r.one("select connect_hit(%s, 'ladder', 3, 3600)", h(a)) for _ in range(3)))
        self.assertFalse(r.one("select connect_hit(%s, 'ladder', 3, 3600)", h(a)))
        self.assertTrue(r.one("select connect_hit(%s, 'ladder', 3, 3600)", h(b)))      # Bob has his own
        self.fails("select connect_hit(%s, 'Bad Bucket', 3, 3600)", h(a), code="22023")

    def test_log_keeps_no_text_and_an_unknown_token_has_no_owner(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        r.one("select connect_log(%s, 'set_story', 0, 'refused', 'checks_failed', 3)", h(a))
        r.one("select connect_log(%s, 'whoami_and_credits', 0, 'refused', 'no_grant', 0)", "f" * 64)
        r.one("select connect_log(%s, 'Bad Tool!', 0, 'ok', 'ok', 0)", h(a))             # silently ignored
        rows = self.db.as_(None).all("select owner_id::text, tool, code, failed_checks from public.connect_calls order by id")
        self.assertEqual(rows, [(ALICE, "set_story", "checks_failed", 3)])           # an unknown hash is not logged: anyone with the runner credentials could flood the table
        cols = [c for (c,) in self.db.all("select column_name from information_schema.columns where table_name = 'connect_calls'")]
        self.assertEqual(sorted(cols), sorted(["id", "at", "owner_id", "client_id", "tool", "credits", "result", "code", "failed_checks"]))

    # ------------------------------------------------------------------------------------------ authorization server
    def test_register_requires_an_allowlisted_redirect_uri(self):
        r = self.runner()
        for bad in ("https://evil.example/cb", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback#x",
                    "https://claude.ai/api/mcp/other", "javascript:alert(1)", "https://claude.ai/api/mcp/auth_callback "):
            self.fails("select connect_register_client('Claude', array[%s])", bad, code="PT400")
        self.fails("select connect_register_client('', array[%s])", URI, code="PT400")
        self.assertTrue(r.one("select connect_register_client('Claude', array[%s])", URI).startswith("rgc_"))
        r.one("select connect_register_client('CLI', array['http://localhost:8123/callback'])")          # loopback is allowed (a row says so)
        r.one("select connect_register_client('CLI', array['http://127.0.0.1:55/cb'])")
        self.fails("select connect_register_client('CLI', array['http://localhost.evil.example/cb'])", code="PT400")
        self.db.as_(None).c.execute("update public.connect_redirect_allowlist set enabled = false where kind = 'loopback'")
        self.fails("select connect_register_client('CLI', array['http://localhost:8123/callback'])", code="PT400")

    def test_authorize_rules_pkce_s256_only_and_exact_uris(self):
        c = self.register()
        r = self.runner()
        ok = lambda **kw: r.one("select connect_begin_authorization(%s,%s,%s,%s,%s,%s,null)",
                                kw.get("client", c), kw.get("uri", URI), "st", kw.get("ch", s256(VER)), kw.get("m", "S256"), kw.get("scope", "read"))
        self.assertTrue(ok())
        self.fails("select connect_begin_authorization(%s,%s,'s',%s,'plain','read',null)", c, URI, s256(VER), code="PT400")
        self.fails("select connect_begin_authorization(%s,%s,'s',%s,null,'read',null)", c, URI, s256(VER), code="PT400")
        self.fails("select connect_begin_authorization(%s,%s,'s','short','S256','read',null)", c, URI, code="PT400")
        self.fails("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", c, "https://claude.ai/api/mcp/auth_callback/", s256(VER), code="PT400")
        self.fails("select connect_begin_authorization('rgc_nope',%s,'s',%s,'S256','read',null)", URI, s256(VER), code="PT400")
        # the assistants' own OAuth words are ignored; unknown scopes fall back to what we offer, never to anything more
        self.db.one("select connect_begin_authorization(%s,%s,'s',%s,'S256','openid offline_access renders_final admin',null)", c, URI, s256(VER))
        got = self.db.as_(None).one("select scopes from public.connect_requests order by created_at desc limit 1")
        self.assertEqual(sorted(got), ["read"])                                   # nothing we know was asked for: the least we have

    def test_the_whole_flow_and_pkce_checks(self):
        client = self.register()
        r = self.runner()
        req = r.one("select connect_begin_authorization(%s,%s,'a b&c',%s,'S256','read write',null)", client, URI, s256(VER))
        chk = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertTrue(chk["allowed"]); self.assertEqual(chk["redirect_host"], "claude.ai"); self.assertEqual(chk["credit_scopes"], [])
        self.assertNotIn("render_final", chk["offered_scopes"])
        url = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"]
        self.assertIn("&state=a%20b%26c", url)
        code = url.split("code=")[1].split("&")[0]
        self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")         # one decision per request
        acc, ref = "a" * 8 + uuid.uuid4().hex, "r" * 8 + uuid.uuid4().hex
        r = self.runner()
        bad = {"error": "invalid_grant"}

        def fresh_code(scopes="read write"):
            q = self.runner().one("select connect_begin_authorization(%s,%s,'a b&c',%s,'S256',%s,null)", client, URI, s256(VER), scopes)
            return self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", q)["redirect_to"].split("code=")[1].split("&")[0]
        r = self.runner()
        for v in ("x" * 43, "short", VER[:-1] + "w"):                                                    # wrong / malformed verifier, each on its own code
            c2 = fresh_code()
            self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(c2), client, URI, v, h(acc), h(ref)), bad)
        c3 = fresh_code()
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(c3), client, "https://claude.ai/api/mcp/other", VER, h(acc), h(ref)), bad)
        c4 = fresh_code()
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(c4), "rgc_other", URI, VER, h(acc), h(ref)), bad)
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(c4), client, URI, VER, h(acc), h(ref)), bad)   # the code a wrong client tried is spent
        out = r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h(acc), h(ref))
        self.assertEqual(out["scope"], "read"); self.assertEqual(out["expires_in"], 3600)
        r.one("select connect_list_projects(%s)", h(acc))
        # a replayed code kills what it made
        self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h("z" * 64), h("y" * 64)), {"error": "invalid_grant"})
        self.fails("select connect_list_projects(%s)", h(acc), code="PT401")

    def test_expired_code_is_refused(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        url = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"]
        code = url.split("code=")[1].split("&")[0]
        self.db.as_(None).c.execute("update public.connect_codes set expires_at = now() - interval '1 second'")
        self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h("1" * 64), h("2" * 64)), {"error": "invalid_grant"})

    def test_refresh_rotates_and_reuse_kills_the_family(self):
        client, a, ref = self.connect(ALICE)
        r = self.runner()
        n_acc, n_ref = uuid.uuid4().hex, uuid.uuid4().hex
        r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n_acc), h(n_ref))
        self.fails("select connect_list_projects(%s)", h(a), code="PT401")                  # the old pair is spent
        r.one("select connect_list_projects(%s)", h(n_acc))
        bad = {"error": "invalid_grant"}
        self.db.as_(None).c.execute("update public.connect_tokens set refresh_used_at = now() - interval '61 seconds' where refresh_hash = %s", (h(ref),))   # past the 60 s retry grace
        r = self.runner()
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("3" * 64), h("4" * 64)), bad)   # reuse ...
        self.fails("select connect_list_projects(%s)", h(n_acc), code="PT401")              # ... killed the new one too
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(n_ref), client, h("5" * 64), h("6" * 64)), bad)

    def test_refresh_retry_grace_and_sliding_thirty_days(self):
        bad = {"error": "invalid_grant"}
        # SLIDING: a refresh gives the new refresh token a fresh 30 days, even when the old one had only days left
        client, a, ref = self.connect(ALICE)
        self.db.as_(None).c.execute("update public.connect_tokens set refresh_expires_at = now() + interval '3 days' where refresh_hash = %s", (h(ref),))
        n1, r1 = uuid.uuid4().hex, uuid.uuid4().hex
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n1), h(r1))
        days = self.db.as_(None).one("select extract(epoch from (refresh_expires_at - now())) / 86400 from public.connect_tokens where refresh_hash = %s", h(r1))
        self.assertGreater(float(days), 29.9); self.assertLess(float(days), 30.1)
        # GRACE: the same refresh token presented again within 60 s (a lost answer, or two requests at once) gets a fresh pair; both pairs work
        n2, r2 = uuid.uuid4().hex, uuid.uuid4().hex
        out = self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n2), h(r2))
        self.assertEqual(out["expires_in"], 3600)
        self.runner().one("select connect_list_projects(%s)", h(n1)); self.runner().one("select connect_list_projects(%s)", h(n2))
        # ONCE per spent token: a SECOND repeat inside the 60 s is reuse, refused, and it kills the family (no parallel chain can grow from a replay)
        n3, r3 = uuid.uuid4().hex, uuid.uuid4().hex
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n3), h(r3)), {"error": "invalid_grant"})
        self.runner(); self.fails("select connect_list_projects(%s)", h(n1), code="PT401"); self.runner(); self.fails("select connect_list_projects(%s)", h(n2), code="PT401")
        self.runner(); self.fails("select connect_list_projects(%s)", h(n3), code="PT401")
        client, a, ref = self.connect(ALICE)           # a new connection to carry on with the remaining checks
        n1, r1 = uuid.uuid4().hex, uuid.uuid4().hex
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n1), h(r1))
        n2, r2 = uuid.uuid4().hex, uuid.uuid4().hex
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n2), h(r2))          # its one grace
        # the grace never reaches past 60 s: aged, the same token is reuse and kills the family (both pairs)
        self.db.as_(None).c.execute("update public.connect_tokens set refresh_used_at = now() - interval '61 seconds' where refresh_hash = %s", (h(ref),))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("7" * 64), h("8" * 64)), bad)
        self.runner(); self.fails("select connect_list_projects(%s)", h(n1), code="PT401"); self.runner(); self.fails("select connect_list_projects(%s)", h(n2), code="PT401")
        # once the family is dead the grace does not come back, even for a token spent a second ago
        self.db.as_(None).c.execute("update public.connect_tokens set refresh_used_at = now() where refresh_hash = %s", (h(ref),))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("9" * 64), h("a" * 64)), bad)
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(r1), client, h("b" * 64), h("c" * 64)), bad)
        # a killed family gets no grace even though this token has not used its one retry: a child row revoked without having been rotated is the kill marker
        client4, a4, ref4 = self.connect(ALICE)
        n4, r4 = uuid.uuid4().hex, uuid.uuid4().hex
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref4), client4, h(n4), h(r4))
        self.db.as_(None).c.execute("update public.connect_tokens set revoked_at = now() where refresh_hash = %s", (h(r4),))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref4), client4, h("5" * 64), h("6" * 64)), bad)
        # the grace still needs the right client, a live grant and an enabled person
        client2, a2, ref2 = self.connect(ALICE)
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref2), client2, h("d" * 64), h("e" * 64))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref2), "rgc_not_this_client", h("f" * 64), h("0" * 64)), bad)
        self.db.as_(None).c.execute("update public.connect_grants set revoked_at = now() where client_id = %s", (client2,))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref2), client2, h("1" * 64), h("2" * 64)), bad)
        # UNUSED for 30 days: the refresh token has expired and the connection is over
        client3, a3, ref3 = self.connect(ALICE)
        self.db.as_(None).c.execute("update public.connect_tokens set refresh_expires_at = now() - interval '1 second' where refresh_hash = %s", (h(ref3),))
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref3), client3, h("3" * 64), h("4" * 64)), bad)

    def test_refresh_needs_the_same_client_and_a_live_grant(self):
        client, a, ref = self.connect(ALICE)
        other = self.register()
        r = self.runner()
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), other, h("7" * 64), h("8" * 64)), {"error": "invalid_grant"})

    def test_revoke_kills_the_family_and_disconnect_does_too(self):
        client, a, ref = self.connect(ALICE)
        r = self.runner()
        r.one("select connect_list_projects(%s)", h(a))
        r.one("select connect_revoke(%s)", h(ref))
        self.fails("select connect_list_projects(%s)", h(a), code="PT401")
        client2, a2, ref2 = self.connect(ALICE)            # a second client; revoking the first one's tokens left its grant
        self.assertEqual(len(self.app(ALICE).all("select * from my_connected_ais()")), 2)
        self.app(ALICE).one("select disconnect_ai(%s)", client2)
        self.assertEqual([r_[0] for r_ in self.app(ALICE).all("select client_id from my_connected_ais()")], [client])
        self.runner()
        self.fails("select connect_list_projects(%s)", h(a2), code="PT401")                 # ... at once
        self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref2), client2, h("9" * 64), h("a" * 64)), {"error": "invalid_grant"})

    # ---------------------------------------------------------------------------------- consent and settings functions
    def test_consent_functions_refuse_a_token_with_a_client_id_and_anyone_else(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        claims = '{"sub": "%s", "role": "authenticated", "client_id": "some-oauth-client"}' % ALICE
        for sql in ("select connect_consent_check(%s)", "select connect_consent_decide(%s, true, array['read'])"):
            self.app(ALICE, claims); self.fails(sql, req, code="42501")
        self.app(ALICE, claims); self.fails("select * from my_connected_ais()", code="42501")
        self.app(ALICE, claims); self.fails("select disconnect_ai(%s)", client, code="42501")
        self.db.as_("anon"); self.fails("select connect_consent_check(%s)", req)
        self.db.as_(ALICE).c.execute("select set_config('request.jwt.claims', '', false)")
        # the runner cannot call them; an app session cannot call the tool or AS functions
        self.runner(); self.fails("select connect_consent_check(%s)", req)
        self.app(ALICE); self.fails("select connect_whoami(%s)", "0" * 64)
        self.app(ALICE); self.fails("select connect_register_client('x', array[%s])", URI)
        self.app(ALICE); self.fails("select connect_purge()")
        self.runner(); self.fails("select connect_purge()")

    def test_not_invited_people_cannot_consent(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        chk = self.app(NOBODY).one("select connect_consent_check(%s)", req)
        self.assertFalse(chk["allowed"]); self.assertFalse(chk["invited"]); self.assertIn("invite", chk["reason"])
        self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")

    def test_deny_returns_access_denied_and_issues_nothing(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'xyz',%s,'S256','read',null)", client, URI, s256(VER))
        url = self.app(ALICE).one("select connect_consent_decide(%s, false, null)", req)["redirect_to"]
        self.assertEqual(url, URI + "?error=access_denied&state=xyz")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_codes"), 0)
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_grants"), 0)

    def test_scopes_the_person_unticks_are_not_granted(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read write render_free',null)", client, URI, s256(VER))
        self.app(ALICE).one("select connect_consent_decide(%s, true, array['read','render_final','admin'])", req)
        self.assertEqual(self.db.as_(None).one("select scopes from public.connect_grants"), ["read"])      # only an offered, requested scope
        req2 = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        self.app(ALICE)
        self.fails("select connect_consent_decide(%s, true, array['write'])", req2, code="22023")           # nothing valid ticked

    def test_admin_functions_are_for_admins(self):
        d = self.app(ALICE)
        self.fails("select admin_set_connect_access('bob@x', true)", code="42501")
        self.fails("select admin_connect_allowlist_set('https://x.example/cb', 'exact', 'x', true)", code="42501")
        self.app(ADMIN).one("select admin_connect_allowlist_set('https://chatgpt.com/connector_platform_oauth_redirect', 'exact', 'chatgpt', true)")
        self.app(ADMIN).one("select admin_set_connect_access('nobody@x', true)")
        self.assertTrue(self.db.as_(None).one("select enabled from public.connect_access where user_id = %s", NOBODY))
        self.fails_as(ADMIN, "select admin_set_connect_access('admin@x', true)", "42501")             # never an admin
        _, a, _ = self.connect(ALICE)
        self.app(ADMIN).one("select admin_set_connect_access('alice@x', false)")
        self.runner(); self.fails("select connect_whoami(%s)", h(a), code="PT401")                      # disabling revokes her tokens

    def fails_as(self, who, sql, code):
        self.app(who)
        self.fails(sql, code=code)

    # ------------------------------------------------------------------------ review E3/E5/S1 and the LOWs
    def test_free_means_free_a_job_that_would_cost_credits_is_refused_in_sql(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        pid = r.one("select connect_create_project(%s, 'Costs')", h(a))["id"]
        vid = r.one("select connect_current_version(%s, %s)", h(a), pid)
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, STORY)
        d = self.db.as_(None)
        # a priced database: install a quote that says the next preview costs credits
        self.db.as_(None).c.execute("""create or replace function public.credit_quote(p_version_id uuid, p_job_type public.job_type)
                       returns table (price_code text, credits int, free_preview boolean, available int)
                       language sql as $$ select 'preview_extra'::text, 3, false, 10 $$""")
        e = self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}', code="42501")
        self.assertIn("would cost credits", str(e))
        self.assertEqual(self.db.as_(None).one("select count(*) from public.jobs"), 0)
        self.db.as_(None).c.execute("""create or replace function public.credit_quote(p_version_id uuid, p_job_type public.job_type)
                       returns table (price_code text, credits int, free_preview boolean, available int)
                       language sql as $$ select 'preview_free'::text, 0, true, 10 $$""")
        self.assertEqual(self.runner().one("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}')["state"], "queued")

    def test_a_charge_that_appears_between_the_quote_and_the_job_is_refused_and_rolled_back(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        pid = r.one("select connect_create_project(%s, 'Race')", h(a))["id"]
        vid = r.one("select connect_current_version(%s, %s)", h(a), pid)
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, STORY)
        d = self.db.as_(None)
        # the quote the connection sees says free ...
        d.c.execute("""create or replace function public.credit_quote(p_version_id uuid, p_job_type public.job_type)
                       returns table (price_code text, credits int, free_preview boolean, available int)
                       language sql as $$ select 'preview_free'::text, 0, true, 10 $$""")
        # ... but by the time the job is inserted the app's own pricing has changed its mind (another call took the last free preview):
        # the job row is stamped with a charge. Model that with a trigger standing in for the ledger's jobs_quote.
        self.db.as_(None).c.execute("alter table public.jobs add column if not exists credits_quoted int")
        self.db.as_(None).c.execute("""create function public.test_race_stamp() returns trigger language plpgsql as $$
                                       begin new.credits_quoted := 1; return new; end $$""")
        self.db.as_(None).c.execute("create trigger test_race before insert on public.jobs for each row execute function public.test_race_stamp()")
        e = self.fails("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}', code="42501")
        self.assertIn("would cost credits", str(e))
        self.assertEqual(self.db.as_(None).one("select count(*) from public.jobs"), 0)          # the insert was rolled back with the refusal
        self.db.as_(None).c.execute("drop trigger test_race on public.jobs")
        self.db.as_(None).c.execute("""create function public.test_race_stamp0() returns trigger language plpgsql as $$
                                       begin new.credits_quoted := 0; return new; end $$""")
        self.db.as_(None).c.execute("create trigger test_race before insert on public.jobs for each row execute function public.test_race_stamp0()")
        self.assertEqual(self.runner().one("select connect_submit_job(%s, %s, 'preview', %s::jsonb, null, null)", h(a), vid, '{"window_s": [0, 5]}')["state"], "queued")

    def test_consent_shows_the_label_ryan_controls_and_refuses_hostile_client_names(self):
        for bad in ("Cla\u202eude", "Claude\u200b", "Cla\nude", "x" * 81, ""):
            self.fails("select connect_register_client(%s, array[%s])", bad, URI, code="PT400")
        c = self.runner().one("select connect_register_client('Claude', array[%s, 'http://localhost:9/cb'])", URI)
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", c, URI, s256(VER))
        chk = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertEqual(chk["redirect_label"], "claude")                                          # the allowlist label, not what the client calls itself
        req2 = self.runner().one("select connect_begin_authorization(%s,'http://localhost:9/cb','s',%s,'S256','read',null)", c, s256(VER))
        self.assertEqual(self.app(ALICE).one("select connect_consent_check(%s)", req2)["redirect_label"], "A program on this computer")

    def test_a_null_client_never_skips_the_client_binding(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        code = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"].split("code=")[1].split("&")[0]
        r = self.runner()
        self.assertEqual(r.one("select connect_exchange_code(%s,null,%s,%s,%s,%s)", h(code), URI, VER, h("a" * 20), h("b" * 20)), {"error": "invalid_grant"})
        _, a, ref = self.connect(ALICE)
        self.assertEqual(r.one("select connect_refresh(%s,null,%s,%s)", h(ref), h("c" * 20), h("d" * 20)), {"error": "invalid_grant"})

    def test_a_failed_exchange_burns_the_code(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        code = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"].split("code=")[1].split("&")[0]
        r = self.runner()
        self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, "w" * 43, h("a" * 20), h("b" * 20)), {"error": "invalid_grant"})
        # the right verifier no longer works: the code was spent by the failed attempt
        self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h("a" * 20), h("b" * 20)), {"error": "invalid_grant"})

    def test_exchange_and_refresh_re_check_the_person_and_the_grant_and_refresh_expires(self):
        d = self.db.as_(None)
        for kind in ("grant", "person"):
            client = self.register()
            req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
            code = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"].split("code=")[1].split("&")[0]
            if kind == "grant":
                self.db.as_(None).c.execute("update public.connect_grants set revoked_at = now() where client_id = %s", (client,))
            else:
                self.db.as_(None).c.execute("update public.connect_access set enabled = false where user_id = %s", (ALICE,))
            self.assertEqual(self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h(kind + "a" * 20), h(kind + "b" * 20)), {"error": "invalid_grant"}, kind)
            self.db.as_(None).c.execute("update public.connect_access set enabled = true where user_id = %s", (ALICE,))
        for kind in ("grant", "person", "expired"):
            client, a, ref = self.connect(ALICE)
            if kind == "grant":
                d.as_(None).c.execute("update public.connect_grants set revoked_at = now() where client_id = %s", (client,))
            elif kind == "person":
                d.as_(None).c.execute("update public.connect_access set enabled = false where user_id = %s", (ALICE,))
            else:
                d.as_(None).c.execute("update public.connect_tokens set refresh_expires_at = now() - interval '1 second' where refresh_hash = %s", (h(ref),))
            self.assertEqual(self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(kind + "c" * 20), h(kind + "d" * 20)), {"error": "invalid_grant"}, kind)
            d.as_(None).c.execute("update public.connect_access set enabled = true where user_id = %s", (ALICE,))

    def test_consent_request_expiry_and_a_redirect_no_longer_on_the_list(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        d = self.db.as_(None)
        self.db.as_(None).c.execute("update public.connect_requests set expires_at = now() - interval '1 second'")
        chk = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertFalse(chk["allowed"]); self.assertIn("expired", chk["reason"])
        self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")
        req2 = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        d.as_(None).c.execute("update public.connect_redirect_allowlist set enabled = false where redirect_uri = %s", (URI,))
        chk2 = self.app(ALICE).one("select connect_consent_check(%s)", req2)
        self.assertFalse(chk2["allowed"]); self.assertIn("allowed list", chk2["reason"])
        self.app(ALICE)
        self.fails("select connect_consent_decide(%s, false, null)", req2, code="42501")             # even a DENY does not redirect to an address that is off the list

    def test_version_functions_do_not_cross_owners(self):
        _, a, _ = self.connect(ALICE); _, b, _ = self.connect(BOB)
        r = self.runner()
        pa = r.one("select connect_create_project(%s, 'A')", h(a))["id"]
        va = r.one("select connect_current_version(%s, %s)", h(a), pa)
        self.assertEqual(r.one("select connect_list_versions(%s, %s)", h(b), pa), [])
        self.fails("select connect_create_version(%s, %s, %s)", h(b), pa, va, code="PT404")
        self.assertEqual(len(r.one("select connect_list_versions(%s, %s)", h(a), pa)), 1)

    def test_per_client_and_per_caller_buckets_and_the_open_request_cap(self):
        c1, a1, _ = self.connect(ALICE); c2, a2, _ = self.connect(ALICE)           # one person, two clients
        r = self.runner()
        for _ in range(3): r.one("select connect_hit(%s, 'calls', 3, 60)", h(a1))
        self.assertFalse(r.one("select connect_hit(%s, 'calls', 3, 60)", h(a1)))
        self.assertTrue(r.one("select connect_hit(%s, 'calls', 3, 60)", h(a2)))      # the second client has its own per-minute allowance
        caller = h("203.0.113.9")
        for _ in range(2): self.assertTrue(r.one("select connect_anon_hit(%s, 'register', 2, 3600)", caller))
        self.assertFalse(r.one("select connect_anon_hit(%s, 'register', 2, 3600)", caller))
        self.assertTrue(r.one("select connect_anon_hit(%s, 'register', 2, 3600)", h("198.51.100.4")))
        self.fails("select connect_anon_hit('not-a-hash', 'register', 2, 3600)", code="22023")
        client = self.register()
        for _ in range(20): r.one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        self.fails("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER), code="PT429")

    def test_scope_defaults_to_the_least_and_admin_and_worker_accounts_are_out(self):
        client = self.register()
        for asked in (None, "", "gibberish admin", "openid"):
            req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256',%s,null)", client, URI, s256(VER), asked)
            self.assertEqual(self.db.as_(None).one("select scopes from public.connect_requests where id = %s", req), ["read"], repr(asked))
        d = self.db.as_(None)
        self.db.as_(None).c.execute("insert into public.workers (user_id, name) values (%s, 'w')", (NOBODY,))
        self.db.as_(None).c.execute("insert into public.connect_access (user_id) values (%s)", (NOBODY,))
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        self.app(NOBODY)
        self.fails("select connect_consent_check(%s)", req, code="42501")                  # the 2A rule already refuses a worker login everywhere
        self.assertFalse(self.db.as_(None).one("select ryagram_private.connect_person_ok(%s)", NOBODY))   # ... and a token of one would be refused too

    def test_admin_functions_refuse_a_token_with_a_client_id(self):
        claims = '{"sub": "%s", "role": "authenticated", "client_id": "x"}' % ADMIN
        self.app(ADMIN, claims)
        self.fails("select admin_set_connect_access('bob@x', true)", code="42501")
        self.app(ADMIN, claims)
        self.fails("select admin_connect_allowlist_set('https://x.example/cb', 'exact', 'x', true)", code="42501")

    def test_connect_actor_sets_every_claim_form_for_one_transaction_only(self):
        _, a, _ = self.connect(ALICE)
        self.runner().one("select connect_whoami(%s)", h(a))
        for key in ("request.jwt.claim.sub", "request.jwt.claim.role", "request.jwt.claim", "request.jwt.claims"):
            self.assertIn(self.runner().one("select coalesce(current_setting(%s, true), '')", key), ("", None), key)

    def test_purge_keeps_rotated_refresh_rows_until_expiry_and_removes_unused_clients(self):
        client, a, ref = self.connect(ALICE)
        d = self.db.as_(None)
        n_acc, n_ref = uuid.uuid4().hex, uuid.uuid4().hex
        self.runner().one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h(n_acc), h(n_ref))     # rotates: the old row is revoked
        d.as_(None).c.execute("update public.connect_tokens set revoked_at = now() - interval '9 days' where refresh_hash = %s", (h(ref),))
        stale = self.register()
        self.db.as_(None).c.execute("update public.connect_clients set created_at = now() - interval '9 days' where client_id = %s", (stale,))
        self.db.as_(None).one("select connect_purge()")
        self.assertEqual(d.one("select count(*) from public.connect_tokens where refresh_hash = %s", h(ref)), 1)    # still there: reuse stays detectable
        self.assertEqual(d.one("select count(*) from public.connect_clients where client_id = %s", stale), 0)
        self.assertEqual(d.one("select count(*) from public.connect_clients where client_id = %s", client), 1)    # a client with a grant is kept

    def test_every_published_table_is_guarded_and_a_table_published_later_is_flagged_then_repaired(self):
        admin = lambda sql, *a: self.db.as_(None).one(sql, *a)
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables()"), [])      # the migration guarded jobs and versions
        pubs = {r[0] for r in self.db.as_(None).all("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")}
        self.assertTrue({"jobs", "versions"} <= pubs)
        # behaviour: the app session still sees its own job rows; a JWT carrying client_id sees none (Realtime evaluates the same row security)
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        pid = r.one("select connect_create_project(%s, 'Realtime')", h(a))["id"]
        vid = r.one("select connect_current_version(%s, %s)", h(a), pid)
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(a), vid, STORY)
        r.one("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", h(a), vid)
        self.assertEqual(self.app(ALICE).one("select count(*) from public.jobs"), 1)
        self.app(ALICE, '{"sub": "%s", "role": "authenticated", "client_id": "some-oauth-client"}' % ALICE)
        self.assertEqual(self.db.one("select count(*) from public.jobs"), 0)
        self.assertEqual(self.db.one("select count(*) from public.versions"), 0)
        # a table published later without the policy is listed ...
        self.db.as_(None).c.execute("create table public.late_published (id int primary key, owner_id uuid)")
        self.db.as_(None).c.execute("alter table public.late_published enable row level security")
        self.db.as_(None).c.execute("alter publication supabase_realtime add table public.late_published")
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables()"), [("public", "late_published")])
        # ... and the repair guards it, once
        self.assertEqual(admin("select ryagram_private.connect_guard_published_tables()"), 1)
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables()"), [])
        self.assertEqual(admin("select ryagram_private.connect_guard_published_tables()"), 0)
        # every guard policy is RESTRICTIVE (a permissive one only adds access, so it would guard nothing) ...
        self.assertEqual(admin("select count(*) from pg_policy where polname = 'connect_no_oauth_select' and polpermissive"), 0)
        self.assertGreaterEqual(admin("select count(*) from pg_policy where polname = 'connect_no_oauth_select' and not polpermissive"), 3)
        # ... and a look-alike: a PERMISSIVE policy with the same name does not count as a guard, so the table is still listed (and repaired)
        c = self.db.as_(None).c
        c.execute("create table public.lookalike (id int primary key, owner_id uuid)")
        c.execute("alter table public.lookalike enable row level security")
        c.execute("create policy connect_no_oauth_select on public.lookalike as permissive for select to authenticated using ((select auth.jwt() ->> 'client_id') is null)")
        c.execute("alter publication supabase_realtime add table public.lookalike")
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables()"), [("public", "lookalike")])
        self.assertEqual(admin("select ryagram_private.connect_guard_published_tables()"), 1)
        self.assertEqual(admin("select count(*) from pg_policy where polname = 'connect_no_oauth_select' and polpermissive"), 0)
        # a restrictive policy of that name that does NOT test client_id (using true), or that is for another role, is no guard either
        c.execute("create table public.weak1 (id int primary key)")
        c.execute("alter table public.weak1 enable row level security")
        c.execute("create policy connect_no_oauth_select on public.weak1 as restrictive for select to authenticated using (true)")
        c.execute("alter publication supabase_realtime add table public.weak1")
        c.execute("create table public.weak2 (id int primary key)")
        c.execute("alter table public.weak2 enable row level security")
        c.execute("create policy connect_no_oauth_select on public.weak2 as restrictive for select to anon using ((select auth.jwt() ->> 'client_id') is null)")
        c.execute("alter publication supabase_realtime add table public.weak2")
        c.execute("create table public.weak3 (id int primary key)")
        c.execute("alter table public.weak3 enable row level security")
        c.execute("create policy connect_no_oauth_select on public.weak3 as restrictive for select to authenticated using (((select auth.jwt() ->> 'client_id') is null) or true)")
        c.execute("alter publication supabase_realtime add table public.weak3")
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables() order by 2"), [("public", "weak1"), ("public", "weak2"), ("public", "weak3")])
        self.assertEqual(admin("select ryagram_private.connect_guard_published_tables()"), 3)
        # after the repair every guard policy is the one exact expression
        self.assertEqual(admin("select count(distinct regexp_replace(lower(pg_get_expr(polqual, polrelid)), '\\s|\\(|\\)|::text', '', 'g')) from pg_policy where polname = 'connect_no_oauth_select'"), 1)
        self.assertEqual(self.db.as_(None).all("select * from ryagram_private.connect_unguarded_published_tables()"), [])
        # the runner and the app roles cannot call the guard functions
        self.runner(); self.fails("select ryagram_private.connect_guard_published_tables()")
        self.app(ALICE); self.fails("select * from ryagram_private.connect_unguarded_published_tables()")

    def test_rfc_9207_the_issuer_is_added_to_both_redirects_and_must_be_an_https_address(self):
        client = self.register()
        iss = "https://ref.supabase.co/functions/v1/connect"
        req = self.runner().one("select connect_begin_authorization(%s,%s,'st',%s,'S256','read',null,%s)", client, URI, s256(VER), iss)
        url = self.app(ALICE).one("select connect_consent_decide(%s, true, array['read'])", req)["redirect_to"]
        self.assertTrue(url.startswith(URI + "?code="))
        self.assertTrue(url.endswith("&state=st&iss=https%3A%2F%2Fref.supabase.co%2Ffunctions%2Fv1%2Fconnect"), url)
        req2 = self.runner().one("select connect_begin_authorization(%s,%s,'st',%s,'S256','read',null,%s)", client, URI, s256(VER), iss)
        deny = self.app(ALICE).one("select connect_consent_decide(%s, false, null)", req2)["redirect_to"]
        self.assertEqual(deny, URI + "?error=access_denied&state=st&iss=https%3A%2F%2Fref.supabase.co%2Ffunctions%2Fv1%2Fconnect")
        for bad in ("http://ref.supabase.co/x", "https://a b.example/", "javascript:alert(1)", "https://x/" + "a" * 300):
            self.runner(); self.fails("select connect_begin_authorization(%s,%s,'st',%s,'S256','read',null,%s)", client, URI, s256(VER), bad)

    def test_the_master_switch_turns_everything_off_at_once_and_back_on(self):
        client, a, ref = self.connect(ALICE)
        r = self.runner()
        r.one("select connect_whoami(%s)", h(a))
        req = r.one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        # a non-admin cannot flip it; an admin can, but not with a client_id token
        self.app(ALICE); self.fails("select admin_connect_set_enabled(false)", code="42501")
        self.app(ADMIN, '{"sub": "%s", "role": "authenticated", "client_id": "x"}' % ADMIN); self.fails("select admin_connect_set_enabled(false)", code="42501")
        self.app(ADMIN).one("select admin_connect_set_enabled(false)")
        r = self.runner()
        self.assertIsNone(r.one("select connect_scopes(%s)", h(a)))
        self.fails("select connect_whoami(%s)", h(a), code="PT403")
        self.fails("select connect_list_projects(%s)", h(a), code="PT403")
        self.fails("select connect_register_client('Claude', array[%s])", URI, code="PT400")
        self.fails("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER), code="PT400")
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("1" * 20), h("2" * 20)), {"error": "invalid_grant"})
        chk = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertFalse(chk["allowed"]); self.assertIn("switched off", chk["reason"])
        self.app(ALICE); self.fails("select connect_consent_decide(%s, true, array['read'])", req, code="42501")
        # the refresh above did not spend the refresh token (it was refused before looking), so switching on restores everything
        self.app(ADMIN).one("select admin_connect_set_enabled(true)")
        r = self.runner()
        self.assertEqual(r.one("select connect_scopes(%s)", h(a)), ["read", "write", "render_free"])
        r.one("select connect_whoami(%s)", h(a))

    def test_revoke_all_ends_every_token_and_grant(self):
        _, a, _ = self.connect(ALICE); _, b, _ = self.connect(BOB)
        self.app(ALICE); self.fails("select admin_connect_revoke_all()", code="42501")
        n = self.app(ADMIN).one("select admin_connect_revoke_all()")
        self.assertEqual(n, 2)
        self.runner()
        for tok in (a, b): self.fails("select connect_whoami(%s)", h(tok), code="PT401")
        self.assertEqual(self.db.as_(None).one("select count(*) from public.connect_grants where revoked_at is null"), 0)

    def test_a_sign_in_request_lives_30_minutes_and_the_page_is_told_when_it_ends(self):
        client = self.register()
        req = self.runner().one("select connect_begin_authorization(%s,%s,'s',%s,'S256','read',null)", client, URI, s256(VER))
        life = self.db.as_(None).one("select expires_at - created_at from public.connect_requests where id = %s", req)
        import datetime
        self.assertEqual(life, datetime.timedelta(minutes=30))              # Ryan's real reading of the consent page outlasted 10 minutes
        chk = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertTrue(chk["allowed"]); self.assertIsNotNone(chk["expires_at"])     # the page can show a countdown or warn before it ends
        # past 30 minutes it is gone, with the plain sentence the page shows
        self.db.as_(None).c.execute("update public.connect_requests set expires_at = now() - interval '1 second' where id = %s", (req,))
        late = self.app(ALICE).one("select connect_consent_check(%s)", req)
        self.assertFalse(late["allowed"]); self.assertEqual(late["reason"], "This sign-in request has expired. Start again from your assistant.")

    # ---------------------------------------------------------------------------------- ENGINE's profiles through the connect functions
    SPEC = '{"profile_version": 1, "name": "my-look", "title": "My look"}'

    def test_profile_functions_are_the_apps_rules_for_the_persons_own_data(self):
        _, a, _ = self.connect(ALICE); _, b, _ = self.connect(BOB)
        r = self.runner()
        self.assertEqual(r.one("select connect_list_profiles(%s)", h(a)), [])
        self.assertIsNone(r.one("select connect_get_profile(%s, null)", h(a)))
        self.assertEqual(r.one("select connect_set_profile(%s, %s::jsonb, true)", h(a), self.SPEC), {"name": "my-look"})
        listed = r.one("select connect_list_profiles(%s)", h(a))
        self.assertEqual([(p["name"], p["is_default"]) for p in listed], [("my-look", True)])
        got = r.one("select connect_get_profile(%s, null)", h(a))
        self.assertEqual(got["spec"]["title"], "My look"); self.assertTrue(got["is_default"])
        self.assertEqual(r.one("select connect_get_profile(%s, 'my-look')", h(a))["spec"]["name"], "my-look")
        self.assertIsNone(r.one("select connect_get_profile(%s, 'nobody-has-this')", h(a)))
        self.assertIsNone(r.one("select connect_get_profile(%s, '../etc')", h(a)))                     # a malformed name is just absent
        self.assertEqual(r.one("select connect_list_profiles(%s)", h(b)), [])                         # Bob sees none of Alice's
        self.assertIsNone(r.one("select connect_get_profile(%s, 'my-look')", h(b)))

    def test_profile_save_is_the_engines_own_check_and_needs_the_write_scope(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        for bad in ('{"profile_version": 1, "name": "x", "data": {"rows": [1]}}', '{"profile_version": 2, "name": "x"}', '{"profile_version": 1}', '[]'):
            self.fails("select connect_set_profile(%s, %s::jsonb, false)", h(a), bad, code="22023")      # a field the profile does not have, a wrong version, no name, not an object
        for i in range(20):
            r.one("select connect_set_profile(%s, %s::jsonb, false)", h(a), '{"profile_version": 1, "name": "p%s"}' % i)
        self.fails("select connect_set_profile(%s, %s::jsonb, false)", h(a), '{"profile_version": 1, "name": "one-too-many"}', code="54000")
        _, ro, _ = self.connect(BOB, scopes=("read",))
        self.fails("select connect_set_profile(%s, %s::jsonb, false)", h(ro), self.SPEC, code="PT403")
        self.fails("select connect_profile_sample_preview(%s, '{}'::jsonb, array['2011','2015','2020'])", h(ro), code="PT403")

    def test_profile_sample_preview_makes_one_project_one_sheet_and_never_a_second(self):
        _, a, _ = self.connect(ALICE)
        r = self.runner()
        story = '{"schema": 1, "engine": "sequence", "name": "sample", "sequence": {}}'
        first = r.one("select connect_profile_sample_preview(%s, %s::jsonb, array['2011','2015','2020'])", h(a), story)
        again = r.one("select connect_profile_sample_preview(%s, %s::jsonb, array['2011','2015','2020'])", h(a), story)
        self.assertEqual(first["job_id"], again["job_id"]); self.assertEqual(first["project_id"], again["project_id"])
        d = self.db.as_(None)
        self.assertEqual(d.one("select count(*) from public.projects where title = 'Profile preview (sample)'"), 1)
        self.assertEqual(d.one("select count(*) from public.jobs"), 1)
        self.assertEqual(d.one("select job_type::text from public.jobs"), "contact_sheet")
        self.fails("select connect_profile_sample_preview(%s, '[]'::jsonb, array['2011','2015','2020'])", h(a), code="22023")
        # once the sheet is finished the next preview works on a new version, and a costing job would be refused like any other
        d.c.execute("update public.jobs set state = 'complete'")
        d.c.execute("update public.versions set state = 'complete'")
        third = self.runner().one("select connect_profile_sample_preview(%s, %s::jsonb, array['2011','2015','2020'])", h(a), story)
        self.assertNotEqual(third["job_id"], first["job_id"])
        self.assertEqual(self.db.as_(None).one("select max(number) from public.versions"), 2)

    def test_profile_functions_refuse_when_switched_off_and_for_an_unknown_token(self):
        _, a, _ = self.connect(ALICE)
        for sql in ("select connect_list_profiles(%s)", "select connect_get_profile(%s, null)"):
            self.runner(); self.fails(sql, "0" * 64, code="PT401")
        self.db.as_(None).c.execute("update public.connect_flags set connections_enabled = false")
        self.runner(); self.fails("select connect_list_profiles(%s)", h(a), code="PT403")

    def test_purge_removes_old_rows_only(self):
        _, a, _ = self.connect(ALICE)
        d = self.db.as_(None)
        self.db.as_(None).c.execute("insert into public.connect_calls (at, tool, result, code) values (now() - interval '40 days', 'x', 'ok', 'ok'), (now(), 'y', 'ok', 'ok')")
        out = d.one("select connect_purge()")
        self.assertEqual(out["calls"], 1)
        self.assertEqual(d.one("select count(*) from public.connect_calls"), 1)
        self.runner().one("select connect_whoami(%s)", h(a))



# Everything connect_runner may CALL, exactly. A function is callable only with EXECUTE and USAGE on its schema, so this is computed over
# every schema the role has USAGE on (pg_catalog and information_schema hold the built-ins every role has, set_config among them).
EXPECTED_CALLABLE = ['connect_anon_hit(text, text, integer, integer)', 'connect_begin_authorization(text, text, text, text, text, text, text, text)', 'connect_create_project(text, text)', 'connect_create_version(text, uuid, uuid)', 'connect_current_engine(text)', 'connect_current_version(text, uuid)', 'connect_exchange_code(text, text, text, text, text, text)', 'connect_final_enabled()', 'connect_get_version(text, uuid)', 'connect_hit(text, text, integer, integer)', 'connect_job(text, uuid)', 'connect_list_projects(text)', 'connect_list_versions(text, uuid)', 'connect_log(text, text, integer, text, text, integer)', 'connect_quote(text, uuid, text)', 'connect_refresh(text, text, text, text)', 'connect_register_client(text, text[])', 'connect_revoke(text)', 'connect_save_story(text, uuid, jsonb)', 'connect_scopes(text)', 'connect_submit_job(text, uuid, text, jsonb, uuid, uuid)', 'connect_whoami(text)', 'connect_list_profiles(text)', 'connect_get_profile(text, text)', 'connect_set_profile(text, jsonb, boolean)',
 'connect_profile_sample_preview(text, jsonb, text[])']


def callable_by_runner(d):
    rows = d.all("""select p.oid::regprocedure::text
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE')
                      and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
                      and n.nspname not in ('pg_catalog', 'information_schema')""")
    # regprocedure leaves the schema off when it is on the search path, so put it back
    return sorted(r[0] if "." in r[0].split("(")[0] else "public." + r[0] for r in rows)


def assert_runner_boundary(t, d):
    """The runner's whole reach, from the catalogs: exact callable functions, no relation privilege anywhere it has usage, no role powers."""
    t.assertEqual(callable_by_runner(d), sorted("public." + f.replace(", ", ",") for f in EXPECTED_CALLABLE))
    usage = [r[0] for r in d.all("select nspname from pg_namespace n where has_schema_privilege('connect_runner', n.oid, 'USAGE') "
                                 "and left(nspname, 3) <> 'pg_' and nspname <> 'information_schema'")]
    t.assertEqual(usage, ["public"], "connect_runner may use only the public schema")
    rels = d.all("""select n.nspname || '.' || c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f') and n.nspname not in ('pg_catalog', 'information_schema')""")
    leaks = [name for name, kind in rels
             if d.one("select has_sequence_privilege('connect_runner', %s::regclass, 'usage,select,update')" if kind == "S"
                      else "select has_table_privilege('connect_runner', %s::regclass, 'select,insert,update,delete,truncate,references,trigger')", name)]
    t.assertEqual(leaks, [], "connect_runner has a privilege on a relation")
    flags = d.one("select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolreplication from pg_roles where rolname = 'connect_runner'")
    t.assertFalse(flags)
    t.assertEqual(d.all("select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'connect_runner'"), [])


class RealisticDefaults(core.Base):
    """The same boundary on a database built WITHOUT the stub's strictness: PUBLIC keeps its default EXECUTE on new functions and its
    USAGE on the public schema, as on a real Supabase project (the stub revokes both; CC1 review S2)."""

    def test_the_boundary_holds_under_supabases_default_privileges(self):
        name = "rd" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True)
                 if not l.startswith("create role") and l.strip() not in drop]
        with psycopg.connect(core._server.get_uri(database=name), autocommit=True) as c:
            c.execute("".join(lines))
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            for path in core.MIGRATIONS:
                c.execute(path.read_text(encoding="utf-8"))
            d = core.Db(core._server.get_uri(database=name))
            assert_runner_boundary(self, d)
            # PUBLIC really does hold EXECUTE on the platform-style functions here, which is the point: only the missing USAGE keeps the runner out
            self.assertTrue(c.execute("select has_function_privilege('connect_runner', 'auth.uid()', 'execute')").fetchone()[0])
            self.assertFalse(c.execute("select has_schema_privilege('connect_runner', 'auth', 'usage')").fetchone()[0])
            d.c.close()
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"drop database {name}")



class LiveFiles(core.Base):
    """Every file in supabase/connect-live runs, every result column has a name, and each does what the live plan says it does."""
    DIR = core.ROOT / "connect-live"
    runner, app, register, connect, fails = Connect.runner, Connect.app, Connect.register, Connect.connect, Connect.fails

    def run_file(self, name, db=None):
        d = db or self.db
        d.as_(None)                       # the live files are run by the project owner in the SQL Editor, never as the runner or a person
        c = d.c
        with c.cursor() as cur:
            cur.execute((self.DIR / name).read_text(encoding="utf-8"))
            while cur.nextset():
                pass
            cols = [d.name for d in cur.description] if cur.description else []
            rows = cur.fetchall() if cur.description else []
        return cols, rows

    def setUp(self):
        super().setUp()
        d = self.db.as_(None)
        d.c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'person-one@example.com'),(%s,'person-two@example.com')",
                    (ALICE, BOB, ADMIN, "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2"))
        d.c.execute("insert into public.app_admins (user_id) values (%s), (%s)", (ADMIN, "00000000-0000-0000-0000-0000000000a2"))   # person-two is an admin
        d.c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))
        self.counter = 0

    def test_prerequisite_check_on_a_database_without_connect_and_on_one_with_it(self):
        cols, rows = self.run_file("00_prereq_check.sql")
        self.assertEqual(cols, ["item", "needed_by", "present"])
        by = {r[0]: (r[1], r[2]) for r in rows}
        self.assertTrue(all(present for item, (need, present) in by.items() if need == "required"))
        self.assertTrue(by["connect tables already there (must be false on a first run)"][1])           # this database HAS the migration: the check says so
        # a database that has everything except the connect migration
        name = "lf" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role")]
        with psycopg.connect(core._server.get_uri(database=name), autocommit=True) as c:
            c.execute("".join(lines))
            for path in core.MIGRATIONS:
                if "connect_ai" not in path.name:
                    c.execute(path.read_text(encoding="utf-8"))
            d = core.Db(core._server.get_uri(database=name))
            cols2, rows2 = self.run_file("00_prereq_check.sql", d)
            by2 = {r[0]: (r[1], r[2]) for r in rows2}
            self.assertEqual(cols2, cols)
            self.assertTrue(all(p for it, (n, p) in by2.items() if n == "required"))
            self.assertFalse(by2["connect tables already there (must be false on a first run)"][1])
            self.assertFalse(by2["role connect_runner already there (must be false on a first run)"][1] and False)   # the role is cluster-wide here; the table check is the real one
            d.c.close()
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"drop database {name}")

    def test_after_migration_check_is_all_ok(self):
        cols, rows = self.run_file("01_after_migration_check.sql")
        self.assertEqual(cols, ["check_name", "ok"])
        self.assertGreaterEqual(len(rows), 10)
        bad = [r[0] for r in rows if r[1] is not True]
        self.assertEqual(bad, [])
        # and it would catch a problem: an enabled loopback row, and a table published without the policy
        self.db.as_(None).c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values ('loopback', 'loopback', 'x')")
        _, rows = self.run_file("01_after_migration_check.sql")
        self.assertEqual([r[0] for r in rows if r[1] is not True], ["the redirect allowlist has NO loopback row enabled (live must keep loopback off)"])
        # a PERMISSIVE look-alike guard policy on a published table fails the restrictive row and the published-table row
        c = self.db.as_(None).c
        c.execute("create table public.lookalike2 (id int primary key)")
        c.execute("alter table public.lookalike2 enable row level security")
        c.execute("create policy connect_no_oauth_select on public.lookalike2 as permissive for select to authenticated using ((select auth.jwt() ->> 'client_id') is null)")
        c.execute("alter publication supabase_realtime add table public.lookalike2")
        _, rows = self.run_file("01_after_migration_check.sql")
        bad = {r[0] for r in rows if r[1] is not True}
        # the day someone adds a policy on realtime.messages (a private channel), the check says so
        c.execute("create schema if not exists realtime")
        c.execute("create table realtime.messages (id int primary key, topic text)")
        c.execute("alter table realtime.messages enable row level security")
        _, rows2 = self.run_file("01_after_migration_check.sql")
        self.assertNotIn("realtime.messages has NO policy", " ".join(r[0] for r in rows2 if r[1] is not True))     # a table with no policy passes
        c.execute("create policy private_channels on realtime.messages for select to authenticated using (true)")
        _, rows2 = self.run_file("01_after_migration_check.sql")
        self.assertTrue(any(r[0].startswith("realtime.messages has NO policy") and r[1] is not True for r in rows2))
        self.assertIn("every connect_no_oauth_select policy is RESTRICTIVE (none is permissive) and at least one exists", bad)
        self.assertIn("every published realtime table has the restrictive client_id policy", bad)

    def test_runner_privilege_report_has_named_columns_and_the_exact_functions(self):
        cols, rows = self.run_file("04_runner_privilege_report.sql")
        self.assertEqual(cols, ["kind", "name"])
        self.assertEqual(sum(1 for r in rows if r[0] == "function execute"), 26)
        self.assertEqual([r for r in rows if r[0].startswith("RELATION PRIVILEGE")], [])

    def test_allowlist_file_turns_loopback_off_and_lists_only_exact_addresses(self):
        self.db.as_(None).c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values ('loopback', 'loopback', 'on staging')")
        cols, rows = self.run_file("02_allowlist_live.sql")
        self.assertEqual(cols, ["address", "kind", "shown_to_people_as", "is_on"])
        on = [(r[0], r[1]) for r in rows if r[3]]
        self.assertEqual(sorted(on), sorted([("https://chatgpt.com/connector_platform_oauth_redirect", "exact"), ("https://claude.ai/api/mcp/auth_callback", "exact"),
                                             ("https://claude.com/api/mcp/auth_callback", "exact")]))
        self.assertTrue(all(r[3] is False for r in rows if r[1] == "loopback"))

    def test_invite_file_invites_listed_people_and_refuses_admins(self):
        cols, rows = self.run_file("03_invite_accounts.sql")
        self.assertEqual(cols, ["invited_email", "invited", "since"])
        emails = {r[0] for r in rows}
        self.assertIn("person-one@example.com", emails); self.assertNotIn("person-two@example.com", emails)      # the admin was not invited

    def test_switch_off_on_and_end_all_files(self):
        _, a, _ = self.connect(ALICE)
        self.runner().one("select connect_whoami(%s)", h(a))
        cols, rows = self.run_file("90_switch_off.sql")
        self.assertEqual(cols, ["switch_is_on", "meaning"]); self.assertEqual(rows[0][0], False)
        self.runner(); self.fails("select connect_whoami(%s)", h(a), code="PT403")
        cols, rows = self.run_file("91_switch_on.sql")
        self.assertEqual(rows[0][0], True)
        self.runner().one("select connect_whoami(%s)", h(a))
        cols, rows = self.run_file("98_end_all_connections.sql")
        self.assertEqual(cols, ["live_tokens_left", "live_permissions_left"]); self.assertEqual(rows[0], (0, 0))
        self.runner(); self.fails("select connect_whoami(%s)", h(a), code="PT401")

    def test_rollback_removes_the_connector_and_nothing_of_the_app(self):
        _, a, _ = self.connect(ALICE)
        pid = self.runner().one("select connect_create_project(%s, 'Survives')", h(a))["id"]
        before = self.db.as_(None).one("select count(*) from public.projects")
        cols, rows = self.run_file("99_rollback_remove_everything.sql")
        self.assertEqual(cols, ["connect_tables_left", "connect_functions_left", "runner_role_left"])
        self.assertEqual(rows[0][:2], (0, 0))
        d = self.db.as_(None)
        self.assertEqual(d.one("select count(*) from public.projects"), before)          # the person's project is untouched
        self.assertEqual(d.one("select count(*) from public.jobs"), 0)
        self.assertEqual(d.one("select count(*) from pg_policy where polname = 'connect_no_oauth_select'"), 0)
        self.assertIsNotNone(d.one("select to_regprocedure('public.submit_job(uuid, public.job_type, jsonb, uuid, uuid)')"))   # the app's own functions are intact
        self.assertIsNotNone(d.one("select to_regprocedure('ryagram_private.require_signed_in()')"))


def _kind(d, oid):
    return d.one("select relkind from pg_class where oid = %s", oid)


if __name__ == "__main__":
    unittest.main()
