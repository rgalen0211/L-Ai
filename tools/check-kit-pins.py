"""Kit drift check: does a Sam kit folder still match the commits it says it was built from, and are those commits still the heads of their branches? Read-only: it only reads the kit folder and runs
`git` read commands in the two repositories (no fetch, no network; run `git fetch` first if you want the latest heads).

    python tools/check-kit-pins.py <kit folder> [--ryagram-repo PATH] [--lai-repo PATH] [--maker-branch maker-drop] [--selftest]

For every pinned component (the Ryagram commits and the desktop maker in KIT-MANIFEST.json) it prints the pinned commit, the branch it belongs to, that branch's head NOW, and: UP TO DATE, BEHIND by N
commits (with their subjects and whether the maker's page files changed), or DIVERGED / MISSING. Then it checks the kit's contents byte for byte:
  * SHA256SUMS.txt: every file in the kit still has the hash recorded when it was built;
  * the maker's page files (tools/desktop_maker.py, tools/start-maker.bat) equal the pinned maker commit, line endings aside;
  * tools/faces_local_probe.py equals the pinned faces-local-probe commit;
  * every file under ryagram/ is identical to the same path in one of the pinned Ryagram commits (a file that is not is either a merge result of two pinned commits or has been edited: it is listed).
Exit 0 when nothing is behind and nothing differs; 1 when something is behind or differs (a table says what); 2 when the check itself could not run.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAKER_FILES = ('tools/desktop_maker.py', 'tools/start-maker.bat')


def git(repo, *args, check=False):
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check and r.returncode:
        raise RuntimeError(f'git {" ".join(args)} failed in {repo}: {r.stderr.strip()[:200]}')
    return r


def head_of(repo, branch):
    """The branch's head now: the local branch and origin/<branch> (whichever exists, the newer one if both)."""
    heads = []
    for ref in (branch, f'origin/{branch}'):
        r = git(repo, 'rev-parse', '--verify', '-q', ref + '^{commit}')
        if r.returncode == 0:
            heads.append(r.stdout.strip())
    if not heads:
        return None
    best = heads[0]
    for h in heads[1:]:
        if git(repo, 'merge-base', '--is-ancestor', best, h).returncode == 0:
            best = h
    return best


def compare(repo, name, pinned, branch):
    """(state, head, detail) for one pinned commit against its branch."""
    if git(repo, 'cat-file', '-e', pinned + '^{commit}').returncode:
        return 'MISSING', None, f'the pinned commit {pinned[:7]} is not in {repo}'
    head = head_of(repo, branch)
    if not head:
        return 'MISSING', None, f'no branch named {branch} in {repo}'
    if head == pinned:
        return 'UP TO DATE', head, ''
    if git(repo, 'merge-base', '--is-ancestor', pinned, head).returncode == 0:
        n = git(repo, 'rev-list', '--count', f'{pinned}..{head}').stdout.strip()
        subj = [s.strip() for s in git(repo, 'log', '--format=%h %s', f'{pinned}..{head}', '-n', '4').stdout.splitlines()]
        return f'BEHIND by {n}', head, '; '.join(s[:70] for s in subj)
    if git(repo, 'merge-base', '--is-ancestor', head, pinned).returncode == 0:
        return 'AHEAD of its branch', head, 'the pinned commit is newer than the branch head (the branch was rewound)'
    return 'DIVERGED', head, 'the branch no longer contains the pinned commit (it was rebuilt)'


def blob_matches(repo, commit, path, data):
    r = git(repo, 'show', f'{commit}:{path}')
    if r.returncode:
        return None
    raw = subprocess.run(['git', '-C', str(repo), 'show', f'{commit}:{path}'], capture_output=True).stdout
    return raw.replace(b'\r\n', b'\n') == data.replace(b'\r\n', b'\n')


def run(kit, ryagram_repo, lai_repo, maker_branch):
    kit = Path(kit)
    man = json.loads((kit / 'KIT-MANIFEST.json').read_text(encoding='utf-8'))
    problems = []
    print(f'KIT {kit}  (made {man.get("made_at")}, scope {man.get("scope")})')
    print('\nCOMPONENTS\n  component            pinned     branch head now  state')
    comps = []
    for short, full in man.get('ryagram_commits', {}).items():
        note = (man.get('review_notes', {}).get(short) or '')
        name = note.split(':')[0].strip() or short
        comps.append((name, full, name, ryagram_repo))
    dm = man.get('desktop_maker') or {}
    if dm:
        comps.append(('desktop maker', dm['commit'], maker_branch, lai_repo))
    pinned_ryagram = [c[1] for c in comps if c[3] == ryagram_repo]
    state_of = {}
    for name, sha, branch, repo in comps:
        state, head, detail = compare(repo, name, sha, branch)
        state_of[name] = (state, head)
        print(f'  {name:20} {sha[:7]:10} {branch:12} {(head or "-")[:7]:8} {state}' + (f'   {detail}' if detail else ''))
        if state != 'UP TO DATE':
            problems.append(f'{name}: {state}')
        if state.startswith('BEHIND') and name == 'desktop maker':
            d = git(repo, 'diff', '--stat', f'{sha}..{head}', '--', *MAKER_FILES).stdout.strip()
            print('      page files changed since the pin: ' + (d.replace('\n', ' | ')[:240] if d else 'none (tools/desktop_maker.py and tools/start-maker.bat are identical; only checks or docs moved)'))
            if d:
                problems.append('desktop maker: its page files changed since the pin')
    print('\nFILES')
    bad = []
    sums = kit / 'SHA256SUMS.txt'
    if sums.is_file():
        n = 0
        for line in sums.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            h, _, rel = line.partition('  ')
            p = kit / rel.strip().lstrip('*')
            n += 1
            if not p.is_file():
                bad.append(f'missing from the kit: {rel}')
            elif hashlib.sha256(p.read_bytes()).hexdigest() != h.strip().lower():
                bad.append(f'changed since the kit was built: {rel}')
        print(f'  SHA256SUMS.txt: {n} files listed, {len([b for b in bad])} problem(s)')
    else:
        bad.append('SHA256SUMS.txt is missing')
    if dm:
        for f in MAKER_FILES:
            p = kit / f
            if not p.is_file():
                bad.append(f'the maker page file {f} is missing from the kit')
                continue
            m = blob_matches(lai_repo, dm['commit'], f, p.read_bytes())
            print(f'  {f}: {"identical to the pinned maker commit" if m else "DIFFERS from the pinned maker commit" if m is False else "not in the pinned maker commit"}')
            if m is not True:
                bad.append(f'{f} does not match the pinned maker commit {dm["commit"][:7]}')
    probe = [c for c in comps if c[0] == 'faces-local-probe']
    if probe and (kit / 'tools/faces_local_probe.py').is_file():
        m = blob_matches(ryagram_repo, probe[0][1], 'tools/faces_local_probe.py', (kit / 'tools/faces_local_probe.py').read_bytes())
        print(f'  tools/faces_local_probe.py: {"identical to the pinned commit" if m else "DIFFERS from the pinned commit"}')
        if m is not True:
            bad.append('tools/faces_local_probe.py does not match the pinned faces-local-probe commit')
    odd = []
    count = 0
    for p in sorted((kit / 'ryagram').rglob('*')):
        if not p.is_file() or p.suffix == '.pyc':
            continue
        count += 1
        rel = p.relative_to(kit).as_posix()
        data = p.read_bytes()
        if not any(blob_matches(ryagram_repo, c, rel, data) for c in pinned_ryagram):
            odd.append(rel)
    print(f'  ryagram/: {count} files, {count - len(odd)} identical to a pinned commit, {len(odd)} not' + (f' (a merge result of two pinned commits, or edited): {", ".join(odd[:8])}' + (' ...' if len(odd) > 8 else '') if odd else ''))
    problems += bad
    # a file that is not identical to any single pinned commit is information, not an alarm, unless the integrity hash also fails
    print('\nRESULT: ' + ('NOTHING BEHIND, NOTHING DIFFERS' if not problems else 'DRIFT FOUND: ' + '; '.join(problems)))
    return 0 if not problems else 1


def selftest():
    """Builds two tiny repositories and a kit, then proves every kind of drift is reported and a clean kit is not."""
    tmp = Path(tempfile.mkdtemp(prefix='kitpins-'))
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    def g(repo, *a):
        return subprocess.run(['git', '-C', str(repo), *a], capture_output=True, text=True, check=True).stdout.strip()
    try:
        ry, lai = tmp / 'ry', tmp / 'lai'
        for r in (ry, lai):
            r.mkdir()
            g(r, 'init', '-q', '-b', 'main')
            g(r, 'config', 'user.email', 'a@b.c')
            g(r, 'config', 'user.name', 'x')
        (ry / 'ryagram').mkdir()
        (ry / 'ryagram' / 'a.py').write_text('print(1)\n')
        (ry / 'tools').mkdir()
        (ry / 'tools' / 'faces_local_probe.py').write_text('probe\n')
        g(ry, 'add', '-A')
        g(ry, 'commit', '-q', '-m', 'one')
        g(ry, 'branch', 'local-mcp')
        r1 = g(ry, 'rev-parse', 'HEAD')
        (lai / 'tools').mkdir()
        (lai / 'tools' / 'desktop_maker.py').write_text('page v1\n')
        (lai / 'tools' / 'start-maker.bat').write_text('@echo off\r\n')
        g(lai, 'add', '-A')
        g(lai, 'commit', '-q', '-m', 'maker one')
        g(lai, 'branch', 'maker-drop')
        g(lai, 'checkout', '-q', 'maker-drop')
        m1 = g(lai, 'rev-parse', 'HEAD')
        kit = tmp / 'kit'
        (kit / 'ryagram').mkdir(parents=True)
        (kit / 'tools').mkdir()
        (kit / 'ryagram' / 'a.py').write_text('print(1)\n')
        (kit / 'tools' / 'desktop_maker.py').write_text('page v1\n')
        (kit / 'tools' / 'start-maker.bat').write_text('@echo off\r\n')
        (kit / 'tools' / 'faces_local_probe.py').write_text('probe\n')
        (kit / 'KIT-MANIFEST.json').write_text(json.dumps({'made_at': 't', 'scope': 'test', 'ryagram_commits': {r1[:7]: r1}, 'review_notes': {r1[:7]: 'local-mcp: ok'}, 'desktop_maker': {'ref': m1[:7], 'commit': m1}}))
        sums = []
        for p in sorted(kit.rglob('*')):
            if p.is_file() and p.name != 'SHA256SUMS.txt' and p.name != 'KIT-MANIFEST.json':
                sums.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(kit).as_posix()}')
        (kit / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n')

        def go():
            import io
            import contextlib
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = run(kit, ry, lai, 'maker-drop')
            return code, buf.getvalue()
        code, out = go()
        check(code == 0 and 'UP TO DATE' in out, 'a clean kit whose pins are the branch heads is reported clean')
        (lai / 'tools' / 'desktop_maker.py').write_text('page v2\n')
        g(lai, 'add', '-A')
        g(lai, 'commit', '-q', '-m', 'maker two')
        code, out = go()
        check(code == 1 and 'BEHIND by 1' in out and 'its page files changed since the pin' in out, 'a maker branch that moved on with a changed page is reported BEHIND, with the page files named')
        (lai / 'README').write_text('doc\n')
        g(lai, 'add', '-A')
        g(lai, 'reset', '-q', '--hard', m1)
        (lai / 'README').write_text('doc\n')
        g(lai, 'add', '-A')
        g(lai, 'commit', '-q', '-m', 'only a doc')
        code, out = go()
        check(code == 1 and 'BEHIND by 1' in out and 'identical; only checks or docs moved' in out, 'a branch that only moved a doc is BEHIND but says the page files are identical')
        (kit / 'tools' / 'desktop_maker.py').write_text('page TAMPERED\n')
        code, out = go()
        check(code == 1 and 'DIFFERS from the pinned maker commit' in out and 'changed since the kit was built: tools/desktop_maker.py' in out, 'an edited page file in the kit is caught twice (the recorded hash and the pinned commit)')
        (kit / 'tools' / 'desktop_maker.py').write_text('page v1\n')
        (kit / 'ryagram' / 'a.py').write_text('print(2)\n')
        code, out = go()
        check(code == 1 and 'changed since the kit was built: ryagram/a.py' in out and '0 identical to a pinned commit, 1 not' in out, 'an edited engine file is caught')
        (kit / 'ryagram' / 'a.py').write_text('print(1)\n')
        g(ry, 'commit', '-q', '--allow-empty', '-m', 'two')
        g(ry, 'checkout', '-q', 'local-mcp')
        g(ry, 'commit', '-q', '--allow-empty', '-m', 'newer on the branch')
        code, out = go()
        check(code == 1 and 'local-mcp' in out and 'BEHIND by 1' in out, 'a Ryagram branch that moved on is reported BEHIND by name')
        g(ry, 'branch', '-q', '-D', 'main')
        g(ry, 'branch', '-q', '-m', 'local-mcp', 'gone')
        code, out = go()
        check(code == 1 and 'MISSING' in out, 'a branch that no longer exists is reported MISSING')
    finally:
        pass
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('kit', nargs='?')
    ap.add_argument('--ryagram-repo', default='C:/Users/Ryan/Documents/GitHub/Ryagram')
    ap.add_argument('--lai-repo', default=str(ROOT))
    ap.add_argument('--maker-branch', default='maker-drop')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.kit:
        ap.error('give a kit folder (or --selftest)')
    try:
        return run(a.kit, Path(a.ryagram_repo), Path(a.lai_repo), a.maker_branch)
    except (OSError, RuntimeError, KeyError, json.JSONDecodeError) as e:
        print(f'check-kit-pins: could not run: {e}')
        return 2


if __name__ == '__main__':
    sys.exit(main())
