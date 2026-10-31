"""Mac-ready step 2 (NEXT-CONNECT 185): the system-drive rule that would have refused every path on a Mac, and the Keychain store for the sign-in token, with MUST-FAILs. Runs on Windows.

    py -I tools/check-mac-step2.py

Both are proved with stand-ins (a fake `security`, POSIX path functions). What a real Mac must still prove is in proposals/CONNECT-MAC-READY-STEP2.md. No network, no file written."""
import ntpath
import posixpath
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_platform as plat                   # noqa: E402
import ryagram_signin as si                       # noqa: E402
import ryagram_node_render as nr                  # noqa: E402

FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


print("1. the system-drive rule")
nt = dict(splitdrive=ntpath.splitdrive, abspath=ntpath.abspath)
px = dict(splitdrive=posixpath.splitdrive, abspath=posixpath.abspath)
check(plat.on_system_drive("C:/Users/x/work", "windows", **nt) is True, "Windows: a path on C: is on the system drive")
check(plat.on_system_drive("D:/work", "windows", **nt) is False, "Windows: a path on D: is not")
check(plat.on_system_drive("c:/work", "windows", **nt) is True, "Windows: the drive letter is read in either case")
check(plat.on_system_drive("//server/share/x", "windows", **nt) is False and plat.on_system_drive("//server/share/x", "windows", **nt) == (ntpath.splitdrive(ntpath.abspath("//server/share/x"))[0].upper() in ("C:", "")),
      "Windows: a network share is decided exactly as before (its drive part is not C:)")
check(plat.on_system_drive("anything", "windows", splitdrive=lambda p: (_ for _ in ()).throw(ValueError("x")), abspath=lambda p: p) is True, "Windows: a path whose drive cannot be read counts as C: (the safe answer, as before)")
check(plat.on_system_drive("/Users/sam/Movies/ryagram", "mac", **px) is False, "macOS: no path is 'on C:'")
check(plat.on_system_drive("/Volumes/Work/ryagram", "mac", **px) is False and plat.on_system_drive("/home/x", "linux", **px) is False, "macOS and Linux: an external volume and a home folder alike")
old_rule = lambda path: posixpath.splitdrive(posixpath.abspath(path))[0].upper() in ("C:", "")      # the rule as it was written before this step
check(old_rule("/Users/sam/Movies/ryagram") is True, "MUST-FAIL (shows the bug): the OLD rule called every macOS path 'on C:' (an empty drive reads as unknown), so a Mac could never render a site film")
check(nr.on_c("D:/Ryagram/work") is False or sys.platform != "win32", "the node renderer's on_c still answers for real Windows paths")
src = (HERE / "ryagram_node_render.py").read_text(encoding="utf-8")
check("plat.on_system_drive(path)" in src and "splitdrive" not in src, "the node renderer's on_c is the platform function (no private copy of the rule is left)")

print("2. the Keychain store, with a stand-in for `security`")


class FakeSecurity:
    """records every call; keeps the 'keychain' in a dict; understands the three commands, and answers the way `security -i` is believed to (see the paper: unverified on a real Mac)"""
    def __init__(self, fail_write=False):
        self.calls, self.items, self.fail_write = [], {}, fail_write

    def __call__(self, argv, input=None, capture_output=None, text=None, timeout=None):
        self.calls.append({"argv": list(argv), "input": input})
        parts = (input or "").strip().split()
        cmd = parts[0] if parts else ""
        opt = {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1) if parts[i].startswith("-") and parts[i] != "-w" and not parts[i + 1].startswith("-")}
        svc = opt.get("-s")
        if cmd == "add-generic-password":
            if self.fail_write:
                return SimpleNamespace(returncode=1, stdout="", stderr="security: error: nope")
            self.items[svc] = parts[parts.index("-w") + 1]
            return SimpleNamespace(returncode=0, stdout="security> ", stderr="")
        if cmd == "find-generic-password":
            if svc not in self.items:
                return SimpleNamespace(returncode=44, stdout="", stderr="security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.")
            return SimpleNamespace(returncode=0, stdout="security> " + self.items[svc] + chr(10), stderr="")
        if cmd == "delete-generic-password":
            if svc not in self.items:
                return SimpleNamespace(returncode=44, stdout="", stderr="security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.")
            del self.items[svc]
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        return SimpleNamespace(returncode=1, stdout="", stderr="unknown command")


fake = FakeSecurity()
st = si.MacKeychainStore(run=fake)
TOKEN = "nodetoken_ABC-123.xyz~+/="
st.write("ryagram:node:abc", TOKEN)
check(st.read("ryagram:node:abc") == TOKEN, "a token written is read back")
check(all(c["argv"] == ["security", "-i"] for c in fake.calls), "every call is exactly `security -i`: no command line carries anything")
check(not any(TOKEN in " ".join(c["argv"]) for c in fake.calls) and any(TOKEN in (c["input"] or "") for c in fake.calls), "the token is only ever on STDIN, never in an argument (so never in a process list)")
check(" -U" in fake.calls[0]["input"] and "add-generic-password" in fake.calls[0]["input"], "writing updates the one item (-U), not a new one each time")
check(st.read("ryagram:node:nobody") is None, "an item that is not there reads as None (signed out), not an error")
st.delete("ryagram:node:abc")
check(st.read("ryagram:node:abc") is None, "a deleted token is gone")
st.delete("ryagram:node:abc")
check(True, "deleting what is not there is quiet")

print("3. MUST-FAIL: nothing unsafe reaches the shell of `security`")
n0 = len(fake.calls)
bad_secrets = ["has space", "two" + chr(10) + "lines", "semi;colon", 'quo"te', "back" + chr(92) + "slash", "x" * 3000, "", "-w injected"]
refused = 0
for sec in bad_secrets:
    try:
        st.write("ryagram:node:abc", sec)
    except si.SignInError as e:
        refused += e.kind == "store"
check(refused == len(bad_secrets) and len(fake.calls) == n0, "a token with a space, newline, semicolon, quote, backslash, empty, too long or an option in it is refused and `security` is never run")
refused = 0
for tgt in ["a b", "a" + chr(10) + "delete-generic-password -a x", "", "x;y", "a" * 200, None]:
    for op in (lambda t=tgt: st.read(t), lambda t=tgt: st.write(t, "abc"), lambda t=tgt: st.delete(t)):
        try:
            op()
        except si.SignInError as e:
            refused += e.kind == "store"
check(refused == 18 and len(fake.calls) == n0, "a target name that is not plain (space, newline = a second command, empty, long, None) is refused for read, write and delete")
bad = si.MacKeychainStore(run=FakeSecurity(fail_write=True))
try:
    bad.write("ryagram:node:abc", "abc")
    check(False, "a failed write says so")
except si.SignInError as e:
    check(e.kind == "store" and "abc" not in str(e), "a failed write says so in words and the message does not hold the token")


def boom(*a, **k):
    raise OSError("no security tool")


try:
    si.MacKeychainStore(run=boom).read("ryagram:node:abc")
    check(False, "a missing `security` tool is an error in words")
except si.SignInError as e:
    check(e.kind == "store", "a missing `security` tool is an error in words, never a silent 'signed out' that would hide a broken store")
junk = SimpleNamespace(returncode=0, stdout="line one" + chr(10) + "line two" + chr(10), stderr="")
try:
    si.MacKeychainStore(run=lambda *a, **k: junk).read("ryagram:node:abc")
    check(False, "an answer that is not exactly one plain line is refused")
except si.SignInError as e:
    check(e.kind == "store", "an answer that is not exactly one plain line is refused, not guessed")

print("4. which store a system uses")
check(si.store_class_for("win32") is si.WindowsCredentialStore and si.store_class_for("darwin") is si.MacKeychainStore, "Windows gets the Credential Manager, macOS the Keychain")
check(si.store_class_for("linux") is None, "MUST-FAIL guard: Linux has no store and there is NO file fallback")
check(si.default_store().__class__ is si.store_class_for(sys.platform) or si.store_class_for(sys.platform) is None, "default_store() picks by the real system")

print()
print("ALL PASS" if not FAILS else "FAILED: " + "; ".join(FAILS))
sys.exit(1 if FAILS else 0)
