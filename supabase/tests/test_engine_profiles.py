"""Engine profiles (migrations/20261017000300_engine_profiles.sql).

Same harness as test_2a_core.py:
    pgvenv/Scripts/python -m unittest supabase/tests/test_engine_profiles.py -v
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
FIX = json.loads((Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "profile-parity.json").read_text("utf-8"))
GOOD = FIX["presets"]["clean-light"]


def setUpModule():
    core.setUpModule()


class EngineProfiles(core.Base):
    def save(self, who, spec, default=False):
        return self.db.as_(who).one("select public.set_engine_profile(%s::jsonb, %s)", json.dumps(spec), default)

    def test_a_person_saves_and_reads_their_own_profile(self):
        self.save(RYAN, GOOD)
        row = self.db.as_(RYAN).all("select name, based_on, spec, length(spec_sha256) from public.engine_profiles")
        self.assertEqual([(r[0], r[3]) for r in row], [("clean-light", 64)])
        self.assertEqual(row[0][2], GOOD)

    def test_nobody_else_can_read_it(self):
        self.save(RYAN, GOOD)
        self.assertEqual(self.db.as_(OTHER).all("select * from public.engine_profiles"), [])
        self.assertEqual(self.db.as_("anon").c.execute("select 1").fetchone()[0], 1)
        self.denied("anon", "select * from public.engine_profiles")

    def test_no_direct_insert_or_update_only_the_function(self):
        self.denied(RYAN, "insert into public.engine_profiles (name, spec, spec_sha256) values ('x', '{}', 'x')")
        self.save(RYAN, GOOD)
        self.denied(RYAN, "update public.engine_profiles set spec = '{}'")
        self.denied("anon", "select public.set_engine_profile('{}'::jsonb)")

    def test_saving_again_replaces_and_keeps_one_row(self):
        self.save(RYAN, GOOD)
        changed = copy.deepcopy(GOOD)
        changed["look"]["fps"] = 25
        self.save(RYAN, changed)
        rows = self.db.as_(RYAN).all("select spec from public.engine_profiles")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0]["look"]["fps"], 25)

    def test_the_database_refuses_a_field_the_schema_does_not_have(self):
        # MUST-FAIL: each of these would be a way to store a claim-changing knob by calling the API directly.
        for where, key in (("top", "axis"), ("top", "dataset"), ("look", "no_data_label"), ("look", "renderer"),
                           ("ramp", "breaks"), ("bars", "axis"), ("reserved", "sources"), ("transition", "x")):
            spec = copy.deepcopy(GOOD)
            node = {"top": spec, "look": spec["look"], "ramp": spec["look"]["ramp"],
                    "bars": spec["look"].setdefault("bars", {}), "reserved": spec.setdefault("reserved", {}),
                    "transition": spec["pacing"]["transition"]}[where]
            node[key] = 1
            self.denied(RYAN, "select public.set_engine_profile(%s::jsonb, false)", json.dumps(spec))
        self.assertEqual(self.db.as_(RYAN).all("select * from public.engine_profiles"), [])
        self.save(RYAN, GOOD)                       # control: the same spec without the stray key saves

    def test_an_object_cannot_hide_where_a_plain_value_belongs(self):
        spec = copy.deepcopy(GOOD)
        spec["look"]["theme"] = {"axis": "dynamic"}
        self.denied(RYAN, "select public.set_engine_profile(%s::jsonb, false)", json.dumps(spec))

    def test_version_name_and_size_are_checked(self):
        for edit in (lambda s: s.__setitem__("profile_version", 2), lambda s: s.pop("profile_version"),
                     lambda s: s.__setitem__("name", "has space"), lambda s: s.pop("name"),
                     lambda s: s.__setitem__("notes", "x" * 20000)):
            spec = copy.deepcopy(GOOD)
            edit(spec)
            self.denied(RYAN, "select public.set_engine_profile(%s::jsonb, false)", json.dumps(spec))
        self.denied(RYAN, "select public.set_engine_profile('[1]'::jsonb, false)")

    def test_at_most_twenty_profiles_but_replacing_one_is_fine(self):
        for i in range(20):
            spec = copy.deepcopy(GOOD)
            spec["name"] = f"p{i}"
            self.save(RYAN, spec)
        extra = copy.deepcopy(GOOD)
        extra["name"] = "one-too-many"
        self.denied(RYAN, "select public.set_engine_profile(%s::jsonb, false)", json.dumps(extra))
        again = copy.deepcopy(GOOD)
        again["name"] = "p3"
        self.save(RYAN, again)
        spec = copy.deepcopy(GOOD)
        spec["name"] = "other-persons-first"
        self.save(OTHER, spec)                       # the cap is per person

    def test_one_default_per_person(self):
        a, b = copy.deepcopy(GOOD), copy.deepcopy(GOOD)
        a["name"], b["name"] = "a", "b"
        self.save(RYAN, a, True)
        self.save(RYAN, b, True)
        d = self.db.as_(RYAN).all("select name from public.engine_profiles where is_default")
        self.assertEqual([r[0] for r in d], ["b"])
        self.save(RYAN, a)                           # re-saving without the flag does not steal the default
        d = self.db.as_(RYAN).all("select name from public.engine_profiles where is_default")
        self.assertEqual([r[0] for r in d], ["b"])

    def test_a_person_can_delete_theirs_and_not_anothers(self):
        self.save(RYAN, GOOD)
        self.db.as_(OTHER).c.execute("delete from public.engine_profiles")
        self.assertEqual(len(self.db.as_(RYAN).all("select * from public.engine_profiles")), 1)
        self.db.as_(RYAN).c.execute("delete from public.engine_profiles")
        self.assertEqual(self.db.as_(RYAN).all("select * from public.engine_profiles"), [])

    def test_deleting_the_account_removes_the_profiles(self):
        self.save(RYAN, GOOD)
        self.db.as_(None).c.execute("delete from auth.users where id = %s", (RYAN,))
        self.assertEqual(self.db.as_(None).one("select count(*) from public.engine_profiles"), 0)

    def test_every_preset_the_engine_ships_is_accepted_by_the_database(self):
        for pid, spec in FIX["presets"].items():
            self.save(RYAN, spec)
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from public.engine_profiles"), len(FIX["presets"]))


if __name__ == "__main__":
    unittest.main()
