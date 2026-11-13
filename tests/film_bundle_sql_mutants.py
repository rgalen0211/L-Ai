"""Must-fail proof for supabase/tests/test_film_bundle.py: each mutant breaks ONE rule of migrations/20261113000400_film_bundles.sql (or the shipped ledger) in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/film_bundle_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

M = "supabase/migrations/20261113000400_film_bundles.sql"
L = "supabase/phase-2b/credits_ledger.sql"
W.MIG = M
W.TEST = "supabase/tests/test_film_bundle.py"
W.SCRATCH = W.ROOT / ".mut_fb"
W.RUN_TMP = W.base.BASE_TEMP / f"fb-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("the window need not have A less than B", "if a >= b or b - a > 10 then", "if b - a > 10 then"),
    ("a window may be longer than ten seconds", "if a >= b or b - a > 10 then", "if a >= b or b - a > 1000 then"),
    ("a window may be anything made of digits", "p_seconds !~ '^(0|[1-9][0-9]{0,5}):[1-9][0-9]{0,5}$'", "p_seconds !~ '^[0-9]+:[0-9]+$'"),
    ("a window past the end of a known film is accepted", "if dur is not null and a >= dur then", "if false then"),
    ("a window that starts inside the film is refused", "if dur is not null and a >= dur then", "if dur is not null and b > dur then"),
    ("the length of an older story is used", "and j3.state = 'complete' and j3.story_sha256 = v.story_sha256 and a3.deleted_at is null;", "and j3.state = 'complete' and a3.deleted_at is null;"),
    ("the length of a deleted video is used", "and j3.state = 'complete' and j3.story_sha256 = v.story_sha256 and a3.deleted_at is null;", "and j3.state = 'complete' and j3.story_sha256 = v.story_sha256;"),
    ("a queued window does not jump the queue", "order by case when job_type = ''film_bundle'' and not exists", "order by case when false and not exists"),
    ("a film that has waited is overtaken for ever", "and o.created_at < now() - interval ''2 minutes'') then 0 else 1 end, created_at, id", "and o.created_at < now() - interval ''2 minutes'' and false) then 0 else 1 end, created_at, id"),
    ("a film must wait twenty minutes before it is protected", "and o.created_at < now() - interval ''2 minutes'') then 0 else 1 end, created_at, id", "and o.created_at < now() - interval ''20 minutes'') then 0 else 1 end, created_at, id"),
    ("a waiting job of a type switched off protects itself", "and o.job_type <> all (ctl.disabled_job_types)", ""),
    ("a drifted claim function is changed anyway", "  if n <> 1 then\n    raise exception 'The live function claim_next_job", "  if false then\n    raise exception 'The live function claim_next_job"),
    ("the rollback leaves the bundle types switched on", [("supabase/rollbacks/20261113000400_film_bundles_rollback.sql", "update public.control set disabled_job_types = array(select distinct t from unnest(disabled_job_types || array['film_bundle', 'scene_bundle']::public.job_type[]) t) where id;", "update public.control set disabled_job_types = array(select t from unnest(disabled_job_types) t where t not in ('film_bundle', 'scene_bundle')) where id;")]),
    ("the cache ignores the window", "        and j2.params ->> 'seconds' = p_seconds\n", ""),
    ("a build of another window is taken for this one", "      and story_sha256 = v.story_sha256 and params ->> 'seconds' = p_seconds\n    order by created_at desc limit 1;\n  if found then\n    return query select 'building'", "      and story_sha256 = v.story_sha256\n    order by created_at desc limit 1;\n  if found then\n    return query select 'building'"),
    ("a queued build of an older story is not stopped", "where version_id = v.id and job_type = 'film_bundle' and state = 'queued' and story_sha256 <> v.story_sha256;", "where version_id = v.id and job_type = 'film_bundle' and state = 'queued' and false;"),
    ("a running build of an older story is not told to stop", "state in ('claimed', 'running', 'validating', 'uploading') and story_sha256 <> v.story_sha256;", "state in ('claimed', 'running', 'validating', 'uploading') and false;"),
    ("a window that failed on its input is built again", "and state in ('failed', 'editorial_action_required') and error_class <> 'infrastructure'", "and state in ('failed', 'editorial_action_required') and false"),
    ("a machine failure is never tried again", "and state in ('failed', 'editorial_action_required') and error_class <> 'infrastructure'", "and state in ('failed', 'editorial_action_required')"),
    ("six at once is not enforced", ") >= 6 then", ") >= 600 then"),
    ("sixty an hour is not enforced", ") >= 60 then", ") >= 6000 then"),
    ("an uploaded data film is bundled", "if v.dataset_id is not null then\n    raise exception 'Real-frame previews are for catalog films only for now.'", "if false then\n    raise exception 'Real-frame previews are for catalog films only for now.'"),
    ("anyone's film can be asked about", "select * into v from public.versions where id = p_version_id and owner_id = me for update;", "select * into v from public.versions where id = p_version_id for update;"),
    ("a visitor may call the request", "revoke execute on function public.request_film_bundle(uuid, text) from public, anon;", "select 1;"),
    ("a bundle can be made by submit_job or a direct insert", "  for each row execute function ryagram_private.film_bundle_by_request();", "  for each row execute function ryagram_private.film_bundle_by_request();\nalter table public.jobs disable trigger jobs_film_bundle_by_request;"),
    ("bundles start switched on", "array['film_bundle', 'scene_bundle']::public.job_type[]) t)", "array[]::public.job_type[]) t)"),
    ("a scene bundle can be made", "raise exception 'Scene bundles are not available yet.' using errcode = '42501';", "null;"),
    ("the scene bundle's file is not what the worker expects", "('scene_bundle', 'scene.bundle.zip', 'application/zip', 50000000),", "('scene_bundle', 'scene.bundle.zip', 'application/zip', 40000000),"),
    ("the scene bundle may upload a film bundle", "when 'scene_bundle' then k in ('scene_bundle', 'metering')", "when 'scene_bundle' then k in ('scene_bundle', 'metering', 'film_bundle')"),
    ("the scene bundle needs nothing", "when 'scene_bundle' then array['scene_bundle']::public.artifact_kind[]", "when 'scene_bundle' then array[]::public.artifact_kind[]"),
    ("a bundle file may be any size", "('film_bundle', 'film.bundle.zip', 'application/zip', 50000000)", "('film_bundle', 'film.bundle.zip', 'application/zip', 5000000000)"),
    ("a bundle job may upload a preview", "when 'film_bundle' then k in ('film_bundle', 'metering')", "when 'film_bundle' then k in ('film_bundle', 'metering', 'preview')"),
    ("a bundle job may finish without its bundle", "when 'film_bundle' then array['film_bundle']::public.artifact_kind[]", "when 'film_bundle' then array[]::public.artifact_kind[]"),
    ("the bucket does not accept a zip", "allowed_mime_types || array['application/zip']", "allowed_mime_types || array['application/json']"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
    ("the migration teaches the ledger to price a bundle at a film's price", "new.price_code := ''film_bundle'';", "new.price_code := ''final_map'';"),
    ("the migration teaches the quote the wrong code", "then code := ''film_bundle'';\\n' || a2;", "then code := ''final_map'';\\n' || a2;"),
    ("a drifted ledger is changed anyway", "  if n <> 1 then\n    raise exception 'The live function jobs_quote", "  if false then\n    raise exception 'The live function jobs_quote"),
    ("the free price row costs credits", "select p.price_version, 'film_bundle', 0, null, false,", "select p.price_version, 'film_bundle', 5, null, false,"),
    ("the shipped ledger prices a bundle at a film's price", [(L, "    new.price_code := 'film_bundle';                     -- film bundles are free (20261113000400)", "    new.price_code := 'final_map';                     -- film bundles are free (20261113000400)")]),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
