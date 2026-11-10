"""CLIENT ID METADATA DOCUMENTS (migrations/20261110000100_connect_cimd.sql) on a local Postgres, with the waiting-accounts gate (20261104000100) in place.

NEXT-CONNECT 205 (Ryan's Q555 answer 1): "Use Claude's published identity" so that a directory listing does not register a new client for every person who presses Connect.
Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_cimd.py -v

What this proves: the ONE new function the connector's role may call (connect_cimd_client) stores a client only for an address that is EXACTLY on Ryan's allowlist and enabled, under the allowlist's own label (never a name
from the document), with redirect addresses that are ALL on Ryan's existing redirect list (a document can never widen where a code may be sent); it refuses when the master switch is off; asking twice changes nothing but
the redirect list and the purge clock; nobody but the connector's role can call it or read the allowlist; the sign-in that follows sees an ordinary client; the register path is untouched; the rollback removes exactly the
function and the table; and the migration ends with the waiting-list gate like every migration after it.
"""
import base64
import hashlib
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
URL = "https://claude.ai/oauth/mcp-oauth-client-metadata"
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
ROOT = Path(__file__).resolve().parent.parent


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class ConnectCimd(core.Base):
    def setUp(self):
        super().setUp()
        d = self.db.as_(None).c
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))

    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role connect_runner")
        return self.db

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def fails(self, sql, *args, code=None):
        self.runner()
        with self.assertRaises(psycopg.Error) as cm:
            self.db.c.execute(sql, args or None)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def register(self, url=URL, uris=(URI,)):
        self.runner()
        return self.db.c.execute("select connect_cimd_client(%s, %s)", (url, list(uris)))

    def client(self, url=URL):
        return self.owner("select client_id, name, redirect_uris, created_at from public.connect_clients where client_id = %s", url).fetchone()

    # ---------------------------------------------------------------------------------------------- what is stored
    def test_the_seed_is_claudes_one_address_and_nothing_else(self):
        rows = self.owner("select client_id_url, label, enabled from public.connect_cimd_allowlist").fetchall()
        self.assertEqual(rows, [(URL, "Claude (claude.ai)", True)])

    def test_an_allowlisted_address_is_stored_as_a_client_under_the_allowlists_own_label(self):
        self.register()
        c = self.client()
        self.assertEqual((c[0], c[1], c[2]), (URL, "Claude (claude.ai)", [URI]), "the name is the allowlist's label, never a name the document could choose")

    def test_asking_twice_is_one_client_and_the_purge_clock_is_refreshed(self):
        self.register()
        self.owner("update public.connect_clients set created_at = now() - interval '2 days' where client_id = %s", URL)
        self.register()
        self.assertEqual(self.owner("select count(*) from public.connect_clients where client_id = %s", URL).fetchone()[0], 1)
        self.assertEqual(self.owner("select created_at > now() - interval '1 minute' from public.connect_clients where client_id = %s", URL).fetchone()[0], True)

    def test_a_second_call_replaces_the_return_addresses_with_the_documents_newer_list(self):
        uri2 = "https://claude.com/api/mcp/auth_callback"
        self.owner("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude second')", uri2)
        self.register(uris=(URI,))
        self.register(uris=(uri2,))
        self.assertEqual(self.client()[2], [uri2], "the document changed its list: the stored list follows it, it is never only added to")

    def test_the_sign_in_that_follows_sees_an_ordinary_client(self):
        self.register()
        self.runner()
        req = self.db.c.execute("select connect_begin_authorization(%s,%s,'st',%s,'S256','read write',null)", (URL, URI, s256(VER))).fetchone()[0]
        self.assertTrue(req, "an authorization request was made for the client the address stands for")
        self.runner()
        with self.assertRaises(psycopg.Error) as cm:
            self.db.c.execute("select connect_begin_authorization(%s,%s,'st',%s,'S256','read write',null)", (URL, "https://evil.example/cb", s256(VER)))
        self.assertEqual(cm.exception.sqlstate, "PT400", "a return address that is not the client's is refused as for any client")

    # ---------------------------------------------------------------------------------------------- what is refused
    def test_an_address_that_is_not_on_the_list_is_refused_and_nothing_is_stored(self):
        for bad in ("https://claude.ai/oauth/mcp-oauth-client-metadata/", "https://claude.ai/oauth/mcp-oauth-client-metadata?x=1", "https://evil.example/doc",
                    "http://claude.ai/oauth/mcp-oauth-client-metadata", "https://claude.ai/oauth/claude-code-client-metadata", "", "claude"):
            e = self.fails("select connect_cimd_client(%s, %s)", bad, [URI], code="PT400")
            self.assertIn("invalid_client", e.diag.message_primary, bad)
        self.assertEqual(self.owner("select count(*) from public.connect_clients").fetchone()[0], 0)

    def test_a_row_switched_off_stops_it_at_once(self):
        self.owner("update public.connect_cimd_allowlist set enabled = false")
        self.fails("select connect_cimd_client(%s, %s)", URL, [URI], code="PT400")
        self.assertEqual(self.owner("select count(*) from public.connect_clients").fetchone()[0], 0)

    def test_a_return_address_that_is_not_on_ryans_list_is_refused_even_for_an_allowlisted_client(self):
        for uris in (["https://evil.example/cb"], [URI, "https://evil.example/cb"], ["http://localhost:1234/cb"]):
            e = self.fails("select connect_cimd_client(%s, %s)", URL, uris, code="PT400")
            self.assertIn("invalid_redirect_uri", e.diag.message_primary, uris)
        self.assertEqual(self.owner("select count(*) from public.connect_clients").fetchone()[0], 0)

    def test_no_return_address_or_more_than_five_is_refused(self):
        self.fails("select connect_cimd_client(%s, %s)", URL, [], code="PT400")
        self.fails("select connect_cimd_client(%s, %s::text[])", URL, None, code="PT400")
        self.fails("select connect_cimd_client(%s, %s)", URL, [URI] * 6, code="PT400")

    def test_nothing_is_stored_while_the_master_switch_is_off_and_it_works_again_when_it_is_on(self):
        self.owner("update public.connect_flags set connections_enabled = false where id")
        e = self.fails("select connect_cimd_client(%s, %s)", URL, [URI], code="PT400")
        self.assertIn("unavailable", e.diag.message_primary)
        self.assertEqual(self.owner("select count(*) from public.connect_clients").fetchone()[0], 0)
        self.owner("update public.connect_flags set connections_enabled = true where id")
        self.register()
        self.assertIsNotNone(self.client())

    # ---------------------------------------------------------------------------------------------- who may call it, who may read the list
    def test_only_the_connectors_role_may_call_it_and_nobody_may_read_or_write_the_list(self):
        for who in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.owner("select has_function_privilege(%s, 'public.connect_cimd_client(text, text[])', 'execute')", who).fetchone()[0], who)
        self.assertTrue(self.owner("select has_function_privilege('connect_runner', 'public.connect_cimd_client(text, text[])', 'execute')").fetchone()[0])
        for role in ("anon", "authenticated", "connect_runner"):
            for priv in ("select", "insert", "update", "delete"):
                self.assertFalse(self.owner("select has_table_privilege(%s, 'public.connect_cimd_allowlist', %s)", role, priv).fetchone()[0], f"{role} {priv}")
        self.assertTrue(self.owner("select relrowsecurity from pg_class where oid = 'public.connect_cimd_allowlist'::regclass").fetchone()[0])

    def test_the_allowlist_refuses_an_address_that_is_not_a_plain_https_address(self):
        for bad in ("http://claude.ai/x", "https://claude.ai", "https://claude.ai/a b", "ftp://x.example/a", "https://x.example/a#frag"):
            with self.assertRaises(psycopg.Error, msg=bad):
                self.owner("insert into public.connect_cimd_allowlist (client_id_url, label) values (%s, 'x')", bad)
            self.db.c.execute("rollback") if not self.db.c.autocommit else None

    # ---------------------------------------------------------------------------------------------- the register path is untouched, the rollback, the gate
    def test_the_register_path_still_registers_and_still_limits_everyone_else(self):
        self.runner()
        cid = self.db.c.execute("select connect_register_client('Some assistant', array[%s])", (URI,)).fetchone()[0]
        self.assertTrue(cid)
        self.assertNotIn(URL, (cid if isinstance(cid, str) else str(cid),))
        src = (ROOT / "migrations" / "20261110000100_connect_cimd.sql").read_text(encoding="utf-8")
        self.assertNotIn("connect_register_client", src, "this migration does not touch the register function or its limits")

    def test_the_rollback_removes_the_function_and_the_table_and_keeps_the_clients(self):
        self.register()
        rb = (ROOT / "rollbacks" / "20261110000100_connect_cimd_rollback.sql").read_text(encoding="utf-8")
        self.owner(rb)
        self.assertIsNone(self.owner("select to_regprocedure('public.connect_cimd_client(text, text[])')").fetchone()[0])
        self.assertIsNone(self.owner("select to_regclass('public.connect_cimd_allowlist')").fetchone()[0])
        self.assertIsNotNone(self.client(), "a client that was made stays an ordinary row")
        self.owner(rb)                                                                                         # safe twice

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        lines = [ln.strip() for ln in (ROOT / "migrations" / "20261110000100_connect_cimd.sql").read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertTrue(lines[-2].startswith("select ryagram_private.gate_apply();"), lines[-2:])
        self.assertEqual(lines[-1], "commit;")


if __name__ == "__main__":
    unittest.main()
