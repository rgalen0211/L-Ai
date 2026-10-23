"""The PAPER SQL for a private delivery link of a compilation built on the person's own PC (NEXT-CONNECT 119), applied to a THROWAWAY Postgres built from the real migrations and tried as the real
roles (node_runner, authenticated, service_role). LOCAL ONLY. Run with the same arguments as the r9 harness (tools/e2e-ride/run.ps1 sets them), with -Check delivery:

    python tools/e2e-ride/delivery_sql_check.py

It proves the draft does what the paper says: only a flagged tester can start, one upload at a time, caps on a film and on a person, the stored size must match, the link is the owner's alone,
it ends after the days, a deleted or foreign one is refused, the purge hands each object over once. It is evidence for the SQL, NOT for the edge function, the app or the page (not built)."""
import os
import sys
import tempfile
import shutil
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "r9-e2e"))
import e2e  # noqa: E402  (prints the heads under test and refuses a dirty checkout)

e = e2e
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def raises(fn, needle):
    try:
        fn()
    except Exception as ex:                                                                  # noqa: BLE001
        return needle.lower() in str(ex).lower()
    return False


def main():
    base = Path(tempfile.mkdtemp(prefix="ryagram-pg-deliv-"))
    srv = None
    try:
        srv = e.pgserver.get_server(base, cleanup_mode="stop")
        with e.psycopg.connect(srv.get_uri(), autocommit=True) as c:
            c.execute("create database dsql")
        uri = srv.get_uri(database="dsql")
        sam, bob, other = (str(uuid.UUID(int=i)) for i in (301, 302, 303))
        draft = (e.APP_REPO / "supabase" / "connect-drafts" / "compilation_delivery_draft.sql")
        with e.psycopg.connect(uri, autocommit=True) as c:
            c.execute((e.core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
            for p in e.schema_files(e.core):
                c.execute(p.read_text(encoding="utf-8"))
            c.execute("insert into auth.users (id, email) values (%s,'sam@example.test'),(%s,'bob@example.test'),(%s,'other@example.test')", (sam, bob, other))
            c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (sam,))
            c.execute("insert into public.account_settings (owner_id) values (%s) on conflict (owner_id) do nothing", (bob,))
            c.execute("insert into public.node_tokens (user_id, computer_name, token_hash) values (%s,'Sam-PC',%s),(%s,'Bob-PC',%s)", (sam, "a" * 64, bob, "b" * 64))
            check(True, "the real migrations are applied in a throwaway database")
            c.execute(draft.read_text(encoding="utf-8"))
            check(True, "the PAPER draft applies on top of them without an error")
        u = e.urlparse(srv.get_uri())
        e_pw = "d-" + uuid.uuid4().hex
        with e.psycopg.connect(uri, autocommit=True) as c:
            c.execute(e.psycopg.sql.SQL("alter role node_runner login password {}").format(e.psycopg.sql.Literal(e_pw)))
        runner = e.psycopg.connect(host=u.hostname, port=u.port, dbname="dsql", user="node_runner", password=e_pw, autocommit=True)
        db = e.core.Db(uri)
        admin = e.core.Db(uri).as_(None)
        A, B = "a" * 64, "b" * 64
        sha = "c" * 64

        def begin(h, title="My compilation", nbytes=1000, sh=sha):
            return runner.execute("select public.node_compilation_begin(%s,%s,%s,%s,2.5,640,360)", (h, title, nbytes, sh)).fetchone()[0]

        def finish(h, i):
            return runner.execute("select public.node_compilation_finish(%s,%s)", (h, i)).fetchone()[0]

        def store(path, size):
            admin.c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, jsonb_build_object('size', %s::bigint)) on conflict do nothing", (path, size))

        print("\n1. who may start")
        check(raises(lambda: begin(B), "not switched on"), "a person who is NOT a flagged tester cannot start (nothing is created)")
        check(admin.one("select count(*) from compilation_deliveries") == 0, "and no row was made")
        check(raises(lambda: runner.execute("select public.node_compilation_begin(%s,'x',10,%s)", ("f" * 64, sha)), "sign this computer in"), "an unknown token is refused")
        check(raises(lambda: begin(A, nbytes=157286401), "150 MB"), "a film over 150 MB is refused in plain words")
        check(raises(lambda: begin(A, nbytes=0), "150 MB"), "an empty film is refused")
        check(raises(lambda: begin(A, title="   "), "title"), "a blank title is refused")
        check(raises(lambda: begin(A, sh="xyz"), "fingerprint"), "a bad fingerprint is refused")

        print("\n2. start, upload, finish")
        r = begin(A, nbytes=1000)
        rid, path = r["id"], r["path"]
        check(path == f"{sam}/compilations/{rid}.mp4", "the DATABASE chose the path (the person's id, then the film's id)")
        check(raises(lambda: begin(A), "already in progress"), "a second upload while one is in progress is refused")
        check(raises(lambda: finish(A, rid), "not the size"), "finishing with nothing stored is refused")
        check(raises(lambda: runner.execute("select public.node_compilation_cancel(%s,%s)", (B, rid)).fetchone()[0] or (_ for _ in ()).throw(Exception("nothing")), "nothing"), "ANOTHER person cannot cancel it (nothing happens)")
        check(runner.execute("select public.node_compilation_cancel(%s,%s)", (A, rid)).fetchone()[0] is True, "the app cancels the failed upload")
        check(admin.one("select state from compilation_deliveries where id=%s", rid) == "failed", "and that upload is marked failed")
        r = begin(A, nbytes=1000)
        rid, path = r["id"], r["path"]
        store(path, 999)
        check(raises(lambda: finish(A, rid), "not the size"), "a stored file of another size is refused")
        runner.execute("select public.node_compilation_cancel(%s,%s)", (A, rid))
        r = begin(A, nbytes=1000)
        rid, path = r["id"], r["path"]
        store(path, 1000)
        check(raises(lambda: finish(B, rid), "not found"), "ANOTHER person cannot finish this upload")
        done = finish(A, rid)
        days = admin.one("select delivery_days from ops_settings where id")
        check(done["id"] == rid and admin.one("select extract(day from expires_at - now())::int from compilation_deliveries where id=%s", rid) in (days - 1, days), f"finishing keeps it for {days} days")
        check(finish(A, rid)["id"] == rid, "finishing twice is harmless")

        print("\n3. the link: the owner alone, for the days")
        check(db.as_("service").one("select public.compilation_object_for(%s,%s)", sam, rid) == path, "the edge function (service role) gets the object path for the owner")
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", bob, rid), "not found"), "another person's id gets nothing")
        check(raises(lambda: db.as_(sam).one("select public.compilation_object_for(%s,%s)", sam, rid), "permission"), "a signed-in person cannot call it (only the edge function can)")
        check(raises(lambda: db.as_("anon").one("select public.compilation_object_for(%s,%s)", sam, rid), "permission"), "nor the public")
        check(raises(lambda: db.as_(sam).one("select ryagram_private.compilation_object(%s,%s)", sam, rid), "permission"), "nor the private function directly")
        check(db.as_(sam).all("select id, title, state from public.compilation_deliveries") == [(rid, "My compilation", "ready")] or len(db.as_(sam).all("select id from public.compilation_deliveries where id=%s", rid)) == 1,
              "the owner can list their own compilations")
        check(db.as_(bob).all("select id from public.compilation_deliveries") == [], "another person sees none of them")
        check(raises(lambda: db.as_(sam).all("select storage_path from public.compilation_deliveries"), "permission"), "and not even the owner can read the storage path column")
        check(raises(lambda: db.as_(sam).one("update public.compilation_deliveries set expires_at = now() + interval '9 years' where id=%s returning id", rid), "permission"), "nobody but the functions can change a row (no extending the days)")
        check(raises(lambda: runner.execute("select * from public.compilation_deliveries"), "permission"), "the node's role has no table access at all")

        print("\n4. the person's own limits")
        admin.c.execute("delete from public.node_buckets")                                   # the hourly count so far belongs to sections 1 and 2
        r2 = begin(A, nbytes=157286400)
        store(r2["path"], 157286400)
        finish(A, r2["id"])
        ids = [r2["id"]]
        for _ in range(2):
            r3 = begin(A, nbytes=157286400)
            store(r3["path"], 157286400)
            finish(A, r3["id"])
            ids.append(r3["id"])
        check(raises(lambda: begin(A, nbytes=157286400), "600 MB"), "a person is capped at 600 MB of kept films")
        admin.c.execute("delete from public.node_buckets")
        for _ in range(5):
            try:
                begin(A, nbytes=1)
            except Exception:                                                              # noqa: BLE001
                pass
        check(raises(lambda: begin(A, nbytes=1), "Too many"), "starting again and again is limited to 5 an hour")
        admin.c.execute("delete from public.node_buckets")
        runner.execute("select public.node_compilation_cancel(%s,%s)", (A, admin.one("select id from compilation_deliveries where owner_id=%s and state='uploading'", sam)))

        print("\n5. deleting, expiring, and the purge")
        check(db.as_(sam).one("select public.delete_my_compilation(%s)", ids[0]) is True, "the owner can delete one")
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", sam, ids[0]), "deleted"), "a deleted one gives no link")
        check(db.as_(bob).one("select public.delete_my_compilation(%s)", ids[1]) is False, "another person cannot delete it (nothing happens)")
        admin.c.execute("update compilation_deliveries set expires_at = now() - interval '1 minute' where id=%s", (ids[1],))
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", sam, ids[1]), "deleted"), "an expired one gives no link")
        paths = admin.one("select ryagram_private.compilation_tick()")
        want = sorted([f"{sam}/compilations/{ids[0]}.mp4", f"{sam}/compilations/{ids[1]}.mp4"])
        check(sorted(paths) == want or set(want) <= set(paths), f"the purge hands over the deleted and the expired objects ({len(paths)} paths)")
        check(admin.one("select ryagram_private.compilation_tick()") == [], "and only once (a second tick has nothing to hand over)")
        check(db.as_("service").one("select public.compilation_object_for(%s,%s)", sam, ids[2]) == f"{sam}/compilations/{ids[2]}.mp4", "a film still in its days is untouched by the purge")
        check(admin.one("select count(*) from credit_ledger") == 0 if admin.one("select to_regclass('public.credit_ledger')") else True, "no credit was touched anywhere")
        runner.close()
    finally:
        try:
            srv and srv.cleanup()
        except Exception:                                                                    # noqa: BLE001
            pass
        shutil.rmtree(base, ignore_errors=True)
    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)}")
        for f in FAILS:
            print("  -", f)
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
