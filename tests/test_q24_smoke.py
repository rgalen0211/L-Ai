"""The guards of tools/q24_smoke.py: it must refuse to touch the live project unless the person types --live, refuse --live anywhere else, and refuse any
project that is not live or proof. Every case below is decided BEFORE any request is made (the proxy variables point at a dead port, so a request would fail
loudly). Run: py tests/test_q24_smoke.py"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "q24_smoke.py"
LIVE, PROOF, THIRD = "jxtkfishqfxuptwjzczz", "awjbjersplaqhxhuvozi", "abcdefghijklmnopqrst"
ENV = dict(os.environ, HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", NO_PROXY="", PYTHONUTF8="1")


def run(ref, flags=(), key="K" * 20, acct=True):
    d = Path(tempfile.mkdtemp(prefix="q24test_"))
    e = d / "e.env"
    e.write_text(f"SUPABASE_URL=https://{ref}.supabase.co\nSUPABASE_PUBLISHABLE_KEY={key}\n" if key else f"SUPABASE_URL=https://{ref}.supabase.co\n", encoding="utf-8")
    a = d / "a.json"
    a.write_text(json.dumps({"email": "t@example.test", "password": "x"}), encoding="utf-8")
    p = subprocess.run([sys.executable, str(SCRIPT), "--env-file", str(e), "--account-file", str(a), *flags], capture_output=True, text=True, env=ENV, timeout=60)
    for f in d.iterdir():
        f.unlink()
    d.rmdir()
    return p.returncode, p.stdout + p.stderr


class Guards(unittest.TestCase):
    def test_live_without_the_flag_is_refused_before_any_request(self):
        code, out = run(LIVE)
        self.assertEqual(code, 2)
        self.assertIn("LIVE project", out)
        self.assertIn("--live", out)
        self.assertNotIn("PASS", out)

    def test_the_flag_is_refused_for_any_other_project(self):
        for ref in (PROOF, THIRD):
            code, out = run(ref, ("--live",))
            self.assertEqual(code, 2, ref)
            self.assertIn("only for the live project", out)

    def test_a_third_project_is_refused_even_without_the_flag(self):
        code, out = run(THIRD)
        self.assertEqual(code, 2)
        self.assertIn("only against the live project", out)

    def test_a_missing_key_or_a_bad_address_is_refused(self):
        code, out = run(LIVE, ("--live",), key="")
        self.assertEqual(code, 2)
        d = Path(tempfile.mkdtemp(prefix="q24test_"))
        (d / "e.env").write_text("SUPABASE_URL=http://localhost:54321\nSUPABASE_PUBLISHABLE_KEY=abc\n", encoding="utf-8")
        (d / "a.json").write_text("{}", encoding="utf-8")
        p = subprocess.run([sys.executable, str(SCRIPT), "--env-file", str(d / "e.env"), "--account-file", str(d / "a.json")], capture_output=True, text=True, env=ENV, timeout=60)
        self.assertEqual(p.returncode, 2)
        for f in d.iterdir():
            f.unlink()
        d.rmdir()

    def test_the_source_never_prints_a_secret(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'acct\["password"\]', src)), 1)            # used once, to sign in
        for call in re.findall(r"(?:say|print|must)\(([^\n]*)", src):
            self.assertNotRegex(call, r"password|access_token|refresh_token|\.token\b|\.refresh\b|\.key\b|\bkey\b\s*[,)]", call)

    def test_it_makes_no_sql_and_names_no_project_secret(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertNotRegex(src, r"psycopg|DB_URL|service_role|SERVICE_ROLE|CONNECT_DB_URL")


if __name__ == "__main__":
    unittest.main()
