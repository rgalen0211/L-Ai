"""Public film pages (migrations/20260929000800_film_pages.sql) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_film_pages.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
setUpModule = core.setUpModule
SUMMARY = json.dumps({"sources": [{"label": "CDC adult obesity", "links": []}]})


class FilmPages(core.Base):
    project_with_version = core.Core.project_with_version
    run_job = core.Core.run_job
    claim = core.Core.claim
    ladder = core.Core.ladder

    def finished(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.claim()
        self.run_job(final, ["final_video", "thumbnail", "receipt"])
        return vid, final

    def svc(self):
        return self.db.as_("service")

    def publish(self, vid, who=RYAN, title="Obesity and fast food"):
        return self.svc().one("select film_publish(%s, %s, %s, %s::jsonb)", who, vid, title, SUMMARY)

    def test_only_the_owner_can_publish_a_finished_film_and_the_page_shows_it(self):
        _, draft = self.project_with_version()
        for vid, who in ((draft, RYAN),):
            with self.assertRaisesRegex(psycopg.Error, "Only a finished film"):
                self.publish(vid, who)
        vid, final = self.finished()
        with self.assertRaisesRegex(psycopg.Error, "Version not found"):
            self.publish(vid, OTHER)

        ctx = self.svc().one("select film_publish_context(%s, %s)", RYAN, vid)
        self.assertEqual((ctx["project_title"], ctx["uploaded_data"], ctx["slug"]), ("Obesity", False, None))
        self.assertTrue(ctx["receipt_path"].endswith("receipt.sequence.json"))

        slug = self.publish(vid)
        self.assertRegex(slug, r"^[A-Za-z0-9_-]{22}$")
        page = self.svc().one("select public_film(%s)", slug)
        self.assertEqual(page["title"], "Obesity and fast food")
        self.assertEqual(page["summary"]["sources"][0]["label"], "CDC adult obesity")
        self.assertTrue(page["video_path"].endswith("film.mp4"))
        self.assertNotIn("receipt_path", page)                       # the receipt itself is never served
        # Publishing again keeps the link; a blank title falls back to the project's.
        self.assertEqual(self.publish(vid, title="  "), slug)
        self.assertEqual(self.svc().one("select public_film(%s)", slug)["title"], "Obesity")

    def test_unpublish_is_the_owners_and_takes_effect_at_once(self):
        vid, _ = self.finished()
        slug = self.publish(vid)
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("select film_unpublish(%s)", vid)
        self.assertIsNotNone(self.svc().one("select public_film(%s)", slug))
        self.db.as_(RYAN).one("select film_unpublish(%s)", vid)
        self.assertIsNone(self.svc().one("select public_film(%s)", slug))
        self.assertEqual(self.db.as_(RYAN).one("select published from film_pages"), False)
        self.assertEqual(self.publish(vid), slug)                     # republished: same link
        self.assertIsNotNone(self.svc().one("select public_film(%s)", slug))

    def test_a_removed_or_archived_film_disappears(self):
        vid, final = self.finished()
        slug = self.publish(vid)
        self.db.as_(None).one("update artifacts set deleted_at = now() where job_id = %s and kind = 'final_video' returning 1", final)
        self.assertIsNone(self.svc().one("select public_film(%s)", slug)["video_path"])
        with self.assertRaisesRegex(psycopg.Error, "no longer stored"):
            self.svc().one("select film_publish_context(%s, %s)", RYAN, vid)
        self.db.as_(RYAN).one("update versions set state = 'archived' where id = %s returning 1", vid)
        self.assertIsNone(self.svc().one("select public_film(%s)", slug))

    def test_visitors_and_other_people_get_nothing_directly(self):
        vid, _ = self.finished()
        slug = self.publish(vid)
        for who in ("anon", OTHER, RYAN):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public_film(%s)", slug)
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select film_publish(%s, %s, 't', '{}')", RYAN, vid)
        self.assertIsNone(self.db.as_(OTHER).one("select slug from film_pages"))
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select summary from film_pages")      # the owner reads state, not the stored summary
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("update film_pages set published = true returning 1")
        for bad in ("", "x" * 22 + "'", "../../etc/passwd", None):
            self.assertIsNone(self.svc().one("select public_film(%s)", bad))

    def test_summary_must_be_a_small_object(self):
        vid, _ = self.finished()
        for bad in ('[]', json.dumps({"x": "y" * 70000})):
            with self.subTest(bad=bad[:10]), self.assertRaises(psycopg.Error):
                self.svc().one("select film_publish(%s, %s, 't', %s::jsonb)", RYAN, vid, bad)


if __name__ == "__main__":
    unittest.main()
