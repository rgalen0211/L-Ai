"""Must-fail proof for supabase/tests/test_account_switches.py: each mutant breaks ONE rule of the per-account switch migration (20261110000400_account_switches.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/account_switches_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261110000400_account_switches.sql"
W.TEST = "supabase/tests/test_account_switches.py"
W.SCRATCH = W.ROOT / ".mut_switches"
W.RUN_TMP = W.base.BASE_TEMP / f"switches-mut-{os.getpid()}"

ADMIN_HEAD = "declare me uuid := ryagram_private.require_admin();"
W.MUTANTS[:] = [
    # the owner can write or read around the writer
    ("a person may update the column", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;\ngrant update (switches_on) on public.account_settings to authenticated;"),
    ("a person may insert the column", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;\ngrant insert (switches_on) on public.account_settings to authenticated;"),
    ("a visitor may update the column", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;\ngrant update (switches_on) on public.account_settings to anon;"),
    ("the audit table may be read", "revoke all on public.account_switch_audit from public, anon, authenticated, service_role;", "grant select on public.account_switch_audit to authenticated;"),
    ("a visitor may ask for a list", "public.my_switches() to authenticated;", "public.my_switches() to anon, authenticated;"),
    # empty by default, fails closed
    ("every account starts with a switch on", "add column switches_on text[] not null default '{}';", "add column switches_on text[] not null default '{aiFirst}';"),
    ("a missing row reads as ON", "where s.owner_id = me), '{}');", "where s.owner_id = me), '{aiFirst}');"),
    ("no signed-in subject reads as ON", "if me is null then return '{}'; end if;", "if me is null then return '{aiFirst}'; end if;"),
    ("a person reads another person's list", "where s.owner_id = me), '{}');", "order by s.owner_id limit 1), '{}');"),
    # who may write
    ("the writer is open to any signed-in person", ADMIN_HEAD + "           -- an admin acts from the app, never through a connected AI\n        target uuid;", "declare me uuid := auth.uid();\n        target uuid;"),
    ("the writer works through a connected AI", ADMIN_HEAD + "           -- an admin acts from the app, never through a connected AI\n        target uuid;", "declare me uuid := ryagram_private.is_app_admin()::text::uuid;\n        target uuid;"),
    ("the list is open to any signed-in person", ADMIN_HEAD + "\nbegin\n  return query select u.email::text, s.switches_on", "declare me uuid := auth.uid();\nbegin\n  return query select u.email::text, s.switches_on"),
    ("the history is open to any signed-in person", ADMIN_HEAD + "\nbegin\n  return query select (select u.email from auth.users u where u.id = a.user_id)::text", "declare me uuid := auth.uid();\nbegin\n  return query select (select u.email from auth.users u where u.id = a.user_id)::text"),
    # what the writer accepts
    ("a worker account is accepted", "if exists (select 1 from public.workers where user_id = target) then", "if false then"),
    ("any switch name is accepted", "if sw !~ '^[a-z][A-Za-z0-9]{1,39}$' then", "if false then"),
    ("the switch name is not trimmed", "sw text := btrim(coalesce(p_switch, ''));", "sw text := coalesce(p_switch, '');"),
    ("no reason is needed", "if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then", "if false then"),
    ("on or off may be left out", "if p_on is null then", "if false then"),
    ("the email is not trimmed", "where lower(email) = lower(btrim(p_email));", "where lower(email) = lower(p_email);"),
    ("the email is case sensitive", "where lower(email) = lower(btrim(p_email));", "where email = btrim(p_email);"),
    ("an unknown email is accepted", "if target is null then raise exception 'No account with that email.' using errcode = 'PT404'; end if;", ""),
    ("a switch can be added twice", "(select distinct unnest(old || sw) as x)", "(select unnest(old || sw) as x)"),
    ("off clears every switch", "new := array_remove(old, sw);", "new := '{}';"),
    ("the writer returns the old list", "  return new;\nend $$;", "  return old;\nend $$;"),
    ("more than twenty switches are not refused in words", "if cardinality(new) > 20 then", "if false then"),
    ("a change is not recorded", "  insert into public.account_switch_audit (user_id, switch, was_on, turned_on, set_by, reason)\n    values (target, sw, sw = any (old), p_on, me, btrim(p_reason));\n", ""),
    ("the audit never says it was on", "sw = any (old)", "false"),
    ("the audit says who by the wrong person", "values (target, sw, sw = any (old), p_on, me, btrim(p_reason));", "values (target, sw, sw = any (old), p_on, target, btrim(p_reason));"),
    ("the list shows accounts with nothing on", "where cardinality(s.switches_on) > 0 order by lower(u.email);", "order by lower(u.email);"),
    ("the history is oldest first", "order by a.at desc, a.id desc;", "order by a.at, a.id;"),
    # the table itself
    ("the table accepts any list", "check (switches_on::text ~ '^\\{([a-z][A-Za-z0-9]{1,39}(,[a-z][A-Za-z0-9]{1,39}){0,19})?\\}$');", "check (true);"),
    ("the table accepts twenty-one names", "{0,19})?", "{0,20})?"),
    ("the table accepts a one-letter name", "{1,39}(,[a-z]", "{0,39}(,[a-z]"),
    # the gate
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
