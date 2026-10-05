"""Upload your own data, phase 1 (migrations 20261004000200 and 20261004000300) on a local Postgres.

Same setup as test_2a_core.py (the files are among the migrations it loads); the catalog seed is loaded
because sync_version_sources reads it. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_uploads.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
ROOT = Path(__file__).resolve().parents[1]
_outer_setup = core.setUpModule
MIB = 1024 * 1024


def setUpModule():
    _outer_setup()
    with psycopg.connect(core._server.get_uri(database="tmpl"), autocommit=True) as c:
        c.execute((ROOT / "catalog_sources_seed.sql").read_text(encoding="utf-8"))


def report(ext="csv", columns=None, **over):
    cols = columns or [("State", "place", ["Alabama", "Alaska", "Texas"]), ("Year", "period", ["2019", "2020", "2021"]),
                       ("Jobs", "number", ["100", "110", "120"])]
    r = {"format": ext, "sha256": "a" * 64, "rows": 150,
         "columns": [{"index": i, "header": h, "kind": k, "sample": s} for i, (h, k, s) in enumerate(cols)],
         "guess": {"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": "us_states", "cadence": "annual", "wide": False},
         "periods": {"first": "2019", "last": "2021", "count": 3}, "unmatched": {"count": 0, "names": []}}
    r.update(over)
    return r


MAPPING = {"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": "us_states", "cadence": "annual",
           "measure_names": {"2": "Jobs"}, "banded_index": 2}


class Uploads(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def create(self, who=RYAN, label="my data.csv", ext="csv", size=1000, retention=None):
        return self.db.as_(who).one("select * from create_upload(%s, %s, %s, %s::dataset_retention)", label, ext, size, retention)

    def put_file(self, path, size=1000, mime="text/csv", who=RYAN):
        """The browser's upload: allowed by the storage policy only into the person's own open slot."""
        self.db.as_(who).c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-uploads', %s, %s::jsonb)",
                                   (path, json.dumps({"size": size, "mimetype": mime})))

    def uploaded(self, who=RYAN, **kw):
        ds, path = self.create(who=who, **kw)
        self.put_file(path, who=who)
        self.db.as_(who).one("select finish_upload(%s) is null", ds)
        return ds, path

    def ingest_id(self, ds):
        return self.admin("select id from dataset_ingests where dataset_id = %s", ds)

    def read_by_worker(self, ds, rep=None, ext="csv"):
        w = self.db.as_(WORKER)
        claimed = w.one("select * from claim_next_ingest()")
        self.assertEqual(claimed[1], ds)
        w.one("select report_ingest(%s, %s::jsonb) is null", claimed[0], json.dumps(rep or report(ext)))

    # -- the person's side
    def test_the_whole_path_for_a_csv(self):
        ds, path = self.create(retention="dont_keep")
        self.assertEqual(path, f"{RYAN}/{ds}/source.csv")
        row = self.admin("select source, status, retention, bytes, ext, uploaded_at from datasets where id = %s", ds)
        self.assertEqual((row[0], row[1], row[2], row[3], row[4], row[5]), ("upload", "pending_validation", "dont_keep", 1000, "csv", None))
        self.put_file(path)
        self.db.as_(RYAN).one("select finish_upload(%s) is null", ds)
        self.assertEqual(self.admin("select state from dataset_ingests where dataset_id = %s", ds), "queued")
        self.read_by_worker(ds)
        self.assertEqual(self.admin("select state from dataset_ingests where dataset_id = %s", ds), "done")
        self.assertEqual(self.admin("select sha256, row_count from datasets where id = %s", ds), ("a" * 64, 150))
        # Not usable until the person confirms; then it is approved with its mapping and geography.
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        self.assertEqual(self.admin("select status, geography from datasets where id = %s", ds), ("approved", "us_states"))
        # Attach to a version: becomes its dataset, appears among the sources, and a story naming it syncs.
        _, vid = self.project_version()
        ref = self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        self.assertEqual(ref, "u_" + str(ds).replace("-", "")[:24])
        self.assertEqual(self.admin("select dataset_id from versions where id = %s", vid), ds)
        self.assertEqual(self.admin("select restorability from versions where id = %s", vid), "non_restorable")   # don't keep
        src = self.db.as_(RYAN).all("select kind, dataset_ref, publisher, licence_short, coverage from version_sources where version_id = %s", vid)
        self.assertEqual(src[0][:4], ("upload", ref, "Your data", "You confirm you may use this data"))
        self.assertIn("2019 to 2021", src[0][4])
        story = {"schema": 1, "engine": "sequence", "name": "t", "sequence": {"clips": [{"kind": "render", "dataset": ref, "view": "map"}]}}
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning 1", json.dumps(story), vid)
        self.assertEqual([r[1] for r in self.db.as_(RYAN).all("select * from sync_version_sources(%s)", vid)] and
                         [r[0] for r in self.db.as_(RYAN).all("select dataset_ref from sync_version_sources(%s)", vid)], [ref])

    def job(self, vid, ds, kind, state, worker=None):
        """A job row as the dashboard would see it (the person-facing path is covered in test_2a_core)."""
        pid = self.admin("select project_id from versions where id = %s", vid)
        base = "insert into jobs (owner_id, project_id, version_id, job_type, state, story, story_sha256, dataset_id, params%s) "                "values (%%s, %%s, %%s, %%s, %%s, '{}'::jsonb, %%s, %%s, %%s%s) returning id"
        win = json.dumps({"window_s": [0, 10]})
        extra = ("", "") if kind != "final_render" else (", sheet_job_id, preview_job_id, approved_by, approved_at", ", %s, %s, %s, now()")
        if worker:
            extra = (extra[0] + ", worker_user_id", extra[1] + ", %s")
        args = [RYAN, pid, vid, kind, state, "f" * 64, ds, win]
        if kind == "final_render":
            prev = self.job(vid, ds, "preview", "complete")
            args += [prev, prev, RYAN]
        if worker:
            args.append(worker)
        return self.admin(base % extra, *args)

    def project_version(self):
        d = self.db.as_(RYAN)
        pid = d.one("insert into projects (title) values ('Uploads') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        return pid, vid

    def test_the_account_default_is_used_and_types_sizes_and_quota_are_enforced(self):
        self.db.as_(RYAN).one("insert into account_settings (upload_retention) values ('dont_keep') returning 1")
        ds, _ = self.create()
        self.assertEqual(self.admin("select retention from datasets where id = %s", ds), "dont_keep")
        for ext in ("exe", "xlsm", "xls", "pdf", "", "csv/../../x"):
            with self.subTest(ext=ext), self.assertRaises(psycopg.Error):
                self.create(ext=ext)
        for size in (0, -5, 10 * MIB + 1):
            with self.subTest(size=size), self.assertRaises(psycopg.Error):
                self.create(size=size)
        self.create(size=10 * MIB)                                              # exactly the cap is fine
        for who in ("anon",):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from create_upload('x', 'csv', 10)")
        with self.assertRaises(psycopg.Error):
            self.create(label="   ")
        # 20 datasets, and 100 MiB in all.
        for i in range(10):
            self.db.as_(OTHER).one("select * from create_upload(%s, 'csv', %s)", f"f{i}", 10 * MIB)
        with self.assertRaisesRegex(psycopg.Error, "100 MB"):
            self.create(who=OTHER)
        self.admin("delete from datasets where owner_id = %s and name like 'f%%' returning 1", OTHER)
        for i in range(20):
            self.db.as_(OTHER).one("select * from create_upload(%s, 'csv', 100)", f"g{i}")
        with self.assertRaisesRegex(psycopg.Error, "20 uploaded"):
            self.create(who=OTHER, size=100)

    def test_the_file_goes_only_into_the_persons_own_open_slot_once(self):
        ds, path = self.create()
        with self.assertRaises(psycopg.Error):                                  # someone else's slot
            self.put_file(path, who=OTHER)
        with self.assertRaises(psycopg.Error):                                  # a path nobody opened
            self.put_file(f"{RYAN}/00000000-0000-0000-0000-000000000099/source.csv")
        with self.assertRaises(psycopg.Error):                                  # a different file name in the right folder
            self.put_file(f"{RYAN}/{ds}/other.csv")
        with self.assertRaises(psycopg.Error):
            self.put_file(path, who="anon")
        self.put_file(path)
        self.db.as_(RYAN).one("select finish_upload(%s) is null", ds)
        with self.assertRaises(psycopg.Error):                                  # the slot closes once the upload is finished
            self.db.as_(RYAN).c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-uploads', %s, '{}'::jsonb)", (path + "x",))
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'"), 1)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'"), 0)

    def test_finishing_needs_the_file_and_its_size(self):
        ds, path = self.create()
        with self.assertRaisesRegex(psycopg.Error, "didn't arrive"):
            self.db.as_(RYAN).one("select finish_upload(%s)", ds)
        self.put_file(path, size=11 * MIB)
        with self.assertRaisesRegex(psycopg.Error, "10 MB"):
            self.db.as_(RYAN).one("select finish_upload(%s)", ds)
        with self.assertRaisesRegex(psycopg.Error, "Dataset not found"):
            self.db.as_(OTHER).one("select finish_upload(%s)", ds)
        self.assertEqual(self.admin("select count(*) from dataset_ingests"), 0)

    def test_nothing_is_used_before_a_valid_confirmed_mapping(self):
        ds, _ = self.uploaded()
        with self.assertRaisesRegex(psycopg.Error, "haven't finished reading"):
            self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb)", ds, json.dumps(MAPPING))
        self.read_by_worker(ds)
        _, vid = self.project_version()
        with self.assertRaisesRegex(psycopg.Error, "Confirm what the columns mean"):
            self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        bad = {
            "no place": {k: v for k, v in MAPPING.items() if k != "place_index"},
            "geography": {**MAPPING, "geography": "world"}, "cadence": {**MAPPING, "cadence": "daily"},
            "no values": {**MAPPING, "value_indexes": []}, "nine values": {**MAPPING, "value_indexes": list(range(2, 11))},
            "outside": {**MAPPING, "value_indexes": [9]}, "negative": {**MAPPING, "place_index": -1},
            "reused column": {**MAPPING, "period_index": 0}, "value is the place": {**MAPPING, "value_indexes": [0]},
            "banded not a value": {**MAPPING, "banded_index": 1}, "unknown key": {**MAPPING, "shell": "rm -rf"},
            "name too long": {**MAPPING, "measure_names": {"2": "x" * 81}}, "name for a non-value": {**MAPPING, "measure_names": {"0": "State"}},
            "county without a state": {**MAPPING, "geography": "us_counties"},
            "county in a fake state": {**MAPPING, "geography": "us_counties", "state": "ZZ"},
            "text index": {**MAPPING, "place_index": "0"},
        }
        for name, m in bad.items():
            with self.subTest(name), self.assertRaises(psycopg.Error):
                self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb)", ds, json.dumps(m))
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("select confirm_dataset_mapping(%s, %s::jsonb)", ds, json.dumps(MAPPING))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "pending_validation")
        # Counties: a chosen state is enough; a state column also is.
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps({**MAPPING, "geography": "us_counties", "state": "TX"}))
        self.assertEqual(self.admin("select geography from datasets where id = %s", ds), "us_counties")

    def test_wide_tables_are_turned_away_with_a_plain_reason(self):
        ds, _ = self.uploaded()
        wide = report(guess={"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": None, "cadence": None, "wide": True})
        self.read_by_worker(ds, wide)
        with self.assertRaisesRegex(psycopg.Error, "years across the columns"):
            self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb)", ds, json.dumps(MAPPING))

    def test_a_version_can_only_use_approved_uploads_of_its_owner_while_editable(self):
        ds, _ = self.uploaded()
        self.read_by_worker(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("select attach_upload_to_version(%s, %s)", vid, ds)
        other_ver = self.db.as_(OTHER)
        pid = other_ver.one("insert into projects (title) values ('x') returning id")
        ovid = other_ver.one("select id from create_version(%s)", pid)
        with self.assertRaisesRegex(psycopg.Error, "Dataset not found"):
            other_ver.one("select attach_upload_to_version(%s, %s)", ovid, ds)
        # someone else's u_ id in a story is refused by sync
        ref = "u_" + str(ds).replace("-", "")[:24]
        story = {"sequence": {"clips": [{"kind": "render", "dataset": ref}]}}
        other_ver.one("update versions set story_spec = %s::jsonb where id = %s returning 1", json.dumps(story), ovid)
        with self.assertRaisesRegex(psycopg.Error, "isn't ready, or isn't yours"):
            other_ver.all("select * from sync_version_sources(%s)", ovid)
        self.admin("update versions set state = 'archived' where id = %s returning 1", vid)
        with self.assertRaisesRegex(psycopg.Error, "can't change its data"):
            self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)

    # -- the worker's side
    def test_the_worker_claims_one_file_reads_it_and_only_it(self):
        ds, path = self.uploaded()
        for who in (RYAN, OTHER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from claim_next_ingest()")
        # Before it claims, the worker can't read the file; while it holds the claim, it can read exactly that file.
        count = lambda who: self.db.as_(who).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'")
        self.assertEqual(count(WORKER), 0)
        claimed = self.db.as_(WORKER).one("select * from claim_next_ingest()")
        self.assertEqual((claimed[1], claimed[2], claimed[3]), (ds, path, "csv"))
        self.assertEqual(count(WORKER), 1)
        self.assertEqual(count(WORKER2), 0)                                       # another worker never
        self.assertIsNone(self.db.as_(WORKER).one("select * from claim_next_ingest()"))   # one at a time
        with self.assertRaises(psycopg.Error):
            self.db.as_(WORKER2).one("select report_ingest(%s, %s::jsonb)", claimed[0], json.dumps(report()))
        self.db.as_(WORKER).one("select report_ingest(%s, %s::jsonb) is null", claimed[0], json.dumps(report()))
        self.assertEqual(count(WORKER), 0)                                         # claim done: no more access
        with self.assertRaises(psycopg.Error):
            self.db.as_(WORKER).one("select report_ingest(%s, %s::jsonb)", claimed[0], json.dumps(report()))

    def test_reports_must_be_in_the_agreed_shape(self):
        ds, _ = self.uploaded()
        claimed = self.db.as_(WORKER).one("select * from claim_next_ingest()")
        evil = [
            report(ext="xlsx"),                                                    # not the file's format
            {**report(), "extra": 1}, {**report(), "sha256": "zz"}, {**report(), "rows": 10_000_001},
            report(columns=[("A" * 81, "place", [])]), report(columns=[("A", "bogus", [])]),
            report(columns=[("A", "place", ["x"] * 6)]), report(columns=[("A", "place", ["x" * 41])]),
            {**report(), "columns": []}, {**report(), "columns": "no"},
            {**report(), "guess": {"place_index": 0, "shell": 1}}, {**report(), "unmatched": {"count": 1, "names": ["x"] * 21}},
            {**report(), "periods": {"first": "a", "other": "b"}}, {**report(), "sheets": ["s"] * 21},
        ]
        bad_index = report(); bad_index["columns"][1]["index"] = 5
        evil.append(bad_index)
        for i, r in enumerate(evil):
            with self.subTest(case=i), self.assertRaises(psycopg.Error):
                self.db.as_(WORKER).one("select report_ingest(%s, %s::jsonb)", claimed[0], json.dumps(r))
        self.assertIsNone(self.admin("select ingest_report from datasets where id = %s", ds))

    def test_a_file_the_worker_cannot_read_is_rejected_with_a_plain_message(self):
        ds, _ = self.uploaded()
        claimed = self.db.as_(WORKER).one("select * from claim_next_ingest()")
        with self.assertRaises(psycopg.Error):
            self.db.as_(WORKER).one("select fail_ingest(%s, 'rm -rf', 'x')", claimed[0])
        self.db.as_(WORKER).one("select fail_ingest(%s, 'not_a_table', %s) is null", claimed[0], "This isn't a table.\x07 " + "y" * 400)
        row = self.admin("select state, error_code, char_length(error_detail) from dataset_ingests where dataset_id = %s", ds)
        self.assertEqual(row, ("failed", "not_a_table", 300))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "rejected")
        self.assertNotIn("\x07", self.admin("select error_detail from dataset_ingests where dataset_id = %s", ds))

    def test_a_lost_worker_is_retried_then_given_up_on(self):
        ds, _ = self.uploaded()
        for attempt in (1, 2, 3):
            claimed = self.db.as_(WORKER).one("select * from claim_next_ingest()")
            self.assertEqual(self.admin("select attempt from dataset_ingests where id = %s", claimed[0]), attempt)
            self.admin("update dataset_ingests set lease_expires_at = now() - interval '1 minute' where id = %s returning 1", claimed[0])
        self.assertIsNone(self.db.as_(WORKER).one("select * from claim_next_ingest()"))
        self.assertEqual(self.admin("select state, error_code from dataset_ingests where dataset_id = %s", ds), ("failed", "worker_lost"))
        self.assertEqual(self.admin("select status from datasets where id = %s", ds), "rejected")

    def test_the_kill_switch_stops_claims(self):
        self.uploaded()
        self.admin("update control set claims_enabled = false returning 1")
        self.assertIsNone(self.db.as_(WORKER).one("select * from claim_next_ingest()"))

    # -- deleting
    def test_deleting_hides_it_detaches_versions_and_the_sweeper_removes_the_file(self):
        ds, path = self.uploaded()
        self.read_by_worker(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("select request_dataset_deletion(%s)", ds)
        self.db.as_(RYAN).one("select request_dataset_deletion(%s) is null", ds)
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", ds)       # 20261004000700: Delete goes to Recently deleted first
        self.assertIsNone(self.admin("select dataset_id from versions where id = %s", vid))
        self.assertEqual(self.admin("select restorability from versions where id = %s", vid), "non_restorable")
        self.assertEqual(self.admin("select count(*) from version_sources where version_id = %s", vid), 0)
        svc = lambda sql, *a: self.db.as_("service").all(sql, *a)
        self.assertEqual([r[0] for r in svc("select dataset_id from uploads_due_for_deletion()")], [ds])
        # The row is only marked once the file is really gone from Storage.
        self.assertEqual(self.db.as_("service").one("select mark_uploads_removed(%s::uuid[])", [ds]), 0)
        self.admin("delete from storage.objects where bucket_id = 'ryagram-uploads' returning 1")
        self.assertEqual(self.db.as_("service").one("select mark_uploads_removed(%s::uuid[])", [ds]), 1)
        row = self.admin("select name, filename_label, ingest_report is null, mapping is null, storage_path is null, status, deleted_at is not null "
                         "from datasets where id = %s", ds)
        self.assertEqual(row, ("Deleted data", None, True, True, True, "rejected", True))
        self.assertEqual(svc("select * from uploads_due_for_deletion()"), [])

    def test_dont_keep_files_go_when_the_final_film_is_done_or_after_seven_idle_days(self):
        a, _ = self.uploaded(retention="dont_keep")
        b, _ = self.uploaded(retention="dont_keep")
        c, _ = self.uploaded(retention="keep")
        svc = lambda: sorted(str(r[0]) for r in self.db.as_("service").all("select dataset_id from uploads_due_for_deletion()"))
        self.assertEqual(svc(), [])
        self.admin("update datasets set last_activity_at = now() - interval '8 days' where id = %s returning 1", b)
        self.admin("update datasets set last_activity_at = now() - interval '30 days' where id = %s returning 1", c)
        self.assertEqual(svc(), [str(b)])                                           # kept data is never swept for idleness
        # A complete final render on `a` makes it due. (A job row is enough for the sweeper's rule.)
        _, vid = self.project_version()
        self.admin("update datasets set status = 'approved' where id = %s returning 1", a)
        self.admin("update versions set dataset_id = %s where id = %s returning 1", a, vid)
        self.job(vid, a, "final_render", "complete")
        self.assertEqual(svc(), sorted([str(a), str(b)]))
        # An unreadable file (rejected) is due a day later.
        d, _ = self.uploaded()
        self.admin("update datasets set status = 'rejected', last_activity_at = now() - interval '2 days' where id = %s returning 1", d)
        self.assertIn(str(d), svc())

    def test_a_render_in_progress_blocks_deletion_and_only_the_service_role_sweeps(self):
        ds, _ = self.uploaded()
        _, vid = self.project_version()
        self.job(vid, ds, "preview", "running")
        with self.assertRaisesRegex(psycopg.Error, "still running"):
            self.db.as_(RYAN).one("select request_dataset_deletion(%s)", ds)
        for who in (RYAN, OTHER, WORKER, "anon"):
            for sql in ("select * from uploads_due_for_deletion()", "select mark_uploads_removed(array[]::uuid[])"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql)

    def test_the_worker_may_read_the_file_while_a_render_on_that_dataset_runs(self):
        ds, _ = self.uploaded()
        self.read_by_worker(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        count = lambda who: self.db.as_(who).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'")
        self.assertEqual(count(WORKER), 0)
        self.job(vid, ds, "preview", "running", worker=WORKER)
        self.assertEqual(count(WORKER), 1)
        self.assertEqual(count(WORKER2), 0)

    def test_account_deletion_lists_uploads_and_activity_is_touched_by_jobs(self):
        ds, path = self.uploaded()
        check = self.db.as_("service").one("select account_deletion_check(%s)", RYAN)
        self.assertEqual(check["upload_paths"], [path])
        self.assertEqual(check["storage_paths"], [])
        before = self.admin("select last_activity_at from datasets where id = %s", ds)
        _, vid = self.project_version()
        self.job(vid, ds, "contact_sheet", "queued")
        self.assertGreater(self.admin("select last_activity_at from datasets where id = %s", ds), before)


if __name__ == "__main__":
    unittest.main()
