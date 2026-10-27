"""Find-data step S1: fetching a file from an ALLOWLISTED OFFICIAL host into the upload pipeline (migrations/20261027000100_find_data_fetch.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 137.

Same setup as test_uploads.py (all migrations load in order, so the trust-label ones are underneath). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_find_data_fetch.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the host list: a host is matched as itself or a subdomain of a listed domain, by the LONGEST suffix; look-alikes, IP numbers, ports, upper case, underscores and a bare 'gov' match nothing
  * only the service role can call any of it or read the host list / attempts; a signed-in person, anon and the public cannot (also under Supabase's real default privileges)
  * the LABEL IS NEVER AN ARGUMENT: it is looked up from the address the bytes really came from; an off-list final address (a redirect) is refused even when the attempt began on a listed host
  * limits: 10 attempts an hour and 30 a day (refused and failed attempts count too), 20 datasets and 100 MiB shared with uploads, 10 MiB a file
  * the whole path: reserve -> register -> bytes -> finish -> the worker reads it -> the person confirms (Official: no tick; any other label: the tick) -> the film's source row carries the real publisher, address and licence
  * a fetched dataset always has its receipt, a plain upload can never be official or publishable, nothing is publishable unless Official AND open, and a person cannot change any of those columns
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_uploads as up  # noqa: E402
from test_uploads import MAPPING, RYAN, WORKER, report, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

OTHER = up.OTHER
SHA = "b" * 64
CENSUS = "https://www2.census.gov/programs-surveys/popest/datasets/state.csv"


class FindDataFetch(core.Base):
    admin = up.Uploads.admin
    create = up.Uploads.create
    put_file = up.Uploads.put_file
    uploaded = up.Uploads.uploaded
    read_by_worker = up.Uploads.read_by_worker
    project_version = up.Uploads.project_version
    job = up.Uploads.job

    def svc(self, sql, *args):
        return self.db.as_("service").one(sql, *args)

    def reserve(self, who=RYAN, host="www2.census.gov"):
        return self.svc("select fetch_reserve(%s::uuid, %s)", who, host)

    def register(self, attempt, who=RYAN, url=CENSUS, ext="csv", size=1000, sha=SHA, name="state.csv", licence="", why="population by state", ver="sf1"):
        return self.svc("select * from fetch_register(%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s)", attempt, who, url, ext, size, sha, name, licence, why, ver)

    def store(self, path, size=1000, mime="text/csv"):
        """What the function does with the service key: it puts the bytes in the person's slot (the service role needs no slot policy)."""
        self.db.as_(None).c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-uploads', %s, %s::jsonb)", (path, json.dumps({"size": size, "mimetype": mime})))

    def fetched(self, who=RYAN, host="www2.census.gov", url=CENSUS, size=1000):
        attempt = self.reserve(who, host)
        ds, path, label, publisher, lic = self.register(attempt, who, url=url, size=size)
        self.store(path, size)
        self.svc("select fetch_finish(%s::uuid) is null", ds)
        return ds, attempt

    def read(self, ds):
        self.read_by_worker(ds)

    def set_hosts(self, sql, *args):
        self.db.as_(None).c.execute(sql, args)

    sql_ = set_hosts                                 # any statement as the database owner, no result wanted

    def attempts(self, who=RYAN):
        return self.admin("select count(*) from fetch_attempts where owner_id = %s", who)

    # ---------------------------------------------------------------- the host list
    def test_a_host_matches_itself_or_a_subdomain_by_the_longest_suffix(self):
        got = lambda h: self.svc("select host_suffix from fetch_host_for(%s)", h)  # noqa: E731
        self.assertEqual(got("census.gov"), "census.gov")
        self.assertEqual(got("www2.census.gov"), "census.gov")
        self.assertEqual(got("a.b.c.census.gov"), "census.gov")
        self.assertEqual(got("nass.usda.gov"), "nass.usda.gov")
        self.assertEqual(got("quickstats.nass.usda.gov"), "nass.usda.gov")
        self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values ('data.census.gov', 'Census data portal', 'published_by_others')")
        self.assertEqual(got("data.census.gov"), "data.census.gov")                          # the longer suffix wins
        self.assertEqual(self.svc("select label from fetch_host_for('x.data.census.gov')"), "published_by_others")
        self.assertEqual(self.svc("select label from fetch_host_for('www2.census.gov')"), "official")

    def test_lookalikes_ip_numbers_ports_upper_case_and_bare_gov_match_nothing(self):
        for h in ("census.gov.evil.com", "evilcensus.gov", "notcensus.gov", "xcensus.gov", "census.gov.", "gov", "usda.gov", "1.2.3.4", "127.0.0.1", "localhost", "census.gov:443",
                  "CENSUS.GOV", "www.Census.gov", "cen_sus.gov", "census.gov/x", "census.gov@evil.com", "evil.com#census.gov", "", "census..gov", "-census.gov", "ç.census.gov",
                  "user@www2.census.gov", "a b.census.gov", "a/b.census.gov", "evil.example/.census.gov", "a%2e.census.gov", "x\n.census.gov"):
            self.assertEqual(self.svc("select count(*) from fetch_host_for(%s)", h), 0, h)
        self.assertEqual(self.svc("select count(*) from fetch_host_for('census.gov')"), 1)      # control
        self.set_hosts("update fetch_hosts set active = false where host_suffix = 'census.gov'")
        self.assertEqual(self.svc("select count(*) from fetch_host_for('census.gov')"), 0)       # an inactive host is off the list

    def test_a_bad_host_cannot_be_put_on_the_list(self):
        for bad in ("gov", "Census.gov", "a_b.gov", "1.2.3.4.", "*.gov", ".gov", "x.gov/"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=bad):
                self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values (%s, 'x', 'official')", bad)
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values ('ok.gov', 'x', 'unverified_user')")
        self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values ('ok.gov', 'Ok', 'official')")                   # control

    def test_every_seed_host_is_official_and_nothing_is_publishable_yet(self):
        self.assertEqual(self.admin("select count(*) from fetch_hosts where label <> 'official' or licence_class <> 'unknown'"), 0)
        self.assertGreaterEqual(self.admin("select count(*) from fetch_hosts"), 10)

    # ---------------------------------------------------------------- who may call it
    def test_only_the_service_role_can_use_any_of_it(self):
        sigs = ("fetch_host_for(text)", "fetch_reserve(uuid,text)", "fetch_fail(uuid,text)", "fetch_register(uuid,uuid,text,text,bigint,text,text,text,text,text)", "fetch_finish(uuid)", "fetch_abort(uuid)")
        for s in sigs:
            for role in ("anon", "authenticated", "public"):
                self.assertFalse(self.admin(f"select has_function_privilege('{role}', 'public.{s}', 'EXECUTE')"), f"{role} {s}")
            self.assertTrue(self.admin(f"select has_function_privilege('service_role', 'public.{s}', 'EXECUTE')"), s)
        for who in ("anon", RYAN):
            with self.assertRaises(psycopg.Error, msg=str(who)):
                self.db.as_(who).one("select fetch_reserve(%s::uuid, 'census.gov')", RYAN)
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from fetch_host_for('census.gov')")
        self.assertEqual(self.attempts(), 0)
        for who in ("anon", RYAN, "service"):
            for t in ("fetch_hosts", "fetch_attempts"):
                with self.assertRaises(psycopg.Error, msg=f"{who} {t}"):
                    self.db.as_(who).one(f"select count(*) from public.{t}")

    def test_under_supabases_default_privileges_nothing_leaks(self):
        name = "fd" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role") and l.strip() not in drop]
        c = psycopg.connect(core._server.get_uri(database=name), autocommit=True)
        try:
            c.execute("".join(lines))
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            for path in core.MIGRATIONS:
                c.execute(path.read_text(encoding="utf-8"))
            for s in ("fetch_host_for(text)", "fetch_reserve(uuid,text)", "fetch_fail(uuid,text)", "fetch_register(uuid,uuid,text,text,bigint,text,text,text,text,text)", "fetch_finish(uuid)", "fetch_abort(uuid)"):
                for role in ("anon", "authenticated", "public"):
                    self.assertFalse(c.execute(f"select has_function_privilege('{role}', 'public.{s}', 'EXECUTE')").fetchone()[0], f"{role} {s}")
                self.assertTrue(c.execute(f"select has_function_privilege('service_role', 'public.{s}', 'EXECUTE')").fetchone()[0], s)
            for role in ("anon", "authenticated", "service_role", "public"):
                for tbl in ("fetch_hosts", "fetch_attempts"):
                    self.assertFalse(c.execute(f"select has_table_privilege('{role}', 'public.{tbl}', 'select,insert,update,delete')").fetchone()[0], f"{role} {tbl}")
                self.assertFalse(c.execute(f"select has_table_privilege('{role}', 'public.dataset_fetches', 'insert,update,delete')").fetchone()[0], f"{role} dataset_fetches write")
        finally:
            c.close()
            with psycopg.connect(core._server.get_uri(), autocommit=True) as c2:
                c2.execute(f"drop database {name}")

    # ---------------------------------------------------------------- reserve: the limits
    def test_an_off_list_host_and_an_unknown_person_are_refused_and_write_nothing(self):
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as cm:
            self.reserve(RYAN, "example.com")
        self.assertIn("not on the list of official sources", str(cm.exception))
        with self.assertRaises(psycopg.Error) as cm2:
            self.reserve(str(uuid.UUID(int=999)), "census.gov")
        self.assertEqual(cm2.exception.sqlstate, "PT401")
        self.assertEqual(self.admin("select count(*) from fetch_attempts"), 0)
        self.assertTrue(self.reserve(RYAN, "census.gov"))                                           # control

    def test_ten_an_hour_and_thirty_a_day_and_refused_attempts_count(self):
        ids = [self.reserve() for _ in range(10)]
        with self.assertRaises(psycopg.Error) as cm:
            self.reserve()
        self.assertEqual(cm.exception.sqlstate, "PT429")
        self.assertIn("10 fetches in the last hour", str(cm.exception))
        self.assertEqual(self.attempts(), 10)
        for i in ids[:3]:
            self.svc("select fetch_fail(%s::uuid, 'off_list')", i)                                  # refused attempts still count: the 11th is still refused
        with self.assertRaises(psycopg.Error):
            self.reserve()
        self.sql_("update fetch_attempts set created_at = now() - interval '2 hours' where id = any(%s)", ids[:5])      # five fall out of the hour
        self.assertTrue(self.reserve())                                                              # control: room again
        self.sql_("update fetch_attempts set created_at = now() - interval '3 hours'")              # all older than an hour but still in the day: 11 so far
        for _ in range(19):
            self.sql_("insert into fetch_attempts (owner_id, host, created_at) values (%s, 'census.gov', now() - interval '3 hours')", RYAN)
        with self.assertRaises(psycopg.Error) as cm2:                                                # 30 in the last day
            self.reserve()
        self.assertEqual(cm2.exception.sqlstate, "PT429")
        self.assertIn("30 fetches in the last day", str(cm2.exception))
        self.assertTrue(self.reserve(OTHER))                                                         # another person has their own count

    def test_twenty_datasets_is_the_limit_shared_with_uploads(self):
        for i in range(20):
            self.create(label=f"d{i}.csv")
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as cm:
            self.reserve()
        self.assertIn("20 uploaded datasets", str(cm.exception))
        self.assertEqual(self.attempts(), 0)

    # ---------------------------------------------------------------- register: the label is looked up, never given
    def test_the_label_comes_from_the_address_and_not_from_the_caller(self):
        a = self.reserve()
        ds, path, label, publisher, lic = self.register(a, licence="Public domain, says the page")
        self.assertEqual((label, publisher, lic), ("official", "U.S. Census Bureau", "unknown"))
        self.assertEqual(path, f"{RYAN}/{ds}/source.csv")
        row = self.admin("select source, origin, trust_label, licence_class, publishable, status, retention from datasets where id = %s", ds)
        self.assertEqual(row, ("upload", "fetched", "official", "unknown", False, "pending_validation", "keep"))
        names = [n for n in self.admin("select proargnames from pg_proc where proname = 'fetch_register'") if n.startswith("p_")]          # the INPUT names (the others are what it returns)
        self.assertEqual(len(names), 10)
        self.assertFalse([n for n in names if "label" in n or "trust" in n or "official" in n or "licence_class" in n], names)    # there is no argument that could carry one
        with self.assertRaises(psycopg.Error):
            self.svc("select * from fetch_register(%s::uuid, %s::uuid, %s, 'csv', 1000, %s, 'x.csv', '', '', '', p_label => 'official')", self.reserve(), RYAN, CENSUS, SHA)
        # a published-by-others host gets ITS label, from the list
        self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values ('uni.edu', 'A University', 'published_by_others')")
        b = self.reserve(RYAN, "data.uni.edu")
        ds2, _, label2, pub2, _ = self.register(b, url="https://data.uni.edu/x.csv")
        self.assertEqual((label2, pub2), ("published_by_others", "A University"))

    def test_an_off_list_final_address_is_refused_even_when_the_attempt_began_on_a_listed_host(self):
        a = self.reserve()
        for url in ("https://evil.example/state.csv", "https://census.gov.evil.example/state.csv", "http://www2.census.gov/state.csv", "https://www2.census.gov:8443/state.csv",
                    "https://user@www2.census.gov/state.csv", "https://203.0.113.5/state.csv", "https://WWW2.CENSUS.GOV/state.csv", "ftp://www2.census.gov/state.csv"):
            with self.assertRaises(psycopg.errors.InvalidParameterValue, msg=url):
                self.register(a, url=url)
        self.assertEqual(self.admin("select count(*) from datasets where origin = 'fetched'"), 0)
        self.assertTrue(self.register(a, url="https://www2.census.gov:443/state.csv"))              # control: port 443 spelled out is fine and the attempt was still open

    def test_what_a_file_may_be(self):
        for kw, text in ((dict(ext="pdf"), "Ryagram reads CSV"), (dict(ext=""), "Ryagram reads CSV"), (dict(size=0), "empty"), (dict(size=10485761), "10 MB limit"), (dict(sha="B" * 64), "hash"),
                         (dict(sha="b" * 63), "hash"), (dict(name="   "), "name of 1 to 200")):
            with self.assertRaises(psycopg.errors.InvalidParameterValue, msg=str(kw)) as cm:
                self.register(self.fresh_attempt(), **kw)
            self.assertIn(text, str(cm.exception), str(kw))
        self.assertTrue(self.register(self.fresh_attempt(), ext="xlsx", size=10485760))             # control: the largest and another allowed type

    def fresh_attempt(self):
        self.sql_("update fetch_attempts set created_at = now() - interval '5 hours' where owner_id = %s", RYAN)       # keep the hourly count out of these tests
        return self.reserve()

    def test_one_attempt_makes_one_dataset(self):
        a = self.reserve()
        self.register(a)
        with self.assertRaises(psycopg.Error) as cm:
            self.register(a)
        self.assertEqual(cm.exception.sqlstate, "PT404")
        self.assertEqual(self.admin("select count(*) from datasets where origin = 'fetched'"), 1)
        with self.assertRaises(psycopg.Error):
            self.register(self.reserve(OTHER), who=RYAN)                                             # an attempt that is someone else's
        with self.assertRaises(psycopg.Error):
            self.register(str(uuid.uuid4()))                                                         # an attempt that does not exist

    def test_the_size_and_total_limits_use_the_real_size(self):
        for i in range(10):
            a = self.fresh_attempt()
            self.register(a, size=10485760, name=f"big{i}.csv")                                      # 100 MiB (104,857,600) in ten files
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as cm:
            self.register(self.fresh_attempt(), size=1)
        self.assertIn("over 100 MB", str(cm.exception))

    def test_the_receipt_keeps_what_was_fetched_and_the_licence_line_never_raises_the_class(self):
        a = self.reserve()
        ds, *_ = self.register(a, licence="CC0 1.0 (read off the page)\x07", why="x" * 400)
        r = self.admin("select final_url, host, http_status, bytes, sha256, publisher, label, label_rule, licence_text, licence_source, licence_class, length(why), code_version from dataset_fetches where dataset_id = %s", ds)
        self.assertEqual(r, (CENSUS, "www2.census.gov", 200, 1000, SHA, "U.S. Census Bureau", "official", "listed_host", "CC0 1.0 (read off the page) ", "page", "unknown", 300, "sf1"))
        self.assertEqual(self.admin("select publishable from datasets where id = %s", ds), False)    # a licence line read off a page is kept as text; the CLASS is the list's
        b = self.reserve()
        ds2, *_ = self.register(b, url="https://www2.census.gov/b.csv")
        self.assertEqual(self.admin("select licence_source, licence_text from dataset_fetches where dataset_id = %s", ds2), ("host_default", ""))

    def test_only_official_and_open_is_publishable_and_a_person_cannot_change_any_of_it(self):
        self.set_hosts("update fetch_hosts set licence_class = 'open' where host_suffix = 'census.gov'")
        ds, _ = self.fetched()
        self.assertEqual(self.admin("select trust_label, licence_class, publishable from datasets where id = %s", ds), ("official", "open", True))
        self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label, licence_class) values ('uni.edu', 'U', 'published_by_others', 'open')")
        b = self.reserve(RYAN, "uni.edu")
        ds2, *_ = self.register(b, url="https://uni.edu/a.csv")
        self.assertEqual(self.admin("select publishable from datasets where id = %s", ds2), False)   # open but not Official
        for sql in ("update datasets set publishable = true where id = %s", "update datasets set origin = 'uploaded' where id = %s", "update datasets set licence_class = 'open' where id = %s",
                    "update datasets set trust_label = 'official' where id = %s"):
            with self.assertRaises(psycopg.Error, msg=sql):
                self.db.as_(RYAN).c.execute(sql, (ds2,))
        admin = self.db.as_(None)
        with self.assertRaises(psycopg.errors.CheckViolation):                                       # even the owner of the table: not publishable unless Official and open
            admin.c.execute("update datasets set publishable = true where id = %s", (ds2,))
        up_ds, _ = self.create()
        admin = self.db.as_(None)                                                                      # (create() switched the connection to the person)
        for sql in ("update datasets set trust_label = 'official' where id = %s", "update datasets set publishable = true where id = %s", "update datasets set licence_class = 'open' where id = %s"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=sql):                          # a plain upload can never be official, open or publishable
                admin.c.execute(sql, (up_ds,))

    def test_a_fetched_dataset_always_has_its_receipt_at_commit(self):
        admin = self.db.as_(None)
        with self.assertRaises(psycopg.Error):
            admin.c.execute("insert into datasets (owner_id, name, source, origin, trust_label, licence_class, storage_path, bytes, ext) "
                            "values (%s, 'sneaky', 'upload', 'fetched', 'official', 'unknown', 'x/y/source.csv', 10, 'csv')", (RYAN,))
            admin.c.execute("set constraints all immediate")
        self.assertEqual(self.admin("select count(*) from datasets where name = 'sneaky'"), 0)
        up_ds, _ = self.create()
        with self.assertRaises(psycopg.Error):                                                      # flipping a plain upload to 'fetched' with no receipt
            admin.c.execute("update datasets set origin = 'fetched', trust_label = 'official', licence_class = 'unknown' where id = %s", (up_ds,))
            admin.c.execute("set constraints all immediate")
        self.assertEqual(self.admin("select origin from datasets where id = %s", up_ds), "uploaded")

    # ---------------------------------------------------------------- finish / abort
    def test_finish_queues_it_once_and_only_when_the_bytes_are_there_with_the_fetched_size(self):
        a = self.reserve()
        ds, path, *_ = self.register(a, size=1234)
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as cm:
            self.svc("select fetch_finish(%s::uuid)", ds)                                           # nothing stored yet
        self.assertIn("didn't arrive", str(cm.exception))
        self.store(path, size=999)
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as cm2:
            self.svc("select fetch_finish(%s::uuid)", ds)                                           # not the size that was fetched
        self.assertIn("not the size", str(cm2.exception))
        self.assertEqual(self.admin("select count(*) from dataset_ingests where dataset_id = %s", ds), 0)
        self.sql_("update storage.objects set metadata = %s::jsonb where name = %s", json.dumps({"size": 1234, "mimetype": "text/csv"}), path)
        self.svc("select fetch_finish(%s::uuid) is null", ds)
        self.svc("select fetch_finish(%s::uuid) is null", ds)                                       # twice: still one ingest
        self.assertEqual(self.admin("select state from dataset_ingests where dataset_id = %s", ds), "queued")
        self.assertEqual(self.admin("select count(*) from dataset_ingests where dataset_id = %s", ds), 1)
        self.assertEqual(self.admin("select bytes, sha256, mime, uploaded_at is not null from datasets where id = %s", ds), (1234, SHA, "text/csv", True))
        self.assertEqual(self.admin("select state from fetch_attempts where id = %s", a), "stored")
        with self.assertRaises(psycopg.Error):
            self.svc("select fetch_finish(%s::uuid)", self.create()[0])                             # a plain upload is not a fetched dataset

    def test_abort_removes_an_unfinished_fetch_and_nothing_else(self):
        a = self.reserve()
        ds, *_ = self.register(a)
        self.svc("select fetch_abort(%s::uuid) is null", ds)
        self.assertEqual(self.admin("select count(*) from datasets where id = %s", ds), 0)
        self.assertEqual(self.admin("select count(*) from dataset_fetches where dataset_id = %s", ds), 0)
        self.assertEqual(self.attempts(), 1)                                                         # the attempt stays and counts
        done, _ = self.fetched()
        for target in (done, self.create()[0]):
            with self.assertRaises(psycopg.Error, msg=str(target)):
                self.svc("select fetch_abort(%s::uuid)", target)                                    # a finished fetch and a plain upload are both left alone
        self.assertEqual(self.admin("select count(*) from datasets where id = %s", done), 1)

    def test_fail_records_why_from_a_closed_list_once(self):
        a = self.reserve()
        self.svc("select fetch_fail(%s::uuid, 'is_html') is null", a)
        self.assertEqual(self.admin("select state, reason from fetch_attempts where id = %s", a), ("refused", "is_html"))
        with self.assertRaises(psycopg.Error):
            self.svc("select fetch_fail(%s::uuid, 'too_big')", a)                                   # already closed
        b = self.reserve()
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.svc("select fetch_fail(%s::uuid, 'because')", b)                                   # not on the list
        self.svc("select fetch_fail(%s::uuid, 'storage') is null", b)
        self.assertEqual(self.admin("select state from fetch_attempts where id = %s", b), "failed")

    # ---------------------------------------------------------------- the person's side
    def test_the_whole_path_official_needs_no_tick_and_the_film_source_names_the_publisher(self):
        ds, attempt = self.fetched()
        self.read(ds)
        self.assertEqual(self.admin("select status, trust_ack_at is null from datasets where id = %s", ds), ("pending_validation", True))
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, false) is null", ds, json.dumps(MAPPING))      # Official: nothing to tick
        self.assertEqual(self.admin("select status, trust_ack_at is not null from datasets where id = %s", ds), ("approved", True))
        _, vid = self.project_version()
        ref = self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        s = self.db.as_(RYAN).one("select publisher, source_url, licence_short, licence_full, trust_label, fetched, kind from version_sources where version_id = %s and dataset_ref = %s", vid, ref)
        self.assertEqual(s[0], "U.S. Census Bureau")
        self.assertEqual(s[1], CENSUS)
        self.assertTrue(s[2].startswith("Retrieved ") and s[2].endswith(" from www2.census.gov"), s[2])
        self.assertEqual((s[4], s[5], s[6]), ("official", True, "upload"))
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)                  # again: still one row
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from version_sources where version_id = %s", vid), 1)

    def test_any_label_but_official_still_needs_the_tick_and_so_does_a_plain_upload(self):
        self.set_hosts("insert into fetch_hosts (host_suffix, publisher, label) values ('uni.edu', 'A University', 'published_by_others')")
        a = self.reserve(RYAN, "uni.edu")
        ds, path, *_ = self.register(a, url="https://uni.edu/a.csv")
        self.store(path)
        self.svc("select fetch_finish(%s::uuid) is null", ds)
        self.read(ds)
        for ack in (False, None):
            with self.assertRaises(psycopg.errors.InvalidParameterValue, msg=str(ack)) as cm:
                self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, %s)", ds, json.dumps(MAPPING), ack)
            self.assertIn("Tick the box", str(cm.exception))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "pending_validation")
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, true) is null", ds, json.dumps(MAPPING))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "approved")
        plain = self.uploaded()[0]
        self.read(plain)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, false)", plain, json.dumps(MAPPING))

    def test_nobody_else_can_confirm_or_see_it(self):
        ds, attempt = self.fetched()
        self.read(ds)
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("select confirm_dataset_mapping(%s, %s::jsonb, true)", ds, json.dumps(MAPPING))
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select confirm_dataset_mapping(%s, %s::jsonb, true)", ds, json.dumps(MAPPING))
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from dataset_fetches"), 0)         # the receipt is the owner's alone
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from dataset_fetches"), 1)
        for stmt in ("insert into dataset_fetches (dataset_id) values (gen_random_uuid())", "update dataset_fetches set label = 'official'", "delete from dataset_fetches"):
            with self.assertRaises(psycopg.Error, msg=stmt):
                self.db.as_(RYAN).c.execute(stmt)
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "pending_validation")

    def test_a_fetched_source_row_cannot_look_unverified_and_an_upload_row_cannot_look_official(self):
        ds, _ = self.fetched()
        self.read(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, true) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        admin = self.db.as_(None)
        for bad in ("unverified_user", None, "trusted"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=str(bad)):
                admin.c.execute("update version_sources set trust_label = %s where version_id = %s", (bad, vid))
        plain = self.uploaded()[0]
        admin = self.db.as_(None)
        self.read(plain)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, true) is null", plain, json.dumps(MAPPING))
        _, vid2 = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid2, plain)
        self.assertEqual(self.db.as_(RYAN).one("select publisher, trust_label, fetched from version_sources where version_id = %s", vid2), ("Your data", "unverified_user", False))
        admin = self.db.as_(None)
        for sql in ("update version_sources set trust_label = 'official' where version_id = %s", "update version_sources set fetched = true where version_id = %s"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=sql):
                admin.c.execute(sql, (vid2,))

    def test_the_job_claim_carries_the_fetched_label(self):
        ds, _ = self.fetched()
        self.read(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, false) is null", ds, json.dumps(MAPPING))
        ref = "u_" + str(ds).replace("-", "")[:24]
        story = json.dumps({"schema": 1, "engine": "sequence", "name": "t", "sequence": {"clips": [{"kind": "render", "dataset": ref, "view": "map"}]}})
        got = self.admin("select ryagram_private.upload_trust_for(%s, %s::jsonb)", RYAN, story)
        self.assertEqual(got[ref]["trust_label"], "official")
        self.assertIsNotNone(got[ref]["trust_ack_at"])

    def test_deleting_an_account_deletes_its_fetch_records(self):
        ds, _ = self.fetched()
        self.assertEqual(self.admin("select count(*) from dataset_fetches"), 1)
        self.admin("delete from auth.users where id = %s returning 1", RYAN)
        self.assertEqual(self.admin("select count(*) from dataset_fetches"), 0)
        self.assertEqual(self.admin("select count(*) from fetch_attempts"), 0)


if __name__ == "__main__":
    unittest.main()
