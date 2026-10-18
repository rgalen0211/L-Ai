"""Builds supabase/migrations/20261017000600_pipe1_orders.sql (JOB-CONTRACT-v1, frozen) from:
  - pipe1_orders.template.sql  (the new order machinery, hand-written), and
  - the LATEST definitions of the existing functions PIPE-1 must change, extracted from the migration files that
    define them and edited by asserted string replacements (each replacement must match exactly the stated number of
    times, or the build stops) -- so nothing of a live function is retyped by hand.

    python supabase/pipe1/build_pipe1.py .        (from the repo root)
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
MIG = ROOT / "supabase" / "migrations"
HERE = Path(__file__).parent


def extract(fname, signature):
    """The full `create [or replace] function <signature>` ... `end $$;` block from one migration file."""
    text = (MIG / fname).read_text(encoding="utf-8")
    m = re.search(r"^create (or replace )?function " + re.escape(signature), text, re.M)
    assert m, (fname, signature)
    end = text.index("\nend $$;", m.start()) + len("\nend $$;")
    block = text[m.start():end]
    return re.sub(r"^create (or replace )?function", "create or replace function", block, count=1)


def edit(block, *pairs):
    for a, b, n in pairs:
        assert block.count(a) == n, (a[:80], block.count(a), n)
        block = block.replace(a, b)
    return block


INFLIGHT = "'queued', 'claimed', 'running', 'validating', 'uploading'"
INFLIGHT_NEW = "'queued', 'awaiting_approval', 'claimed', 'running', 'validating', 'uploading'"

parts = {}

# 1. version state: a final waiting for Ryan keeps its version 'queued' (no other job can be submitted for it).
parts["SYNC_VERSION_STATE"] = edit(
    extract("20260928000100_2a_core.sql", "ryagram_private.sync_version_state()"),
    ("        when 'queued' then 'queued'\n", "        when 'queued' then 'queued'\n        when 'awaiting_approval' then 'queued'\n", 1))

# 2. submit_job -> the internal submit_job_for(owner, ...) the order machinery calls from triggers, where auth.uid() is the
#    worker; the public submit_job keeps its signature and calls it for the signed-in person.
sj = extract("20260929000400_2a_ladder_engine_commit.sql", "public.submit_job(")
sj = edit(sj,
          ("create or replace function public.submit_job(\n  p_version_id uuid,",
           "create function ryagram_private.submit_job_for(\n  p_owner uuid,\n  p_version_id uuid,", 1),
          ("  p_preview_job_id uuid default null)\nreturns public.jobs",
           "  p_preview_job_id uuid default null,\n  p_state public.job_state default 'queued',\n  p_stage_id uuid default null)\nreturns public.jobs", 1),
          ("  me uuid := ryagram_private.require_signed_in();", "  me uuid := p_owner;", 1),
          (f"j.state in ({INFLIGHT})", f"j.state in ({INFLIGHT_NEW})", 1),
          ("                           ladder_engine_commit)\n",
           "                           ladder_engine_commit, state, stage_id)\n", 1),
          ("            ladder_commit)\n    returning * into result;",
           "            ladder_commit, p_state, p_stage_id)\n    returning * into result;", 1))
assert "p_state not in" not in sj
sj = sj.replace("begin\n  select * into v from public.versions", "begin\n  if p_state not in ('queued', 'awaiting_approval') then\n"
                "    raise exception 'A job starts queued or awaiting approval.' using errcode = '22023';\n  end if;\n"
                "  if p_state = 'awaiting_approval' and p_job_type <> 'final_render' then\n"
                "    raise exception 'Only a full render waits for approval.' using errcode = '22023';\n  end if;\n"
                "  select * into v from public.versions", 1)
parts["SUBMIT_JOB_FOR"] = sj

# 3. cancel_job: a final waiting for approval can be cancelled by its owner (the hold is released by the 2B trigger).
parts["CANCEL_JOB"] = edit(
    extract("20260929000100_2a_not_found_is_404.sql", "public.cancel_job("),
    ("  if j.state = 'queued' then", "  if j.state in ('queued', 'awaiting_approval') then", 1))

# 4. account deletion and dataset deletion count a waiting final as work in progress.
parts["ACCOUNT_DELETION_CHECK"] = edit(
    extract("20261004000200_uploads_schema.sql", "public.account_deletion_check("),
    (f"state in ({INFLIGHT})", f"state in ({INFLIGHT_NEW})", 1))
parts["REQUEST_DATASET_DELETION"] = edit(
    extract("20261004000200_uploads_schema.sql", "public.request_dataset_deletion("),
    (f"j.state in ({INFLIGHT})", f"j.state in ({INFLIGHT_NEW})", 1))

# 5. retry once (Ryan, 2026-10-17): two attempts in all.
parts["CLAIM_NEXT_JOB"] = edit(
    extract("20260928000400_2a_worker_test_fixes.sql", "public.claim_next_job()"),
    ("lost.attempt < 3", "lost.attempt < 2", 3),
    ("lost.attempt >= 3", "lost.attempt >= 2", 1))
# ops_tick's reaper runs claim_next_job's lost-lease block with no worker polling; it must stay row-for-row the same.
parts["REAP_LOST_LEASES"] = edit(
    extract("20261010000100_ops_readiness.sql", "ryagram_private.reap_lost_leases()"),
    ("lost.attempt < 3", "lost.attempt < 2", 3),
    ("lost.attempt >= 3", "lost.attempt >= 2", 1))
parts["RETRY_JOB"] = edit(
    extract("20260928000400_2a_worker_test_fixes.sql", "public.retry_job("),
    ("j.attempt < 3", "j.attempt < 2", 2),
    ("least(j.attempt + 1, 3)", "least(j.attempt + 1, 2)", 1),
    ("j.attempt >= 3", "j.attempt >= 2", 1))

out = (HERE / "pipe1_orders.template.sql").read_text(encoding="utf-8")
schema = (HERE / "story.schema.json").read_text(encoding="utf-8")
import hashlib  # noqa: E402
import json  # noqa: E402
schema_min = json.dumps(json.loads(schema), separators=(",", ":"), sort_keys=True)
assert "$story$" not in schema_min
parts["STORY_SCHEMA_JSON"] = schema_min
parts["STORY_SCHEMA_SHA256"] = hashlib.sha256(schema.encode("utf-8")).hexdigest()
for k, v in parts.items():
    tag = "{{" + k + "}}"
    assert out.count(tag) == 1, (k, out.count(tag))
    out = out.replace(tag, v)
assert "{{" not in out, re.findall(r"\{\{[A-Z_]+\}\}", out)
dst = MIG / "20261017000600_pipe1_orders.sql"
dst.write_text(out, encoding="utf-8", newline="\n")
print("wrote", dst, len(out.splitlines()), "lines")
