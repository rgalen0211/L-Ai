"""Every ryagram_private function a row-level policy calls must be executable by that policy's roles.

A policy runs its expressions as the signed-in person, so a missing grant is not a quiet "no rows": the whole query fails with
"permission denied for function". 2026-10-17: WEB's read-only live check found upload_slot_ok and worker_may_read_upload not
executable by `authenticated` -- phase-2b's "revoke execute on all functions in schema ryagram_private" had taken away the
grants 20261004000200_uploads_schema.sql made. 20261017000700_upload_policy_grants.sql puts them back; both phase-2b files now
re-grant all five.

Three databases on one local Postgres:
  * harness order  -- stub, every migration, phase-2b ledger, phase-2b stripe (what the other suites build);
  * live order     -- stub, the migrations before 20261017000700, the phase-2b files AS THEY WERE (revoke all, re-grant three),
                      then 20261017000700 -- the order Ryan applies on live;
  * must-fail      -- each of the two upload functions loses execute in turn; the checker must name it.

Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_policy_grants.py -v
"""
import re
import sys
import tempfile
import unittest
from pathlib import Path

import pgserver
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

ROOT = core.ROOT
FIX = ROOT / "migrations" / "20261017000700_upload_policy_grants.sql"
LEDGER = ROOT / "phase-2b" / "credits_ledger.sql"
STRIPE = ROOT / "phase-2b" / "stripe_test_mode.sql"
UPLOAD = ("upload_slot_ok", "worker_may_read_upload")
POLICY_FUNCS = ("owner_may_read", "worker_may_write", "is_worker", *UPLOAD)   # what the policies call today
# How the two phase-2b files ended before the fix: everything revoked, three re-granted.
OLD_TAIL = ("revoke execute on all functions in schema ryagram_private from public, anon, authenticated;\n"
            "grant execute on function ryagram_private.owner_may_read(text), ryagram_private.worker_may_write(text),\n"
            "  ryagram_private.is_worker() to authenticated;")
_server = None


def setUpModule():
    global _server
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-grants-"), cleanup_mode="stop")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:      # the stub makes cluster-wide roles: run it once
        c.execute("drop database if exists gstub")
        c.execute("create database gstub")
    with psycopg.connect(_server.get_uri(database="gstub"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))


def build(name, files, after=()):
    """A fresh database from the stub plus `files` in order, then the SQL strings in `after`."""
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute(f"drop database if exists {name}")
        c.execute(f"create database {name} template gstub")
    c = psycopg.connect(_server.get_uri(database=name), autocommit=True)
    for f in files:
        c.execute(f.read_text(encoding="utf-8"))
    for sql in after:
        c.execute(sql)
    return c


def policy_calls(c):
    """{(schema.table, policy, function): [roles that need execute]} for every ryagram_private call in a policy."""
    out = {}
    rows = c.execute("select schemaname, tablename, policyname, roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') "
                     "from pg_policies").fetchall()
    for schema, table, policy, roles, text in rows:
        roles = ["anon", "authenticated"] if "public" in roles else list(roles)
        for fn in sorted(set(re.findall(r"ryagram_private\.(\w+)\(", text))):
            out[(f"{schema}.{table}", policy, fn)] = roles
    return out


def missing_grants(c):
    """Every (function, role, policy) where the policy's role cannot execute a function the policy calls."""
    bad = []
    for (table, policy, fn), roles in policy_calls(c).items():
        oids = [r[0] for r in c.execute("select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                                        "where n.nspname = 'ryagram_private' and p.proname = %s", (fn,)).fetchall()]
        if not oids:
            bad.append((fn, "*", f"{table}: {policy} (function does not exist)"))
        for role in roles:
            if not any(c.execute("select has_function_privilege(%s, %s::oid, 'execute')", (role, o)).fetchone()[0]
                       for o in oids):
                bad.append((fn, role, f"{table}: {policy}"))
    return sorted(bad)


def too_wide(c):
    """Any of the two upload functions that anon, or PUBLIC (every role), can execute."""
    bad = []
    for fn in UPLOAD:
        oid = c.execute("select to_regprocedure(%s)::oid", (f"ryagram_private.{fn}(text)",)).fetchone()[0]
        if c.execute("select has_function_privilege('anon', %s::oid, 'execute')", (oid,)).fetchone()[0]:
            bad.append((fn, "anon"))
        if c.execute("select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a "
                     "where p.oid = %s and a.grantee = 0 and a.privilege_type = 'EXECUTE')", (oid,)).fetchone()[0]:
            bad.append((fn, "public"))
    return bad


class PolicyGrants(unittest.TestCase):
    def check_clean(self, c):
        calls = {fn for (_, _, fn) in policy_calls(c)}
        self.assertTrue(set(POLICY_FUNCS) <= calls, f"the checker no longer sees every policy function: {sorted(calls)}")
        self.assertEqual(missing_grants(c), [])
        self.assertEqual(too_wide(c), [])

    def test_harness_order(self):
        c = build("g_harness", [*core.MIGRATIONS, LEDGER, STRIPE])
        try:
            self.check_clean(c)
        finally:
            c.close()

    def test_live_order(self):
        before = [m for m in core.MIGRATIONS if m.name < FIX.name]
        later = [m for m in core.MIGRATIONS if m.name > FIX.name]
        c = build("g_live", [*before, LEDGER, STRIPE], after=[OLD_TAIL])
        try:
            # As live was before the fix: exactly the two upload functions missing, for `authenticated`.
            self.assertEqual({(fn, role) for fn, role, _ in missing_grants(c)},
                             {("upload_slot_ok", "authenticated"), ("worker_may_read_upload", "authenticated")})
            for f in [FIX, FIX, *later]:                 # twice: the migration is safe to run again
                c.execute(f.read_text(encoding="utf-8"))
            self.check_clean(c)
        finally:
            c.close()

    def test_must_fail_each_upload_function_losing_execute(self):
        c = build("g_mustfail", [*core.MIGRATIONS, LEDGER, STRIPE])
        try:
            for fn in UPLOAD:
                with self.subTest(fn=fn):
                    c.execute(f"revoke execute on function ryagram_private.{fn}(text) from authenticated")
                    self.assertIn(fn, {f for f, role, _ in missing_grants(c) if role == "authenticated"})
                    c.execute(f"grant execute on function ryagram_private.{fn}(text) to authenticated")
                    self.assertEqual(missing_grants(c), [])
        finally:
            c.close()

    def test_must_fail_upload_function_granted_to_anon_or_public(self):
        c = build("g_wide", [*core.MIGRATIONS, LEDGER, STRIPE])
        try:
            c.execute("grant execute on function ryagram_private.upload_slot_ok(text) to anon")
            c.execute("grant execute on function ryagram_private.worker_may_read_upload(text) to public")
            self.assertEqual(sorted(too_wide(c)), [("upload_slot_ok", "anon"), ("worker_may_read_upload", "anon"),
                                                   ("worker_may_read_upload", "public")])
        finally:
            c.close()


def build_realistic(name, files):
    """Like build(), but from the stub WITHOUT its strictness (the way CONNECT's RealisticDefaults does): PUBLIC keeps its default EXECUTE on new
    functions and USAGE on the public schema, as on a real Supabase project, so a function nobody revoked shows up as executable."""
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute(f"drop database if exists {name}")
        c.execute(f"create database {name}")
    drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
            "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
    lines = [l for l in (ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True)
             if not l.startswith("create role") and l.strip() not in drop]
    c = psycopg.connect(_server.get_uri(database=name), autocommit=True)
    c.execute("".join(lines))
    for f in files:
        c.execute(f.read_text(encoding="utf-8"))
    return c


def executable_by_authenticated(c):
    """Every ryagram_private function a signed-in person (or anon, or PUBLIC) can execute: name(args)."""
    return sorted(r[0] for r in c.execute(
        "select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ryagram_private' "
        "and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))").fetchall())


# The order Ryan applies on live: the phase-2b files (whose tail revokes every ryagram_private function) went in BEFORE the funnel migration, so they cannot mask a missing revoke in it.
LIVE_ORDER = [*[m for m in core.MIGRATIONS if m.name < "20261017000900"], LEDGER, STRIPE, *[m for m in core.MIGRATIONS if m.name >= "20261017000900"]]


class PrivateSchemaClosed(unittest.TestCase):
    """CC1 MED-1 (funnel-events): ryagram_private.funnel_log takes any p_user and was never revoked, so on a real project (PUBLIC executes new functions by default)
    any signed-in person could have written fake funnel events for any account. The stub's default-privilege revoke hid it. This runs WITHOUT that revoke:
    a signed-in person (or anon) may execute NO ryagram_private function except the five a row policy calls."""

    def test_authenticated_executes_only_the_five_policy_functions(self):
        c = build_realistic("g_real", LIVE_ORDER)
        try:
            names = {re.match(r"ryagram_private\.(\w+)\(", f).group(1) for f in executable_by_authenticated(c)}
            self.assertEqual(sorted(names), sorted(POLICY_FUNCS))
        finally:
            c.close()

    def test_must_fail_a_new_private_function_nobody_revoked_is_caught(self):
        c = build_realistic("g_real_mf", LIVE_ORDER)
        try:
            c.execute("create function ryagram_private.funnel_log_planted(p_user uuid) returns void language sql as 'select 1'")
            self.assertIn("ryagram_private.funnel_log_planted(uuid)", executable_by_authenticated(c))
            for fn in ("funnel_log(text,uuid)", "funnel_clean(text,integer)"):
                c.execute(f"grant execute on function ryagram_private.{fn} to public")
                self.assertIn(f"ryagram_private.{fn}", executable_by_authenticated(c))
        finally:
            c.close()


if __name__ == "__main__":
    unittest.main()
