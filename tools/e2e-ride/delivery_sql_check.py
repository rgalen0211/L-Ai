"""The PAPER SQL for a private delivery link of a compilation built on the person's own PC, for PAID SUBSCRIBERS (NEXT-CONNECT 119, redesigned by 120), applied to a THROWAWAY Postgres built from the real
migrations plus the real Stripe test-mode file, and tried as the real roles (node_runner, authenticated, anon, service_role). LOCAL ONLY. Run it with tools/e2e-ride/run.ps1 -Check delivery.

It proves the draft does what the paper says: nobody without an ACTIVE PLAN can start (and the old tester flag does not help), the plan's limits are CONFIG rows, the whole feature is OFF until a switch is
turned on, the app's launch check tells the truth, the stored size must match, a lapsed plan cannot finish an upload but keeps what it already made, the link is the owner's alone and ends after the days,
the purge hands each object over once. It is evidence for the SQL, NOT for the edge function, the app or the page."""
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "r9-e2e"))
import e2e  # noqa: E402  (prints the heads under test and refuses a dirty checkout)

e = e2e
FAILS = []
MB = 1048576


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
        ids = {n: str(uuid.UUID(int=i)) for n, i in (("sam", 301), ("bob", 302), ("pro", 303), ("lapsed", 304), ("grace", 305), ("stale", 306), ("other", 307), ("off", 308), ("past", 309))}
        draft = Path(os.environ.get("DELIVERY_DRAFT") or (e.APP_REPO / "supabase" / "connect-drafts" / "compilation_delivery_draft.sql"))      # DELIVERY_DRAFT: the broken-on-purpose copies of mutants_delivery.py
        stripe = e.APP_REPO / "supabase" / "phase-2b" / "stripe_test_mode.sql"
        hashes = {n: (chr(ord("a") + i) * 64) for i, n in enumerate(ids)}
        with e.psycopg.connect(uri, autocommit=True) as c:
            c.execute((e.core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
            for p in e.schema_files(e.core):
                c.execute(p.read_text(encoding="utf-8"))
            for n, uid in ids.items():
                c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"{n}@example.test"))
                c.execute("insert into public.node_tokens (user_id, computer_name, token_hash) values (%s, %s, %s)", (uid, f"{n}-PC", hashes[n]))
            check(True, "the real migrations are applied in a throwaway database")
            try:
                c.execute(stripe.read_text(encoding="utf-8"))
                check(True, "the real Stripe test-mode file (where stripe_subscriptions lives) is applied too")
            except Exception as ex:                                                          # noqa: BLE001
                check(False, f"the Stripe test-mode file did not apply: {str(ex)[:150]}")
                raise
            c.execute(draft.read_text(encoding="utf-8"))
            check(True, "the PAPER draft applies on top of them without an error")

            def sub(who, code, status="active", end="now() + interval '10 days'"):
                c.execute(f"insert into public.stripe_subscriptions (subscription_id, owner_id, price_code, status, current_period_end, event_created) values (%s,%s,%s,%s,{end},now())",
                          ("sub_" + who, ids[who], code, status))
            sub("sam", "sub_creator")
            sub("pro", "sub_pro")
            sub("lapsed", "sub_creator", "canceled")
            sub("past", "sub_creator", "past_due")
            sub("grace", "sub_creator", "active", "now() - interval '1 day'")
            sub("stale", "sub_creator", "active", "now() - interval '5 days'")
            sub("other", "sub_unknown")
            sub("off", "sub_off")
            c.execute("insert into public.plan_compilation_limits (price_code, enabled, max_film_bytes, max_kept_bytes, starts_per_hour) values ('sub_off', false, 1000, 1000, 1)")
            c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (ids["bob"],))
        u = e.urlparse(srv.get_uri())
        pw = "d-" + uuid.uuid4().hex
        with e.psycopg.connect(uri, autocommit=True) as c:
            c.execute(e.psycopg.sql.SQL("alter role node_runner login password {}").format(e.psycopg.sql.Literal(pw)))
        runner = e.psycopg.connect(host=u.hostname, port=u.port, dbname="dsql", user="node_runner", password=pw, autocommit=True)
        db = e.core.Db(uri)
        admin = e.core.Db(uri).as_(None)
        sha = "c" * 64

        def begin(who, title="My compilation", nbytes=1000, sh=sha, rights=True):
            return runner.execute("select public.node_compilation_begin(%s,%s,%s,%s,%s,2.5,640,360)", (hashes[who], title, nbytes, sh, rights)).fetchone()[0]

        def finish(who, i):
            return runner.execute("select public.node_compilation_finish(%s,%s)", (hashes[who], i)).fetchone()[0]

        def cancel(who, i):
            return runner.execute("select public.node_compilation_cancel(%s,%s)", (hashes[who], i)).fetchone()[0]

        def status(who):
            return runner.execute("select public.node_compilation_status(%s)", (hashes[who],)).fetchone()[0]

        def store(path, size):
            admin.c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, jsonb_build_object('size', %s::bigint)) on conflict do nothing", (path, size))

        def reset_hits():
            admin.c.execute("delete from public.node_buckets")

        print("\n1. the switch and the plan are the gate (no tester flag)")
        check(raises(lambda: begin("sam"), "not switched on"), "with the switch OFF (the default) even a subscriber is refused in plain words")
        check(status("sam")["allowed"] is False and status("sam")["plan"] == "sub_creator" and status("sam")["switch_on"] is False, "and the launch check says so: plan seen, switch off, not allowed")
        admin.c.execute("update public.ops_settings set compilation_links_on = true")
        check(status("sam")["allowed"] is True and status("sam")["max_film_bytes"] == 150 * MB and status("pro")["max_kept_bytes"] == 3072 * MB, "switched on: the launch check gives each plan its own limits from the config table")
        check(raises(lambda: begin("bob"), "part of a ryagram plan"), "a person with NO plan is refused, and the old tester flag (local_compute) does not help")
        check(status("bob")["allowed"] is False and status("bob")["active"] is False and status("bob")["max_film_bytes"] is None, "the launch check for them: no plan, not allowed, no limits")
        for who, why in (("lapsed", "a canceled plan"), ("past", "a past-due plan"), ("stale", "a plan that ended 5 days ago")):
            check(raises(lambda: begin(who), "part of a ryagram plan"), f"{why} is refused")
        check(raises(lambda: begin("other"), "does not include"), "a plan code with no config row is refused")
        check(raises(lambda: begin("off"), "does not include"), "a plan whose row says enabled = false is refused")
        g = begin("grace", nbytes=10)
        check(g["path"].startswith(ids["grace"] + "/compilations/"), "a plan that ended 1 day ago is still honoured (the webhook may be late)")
        cancel("grace", g["id"])
        check(raises(lambda: runner.execute("select public.node_compilation_begin(%s,'x',10,%s,true)", ("f" * 64, sha)), "sign this computer in"), "an unknown token is refused")
        check(raises(lambda: begin("sam", rights=False), "right to share"), "without the rights tick it is refused")
        check(raises(lambda: begin("sam", nbytes=150 * MB + 1), "150 MB"), "a film over the plan's size is refused, and the sentence names the plan's number")
        check(begin("pro", nbytes=400 * MB)["id"] is not None, "the bigger plan takes a 400 MB film")
        cancel("pro", admin.one("select id from compilation_deliveries where owner_id=%s and state='uploading'", ids["pro"]))
        check(raises(lambda: begin("sam", nbytes=0), "150 MB"), "an empty film is refused")
        check(raises(lambda: begin("sam", title="   "), "title"), "a blank title is refused")
        check(raises(lambda: begin("sam", sh="xyz"), "fingerprint"), "a bad fingerprint is refused")
        check(admin.one("select count(*) from compilation_deliveries where owner_id = %s", ids["bob"]) == 0, "nothing was created for anyone who was refused")

        print("\n2. start, upload, finish")
        reset_hits()
        r = begin("sam", nbytes=1000)
        rid, path = r["id"], r["path"]
        check(path == f"{ids['sam']}/compilations/{rid}.mp4", "the DATABASE chose the path (the person's id, then the film's id)")
        check(raises(lambda: begin("sam"), "already in progress"), "a second upload while one is in progress is refused")
        check(raises(lambda: finish("sam", rid), "not the size"), "finishing with nothing stored is refused")
        check(cancel("bob", rid) is False and cancel("sam", rid) is True, "another person cannot cancel it; the owner can")
        r = begin("sam", nbytes=1000)
        rid, path = r["id"], r["path"]
        store(path, 999)
        check(raises(lambda: finish("sam", rid), "not the size"), "a stored file of another size is refused")
        cancel("sam", rid)
        reset_hits()
        r = begin("sam", nbytes=1000)
        rid, path = r["id"], r["path"]
        store(path, 1000)
        check(raises(lambda: finish("bob", rid), "not found"), "ANOTHER person cannot finish this upload")
        admin.c.execute("update public.stripe_subscriptions set status = 'canceled' where owner_id = %s", (ids["sam"],))
        check(raises(lambda: finish("sam", rid), "part of a ryagram plan"), "a plan that LAPSED while the file was uploading cannot finish it")
        admin.c.execute("update public.stripe_subscriptions set status = 'active' where owner_id = %s", (ids["sam"],))
        done = finish("sam", rid)
        days = admin.one("select delivery_days from ops_settings where id")
        check(done["id"] == rid and admin.one("select extract(day from expires_at - now())::int from compilation_deliveries where id=%s", rid) in (days - 1, days), f"finishing keeps it for {days} days")
        check(finish("sam", rid)["id"] == rid, "finishing twice is harmless")
        check(admin.one("select rights_ticked from compilation_deliveries where id=%s", rid) is True, "the rights tick is recorded on the row")

        print("\n3. the link: the owner alone, for the days")
        check(db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["sam"], rid) == path, "the edge function (service role) gets the object path for the owner")
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["bob"], rid), "not found"), "another person's id gets nothing")
        check(raises(lambda: db.as_(ids["sam"]).one("select public.compilation_object_for(%s,%s)", ids["sam"], rid), "permission"), "a signed-in person cannot call it (only the edge function can)")
        check(raises(lambda: db.as_("anon").one("select public.compilation_object_for(%s,%s)", ids["sam"], rid), "permission"), "nor the public")
        check(raises(lambda: db.as_(ids["sam"]).one("select ryagram_private.compilation_object(%s,%s)", ids["sam"], rid), "permission"), "nor the private function directly")
        check(len(db.as_(ids["sam"]).all("select id from public.compilation_deliveries where id=%s", rid)) == 1, "the owner can list their own compilations")
        check(db.as_(ids["bob"]).all("select id from public.compilation_deliveries") == [], "another person sees none of them")
        check(raises(lambda: db.as_(ids["sam"]).all("select storage_path from public.compilation_deliveries"), "permission"), "and not even the owner can read the storage path column")
        check(raises(lambda: db.as_(ids["sam"]).one("update public.compilation_deliveries set expires_at = now() + interval '9 years' where id=%s returning id", rid), "permission"), "nobody but the functions can change a row (no extending the days)")
        check(raises(lambda: runner.execute("select * from public.compilation_deliveries"), "permission"), "the node's role has no table access at all")
        check(raises(lambda: runner.execute("select * from public.plan_compilation_limits"), "permission") and raises(lambda: db.as_(ids["sam"]).all("select * from public.plan_compilation_limits"), "permission"),
              "the plan limits table is readable by nobody but the functions (Ryan edits it)")
        admin.c.execute("update public.stripe_subscriptions set status = 'canceled' where owner_id = %s", (ids["sam"],))
        check(db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["sam"], rid) == path, "a lapsed plan does NOT take back a film already kept (the owner still gets the link for the days)")
        admin.c.execute("update public.stripe_subscriptions set status = 'active' where owner_id = %s", (ids["sam"],))

        print("\n4. limits come from the plan's config row")
        reset_hits()
        ids_kept = []
        for _ in range(3):
            x = begin("sam", nbytes=150 * MB)
            store(x["path"], 150 * MB)
            finish("sam", x["id"])
            ids_kept.append(x["id"])
        check(raises(lambda: begin("sam", nbytes=150 * MB), "keeps 600 MB"), "the creator plan keeps 600 MB: the fourth big film is refused, and the sentence names the number")
        admin.c.execute("update public.plan_compilation_limits set max_kept_bytes = 2147483648 where price_code = 'sub_creator'")
        reset_hits()
        y = begin("sam", nbytes=150 * MB)
        check(y["id"] is not None, "Ryan raises the number in the config row and it takes effect at once (no migration)")
        cancel("sam", y["id"])
        admin.c.execute("update public.plan_compilation_limits set starts_per_hour = 2 where price_code = 'sub_creator'")
        reset_hits()
        for _ in range(2):
            z = begin("sam", nbytes=1)
            cancel("sam", z["id"])
        check(raises(lambda: begin("sam", nbytes=1), "Too many"), "starts an hour also come from the config row (2 allowed, the third is refused)")
        admin.c.execute("update public.plan_compilation_limits set starts_per_hour = 5, max_kept_bytes = 629145600 where price_code = 'sub_creator'")
        reset_hits()

        print("\n5. deleting, expiring, and the purge")
        admin.c.execute("update public.stripe_subscriptions set status = 'canceled' where owner_id = %s", (ids["sam"],))
        check(db.as_(ids["sam"]).one("select public.delete_my_compilation(%s)", ids_kept[0]) is True, "the owner can delete one even with a lapsed plan")
        admin.c.execute("update public.stripe_subscriptions set status = 'active' where owner_id = %s", (ids["sam"],))
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["sam"], ids_kept[0]), "deleted"), "a deleted one gives no link")
        check(db.as_(ids["bob"]).one("select public.delete_my_compilation(%s)", ids_kept[1]) is False, "another person cannot delete it (nothing happens)")
        admin.c.execute("update compilation_deliveries set expires_at = now() - interval '1 minute' where id=%s", (ids_kept[1],))
        check(raises(lambda: db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["sam"], ids_kept[1]), "deleted"), "an expired one gives no link")
        paths = admin.one("select ryagram_private.compilation_tick()")
        want = {f"{ids['sam']}/compilations/{ids_kept[0]}.mp4", f"{ids['sam']}/compilations/{ids_kept[1]}.mp4"}
        check(want <= set(paths), f"the purge hands over the deleted and the expired objects ({len(paths)} paths)")
        check(admin.one("select ryagram_private.compilation_tick()") == [], "and only once (a second tick has nothing to hand over)")
        check(db.as_("service").one("select public.compilation_object_for(%s,%s)", ids["sam"], ids_kept[2]) == f"{ids['sam']}/compilations/{ids_kept[2]}.mp4", "a film still in its days is untouched by the purge")
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
