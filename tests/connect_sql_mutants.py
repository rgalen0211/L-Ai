"""Must-fail proof for supabase/tests/test_connect.py: each mutant breaks ONE rule in a scratch copy of the connect migration and
the connect SQL tests must then FAIL. Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/connect_sql_mutants.py
Exit 0 only when every mutant is caught.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".mut_sql"
MIG = "supabase/migrations/20261018000100_connect_ai.sql"

MUTANTS = [
    ("token revoked is not checked", "k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now()",
     "k.access_hash = p_token_hash and k.access_expires_at > now()"),
    ("token expiry is not checked", "k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now();",
     "k.access_hash = p_token_hash and k.revoked_at is null;"),
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
]


def run():
    missed = 0
    for name, old, new in MUTANTS:
        shutil.rmtree(SCRATCH, ignore_errors=True)
        (SCRATCH / "supabase").mkdir(parents=True)
        shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", dirs_exist_ok=True)
        (SCRATCH / "tests").mkdir(exist_ok=True)
        # tests/supabase_stub.sql is read from <supabase>/tests; the copy above already holds it
        path = SCRATCH / MIG
        text = path.read_text(encoding="utf-8")
        if old not in text:
            print(f"BROKEN MUTANT (text not found): {name}")
            missed += 1
            continue
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        r = subprocess.run([sys.executable, "-m", "unittest", "supabase/tests/test_connect.py"], cwd=SCRATCH, capture_output=True, text=True)
        caught = r.returncode != 0
        print(("caught  " if caught else "MISSED  ") + name)
        missed += 0 if caught else 1
    shutil.rmtree(SCRATCH, ignore_errors=True)
    print(f"{missed} mutant(s) not caught" if missed else f"all {len(MUTANTS)} mutants caught")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(run())
