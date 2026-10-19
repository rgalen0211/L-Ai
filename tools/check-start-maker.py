"""The one-click start (tools/start-maker.bat) from a FRESH shell, on a folder laid out like Sam's Ryagram folder: ryagram/ (ENGINE's code), recipes/sam-first.json, tools/desktop_maker.py and tools/start-maker.bat.
Starts the .bat in a new cmd.exe with a clean environment (only the system folders, Python's folder and the temp folder; no PYTHONPATH, no RYAGRAM_* variables), waits for the address it prints, and checks:
the page answers with the token and not without it, it listens on 127.0.0.1 only (not on this computer's network address), a second start does not fail but takes the next free port, a folder with no
recipe says so in plain words and does not start, and a PATH without Python says so in plain words. It never opens a browser (MAKER_NO_OPEN). It stops only the processes it started, by PID.
Windows only.

    python tools/check-start-maker.py <path to a Ryagram checkout with ryagram/local>      (default D:/Ryagram-scratch/WEB/engine-lr)
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/engine-lr')


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf8', 'replace')


def clean_env(extra_path=True):
    sysroot = os.environ.get('SystemRoot', r'C:\Windows')
    py_dir = str(Path(sys.executable).parent)
    path = [rf'{sysroot}\System32', sysroot] + ([py_dir, str(Path(py_dir) / 'Scripts'), shutil.which('py') and str(Path(shutil.which('py')).parent)] if extra_path else [])
    env = {'SystemRoot': sysroot, 'ComSpec': rf'{sysroot}\System32\cmd.exe', 'PATH': ';'.join(p for p in path if p), 'TEMP': tempfile.gettempdir(), 'TMP': tempfile.gettempdir(),
           'USERPROFILE': os.environ['USERPROFILE'], 'HOMEDRIVE': os.environ.get('HOMEDRIVE', ''), 'HOMEPATH': os.environ.get('HOMEPATH', ''), 'MAKER_NO_OPEN': '1', 'NO_PROXY': '127.0.0.1,localhost'}
    return env


def start(folder, extra_path=True, args=()):
    log = folder / f'start-{time.time_ns()}.log'
    f = open(log, 'w', encoding='utf8')
    p = subprocess.Popen(['cmd.exe', '/c', str(folder / 'tools' / 'start-maker.bat'), *args], cwd=str(folder.parent), env=clean_env(extra_path), stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT)
    return p, log, f


def url_from(log, p, seconds=25):
    end = time.time() + seconds
    while time.time() < end:
        txt = log.read_text(encoding='utf8', errors='replace')
        for line in txt.splitlines():
            if line.startswith('Open  http://'):
                return line[6:].strip(), txt
        if p.poll() is not None:
            return None, txt
        time.sleep(0.3)
    return None, log.read_text(encoding='utf8', errors='replace')


def stop(p):
    subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)


def main():
    tmp = Path(tempfile.mkdtemp(prefix='sam-'))
    folder = tmp / 'ryagram'
    ok = True
    procs = []

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)
    try:
        shutil.copytree(ENGINE / 'ryagram', folder / 'ryagram', ignore=shutil.ignore_patterns('__pycache__', 'globe3d', 'maprace', 'trends'))
        (folder / 'recipes').mkdir()
        sam = Path('D:/Ryagram-scratch/ENGINE/Ryagram-ranges/recipes/sam-first.json')
        (folder / 'recipes' / 'sam-first.json').write_bytes(sam.read_bytes() if sam.is_file() else json.dumps({}).encode())
        (folder / 'tools').mkdir()
        for n in ('desktop_maker.py', 'start-maker.bat'):
            shutil.copy(ROOT / 'tools' / n, folder / 'tools' / n)
        print('one click')
        p1, log1, f1 = start(folder, args=('--port', '0'))
        procs.append((p1, f1))
        url, txt = url_from(log1, p1)
        check(url is not None, f'the .bat starts the maker and prints an address ({(url or txt)[:70]!r})')
        if url:
            base = url.split('/?t=')[0]
            st, body = get(url)
            check(st == 200 and 'Desktop maker' in body, 'the address opens the page')
            check(get(base + '/')[0] == 403, 'the same address without the token is refused')
            host = socket.gethostbyname(socket.gethostname())
            port = int(base.rsplit(':', 1)[1])
            refused = False
            if host and not host.startswith('127.'):
                try:
                    socket.create_connection((host, port), timeout=3).close()
                except OSError:
                    refused = True
            else:
                refused = True
            check(refused, f'it listens on 127.0.0.1 only: connecting to this computer\u2019s network address {host} fails')
            check('Open  http://127.0.0.1:' in txt and 'Leave this window open' in txt, 'the window says in words what to do (open this, leave it open, close to stop)')
            # a second start takes the next free port
            p2, log2, f2 = start(folder, args=('--port', str(port)))
            procs.append((p2, f2))
            url2, txt2 = url_from(log2, p2)
            check(url2 is not None and url2.split('/?t=')[0] != base, f'a second start does not fail: it takes the next free port ({(url2 or txt2)[:60]!r})')
        # a folder with no recipe
        folder2 = tmp / 'norecipe'
        shutil.copytree(folder, folder2, ignore=shutil.ignore_patterns('*.log'))
        for f in (folder2 / 'recipes').glob('*.json'):
            f.unlink()
        p3, log3, f3 = start(folder2, args=('--port', '0'))
        procs.append((p3, f3))
        try:
            p3.wait(timeout=30)
        except subprocess.TimeoutExpired:
            pass
        f3.flush()
        t3 = log3.read_text(encoding='utf8', errors='replace')
        check('There are no recipe files' in t3 and 'The maker did not start' in t3 and 'Traceback' not in t3, f'no recipe: it says so in words, without a Python traceback ({t3.strip()[:80]!r})')
        # no Python on PATH
        p4, log4, f4 = start(folder, extra_path=False)
        procs.append((p4, f4))
        try:
            p4.wait(timeout=30)
        except subprocess.TimeoutExpired:
            stop(p4)
        t4 = log4.read_text(encoding='utf8', errors='replace')
        check('Python was not found' in t4 and 'python.org' in t4 and 'Add python.exe to PATH' in t4, f'no Python: it says how to get it ({t4.strip()[:80]!r})')
    finally:
        for p, f in procs:
            if p.poll() is None:
                stop(p)
            f.close()
        time.sleep(0.5)
        shutil.rmtree(tmp, ignore_errors=True)
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
