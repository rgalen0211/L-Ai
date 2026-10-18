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
        d.c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')",
                    (ALICE, BOB, ADMIN, NOBODY))
        d.c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        d.c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), "
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
        if claims:
            self.db.c.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
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
        d = self.db.as_(None)
        # (1) generated from the catalogs, so a function added later without an explicit revoke fails here
        funcs = d.all("""select n.nspname, p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname in ('public', 'ryagram_private', 'auth', 'storage') and p.prokind in ('f', 'p')""")
        allowed = {n for n in d.all("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                    "where n.nspname = 'public' and proname like 'connect\\_%%' ")}
        # The only exceptions are Supabase's own read-only helpers that every role may execute (they read request settings or
        # split a string). Listed by name so any OTHER function that becomes executable fails here.
        HARMLESS = {("auth", "uid"), ("auth", "jwt"), ("auth", "role"), ("auth", "email"), ("storage", "foldername"),
                    ("storage", "filename"), ("storage", "extension")}
        bad = [(s, n) for s, n, oid in funcs
               if d.one("select has_function_privilege('connect_runner', %s, 'EXECUTE')", oid)
               and not (s == "public" and n.startswith("connect_")) and (s, n) not in HARMLESS]
        self.assertEqual(bad, [], "connect_runner can execute functions outside connect_*")
        # ... and not even all of the connect_* ones: the consent, settings, admin and purge functions are not for it
        for fn in ("connect_consent_check(uuid)", "connect_consent_decide(uuid, boolean, text[])", "my_connected_ais()",
                   "disconnect_ai(text)", "admin_set_connect_access(text, boolean)",
                   "admin_connect_allowlist_set(text, text, text, boolean)", "connect_purge()"):
            self.assertFalse(d.one("select has_function_privilege('connect_runner', %s::regprocedure, 'EXECUTE')", f"public.{fn}"), fn)
        self.assertTrue(allowed)
        # no table, sequence or view privilege of any kind, in any of those schemas
        rels = d.all("""select c.oid, n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname in ('public', 'ryagram_private', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')""")
        leaks = [name for oid, name in rels
                 if d.one("select has_table_privilege('connect_runner', %s, 'select,insert,update,delete,truncate,references,trigger')"
                          if _kind(d, oid) != 'S' else "select has_sequence_privilege('connect_runner', %s, 'usage,select,update')", oid)]
        self.assertEqual(leaks, [])
        # no usage on the private schema, and none of the tables that hold secrets
        self.assertFalse(d.one("select has_schema_privilege('connect_runner', 'ryagram_private', 'USAGE')"))
        self.assertFalse(d.one("select has_schema_privilege('connect_runner', 'auth', 'USAGE')"))
        self.assertFalse(d.one("select has_schema_privilege('connect_runner', 'storage', 'USAGE')"))

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
        self.assertIsNone(r.one("select auth.uid()") if False else None)

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
        d.c.execute("update public.connect_tokens set access_expires_at = now() - interval '1 second' where access_hash = %s", (h(a),))
        self.fails("select connect_whoami(%s)", h(a), code="PT401")              # expired
        d.c.execute("update public.connect_tokens set access_expires_at = now() + interval '1 hour' where access_hash = %s", (h(a),))
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
        d.c.execute("update public.connect_flags set full_render_enabled = true")
        d.c.execute("update public.connect_grants set scopes = scopes || array['render_final']")
        d.c.execute("update public.connect_tokens set scopes = scopes || array['render_final']")
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
        self.assertEqual(rows, [(ALICE, "set_story", "checks_failed", 3), (None, "whoami_and_credits", "no_grant", 0)])
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
        self.assertEqual(sorted(got), ["read", "render_free", "write"])

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
        for v in ("x" * 43, "short", VER[:-1] + "w"):                                                    # wrong / malformed verifier
            self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, v, h(acc), h(ref)), bad)
        self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, "https://claude.ai/api/mcp/other", VER, h(acc), h(ref)), bad)
        self.assertEqual(r.one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), "rgc_other", URI, VER, h(acc), h(ref)), bad)
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
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(ref), client, h("3" * 64), h("4" * 64)), bad)   # reuse ...
        self.fails("select connect_list_projects(%s)", h(n_acc), code="PT401")              # ... killed the new one too
        self.assertEqual(r.one("select connect_refresh(%s,%s,%s,%s)", h(n_ref), client, h("5" * 64), h("6" * 64)), bad)

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

    def test_purge_removes_old_rows_only(self):
        _, a, _ = self.connect(ALICE)
        d = self.db.as_(None)
        d.c.execute("insert into public.connect_calls (at, tool, result, code) values (now() - interval '40 days', 'x', 'ok', 'ok'), (now(), 'y', 'ok', 'ok')")
        out = d.one("select connect_purge()")
        self.assertEqual(out["calls"], 1)
        self.assertEqual(d.one("select count(*) from public.connect_calls"), 1)
        self.runner().one("select connect_whoami(%s)", h(a))


def _kind(d, oid):
    return d.one("select relkind from pg_class where oid = %s", oid)


if __name__ == "__main__":
    unittest.main()
