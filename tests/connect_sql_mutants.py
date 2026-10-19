"""Must-fail proof for supabase/tests/test_connect.py: each mutant breaks ONE rule in a scratch copy of the connect migration and
the connect SQL tests must then FAIL. Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/connect_sql_mutants.py
Exit 0 only when every mutant is caught: CAUGHT means the tests FAILED ON AN ASSERTION (an error, a broken migration or a full disk does not count).
Each mutant's pgserver folder (about 1 GB) is deleted before the next one starts. `--selftest` proves the harness itself; names after the script
run only those mutants.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".mut_sql"
MIG = "supabase/migrations/20261018000100_connect_ai.sql"

MUTANTS = [
    ("token revoked is not checked", "connect_tokens k\n    where k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now()",
     "connect_tokens k\n    where k.access_hash = p_token_hash and k.access_expires_at > now()"),
    ("token expiry is not checked", "connect_tokens k\n    where k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now();",
     "connect_tokens k\n    where k.access_hash = p_token_hash and k.revoked_at is null;"),
    ("invitation / admin check removed from the actor", "if not ryagram_private.connect_person_ok(t.owner_id)\n     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id\n                    and g.revoked_at is null and (p_scope is null or p_scope = any (g.scopes)))",
     "if false\n     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id\n                    and g.revoked_at is null and (p_scope is null or p_scope = any (g.scopes)))"),
    ("grant revocation not checked by the actor", "and g.revoked_at is null and (p_scope is null or p_scope = any (g.scopes)))",
     "and (p_scope is null or p_scope = any (g.scopes)))"),
    ("token scope not checked by the actor", "or (p_scope is not null and not (p_scope = any (t.scopes))) then", "or false then"),
    ("PKCE verifier not checked at exchange", "or translate(rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='), '+/', '-_') <> k.code_challenge then",
     "then"),
    ("a replayed code does not revoke what it made", "update public.connect_tokens set revoked_at = now() where family_id = k.family_id and revoked_at is null;\n    return bad;",
     "return bad;"),
    ("refresh-token reuse does not revoke the family", "update public.connect_tokens set revoked_at = now() where family_id = t.family_id and revoked_at is null;\n    return bad;",
     "return bad;"),
    ("any https redirect URI accepted", "exists (select 1 from public.connect_redirect_allowlist a\n            where a.enabled and a.kind = 'exact' and a.redirect_uri = p_uri and",
     "exists (select 1 from public.connect_redirect_allowlist a\n            where a.enabled and a.kind = 'exact' and"),
    ("plain PKCE accepted", "if p_method is distinct from 'S256' then", "if false then"),
    ("connect_runner can read a table", "-- ---------------------------------------------------------------------------------------------------- tables",
     "grant select on public.projects to connect_runner;\n-- tables"),
    ("connect_runner can execute an app function", "-- ---------------------------------------------------------------------------------------------------- tables",
     "grant execute on function public.submit_job(uuid, public.job_type, jsonb, uuid, uuid) to connect_runner;\n-- tables"),
    ("a connect function takes an owner id", "create function public.connect_final_enabled()",
     "create function public.connect_owner_peek(p_owner uuid) returns text language sql security definer set search_path = '' as $$ select email from auth.users where id = p_owner $$;\ngrant execute on function public.connect_owner_peek(uuid) to connect_runner;\ncreate function public.connect_final_enabled()"),
    ("the app-session guard against client_id tokens removed", "if nullif(auth.jwt() ->> 'client_id', '') is not null then", "if false then"),
    ("an admin may consent", "and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)", ""),
    ("full render can be started from a connection", "raise exception 'Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.' using errcode = '42501';",
     "select * into j from public.submit_job(p_version, 'final_render', '{}'::jsonb, p_sheet, p_preview); return jsonb_build_object('id', j.id, 'state', j.state);"),
    ("a locked version can be edited through a tool", "if v.state not in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then\n    raise exception 'This version is locked",
     "if false then\n    raise exception 'This version is locked"),
    ("disconnect leaves the tokens alive", "update public.connect_tokens set revoked_at = now() where owner_id = me and client_id = p_client_id and revoked_at is null;", ""),
    ("claims survive the call (set_config not transaction-local)", "perform set_config('request.jwt.claims', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, true);",
     "perform set_config('request.jwt.claims', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, false);"),
    ("another person's version is readable", "select * into v from public.versions where id = p_version and owner_id = me;\n  if not found then raise exception 'Version not found.' using errcode = 'PT404'; end if;\n  select * into p from",
     "select * into v from public.versions where id = p_version;\n  if not found then raise exception 'Version not found.' using errcode = 'PT404'; end if;\n  select * into p from"),

    ("connect_hit has no per-client key", "p_bucket || case when p_bucket = 'calls' then ':' || cli else '' end", "p_bucket"),
    ("a NULL client skips the binding at exchange", "k.client_id is distinct from p_client_id", "k.client_id <> p_client_id"),
    ("a NULL client skips the binding at refresh", "t.client_id is distinct from p_client_id", "t.client_id <> p_client_id"),
    ("a failed exchange does not burn the code", "update public.connect_codes set used_at = now() where code_hash = p_code_hash;      -- a failed attempt burns the code (OAuth 2.1)", ""),
    ("free is not free: a costing job is submitted", "if coalesce((public.connect_quote(p_token_hash, p_version, p_job_type) ->> 'credits')::int, 0) > 0 then", "if false then"),
    ("worker accounts can be connected", "     and not exists (select 1 from public.workers w where w.user_id = p_owner)\n", ""),
    ("unknown scopes default to everything offered", "if cardinality(want) = 0 then want := array['read']; end if;", "if cardinality(want) = 0 then want := ryagram_private.connect_offered_scopes(); end if;"),
    ("a deny redirects without the allowlist check", "if not ryagram_private.connect_uri_ok(r.redirect_uri) then\n    raise exception 'This assistant''s return address", "if false then\n    raise exception 'This assistant''s return address"),
    ("an admin function accepts a token with a client_id", "perform ryagram_private.connect_app_session();\n  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;\n  select id into target",
     "if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;\n  select id into target"),
    ("client names may hold control or bidi characters", " or p_name ~ '[[:cntrl:]\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]' then", " then"),
    ("no cap on open sign-in requests per client", "q.decided_at is null and q.expires_at > now()) >= 20 then", "q.decided_at is null and q.expires_at > now()) >= 2000000 then"),
    ("the purge deletes rotated refresh rows early", "delete from public.connect_tokens where refresh_expires_at < now() - interval '1 day'",
     "delete from public.connect_tokens where revoked_at < now() - interval '7 days' or refresh_expires_at < now() - interval '1 day'"),
    ("unused clients are never purged", "delete from public.connect_clients c where c.created_at < now() - interval '7 days'", "delete from public.connect_clients c where false and c.created_at < now() - interval '7 days'"),
    ("connect_log records any hash", "  if not found then return; end if;                    -- an unknown hash is not logged: anyone holding the runner credentials could flood the table\n", ""),
    ("consent shows the client's own name as the label", "'redirect_label', case when", "'redirect_label', c.name, 'unused', case when"),
    ("connect_anon_hit accepts a caller that is not a hash", "p_caller is null or p_caller !~ '^[0-9a-f]{64}$' or ", ""),
    ("exchange does not re-check the person", "  if not ryagram_private.connect_person_ok(k.owner_id)\n     or not exists", "  if false\n     or not exists"),
    ("exchange does not re-check the grant", "g.owner_id = k.owner_id and g.client_id = k.client_id and g.revoked_at is null) then\n    return bad;", "g.owner_id = k.owner_id and g.client_id = k.client_id) then\n    return bad;"),
    ("refresh does not check expiry", "if t.refresh_expires_at < now() or not ryagram_private.connect_person_ok(t.owner_id)", "if false or not ryagram_private.connect_person_ok(t.owner_id)"),
    ("refresh does not re-check the person", "or not ryagram_private.connect_person_ok(t.owner_id)\n     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id and g.revoked_at is null) then",
     "or false\n     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id and g.revoked_at is null) then"),
    ("refresh does not re-check the grant", "g.owner_id = t.owner_id and g.client_id = t.client_id and g.revoked_at is null) then\n    return bad;\n  end if;\n  if not grace then", "g.owner_id = t.owner_id and g.client_id = t.client_id) then\n    return bad;\n  end if;\n  if not grace then"),
    ("consent request expiry is not checked at decide", "if not found or r.decided_at is not null or r.expires_at < now() then\n    raise exception 'This sign-in request has expired.", "if not found or r.decided_at is not null then\n    raise exception 'This sign-in request has expired."),
    ("consent_check does not notice a redirect that left the list", "elsif not ryagram_private.connect_uri_ok(r.redirect_uri) then why :=", "elsif false then why :="),
    ("connect_runner is given the purge function", "public.connect_job(text, uuid), public.connect_current_engine(text)\n  to connect_runner;",
     "public.connect_job(text, uuid), public.connect_current_engine(text), public.connect_purge()\n  to connect_runner;"),
    ("the charge is not re-checked after the job is created (check-then-act race)", "  if coalesce((to_jsonb(j) ->> 'credits_quoted')::int, 0) > 0 then\n    raise exception", "  if false then\n    raise exception"),
    ("iss is left off the redirect that carries the code", "'code=' || code || case when r.state is null then '' else '&state=' || ryagram_private.connect_pct(r.state) end\n                                            || case when r.issuer is null then '' else '&iss=' || ryagram_private.connect_pct(r.issuer) end);",
     "'code=' || code || case when r.state is null then '' else '&state=' || ryagram_private.connect_pct(r.state) end);"),
    ("the realtime guard is not applied to the published tables", "select ryagram_private.connect_guard_published_tables();\n", ""),
    ("refresh retry grace is zero seconds", "t.refresh_used_at > now() - interval '60 seconds'", "t.refresh_used_at > now() - interval '0 seconds'"),
    ("refresh retry grace never ends", "t.refresh_used_at is not null and t.refresh_used_at > now() - interval '60 seconds'", "t.refresh_used_at is not null"),
    ("refresh retry grace still applies after the family was killed", "and not exists (select 1 from public.connect_tokens x where x.family_id = t.family_id and x.revoked_at is not null and x.refresh_used_at is null) then", "then"),
    ("refresh no longer slides the 30 days", "now() + interval '1 hour', p_new_refresh_hash, now() + interval '30 days');", "now() + interval '1 hour', p_new_refresh_hash, t.refresh_expires_at);"),
    ("refresh retry grace can be used any number of times", "interval '60 seconds' and t.grace_used_at is null", "interval '60 seconds'"),
    ("refresh retry grace is never marked as used", "set grace_used_at = now() where id = t.id;", "set grace_used_at = null where id = t.id;"),
    ("list_versions has no owner filter", "from public.versions v where v.project_id = p_project and v.owner_id = me), '[]'::jsonb);", "from public.versions v where v.project_id = p_project), '[]'::jsonb);"),
    ("current_version has no owner filter", "where v.project_id = p_project and v.owner_id = me and p.owner_id = me and p.archived_at is null", "where v.project_id = p_project and p.archived_at is null"),
    ("create_version needs only the read scope", "connect_actor(p_token_hash, 'write'); v public.versions;\nbegin\n  select * into v from public.create_version(p_project, p_from);", "connect_actor(p_token_hash, 'read'); v public.versions;\nbegin\n  select * into v from public.create_version(p_project, p_from);"),
    ("the realtime check ignores what the policy tests", "= 'selectauth.jwt->>''client_id''isnull')", "like '%client_id%')"),
    ("the realtime check ignores which role the policy is for", "\n                        and (pol.polroles = '{0}'::pg_catalog.oid[] or 'authenticated'::pg_catalog.regrole::pg_catalog.oid = any (pol.polroles))", ""),
    ("the realtime check ignores whether the policy is restrictive", "and not pol.polpermissive and pol.polcmd in ('r', '*')", "and pol.polcmd in ('r', '*')"),
    ("the master switch is ignored by the actor", "  if not ryagram_private.connect_on() then\n    raise exception 'AI connections to Ryagram are switched off right now.' using errcode = 'PT403';\n  end if;\n  if p_token_hash is null", "  if p_token_hash is null"),
    ("the master switch is ignored by connect_scopes", "  if not ryagram_private.connect_on() then return null; end if;\n", ""),
    ("the master switch is ignored by registration", "  if not ryagram_private.connect_on() then raise exception 'unavailable: AI connections are switched off right now' using errcode = 'PT400'; end if;\n  if p_name is null", "  if p_name is null"),
    ("the master switch is ignored by refresh", "  if not ryagram_private.connect_on() then return bad; end if;\n  select * into t from public.connect_tokens where refresh_hash", "  select * into t from public.connect_tokens where refresh_hash"),
    ("the master switch is ignored by consent decide", "  if not ryagram_private.connect_on() then\n    raise exception 'AI connections to Ryagram are switched off right now.' using errcode = '42501';\n  end if;\n  select * into r from public.connect_requests where id = p_request for update;", "  select * into r from public.connect_requests where id = p_request for update;"),
    ("the switch can be flipped by a non-admin", "  perform ryagram_private.connect_app_session();\n  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;\n  update public.connect_flags set connections_enabled", "  perform ryagram_private.connect_app_session();\n  update public.connect_flags set connections_enabled"),
    ("revoke-all leaves grants alive", "  update public.connect_grants set revoked_at = now() where revoked_at is null;\n  return n;", "  return n;"),
    ("a sign-in request lives only 10 minutes again", "default now() + interval '30 minutes',", "default now() + interval '10 minutes',"),
    ("a helper function with no revoke (only the realistic-defaults test sees it)", "-- --------------------------------------------------------------------------------------------------- grants\n",
     "create function public.helper_without_revoke() returns int language sql as $$ select 1 $$;\n-- grants\n"),
]


# ----------------------------------------------------------------------------------------------------------- the runner
# Rules (CC1 15:19, after a gate run left 66 pgserver folders of about 1 GB each and filled D:):
#  1. Every mutant run gets its OWN temp folder; the pgserver data folder the tests create inside it is stopped and DELETED before the next mutant
#     starts and at exit. A folder that cannot be removed stops the whole run (never fill the disk and carry on).
#  2. At most ONE pgserver folder may exist in a mutant's temp (the tests start one server per process); more than one stops the run.
#  3. A mutant counts as CAUGHT only when the tests FAIL ON AN ASSERTION (unittest "FAIL:"), never because they ERRORED (a broken migration, a full
#     disk, a setup failure): errors are reported as NOT CAUGHT. The unmutated copy must pass first (baseline).
#  4. Free space on the temp drive is checked before every run.
PG_DIR = re.compile(r"^ryagram-pg-")
MIN_FREE_GB = float(os.environ.get("CONNECT_MUT_MIN_FREE_GB", "8"))
BASE_TEMP = Path(os.environ.get("TEMP") or tempfile.gettempdir())
RUN_TMP = BASE_TEMP / f"connect-mut-{os.getpid()}"


class HarnessError(RuntimeError):
    pass


def pg_dirs(root):
    return sorted(p for p in Path(root).iterdir() if p.is_dir() and PG_DIR.match(p.name)) if Path(root).exists() else []


def classify(output, returncode):
    """('caught' | 'survived' | 'errored', failures, errors). caught only on assertion failures; survived = all tests passed."""
    m = re.search(r"^FAILED \(([^)]*)\)\s*$", output, flags=re.M)
    failures = errors = 0
    if m:
        f = re.search(r"failures=(\d+)", m.group(1))
        e = re.search(r"errors=(\d+)", m.group(1))
        failures = int(f.group(1)) if f else 0
        errors = int(e.group(1)) if e else 0
    ran = re.search(r"^Ran (\d+) tests? in ", output, flags=re.M)
    if returncode == 0 and ran and not m:
        return "survived", 0, 0
    if failures >= 1:
        return "caught", failures, errors
    return "errored", failures, errors            # errors only, or no summary at all (killed, disk full, setup failure)


def _pg_ctl():
    import pgserver
    return Path(pgserver.__file__).parent / "pginstall" / "bin" / ("pg_ctl.exe" if os.name == "nt" else "pg_ctl")


def remove_pg_folders(root):
    """Stop any server still running in a pgserver folder under root, delete the folders, and prove they are gone."""
    for d in pg_dirs(root):
        data = d / "pgdata" if (d / "pgdata").exists() else d
        if (data / "postmaster.pid").exists():
            try:
                subprocess.run([str(_pg_ctl()), "stop", "-D", str(data), "-m", "immediate", "-w", "-t", "30"], capture_output=True, timeout=60)
            except Exception:
                pass
    for d in pg_dirs(root):
        for attempt in range(15):
            shutil.rmtree(d, ignore_errors=True)
            if not d.exists():
                break
            time.sleep(1)
    left = pg_dirs(root)
    if left:
        raise HarnessError(f"could not remove {len(left)} pgserver folder(s) in {root}: {[p.name for p in left]}; stopping before the disk fills")


def free_gb(path):
    return shutil.disk_usage(path).free / 1e9


def one_run(label, mutate=None, env_override=None):
    """Run test_connect once on a scratch copy (optionally mutated). Returns (verdict, failures, errors)."""
    if free_gb(BASE_TEMP) < MIN_FREE_GB:
        raise HarnessError(f"only {free_gb(BASE_TEMP):.1f} GB free on the temp drive (need {MIN_FREE_GB}); stopping")
    RUN_TMP.mkdir(parents=True, exist_ok=True)
    left = pg_dirs(RUN_TMP) + pg_dirs(RUN_TMP / "t")
    if left:
        raise HarnessError(f"a pgserver folder was left behind before {label}: {[p.name for p in left]}")
    shutil.rmtree(SCRATCH, ignore_errors=True)
    (SCRATCH / "supabase").mkdir(parents=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", dirs_exist_ok=True)
    (SCRATCH / "tests").mkdir(exist_ok=True)
    path = SCRATCH / MIG
    if mutate is not None:
        old, new = mutate
        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if old not in text:
            return "broken", 0, 0
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
    mut_tmp = RUN_TMP / "t"
    mut_tmp.mkdir(exist_ok=True)
    env = dict(os.environ, TEMP=str(mut_tmp), TMP=str(mut_tmp), TMPDIR=str(mut_tmp), PYTHONDONTWRITEBYTECODE="1")
    env.update(env_override or {})
    proc = subprocess.Popen([sys.executable, "-u", "-m", "unittest", "supabase/tests/test_connect.py"], cwd=SCRATCH, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        out, _ = proc.communicate(timeout=1800)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True) if os.name == "nt" else proc.kill()
        out, _ = proc.communicate()
        out += "\nTIMEOUT: killed after 30 minutes\n"
    verdict = classify(out, proc.returncode)
    try:
        n = len(pg_dirs(mut_tmp))
        if n > 1:
            raise HarnessError(f"{label}: {n} pgserver folders in one mutant's temp (the tests start one server per process)")
        if n == 0 and verdict[0] != "errored":
            # the tests ran but their server is not where we can see and delete it: it went to a fallback temp folder (possibly C:)
            raise HarnessError(f"{label}: the tests ran but left no pgserver folder in the controlled temp {mut_tmp}; they used another location")
    finally:
        remove_pg_folders(mut_tmp)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    return verdict


def run(only=None):
    bad = 0
    try:
        verdict, f, e = one_run("baseline")
        print(f"baseline (unmutated): {verdict}")
        if verdict != "survived":
            print("BASELINE FAILED: the unmutated tests must pass before any mutant means anything")
            return 2
        selected = [m for m in MUTANTS if not only or m[0] in only]
        for name, old, new in selected:
            verdict, f, e = one_run(name, (old, new))
            if verdict == "caught":
                print(f"caught  {name}  (assertion failures: {f})")
            elif verdict == "broken":
                print(f"BROKEN MUTANT (text not found): {name}")
                bad += 1
            elif verdict == "errored":
                print(f"NOT CAUGHT (the tests ERRORED, they did not FAIL on an assertion; errors={e}): {name}")
                bad += 1
            else:
                print(f"MISSED  {name}")
                bad += 1
    except HarnessError as err:
        print(f"HARNESS STOPPED: {err}")
        return 3
    finally:
        remove_left = RUN_TMP.exists()
        if remove_left:
            try:
                remove_pg_folders(RUN_TMP)
            finally:
                shutil.rmtree(RUN_TMP, ignore_errors=True)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print(f"{bad} mutant(s) not caught" if bad else f"all {len(selected)} mutants caught")
    return 1 if bad else 0


def selftest():
    """Must-fail for the harness itself: a mutant whose tests ERROR is NOT caught; a setup failure is NOT caught; a real rule break IS caught."""
    ok = True
    try:
        v, f, e = one_run("selftest: broken SQL", ("create table public.connect_access", "create tabel public.connect_access"))
        print(f"  broken migration -> {v} (errors={e}, failures={f})  expected: errored"); ok &= (v == "errored")
        v, f, e = one_run("selftest: setup failure", ("create table public.connect_access", "select 1 / 0;\ncreate table public.connect_access"))
        print(f"  migration that fails while loading (setup failure) -> {v} (errors={e}, failures={f})  expected: errored"); ok &= (v == "errored")
        m = [x for x in MUTANTS if x[0] == "a sign-in request lives only 10 minutes again"][0]
        v, f, e = one_run("selftest: real rule break", (m[1], m[2]))
        print(f"  a real rule break -> {v} (failures={f})  expected: caught"); ok &= (v == "caught")
        left = pg_dirs(RUN_TMP / "t") if (RUN_TMP / "t").exists() else []
        print(f"  pgserver folders left in the run temp: {len(left)}  expected: 0"); ok &= (not left)
    except HarnessError as err:
        print(f"HARNESS STOPPED: {err}")
        return 3
    finally:
        shutil.rmtree(RUN_TMP, ignore_errors=True)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print("SELFTEST " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def broken_targets():
    """Names of mutants whose target text is not in the migration EXACTLY ONCE (LF text), or whose replacement equals it. Fast: no database."""
    text = (ROOT / MIG).read_text(encoding="utf-8").replace("\r\n", "\n")
    return [name for name, old, new in MUTANTS if text.count(old) != 1 or old == new]        # exactly once: replace(old, new, 1) must hit the function meant


def duplicate_names():
    names = [m[0] for m in MUTANTS]
    return sorted({n for n in names if names.count(n) > 1})


if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b, d = broken_targets(), duplicate_names()
        print(f"{len(MUTANTS)} mutants; broken targets: {b or 'none'}; duplicate names: {d or 'none'}")
        sys.exit(1 if (b or d) else 0)
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    sys.exit(run(only or None))
