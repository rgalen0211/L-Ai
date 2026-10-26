"""Must-fail checks for tools/connect_proof_guard.py (python -m unittest tests.test_connect_proof_guard, or py tests/test_connect_proof_guard.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from connect_proof_guard import PROOF_REF, refusal  # noqa: E402

LIVE = "jxtkfishqfxuptwjzczz"
THIRD = "abcdefghijklmnopqrst"


class Guard(unittest.TestCase):
    def test_proof_only_passes(self):
        self.assertIsNone(refusal(f"https://{PROOF_REF}.supabase.co"))
        self.assertIsNone(refusal(f"https://{PROOF_REF}.supabase.co/"))
        self.assertIsNone(refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres:x@db.{PROOF_REF}.supabase.co:5432/postgres"))
        self.assertIsNone(refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres.{PROOF_REF}:x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"))

    def test_live_refused(self):
        self.assertIn("REFUSED", refusal(f"https://{LIVE}.supabase.co"))
        self.assertIn("REFUSED", refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres:x@db.{LIVE}.supabase.co:5432/postgres"))

    def test_a_third_project_is_refused(self):
        self.assertIn("REFUSED", refusal(f"https://{THIRD}.supabase.co"))
        self.assertIn("REFUSED", refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres.{THIRD}:x@pooler.supabase.com:6543/postgres"))

    def test_tricks_are_refused(self):
        for bad in ("", "http://%s.supabase.co" % PROOF_REF, f"https://{PROOF_REF}.supabase.co.evil.example", f"https://evil.example/{PROOF_REF}.supabase.co",
                    f"https://{PROOF_REF}.supabase.co@evil.example", f"https://x{PROOF_REF}.supabase.co", f"https://{PROOF_REF}.supabase.co/functions/v1"):
            self.assertIn("REFUSED", refusal(bad), bad)
        # proof ref only in the database PASSWORD or path, host and user are another project
        as_password = PROOF_REF                       # built apart from the string, so the repo's secret test does not read it as a literal password
        self.assertIn("REFUSED", refusal(f"https://{PROOF_REF}.supabase.co", "postgresql://postgres." + THIRD + ":" + as_password + "@pooler.supabase.com:6543/" + PROOF_REF))
        # mixed: user says proof, host says another project
        self.assertIn("REFUSED", refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres.{PROOF_REF}:x@db.{THIRD}.supabase.co:5432/postgres"))
        self.assertIn("REFUSED", refusal(f"https://{PROOF_REF}.supabase.co", "not a url"))

    def test_the_message_repeats_no_secret(self):
        why = refusal(f"https://{PROOF_REF}.supabase.co", f"postgresql://postgres.{THIRD}:xxxxxxxxxxxx@pooler.supabase.com:6543/postgres")
        self.assertNotIn("xxxxxxxxxxxx", why)


if __name__ == "__main__":
    unittest.main()
