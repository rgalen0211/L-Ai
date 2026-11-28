"""ROLLBACK ROUND TRIP for migrations/20261127000300_compilations_for_everyone.sql (BUILDER 2026-11-27) on a local Postgres, the test_2a_core helpers (start_pg, MIGRATIONS, the stub).
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -B -m unittest supabase/tests/test_rollback_roundtrip_0300.py -v

What it proves
  * PRE: every migration EXCEPT this one, applied in order on a fresh database (the true pre-migration state: no rollback needed to get it);
  * FIRST: PRE plus this migration (it is the newest file in migrations/, so this is also what every other suite's template holds);
  * on a copy of FIRST: rollback -> the schema equals PRE exactly; apply again -> equals FIRST exactly; rollback -> PRE; apply -> FIRST.
    "The schema" is every function's pg_get_functiondef text and grants, every table/view/sequence/index (rls flags, grants), column, constraint, policy, trigger,
    view text, enum and schema grant outside the system schemas. Byte-identical, not just "present".
  * the snapshot is not blind: every function, table and policy the migration creates is in FIRST and not in PRE, and every function it rewrites in place
    (pg_get_functiondef(...) in the file) differs between PRE and FIRST.
  * ONLY 0300 is rolled back: 0250 stays applied (its rollback refuses while 0300 is applied, and 0300's rollback raises if a rewritten function still names compilations_on).
  * (test_compilations_for_everyone.py already runs the rollback ONCE for device_decide and request_app_download; this adds every object, apply again and byte-identity.)
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

MIG = core.ROOT / "migrations" / "20261127000300_compilations_for_everyone.sql"
RB = core.ROOT / "rollbacks" / "20261127000300_compilations_for_everyone_rollback.sql"
_server = None

SNAP = {
    "functions": r"""select p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "function grants": r"""select p.oid::regprocedure::text, coalesce(p.proacl::text, '-') || ' owner ' || pg_get_userbyid(p.proowner) || ' secdef ' || p.prosecdef::text
                            || ' config ' || coalesce(p.proconfig::text, '-') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "relations": r"""select c.oid::regclass::text, c.relkind::text || ' rls ' || c.relrowsecurity::text || ' force ' || c.relforcerowsecurity::text || ' acl ' || coalesce(c.relacl::text, '-')
                      from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "indexes": r"""select i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "columns": r"""select a.attrelid::regclass::text || '.' || a.attname, format_type(a.atttypid, a.atttypmod) || ' notnull ' || a.attnotnull::text
                           || ' default ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' acl ' || coalesce(a.attacl::text, '-')
                    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                    where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
                      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "constraints": r"""select coalesce(nullif(o.conrelid, 0)::regclass::text, o.contypid::regtype::text) || '.' || o.conname, pg_get_constraintdef(o.oid)
                        from pg_constraint o join pg_namespace n on n.oid = o.connamespace
                        where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "policies": r"""select schemaname || '.' || tablename || '.' || policyname, permissive || ' ' || roles::text || ' ' || cmd || ' using ' || coalesce(qual, '-')
                            || ' check ' || coalesce(with_check, '-') from pg_policies""",
    "triggers": r"""select t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' enabled ' || t.tgenabled::text from pg_trigger t where not t.tgisinternal""",
    "views": r"""select c.oid::regclass::text, pg_get_viewdef(c.oid) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where c.relkind in ('v', 'm') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'""",
    "enums": r"""select t.oid::regtype::text, string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.oid""",
    "schemas": r"""select nspname, coalesce(nspacl::text, '-') || ' owner ' || pg_get_userbyid(nspowner) from pg_namespace
                    where nspname not in ('pg_catalog', 'information_schema') and nspname not like 'pg\_%'""",
}


def setUpModule():
    """One throwaway server (core.start_pg removes it however the module ends). pre = stub + every migration but this one; first = pre + this one."""
    global _server
    _server = core.start_pg("ryagram-rt-")
    assert MIG in core.MIGRATIONS, "the migration under test is in migrations/"
    others = core.MIGRATIONS[:core.MIGRATIONS.index(MIG)]   # only the ones BEFORE it: a later migration (20261128000100) builds on it and has its own round trip
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database rt_pre")
    with psycopg.connect(_server.get_uri(database="rt_pre"), autocommit=True) as c:
        c.execute((core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in others:
            c.execute(path.read_text(encoding="utf-8"))
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database rt_first template rt_pre")
    with psycopg.connect(_server.get_uri(database="rt_first"), autocommit=True) as c:
        c.execute(MIG.read_text(encoding="utf-8"))


def snapshot(c):
    """Every category as {name: text}, fully qualified (search_path '' while reading, put back after)."""
    c.execute("set search_path to ''")
    try:
        out = {}
        for cat, sql in SNAP.items():
            rows = c.execute(sql).fetchall()
            d = {}
            for k, v in rows:
                d[k] = v if k not in d else d[k] + "\n|| " + v       # two rows under one name (overloads never share a regprocedure, but be safe)
            out[cat] = d
        return out
    finally:
        c.execute("reset search_path")


def snap_of(db):
    with psycopg.connect(_server.get_uri(database=db), autocommit=True) as c:
        return snapshot(c)


def diff(want, got):
    """Plain words, one line per difference; [] when identical."""
    out = []
    for cat in want:
        a, b = want[cat], got[cat]
        out += [f"{cat}: {k} is missing" for k in sorted(a.keys() - b.keys())]
        out += [f"{cat}: {k} should not be there" for k in sorted(b.keys() - a.keys())]
        out += [f"{cat}: {k} changed:\n--- want\n{a[k]}\n--- got\n{b[k]}" for k in sorted(a.keys() & b.keys()) if a[k] != b[k]]
    return out


def code_only(sql):
    return "\n".join(l.split("--", 1)[0] for l in sql.splitlines())


def named(sql):
    """What the file says it creates (functions, tables, policies) and which existing functions it rewrites through pg_get_functiondef."""
    s = code_only(sql)
    funcs = sorted(set(m.lower() for m in re.findall(r"(?i)\bcreate\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(", s)))
    tables = sorted(set(m.lower() for m in re.findall(r"(?i)\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)", s)))
    policies = sorted(set((p.lower(), t.lower()) for p, t in re.findall(r"(?i)\bcreate\s+policy\s+\"?(\w+)\"?\s+on\s+([\w.]+)", s)))
    rewritten = sorted(set(m.lower() for m in re.findall(r"(?i)pg_get_functiondef\(\s*'([\w.]+)\s*\(", s)))
    return funcs, tables, policies, rewritten


def keys_named(d, name):
    return [k for k in d if k.lower().startswith(name + "(")]


class RollbackRoundTrip(unittest.TestCase):
    maxDiff = None

    def run_file(self, c, path):
        c.execute(path.read_text(encoding="utf-8"))
        self.assertEqual(c.info.transaction_status, psycopg.pq.TransactionStatus.IDLE, f"{path.name} left a transaction open")

    def test_apply_rollback_apply_again_is_byte_identical(self):
        pre, first = snap_of("rt_pre"), snap_of("rt_first")
        funcs, tables, policies, rewritten = named(MIG.read_text(encoding="utf-8"))
        self.assertTrue(funcs or rewritten, "the file names at least one function it creates or rewrites")

        # the snapshot sees what the migration did
        for f in funcs:
            self.assertTrue(keys_named(first["functions"], f), f"{f} exists after the migration")
            self.assertFalse(keys_named(pre["functions"], f), f"{f} does not exist before it")
        for f in rewritten:
            ks = keys_named(pre["functions"], f)
            self.assertTrue(ks, f"{f} exists before the migration (it is rewritten in place)")
            for k in ks:
                self.assertIn(k, first["functions"], f"{k} still exists after the migration")
                self.assertNotEqual(pre["functions"][k], first["functions"][k], f"{k} is different after the migration")
        for t in tables:
            self.assertIn(t, first["relations"], f"table {t} exists after the migration")
            self.assertNotIn(t, pre["relations"], f"table {t} does not exist before it")
        for p, t in policies:
            self.assertIn(f"{t}.{p}", first["policies"], f"policy {p} on {t} exists after the migration")
            self.assertNotIn(f"{t}.{p}", pre["policies"], f"policy {p} on {t} does not exist before it")
        self.assertNotEqual([], diff(pre, first), "the migration changes the schema")

        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute("create database rt_roundtrip template rt_first")
        with psycopg.connect(_server.get_uri(database="rt_roundtrip"), autocommit=True) as c:
            for rnd in (1, 2):
                self.run_file(c, RB)
                back = snapshot(c)
                for f in funcs:
                    self.assertFalse(keys_named(back["functions"], f), f"round {rnd}: the rollback drops {f}")
                for t in tables:
                    self.assertNotIn(t, back["relations"], f"round {rnd}: the rollback drops table {t}")
                for p, t in policies:
                    self.assertNotIn(f"{t}.{p}", back["policies"], f"round {rnd}: the rollback drops policy {p} on {t}")
                for f in rewritten:
                    for k in keys_named(pre["functions"], f):
                        self.assertEqual(back["functions"].get(k), pre["functions"][k], f"round {rnd}: the rollback puts {k} back byte for byte")
                self.assertEqual([], diff(pre, back), f"round {rnd}: after the rollback the schema is exactly the pre-migration schema")

                self.run_file(c, MIG)
                again = snapshot(c)
                for f in funcs + rewritten:
                    for k in keys_named(first["functions"], f):
                        self.assertEqual(again["functions"].get(k), first["functions"][k], f"round {rnd}: {k} is byte-identical to the first apply")
                self.assertEqual([], diff(first, again), f"round {rnd}: after applying again the schema is exactly the first apply's")


if __name__ == "__main__":
    unittest.main()
