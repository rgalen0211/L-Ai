"""Must-fail proof for supabase/tests/test_waitlist_join.py: each mutant breaks ONE rule of the waiting-list migration (20261110000200_waitlist_join.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/waitlist_join_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261110000200_waitlist_join.sql"
W.TEST = "supabase/tests/test_waitlist_join.py"
W.SCRATCH = W.ROOT / ".mut_waitlist"
W.RUN_TMP = W.base.BASE_TEMP / f"waitlist-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("a repeat is an error (it tells a stranger who is on the list)", "values (em, why, src) on conflict (lower(email)) do nothing;", "values (em, why, src);"),
    ("a repeat overwrites what was stored", "values (em, why, src) on conflict (lower(email)) do nothing;", "values (em, why, src) on conflict (lower(email)) do update set use_case = excluded.use_case;"),
    ("the address is not lower-cased", "em text := lower(btrim(coalesce(p_email, '')));", "em text := btrim(coalesce(p_email, ''));"),
    ("the address is not trimmed", "em text := lower(btrim(coalesce(p_email, '')));", "em text := lower(coalesce(p_email, ''));"),
    ("a bad address is accepted", "if char_length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' then", "if false then"),
    ("an address of any length is accepted", "if char_length(em) > 254 or em !~", "if em !~"),
    ("a long reason is accepted", "if why is not null and (char_length(why) > 140 or why ~ '[[:cntrl:]]') then", "if why is not null and (char_length(why) > 14000 or why ~ '[[:cntrl:]]') then"),
    ("a reason on two lines is accepted", "(char_length(why) > 140 or why ~ '[[:cntrl:]]')", "(char_length(why) > 140)"),
    ("the answer echoes the address", "return jsonb_build_object('ok', true, 'message', 'You are on the list.", "return jsonb_build_object('ok', true, 'email', em, 'message', 'You are on the list."),
    ("a refusal holds the address typed", "raise exception 'That does not look like an email address.' using errcode = '22023';", "raise exception 'That does not look like an email address: %', p_email using errcode = '22023';"),
    ("the function logs the address", "  insert into public.ryagram_waitlist (email, use_case, source) values (em, why, src) on conflict", "  raise notice 'joined %', em;\n  insert into public.ryagram_waitlist (email, use_case, source) values (em, why, src) on conflict"),
    ("the visitor limit is removed", "    if hits > 5 then", "    if false then"),
    ("the visitor limit is one for everybody", "k := encode(sha256(convert_to('waitlist:' || ip || ':' || current_date::text, 'utf8')), 'hex');", "k := encode(sha256(convert_to('waitlist:', 'utf8')), 'hex');"),
    ("the raw address is kept instead of a hash", "values (k, date_trunc('hour', now()))", "values (repeat('0', 64 - length(ip)) || ip, date_trunc('hour', now()))"),
    ("old hit rows are never purged", "    delete from public.ryagram_waitlist_hits where hour < now() - interval '2 days';\n", ""),
    ("the daily cap is removed", "  if today >= 1000 then", "  if false then"),
    ("the daily cap is checked after the repeat check (a full list tells who is on it)", "  select count(*) into today from public.ryagram_waitlist where created_at > now() - interval '24 hours';\n  if today >= 1000 then", "  select count(*) into today from public.ryagram_waitlist where created_at > now() - interval '24 hours' and lower(email) <> em;\n  if today >= 1000 then"),
    ("a bad film label is an error instead of a fallback", "then src := 'uselai.com/ryagram'; end if;", "then raise exception 'bad label' using errcode = '22023'; end if;"),
    ("a signed-in person may call join", "grant execute on function public.join_waitlist(text, text, text) to anon;", "grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;"),
    ("a visitor may read the hit table", "revoke all on public.ryagram_waitlist_hits from public, anon, authenticated, service_role;", "grant select on public.ryagram_waitlist_hits to anon;"),
    ("a visitor may read the approvals table", "revoke all on public.ryagram_waitlist_approvals from public, anon, authenticated, service_role;", "grant select on public.ryagram_waitlist_approvals to anon;"),
    ("a visitor may set approved_at on insert", "grant execute on function public.join_waitlist(text, text, text) to anon;", "grant execute on function public.join_waitlist(text, text, text) to anon;\ngrant insert (approved_at) on public.ryagram_waitlist to anon;"),
    ("the counts are open to any signed-in person", "    raise exception 'Only an admin can see the waiting list counts.' using errcode = '42501';", "    null;"),
    ("approve is open to any signed-in person", "    raise exception 'Only an admin can approve from the waiting list.' using errcode = '42501';", "    null;"),
    ("approve accepts any count", "if coalesce(p_count, 0) not between 1 and 500 then", "if false then"),
    ("approve takes the newest, not the oldest", "order by created_at, id limit p_count", "order by created_at desc, id limit p_count"),
    ("approve also takes people already invited", "where approved_at is null and invited_at is null order by", "where approved_at is null order by"),
    ("approve is not recorded", "  insert into public.ryagram_waitlist_approvals (by_user, n) values (me, n);\n", ""),
    ("approve does not say who approved", "set approved_at = now(), approved_by = me from pick", "set approved_at = now() from pick"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
