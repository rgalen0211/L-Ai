"""Scratch-Postgres harness for the morning live-step sheet (NEXT-CONNECT 138). Builds databases from the supabase stub plus migration files in a CHOSEN ORDER, fingerprints the schema, runs check SQL files.
Run with a Python that has pgserver and psycopg:  python live_steps_harness.py <command>   (commands: order, hazards, steps, diffs <step names>, gen, rollbacks).  Needs LIVE_TREE_SUPABASE if the supabase folder is not this file's parent."""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import pgserver
import psycopg

import os
ROOT = Path(os.environ.get("LIVE_TREE_SUPABASE") or Path(__file__).resolve().parents[1])       # the supabase folder of a checkout that holds every file of the nine steps (the open branches merged in)
STUB = ROOT / "tests" / "supabase_stub.sql"
TEMP = Path(os.environ.get("TEMP") or tempfile.gettempdir()) / "pg-live"
TEMP.mkdir(parents=True, exist_ok=True)

# the nine pending live steps, in the order of the sheet
STEPS = [
    ("Q239 B1", "migrations/20261026000100_trust_label_uploads.sql"),
    ("Q239 B2", "migrations/20261026000200_trust_ack_and_claim.sql"),
    ("Q246 B", "migrations/20261026000300_compilation_requests.sql"),
    ("Q247 B", "migrations/20261026000400_node_compilation_requests.sql"),
    ("Q263 B1", "migrations/20261004000500_worker_job_upload.sql"),
    ("Q263 B2", "migrations/20261004000510_worker_read_policy_follow_up.sql"),
    ("Q264 B", "migrations/20261027000200_uploads_recently_deleted.sql"),
    ("Q262 B (departments)", "migrations/20261027000100_departments.sql"),
    ("Q265 B", "migrations/20261027000300_find_data_fetch.sql"),
]
PENDING = {s[1].split("/")[1] for s in STEPS}
ALL = [ROOT / "ryagram-waitlist.sql", *sorted((ROOT / "migrations").glob("*.sql"))]
LIVE_NOW = [p for p in ALL if p.name not in PENDING]          # what the live database holds before the sheet (every other migration of the merged tree)

FP_SORTED = Path(__file__).resolve().parent / "live-fp-sorted.json"
_server = None


def server():
    global _server
    if _server is None:
        _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-pg-live-", dir=str(TEMP)), cleanup_mode="stop")
    return _server


_n = 0


def newdb(files):
    """A fresh database: the stub, then the files in the order given."""
    global _n
    _n += 1
    name = f"live{_n}"
    with psycopg.connect(server().get_uri(), autocommit=True) as c:
        c.execute(f"create database {name}")
    c = psycopg.connect(server().get_uri(database=name), autocommit=True)
    text = STUB.read_text(encoding="utf-8")
    if _n > 1:                                   # roles are cluster-wide: only the first database creates them
        text = "".join(l for l in text.splitlines(True) if not l.startswith("create role"))
    c.execute(text)
    for f in files:
        c.execute(Path(f).read_text(encoding="utf-8"))
    return c


QUERIES = {
    "columns": "select table_schema||'.'||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','ryagram_private','storage') order by 1",
    "constraints": "select n.nspname||'.'||c.relname||' '||k.conname||' '||pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','ryagram_private') order by 1",
    "indexes": "select schemaname||'.'||tablename||' '||indexdef from pg_indexes where schemaname in ('public','ryagram_private') order by 1",
    "functions": "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(pg_get_functiondef(p.oid))||' acl='||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','ryagram_private') order by 1",
    "triggers": "select tgrelid::regclass::text||' '||tgname||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1",
    "policies": "select schemaname||'.'||tablename||' '||policyname||' '||cmd||' '||roles::text||' '||coalesce(qual,'')||' '||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage') order by 1",
    "tables": "select n.nspname||'.'||c.relname||' rls='||c.relrowsecurity||' acl='||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','ryagram_private') and c.relkind in ('r','v','m') order by 1",
    "enums": "select t.typname||' '||string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid group by t.typname order by 1",
}


def fingerprint(c):
    return {k: [r[0] for r in c.execute(q).fetchall()] for k, q in QUERIES.items()}


def diff(a, b):
    out = []
    for k in a:
        sa, sb = set(a[k]), set(b[k])
        for x in sorted(sa - sb):
            out.append(f"  - {k}: {x[:230]}")
        for x in sorted(sb - sa):
            out.append(f"  + {k}: {x[:230]}")
    return out


def run_check(c, path):
    rows = c.execute(Path(path).read_text(encoding="utf-8")).fetchall()
    return [(r[0], r[1]) for r in rows]


def stop():
    global _server
    if _server is not None:
        _server.cleanup()
        _server = None


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    try:
        if cmd == "order":
            # (1) the normal way: every migration in filename order from scratch;  (2) the live way: what is live now, then the nine steps in the sheet's order
            sorted_db = newdb(ALL)
            f_sorted = fingerprint(sorted_db)
            live_db = newdb(LIVE_NOW)
            f_live0 = fingerprint(live_db)
            for label, rel in STEPS:
                live_db.execute((ROOT / rel).read_text(encoding="utf-8"))
            f_end = fingerprint(live_db)
            d = diff(f_sorted, f_end)
            print("live-now files:", len(LIVE_NOW), "| pending:", len(STEPS), "| fingerprint lines:", {k: len(v) for k, v in f_end.items()})
            print("SHEET ORDER vs NORMAL FILENAME ORDER: " + ("IDENTICAL schema" if not d else f"{len(d)} DIFFERENCES"))
            for line in d:
                print(line)
            FP_SORTED.write_text(json.dumps(f_sorted), encoding="utf-8")
        elif cmd == "hazards":
            f_sorted = json.loads(FP_SORTED.read_text(encoding="utf-8"))
            names = {s[0]: ROOT / s[1] for s in STEPS}
            orders = {
                "the sheet's order reversed": [s[0] for s in reversed(STEPS)],
                "find-data BEFORE recently-deleted": ["Q239 B1", "Q239 B2", "Q246 B", "Q247 B", "Q263 B1", "Q263 B2", "Q265 B", "Q264 B", "Q262 B (departments)"],
                "the two uploads-worker files BEFORE the trust-label ones": ["Q263 B1", "Q263 B2", "Q239 B1", "Q239 B2", "Q246 B", "Q247 B", "Q264 B", "Q262 B (departments)", "Q265 B"],
                "recently-deleted BEFORE the uploads-worker files": ["Q239 B1", "Q239 B2", "Q246 B", "Q247 B", "Q264 B", "Q263 B1", "Q263 B2", "Q262 B (departments)", "Q265 B"],
                "recently-deleted BEFORE the trust-label ones": ["Q264 B", "Q239 B1", "Q239 B2", "Q246 B", "Q247 B", "Q263 B1", "Q263 B2", "Q262 B (departments)", "Q265 B"],
                "departments first, compilation steps last": ["Q262 B (departments)", "Q239 B1", "Q239 B2", "Q263 B1", "Q263 B2", "Q264 B", "Q265 B", "Q246 B", "Q247 B"],
                "the second trust-label file before the first": ["Q239 B2", "Q239 B1", "Q246 B", "Q247 B", "Q263 B1", "Q263 B2", "Q264 B", "Q262 B (departments)", "Q265 B"],
            }
            for label, order in orders.items():
                try:
                    c = newdb(LIVE_NOW)
                    for step in order:
                        try:
                            c.execute(names[step].read_text(encoding="utf-8"))
                        except psycopg.Error as e:
                            print(f"{label}: step {step} FAILED: {str(e).splitlines()[0][:150]}")
                            raise
                    d = diff(f_sorted, fingerprint(c))
                    print(f"{label}: " + ("same schema" if not d else f"{len(d)} DIFFERENCES"))
                    for line in d[:6]:
                        print(line)
                except psycopg.Error:
                    pass
        elif cmd == "steps":
            LS = ROOT / "live-steps"
            checks = {"Q239 B2": LS / "01_q239_after_check.sql", "Q246 B": LS / "02_q246_after_check.sql", "Q247 B": LS / "03_q247_after_check.sql",
                      "Q263 B2": LS / "04_q263_after_check.sql", "Q264 B": LS / "05_q264_after_check.sql", "Q262 B (departments)": LS / "06_departments_after_check.sql",
                      "Q265 B": ROOT / "find-data-live" / "01_after_migration_check.sql"}
            faults = {"Q239 B2": ("grant execute on function ryagram_private.upload_trust_for(uuid,jsonb) to authenticated", "revoke execute on function ryagram_private.upload_trust_for(uuid,jsonb) from authenticated", "nobody"),
                      "Q246 B": ("grant insert on public.compilation_requests to authenticated", "revoke insert on public.compilation_requests from authenticated", "READ their own rows"),
                      "Q247 B": ("grant execute on function public.node_compilation_requests(text) to authenticated", "revoke execute on function public.node_compilation_requests(text) from authenticated", "ONLY the node login"),
                      "Q263 B2": ("grant execute on function ryagram_private.worker_may_read_upload(text) to anon", "revoke execute on function ryagram_private.worker_may_read_upload(text) from anon", "not open to the public"),
                      "Q264 B": ("grant execute on function public.restore_dataset(uuid) to anon", "revoke execute on function public.restore_dataset(uuid) from anon", "not for the public"),
                      "Q262 B (departments)": ("grant select on public.departments to authenticated", "revoke select on public.departments from authenticated", "nobody can touch them"),
                      "Q265 B": ("grant execute on function public.fetch_reserve(uuid,text) to authenticated", "revoke execute on function public.fetch_reserve(uuid,text) from authenticated", "ONLY the service role")}
            c = newdb(LIVE_NOW)
            def board():
                return [(r[0].split("  ")[0].strip(), r[1]) for r in c.execute((LS / "00_status_board.sql").read_text(encoding="utf-8")).fetchall()]
            b0 = board()
            print("STATUS BOARD at the start (the live database as the merged tree has it, minus the nine steps):", b0)
            ok_all = not any(a for _, a in b0)
            for label, rel in STEPS:
                c.execute((ROOT / rel).read_text(encoding="utf-8"))
                if label in checks:
                    rows = run_check(c, checks[label])
                    bad = [r[0] for r in rows if not r[1]]
                    print(f"after {label}: check {checks[label].name}: {len(rows)} rows, " + ("ALL TRUE" if not bad else f"FALSE: {bad}"))
                    ok_all = ok_all and not bad
                    fault, undo, expect = faults[label]
                    c.execute(fault)
                    badf = [r[0] for r in run_check(c, checks[label]) if not r[1]]
                    good = len(badf) == 1 and expect in badf[0]
                    print(f"   planted fault -> {'exactly the expected row goes FALSE' if good else 'UNEXPECTED: ' + str(badf)}")
                    ok_all = ok_all and good
                    c.execute(undo)
                    again = [r[0] for r in run_check(c, checks[label]) if not r[1]]
                    ok_all = ok_all and not again
                done = [n for n, a in board() if a]
                print(f"   status board: {len(done)} of 9 applied")
            b9 = board()
            print("STATUS BOARD at the end:", b9)
            ok_all = ok_all and all(a for _, a in b9)
            print("RESULT:", "ALL CHECKS BEHAVE" if ok_all else "PROBLEMS")
        elif cmd == "diffs":
            c = newdb(LIVE_NOW)
            prev = fingerprint(c)
            for label, rel in STEPS:
                c.execute((ROOT / rel).read_text(encoding="utf-8"))
                cur = fingerprint(c)
                if label in sys.argv[2:]:
                    print(f"=== {label}")
                    for line in diff(prev, cur):
                        print(line[:330])
                prev = cur
        elif cmd == "gen":
            RB = ROOT / "rollbacks"

            def defs(c, sigs):
                out = []
                for sig in sigs:
                    d = c.execute("select pg_get_functiondef(%s::regprocedure)", (sig,)).fetchone()[0]
                    out.append(d.rstrip().rstrip(";") + ";")
                return "\n\n".join(out)

            def state_before(label):
                c = newdb(LIVE_NOW)
                for lb, rel in STEPS:
                    if lb == label:
                        break
                    c.execute((ROOT / rel).read_text(encoding="utf-8"))
                return c

            def hdr(step, what):
                return (f"-- THE EXACT UNDO of {step} ({what}). NOT a migration: it lives outside migrations/ so nothing applies it by itself. Generated from the database state BEFORE that step\n"
                        f"-- (every function below is that state's own definition, as Postgres prints it), and TESTED on a scratch Postgres: applying the step and then this file gives back the identical schema, grants included.\n")

            c = state_before("Q239 B1")
            body = defs(c, ["public.confirm_dataset_mapping(uuid,jsonb)", "public.attach_upload_to_version(uuid,uuid)"])
            (RB / "20261026000100_trust_label_uploads_rollback.sql").write_text(hdr("migrations/20261026000100_trust_label_uploads.sql", "Q239 B1") +
                "-- Undo 20261026000200 FIRST (its own file) if it has been applied: this file assumes the two-argument confirm_dataset_mapping.\n"
                "-- It LOSES the label and the moment of the tick on every dataset, and the label on every film source row (each upload is unverified by definition, so nothing true is lost).\nbegin;\n\n"
                "alter table public.version_sources drop column trust_label;       -- takes its two check rules with it\n"
                "alter table public.datasets drop column trust_label, drop column trust_ack_at;       -- takes its three check rules with it\n\n" + body + "\n\ncommit;\n", encoding="utf-8")
            c = state_before("Q239 B2")
            body = defs(c, ["public.claim_next_job()", "public.node_claim(text)", "public.confirm_dataset_mapping(uuid,jsonb)"])
            (RB / "20261026000200_trust_ack_and_claim_rollback.sql").write_text(hdr("migrations/20261026000200_trust_ack_and_claim.sql", "Q239 B2") +
                "-- It LOSES jobs.upload_trust (the label each job carried for the worker's check) and goes back to the two-argument confirm_dataset_mapping (the database no longer demands the tick).\nbegin;\n\n"
                "drop function public.confirm_dataset_mapping(uuid, jsonb, boolean);\n\n" + body + "\n\n"
                "revoke execute on function public.confirm_dataset_mapping(uuid, jsonb) from public, anon;\ngrant execute on function public.confirm_dataset_mapping(uuid, jsonb) to authenticated;\n\n"
                "drop function ryagram_private.upload_trust_for(uuid, jsonb);\nalter table public.jobs drop column upload_trust;\n\ncommit;\n", encoding="utf-8")
            (RB / "20261004000500_worker_job_upload_rollback.sql").write_text(hdr("migrations/20261004000500_worker_job_upload.sql", "Q263 B1") +
                "-- Undo 20261027000200 and 20261004000510 FIRST if they have been applied (they redefine this function / the read rule). The live worker cannot read an upload after this (uploads are off).\nbegin;\n\n"
                "drop function public.worker_job_upload(uuid);\n\ncommit;\n", encoding="utf-8")
            c = state_before("Q263 B2")
            body = defs(c, ["ryagram_private.worker_may_read_upload(text)"])
            (RB / "20261004000510_worker_read_policy_follow_up_rollback.sql").write_text(hdr("migrations/20261004000510_worker_read_policy_follow_up.sql", "Q263 B2") +
                "-- Goes back to the earlier worker read rule (the one that did not check a requested deletion, a confirmed upload, or the job owner).\nbegin;\n\n" + body + "\n\ncommit;\n", encoding="utf-8")
            c = state_before("Q264 B")
            body = defs(c, ["public.attach_upload_to_version(uuid,uuid)", "public.confirm_dataset_mapping(uuid,jsonb,boolean)", "public.finish_upload(uuid)", "public.request_dataset_deletion(uuid)",
                            "public.sync_version_sources(uuid)", "public.uploads_due_for_deletion(integer)", "public.worker_job_upload(uuid)", "ryagram_private.upload_slot_ok(text)", "ryagram_private.worker_may_read_upload(text)"])
            (RB / "20261027000200_uploads_recently_deleted_rollback.sql").write_text(hdr("migrations/20261027000200_uploads_recently_deleted.sql", "Q264 B") +
                "-- Undo 20261027000300 (find data) FIRST if it has been applied: it builds on this file. Uploads now in Recently deleted are turned into plain deletion requests (the old behaviour: the sweeper removes them);\n"
                "-- nothing in Recently deleted comes back as a usable upload.\nbegin;\n\n"
                "update public.datasets set delete_requested_at = trashed_at where trashed_at is not null and delete_requested_at is null;\n\n" + body + "\n\n"
                "drop function public.restore_dataset(uuid);\ndrop function public.delete_dataset_forever(uuid);\ndrop function public.my_recently_deleted_uploads();\n"
                "drop index public.datasets_trashed_at_idx;\nalter table public.datasets drop column trashed_at;\n\ncommit;\n", encoding="utf-8")
            print("written:", sorted(q.name for q in RB.glob("*.sql")))
        elif cmd == "rollbacks":
            RB = ROOT / "rollbacks"
            files = {"Q239 B1": "20261026000100_trust_label_uploads_rollback.sql", "Q239 B2": "20261026000200_trust_ack_and_claim_rollback.sql", "Q246 B": "20261026000300_compilation_requests_rollback.sql",
                     "Q247 B": "20261026000400_node_compilation_requests_rollback.sql", "Q263 B1": "20261004000500_worker_job_upload_rollback.sql", "Q263 B2": "20261004000510_worker_read_policy_follow_up_rollback.sql",
                     "Q264 B": "20261027000200_uploads_recently_deleted_rollback.sql", "Q262 B (departments)": "20261027000100_departments_rollback.sql", "Q265 B": "20261027000300_find_data_fetch_rollback.sql"}
            c = newdb(LIVE_NOW)
            fps = [fingerprint(c)]
            for label, rel in STEPS:
                c.execute((ROOT / rel).read_text(encoding="utf-8"))
                fps.append(fingerprint(c))
            ok_all = True
            for k in range(len(STEPS), 0, -1):
                label = STEPS[k - 1][0]
                c.execute((RB / files[label]).read_text(encoding="utf-8"))
                d = diff(fps[k - 1], fingerprint(c))
                print(f"undo {label}: " + ("back to the exact schema before the step" if not d else f"{len(d)} DIFFERENCES"))
                for line in d[:8]:
                    print(line)
                ok_all = ok_all and not d
            for label, rel in STEPS:
                c.execute((ROOT / rel).read_text(encoding="utf-8"))
            d = diff(fps[-1], fingerprint(c))
            print("re-applying all nine after undoing all nine: " + ("identical to the first time" if not d else f"{len(d)} DIFFERENCES"))
            for line in d[:8]:
                print(line)
            print("RESULT:", "ALL UNDOS EXACT" if ok_all and not d else "PROBLEMS")
        else:
            print("commands: order, hazards")
    finally:
        stop()
