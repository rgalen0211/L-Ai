"""CC1 (2026-10-16): the reporter key was md5(address + day), so anyone holding abuse_reports could find an IPv4 address by trying all 2^32.
It is now an HMAC-SHA256 under a secret held in a closed table (the creator-beta caller key is the same, made in the Edge Function: tests/creator-beta.test.mjs).

Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_hash_secrets.py -v
"""
import hashlib
import hmac as pyhmac
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_ops_readiness as ops  # noqa: E402

setUpModule = core.setUpModule


class HashSecrets(core.Base):
    project_with_version = core.Core.project_with_version
    admin = ops.Ops.admin
    make_ryan_admin = ops.Ops.make_ryan_admin
    publish_many = ops.Ops.publish_many

    def hmac_hex(self, key_hex, msg_hex):
        return self.admin("select encode(ryagram_private.hmac_sha256(decode(%s, 'hex'), decode(%s, 'hex')), 'hex')" % (f"'{key_hex}'", f"'{msg_hex}'"))

    def test_hmac_matches_the_rfc_4231_vectors_and_python(self):
        self.assertEqual(self.hmac_hex("0b" * 20, "4869205468657265"), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")      # case 1
        self.assertEqual(self.hmac_hex("4a656665", "7768617420646f2079612077616e7420666f72206e6f7468696e673f"),
                         "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")                                                    # case 2
        long_msg = b"Test Using Larger Than Block-Size Key - Hash Key First"
        self.assertEqual(self.hmac_hex("aa" * 131, long_msg.hex()), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54")          # case 6: a key over 64 bytes is hashed first
        self.assertEqual(self.hmac_hex("aa" * 131, long_msg.hex()), pyhmac.new(bytes.fromhex("aa" * 131), long_msg, hashlib.sha256).hexdigest())

    def test_the_secret_exists_is_random_and_closed_to_every_role(self):
        self.assertEqual(self.admin("select octet_length(secret) from ryagram_private.hash_secret"), 32)
        self.assertEqual(self.admin("select count(*) from ryagram_private.hash_secret"), 1)
        for role in ("anon", "authenticated", "service_role"):
            c = self.db.as_(role).c
            with self.assertRaises(psycopg.Error, msg=role):
                c.execute("select secret from ryagram_private.hash_secret")
            with self.assertRaises(psycopg.Error, msg=role):
                c.execute("select ryagram_private.hash_secret()")
            with self.assertRaises(psycopg.Error, msg=role):
                c.execute("select ryagram_private.hmac_sha256('\x01'::bytea, '\x02'::bytea)")

    def report_key(self, ip, slug):
        c = self.db.as_("anon").c
        c.execute("select set_config('request.headers', %s, false)", ('{"x-forwarded-for": "%s"}' % ip,))
        c.execute("select report_film_page(%s, 'other', %s)", (slug, f"r{ip}@x.co"))
        return self.admin("select reporter_key from public.abuse_reports order by id desc limit 1")

    def test_the_reporter_key_is_an_hmac_under_the_secret_not_a_bare_hash(self):
        slug = self.publish_many(1)[0]
        ip = "203.0.113.9"
        key = self.report_key(ip, slug)
        day = self.admin("select to_char(now() at time zone 'EST5EDT', 'YYYY-MM-DD')")
        secret = bytes(self.admin("select secret from ryagram_private.hash_secret"))
        self.assertRegex(key, r"^[0-9a-f]{64}$")
        self.assertEqual(key, pyhmac.new(secret, f"report|{ip}|{day}".encode(), hashlib.sha256).hexdigest())
        self.assertNotEqual(key, hashlib.md5(f"{ip}{day}".encode()).hexdigest())                                    # not the old md5
        self.assertNotEqual(key, hashlib.sha256(f"report|{ip}|{day}".encode()).hexdigest())                         # not a bare hash: a table without the secret cannot be tried against all addresses
        self.assertNotIn(ip, key)

    def test_another_secret_gives_another_key_and_a_missing_secret_is_an_error_not_an_unsalted_hash(self):
        slug = self.publish_many(1)[0]
        k1 = self.report_key("203.0.113.9", slug)
        self.admin("update ryagram_private.hash_secret set secret = uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) returning 1")
        k2 = self.report_key("203.0.113.9", slug)
        self.assertNotEqual(k1, k2)                                                                                 # same caller, same day: a different secret gives a different key
        self.admin("delete from ryagram_private.hash_secret returning 1")
        c = self.db.as_("anon").c
        c.execute("select set_config('request.headers', %s, false)", ('{"x-forwarded-for": "203.0.113.55"}',))
        with self.assertRaises(psycopg.Error):
            c.execute("select report_film_page(%s, 'other', 'nokey@x.co')", (slug,))                                # no secret: refused (hmac of a null key), nothing stored
        self.assertEqual(self.admin("select count(*) from public.abuse_reports where reporter_email = 'nokey@x.co'"), 0)

    def test_with_no_address_the_key_is_still_the_reporters_lowercased_email(self):
        slug = self.publish_many(1)[0]
        c = self.db.as_("anon").c
        c.execute("select set_config('request.headers', %s, false)", ('{}',))
        c.execute("select report_film_page(%s, 'other', 'Some.One@X.co')", (slug,))
        self.assertEqual(self.admin("select reporter_key from public.abuse_reports order by id desc limit 1"), "some.one@x.co")


if __name__ == "__main__":
    unittest.main()
