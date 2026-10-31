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
GET = 'tools' + chr(92) + 'get-model.bat'
ENGINE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/engine-lr')


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf8', 'replace')


def clean_env(extra_path=True, extra=None):
    sysroot = os.environ.get('SystemRoot', r'C:\Windows')
    py_dir = str(Path(sys.executable).parent)
    path = [rf'{sysroot}\System32', sysroot] + ([py_dir, str(Path(py_dir) / 'Scripts'), shutil.which('py') and str(Path(shutil.which('py')).parent)] if extra_path else [])
    env = {'SystemRoot': sysroot, 'ComSpec': rf'{sysroot}\System32\cmd.exe', 'PATH': ';'.join(p for p in path if p), 'TEMP': tempfile.gettempdir(), 'TMP': tempfile.gettempdir(),
           'USERPROFILE': os.environ['USERPROFILE'], 'HOMEDRIVE': os.environ.get('HOMEDRIVE', ''), 'HOMEPATH': os.environ.get('HOMEPATH', ''), 'MAKER_NO_OPEN': '1', 'NO_PROXY': '127.0.0.1,localhost'}
    env.update(extra or {})
    return env


def start(folder, extra_path=True, args=(), extra_env=None):
    log = folder / f'start-{time.time_ns()}.log'
    f = open(log, 'w', encoding='utf8')
    p = subprocess.Popen(['cmd.exe', '/c', str(folder / 'tools' / 'start-maker.bat'), *args], cwd=str(folder.parent), env=clean_env(extra_path, extra_env), stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT)
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
        shutil.copytree(ENGINE / 'ryagram', folder / 'ryagram', ignore=shutil.ignore_patterns('__pycache__', 'globe3d', 'trends'))
        (folder / 'recipes').mkdir()
        sam = Path('D:/Ryagram-scratch/ENGINE/Ryagram-ranges/recipes/sam-first.json')
        (folder / 'recipes' / 'sam-first.json').write_bytes(sam.read_bytes() if sam.is_file() else json.dumps({}).encode())
        (folder / 'tools').mkdir()
        for n in ('desktop_maker.py', 'ryagram_platform.py', 'start-maker.bat', 'get-model.bat'):
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
            check('copy the address above into Microsoft Edge or Google Chrome' in txt, 'and it says what to do if the page misbehaves in the default browser: use Edge or Chrome')
            # the listening model: found with NO variable set by the person (a double-click has none), in the kit's own models folder
            want = str(folder / 'models')
            line = 'Listening model folder: ' + want + ' (no model there yet: use the Download button on the page)'
            check(line in txt.replace(chr(13), ''), "a double-click start (a clean environment, no RYAGRAM_MODEL_DIR) looks in the kit's own models folder and says plainly the model is not there yet (" + str([x for x in txt.splitlines() if 'model folder' in x][:1]) + ')')
            tok = url.split('/?t=')[1]
            (tmp / 'a.mp4').write_bytes(b'not a real video')

            def problems_at(b, k):
                req = urllib.request.Request(b + '/api/check', data=json.dumps({'recipe': 'sam-first.json', 'binds': {'footage-1': [str(tmp / 'a.mp4')]}, 'model': 'base'}).encode(), headers={'X-Maker-Token': k, 'Content-Type': 'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=20) as r:
                        return json.loads(r.read().decode()).get('problems', [])
                except urllib.error.HTTPError as e:
                    return json.loads(e.read().decode()).get('problems', [])
            sentence = 'The \u201cFast (rough)\u201d listening model is not on this computer yet (about 142 MB, downloaded once). Press “Download the listening model” on this page'
            check(any(sentence in x for x in problems_at(base, tok)), "Plan's door check says in ONE plain sentence what to do when the model is missing")
            # a second start takes the next free port
            p2, log2, f2 = start(folder, args=('--port', str(port)))
            procs.append((p2, f2))
            url2, txt2 = url_from(log2, p2)
            check(url2 is not None and url2.split('/?t=')[0] != base, f'a second start does not fail: it takes the next free port ({(url2 or txt2)[:60]!r})')
        # the model IS there (the layout the engine's download writes): found, said so, and the missing-model sentence is gone
        folder_m = tmp / 'withmodel'
        shutil.copytree(folder, folder_m, ignore=shutil.ignore_patterns('*.log'))
        wdir = folder_m / 'models' / 'models--Systran--faster-whisper-base' / 'snapshots' / 'abc123'
        wdir.mkdir(parents=True)
        (wdir / 'model.bin').write_bytes(b'x')
        p5, log5, f5 = start(folder_m, args=('--port', '0'))
        procs.append((p5, f5))
        url5, txt5 = url_from(log5, p5)
        check('found: Fast (rough)' in txt5, 'with the model in the same models folder the black window says it is found (' + str([x for x in txt5.splitlines() if 'model folder' in x][:1]) + ')')
        if url5:
            probs5 = problems_at(url5.split('/?t=')[0], url5.split('/?t=')[1])
            check(not any('listening model' in x for x in probs5), 'and the door check no longer mentions the model')
        # a folder the person chose themselves (RYAGRAM_MODEL_DIR set before the start) is respected, not overwritten
        elsewhere = tmp / 'my-models'
        elsewhere.mkdir()
        p6, log6, f6 = start(folder, args=('--port', '0'), extra_env={'RYAGRAM_MODEL_DIR': str(elsewhere)})
        procs.append((p6, f6))
        url6, txt6 = url_from(log6, p6)
        check('Listening model folder: ' + str(elsewhere) in txt6, 'a model folder the person set is respected')
        # MUST-FAIL: take the new line out of the .bat and the model folder is no longer announced (so the checks above do test that line)
        folder_b = tmp / 'broken'
        shutil.copytree(folder, folder_b, ignore=shutil.ignore_patterns('*.log'))
        bat_line = b'if not defined RYAGRAM_MODEL_DIR set "RYAGRAM_MODEL_DIR=%CD%' + bytes([92]) + b'models"' + bytes([13, 10])
        bat0 = (folder_b / 'tools' / 'start-maker.bat').read_bytes()
        check(bat_line in bat0, 'the .bat has the model-folder line this test expects')
        (folder_b / 'tools' / 'start-maker.bat').write_bytes(bat0.replace(bat_line, b''))
        p7, log7, f7 = start(folder_b, args=('--port', '0'))
        procs.append((p7, f7))
        url7, txt7 = url_from(log7, p7)
        check(url7 is not None and 'Listening model folder' not in txt7, 'MUST-FAIL: without the .bat line the black window says nothing about the model folder (the tests above need that line)')
        # get-model.bat with no Python says so in words (it starts no download)
        gm_log = folder / 'getmodel.log'
        f8 = open(gm_log, 'w', encoding='utf8')
        p8 = subprocess.Popen(['cmd.exe', '/c', str(folder / 'tools' / 'get-model.bat')], cwd=str(folder.parent), env=clean_env(False), stdin=subprocess.DEVNULL, stdout=f8, stderr=subprocess.STDOUT)
        procs.append((p8, f8))
        try:
            p8.wait(timeout=30)
        except subprocess.TimeoutExpired:
            stop(p8)
        f8.flush()
        t8 = gm_log.read_text(encoding='utf8', errors='replace')
        check('Python was not found' in t8 and 'python.org' in t8, 'get-model.bat with no Python on PATH says how to get Python (it started no download)')
        # the Microsoft Store python.exe stub (found by `where`, but it only prints "Python was not found; run without arguments...") must count as NO Python
        stub_dir = tmp / 'storestub'
        stub_dir.mkdir()
        (stub_dir / 'python.cmd').write_text('@echo Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.' + chr(13) + chr(10) + '@exit /b 9009' + chr(13) + chr(10), encoding='ascii')
        for bat in ('start-maker.bat', 'get-model.bat'):
            lg = folder / ('stub-' + bat + '.log')
            f_ = open(lg, 'w', encoding='utf8')
            e_ = clean_env(False)
            e_['PATH'] = str(stub_dir) + ';' + e_['PATH']
            p_ = subprocess.Popen(['cmd.exe', '/c', str(folder / 'tools' / bat)], cwd=str(folder.parent), env=e_, stdin=subprocess.DEVNULL, stdout=f_, stderr=subprocess.STDOUT)
            procs.append((p_, f_))
            try:
                p_.wait(timeout=30)
            except subprocess.TimeoutExpired:
                stop(p_)
            f_.flush()
            tx = lg.read_text(encoding='utf8', errors='replace')
            check('Python was not found on this computer.' in tx and 'python.org' in tx and 'Microsoft Store' not in tx and 'online' not in tx, f'{bat} with only the Microsoft Store python stub on PATH says Python is missing and how to get it (not the Store text, not "check you are online")')
        # get-model.bat with the internet BLOCKED (a dead local proxy, so nothing leaves this computer): the download fails, Sam sees a plain sentence plus the last line of the error, NOT a Python traceback; the full text is kept in a log next to the models folder
        folder_g = tmp / 'getmodel'
        shutil.copytree(folder, folder_g, ignore=shutil.ignore_patterns('*.log'))
        gm2 = folder_g / 'getmodel-out.txt'
        f9 = open(gm2, 'w', encoding='utf8')
        dead = 'http://127.0.0.1:9'
        p9 = subprocess.Popen(['cmd.exe', '/c', str(folder_g / 'tools' / 'get-model.bat')], cwd=str(folder_g.parent), env=clean_env(True, {'HTTP_PROXY': dead, 'HTTPS_PROXY': dead, 'ALL_PROXY': dead, 'NO_PROXY': ''}), stdin=subprocess.DEVNULL, stdout=f9, stderr=subprocess.STDOUT)
        procs.append((p9, f9))
        try:
            p9.wait(timeout=180)
        except subprocess.TimeoutExpired:
            stop(p9)
        f9.flush()
        t9 = gm2.read_text(encoding='utf8', errors='replace')
        logf = Path(str(folder_g / 'models') + '.get-model.log')
        check('The download did not finish' in t9 and 'The last line of the error was:' in t9 and 'Traceback' not in t9, 'a failed download shows a plain sentence and the last line of the error, no Python traceback (' + str(t9.strip()[:120]) + ')')
        check(logf.is_file() and len(logf.read_text(encoding='utf8', errors='replace')) > 20 and str(logf) in t9, 'the full text of the failure is kept in a log file next to the models folder, and the window names it')
        check(not any((folder_g / 'models').rglob('model.bin')) if (folder_g / 'models').exists() else True, 'and nothing was downloaded')
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
