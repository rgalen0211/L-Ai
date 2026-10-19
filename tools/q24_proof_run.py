"""Runs tools/q24_smoke.py against the PROOF project with a SIMULATED render machine (PROOF ONLY; INTERNAL, CONNECT 2026-10-19).

    py tools/q24_proof_run.py           (needs the proof .env and test account outside the repo, like the other proof tools)

The proof project has no PC worker, so a contact-sheet job would sit 'queued' for ever. To prove the smoke script's step 9 (follow the job through its words
to 'finished') and step 10 (the result link) end to end, a helper thread moves the smoke's new job through queued -> claimed -> running -> validating ->
uploading -> complete with plain SQL on the proof database, a few seconds apart. That is a stand-in for WORKER's real machine; the real timing (about 3.5
minutes) can only be seen on live with the real worker."""
from __future__ import annotations

import re
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import psycopg  # noqa: E402
from connect_proof_guard import require_proof  # noqa: E402
import q24_smoke  # noqa: E402

ENV = Path("D:/Ryagram-scratch/oauth-proof/.env")
ACCT = Path("D:/Ryagram-scratch/oauth-proof/connect-test-account.json")
env = q24_smoke.read_env(ENV)
require_proof(env["SUPABASE_URL"], env["SUPABASE_DB_URL"])
DB = env["SUPABASE_DB_URL"]
STATES = ["claimed", "running", "validating", "uploading", "complete"]
done = {"ok": False, "why": ""}


def pretend_worker():
    try:
        with psycopg.connect(DB, autocommit=True, prepare_threshold=None) as c:
            job = None
            started = c.execute("select now()").fetchone()[0]       # only a job queued AFTER this moment is ours (older proof jobs stay as they are)
            for _ in range(240):                                   # up to 2 minutes for the smoke to queue its job
                row = c.execute("select id from public.jobs where state = 'queued' and job_type = 'contact_sheet' and created_at > %s order by created_at desc limit 1", (started,)).fetchone()
                if row:
                    job = row[0]
                    break
                time.sleep(0.5)
            if not job:
                done["why"] = "no queued contact-sheet job appeared"
                return
            time.sleep(2.5)
            for s in STATES:
                c.execute("update public.jobs set state = %s::public.job_state where id = %s", (s, job))
                time.sleep(2.5)
            done["ok"] = True
    except Exception as e:                                          # noqa: BLE001
        done["why"] = type(e).__name__ + ": " + str(e).split("\n")[0][:120]


if __name__ == "__main__":
    t = threading.Thread(target=pretend_worker, daemon=True)
    t.start()
    sys.argv = ["q24_smoke.py", "--env-file", str(ENV), "--account-file", str(ACCT), "--wait-minutes", "2", "--poll-seconds", "1", "--preview"]
    rc = q24_smoke.main()
    t.join(timeout=5)
    print(f"\n(simulated render machine: {'moved the job to complete' if done['ok'] else 'did not finish: ' + done['why']})")
    sys.exit(rc)
