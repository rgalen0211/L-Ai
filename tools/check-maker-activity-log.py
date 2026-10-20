"""The desktop maker's LOCAL activity log (kit r8) and its seven wording lines, with MUST-FAILs. No browser, no network, no speech model: the engine's recipe and bind checks are real; Plan and Build
run a stand-in `ryagram.local`. Everything is written under one throwaway folder (TEMP, or --base), never to C:\\ unless TEMP is there; the home, AppData and LocalAppData the program could reach are
replaced with EMPTY folders and must still be empty at the end.

    python tools/check-maker-activity-log.py <the kit's own folder, e.g. D:/Ryagram-scratch/sam-kit-v11c-r8, or a current Ryagram checkout> [<scratch base folder>]
      the engine folder is REQUIRED (an older engine has no sound check and two rows would fail for that reason alone; the check says so in words); the scratch folder defaults to a new one under TEMP

What it proves
  A  what the log can say: only fixed events and fields; hostile values written as "?"; a file name, folder, typed word, answer, user name or computer name never reaches the file
  B  the off switch: off writes one last line then nothing; it survives a restart; --no-activity-log writes no file at all; on again resumes
  C  a deleted log file or folder, or a folder that cannot be written, never breaks the maker
  D  nothing leaves the computer: with every non-loopback connection refused, a whole session makes no attempt; the log code imports nothing that can connect
  E  it writes only in the out folder (home, AppData, LocalAppData stay empty); no registry; it stops growing at its cap
  F  the visible notice and switch are on the first screen; the seven wording lines are exactly the agreed ones
"""
import importlib.util
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout. There is no default, because an older engine has no sound check and would fail two rows for that reason alone.")
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)
SRC = (ROOT / 'tools' / 'desktop_maker.py').read_text(encoding='utf-8')

RECIPE = {"schema": "ryagram.recipe/0", "name": "well that is great news",
          "slots": [{"id": "source-1", "label": "First footage", "accepts": "video", "multiple": True},
                    {"id": "source-2", "label": "Second footage", "accepts": "video", "multiple": False}],
          "find": {"op": "words", "text": "well that is great news", "unit": "words", "slots": ["source-1", "source-2"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}
STUB_MAIN = '''import sys, json
from pathlib import Path
a = sys.argv
cmd = a[1]
work = Path(a[a.index("--work-dir") + 1]); out = Path(a[a.index("--out") + 1])
clips = [{"n": 1, "words": "well that is great", "file_name": "a.mp4", "slot": "source-1", "start_ms": 7930, "end_ms": 9970, "duration_ms": 2040}]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"ok": True, "gaps": [], "clips": clips, "seconds_estimate": 2.96, "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(0)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42" + bytes(range(256)) * 20)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "film": out.name, "seconds": 2.4, "clips": clips, "network_attempts": 0, "reused_words": True}))
print("built", out.name)
'''


def get(url, headers=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**headers, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def lines(path):
    try:
        return [json.loads(x) for x in Path(path).read_text(encoding='utf-8').splitlines() if x.strip()]
    except OSError:
        return []


FAILED = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILED.append(what)


class Session:
    """One maker server on a free port, with its own folders; the engine is a stand-in for plan and build."""

    def __init__(self, tmp, name, activity=True, out=None):
        self.tmp = tmp
        self.out = Path(out) if out else tmp / f'films-{name}'
        self.srv = dm.make_server(tmp / 'engine', tmp / 'recipes', tmp / f'work-{name}', self.out, port=0, token='testtoken', activity=activity)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{dm.STATE['port']}"
        self.tok = {'X-Maker-Token': 'testtoken'}
        self.log = self.out / dm.ACTIVITY_NAME

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()

    def api(self, path, body=None):
        return post(self.base + path, body, self.tok) if body is not None else (lambda r: (r[0], json.loads(r[1])))(get(self.base + path, self.tok))

    def wait(self, states, seconds=30):
        end = time.time() + seconds
        j = {}
        while time.time() < end:
            j = self.api('/api/job')[1]
            if j['state'] in states:
                return j
            time.sleep(0.15)
        return j


def full_flow(s, clips, words='super secret phrase'):
    """Everything a first-time person does, with private-looking content in every place a name or words could leak from."""
    sl = {'recipe': 'great-news.json', 'model': 'base', 'phrase': words}
    good = {'source-1': [str(clips / 'a.mp4')], 'source-2': [str(clips / 'b.mkv')]}
    get(f'{s.base}/?t=testtoken')
    s.api('/api/check', {**sl, 'binds': {}})
    s.api('/api/check', {**sl, 'binds': good})
    s.api('/api/build', {**sl, 'binds': good})                                        # refused: no Plan yet
    s.api('/api/plan', {**sl, 'binds': good}); j = s.wait(('planned', 'gaps', 'stopped'))
    s.api('/api/sound', {**sl, 'binds': good})
    for _ in range(100):                                                              # wait for the sound check to finish (a fixed sleep was flaky under load)
        if s.api('/api/sound')[1].get('state') != 'running':
            break
        time.sleep(0.1)
    time.sleep(0.2)
    s.api('/api/build', {**sl, 'binds': good}); j2 = s.wait(('built', 'stopped'))
    s.api('/api/open-folder', {})
    s.api('/api/answers', {'answers': ['My private answer one', '', 'Another private answer, with my name Ryan Smith']})
    s.api('/api/pick', {'multiple': True})
    s.api('/api/locate', {'name': 'a.mp4', 'size': 10, 'mtime_ms': 1})
    s.api('/api/paste', {'text': f'--bind source-1={clips / "a.mp4"}\nnonsense'})
    s.api('/api/event', {'name': 'recipe_changed', 'recipe': 'great-news'})
    s.api('/api/event', {'name': 'words_edited', 'chars': len(words)})
    s.api('/api/event', {'name': 'model_changed', 'model': 'base'})
    s.api('/api/event', {'name': 'slot_cleared'})
    s.api('/api/event', {'name': 'evil_event', 'path': 'C:\\Users\\Ryan'})
    s.api('/api/cancel', {})
    return j, j2


def main():
    keep = {k: os.environ.get(k) for k in ('USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA')}
    tmp = Path(tempfile.mkdtemp(prefix='maker-actlog-', dir=BASE if BASE else None))
    if os.name == 'nt' and tmp.drive.upper() == 'C:' and not BASE:
        print('note: TEMP is on C:; everything below is deleted at the end')
    try:
        eng = tmp / 'engine'
        shutil.copytree(ENGINE / 'ryagram', eng / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (eng / 'ryagram' / 'local' / '__main__.py').write_text(STUB_MAIN, encoding='utf8')
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'great-news.json').write_text(json.dumps(RECIPE), encoding='utf8')
        clips = tmp / 'Sam Private Holiday Videos'
        clips.mkdir()
        for n in ('a.mp4', 'b.mkv'):
            (clips / n).write_bytes(b'not really a video')
        dm.faster_whisper_missing = lambda: False
        dm.open_in_folder = lambda path: None
        dm.pick_files = lambda multiple: [str(clips / 'a.mp4'), str(clips / 'b.mkv')] if multiple else [str(clips / 'a.mp4')]
        # empty homes: anything the program tried to write there would show
        fake = {k: tmp / f'fake-{k}' for k in keep}
        for k, v in fake.items():
            v.mkdir()
            os.environ[k] = str(v)

        print('A  what the log can say')
        events, rules = dm.ACTIVITY_EVENTS, dm.FIELD_RULES
        check(all(f in rules for fs in events.values() for f in fs), 'every field an event may carry has a rule that its value must satisfy')
        hostile = ['C:\\Users\\Ryan\\Desktop maker\\films\\a.mp4', '/home/sam/holiday.mp4', 'super secret phrase', 'Ryan Smith', '', 'DESKTOP-ABC123', '..\\..\\x', {'path': 'x'}, ['a.mp4']]
        a = dm.ActivityLog(tmp / 'unit', True)
        for ev, fs in events.items():
            a.log(ev, **{f: h for f in fs for h in hostile[:1]})
        for h in hostile:
            for ev, fs in events.items():
                a.log(ev, **{f: h for f in fs})
        unit = (tmp / 'unit' / dm.ACTIVITY_NAME).read_text(encoding='utf-8')
        check(not any(bad in unit for bad in hostile if bad and isinstance(bad, str)) and 'Users' not in unit and 'holiday' not in unit and 'secret' not in unit and 'mp4' not in unit, 'MUST-FAIL: hostile values (paths, typed words, a name, a computer name) never reach the file, whatever field they are offered in')
        check(all(v == '?' or isinstance(v, (bool, int)) or (isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9_. -]*', v)) for rec in lines(tmp / 'unit' / dm.ACTIVITY_NAME) for k, v in rec.items() if k not in ('t', 's', 'ev', 'n')), 'what is written for a field is "?", a number, a yes/no, or a plain word from a fixed list (never a path or a sentence)')
        before = len(lines(tmp / 'unit' / dm.ACTIVITY_NAME))
        check(a.log('not_an_event', x='y') is False and len(lines(tmp / 'unit' / dm.ACTIVITY_NAME)) == before, 'MUST-FAIL: an event that is not in the list writes nothing')
        a.log('check', ok=True, problems='', files=2, secret='C:\\private')
        check('secret' not in lines(tmp / 'unit' / dm.ACTIVITY_NAME)[-1] and 'private' not in (tmp / 'unit' / dm.ACTIVITY_NAME).read_text(encoding='utf-8'), 'a field the event does not list is dropped')

        s = Session(tmp, 'one')
        if dm.STATE.get('gap_fn') is None:
            print(f"STOP: the engine in {ENGINE} has no sound check (ryagram.library.transcribe.decode_gap_ms), so the sound_started / sound_done rows cannot be tested. Use the kit's own folder or a current Ryagram checkout.")
            return 2
        j, j2 = full_flow(s, clips)
        recs = lines(s.log)
        names = [r['ev'] for r in recs]
        for want in ('session_start', 'page_opened', 'check', 'job_start', 'job_end', 'sound_started', 'sound_done', 'answers_saved', 'files_picked', 'file_dropped', 'paste_used',
                     'ui_recipe_changed', 'ui_words_edited', 'ui_model_changed', 'ui_slot_cleared', 'folder_opened', 'problem_shown', 'cancel_pressed'):
            check(want in names, f'a session records "{want}"')
        check(j.get('state') == 'planned' and j2.get('state') == 'built', 'the stand-in Plan and Build finished (so the log was exercised on a real flow)')
        text = s.log.read_text(encoding='utf-8')
        user = os.environ.get('USERNAME', 'zzzz-no-user')
        comp = os.environ.get('COMPUTERNAME', 'zzzz-no-computer')
        leaks = ['a.mp4', 'b.mkv', 'Sam Private', 'Holiday', 'super secret', 'My private answer', 'Ryan Smith', 'testtoken', str(tmp), 'Users', user, comp, 'films-one', 'great-news.json']
        found = [x for x in leaks if x.lower() in text.lower()]
        check(not found, f'MUST-FAIL: after a whole session the file holds none of: file names, folder names, typed words, answers, the token, the user name, the computer name ({found})')
        ae = [r for r in recs if r['ev'] == 'answers_saved'][0]
        check(ae['answered'] == '1 3' and ae['count'] == 2, 'answers: only WHICH questions were answered are recorded (1 and 3), not what was written')
        je = [r for r in recs if r['ev'] == 'job_start']
        check([r['kind'] for r in je] == ['plan', 'build'] and [r['attempt'] for r in je] == [1, 1] and je[0]['phrase_chars'] == len('super secret phrase') and 'phrase' not in je[0], 'Plan and Build starts record the attempt number and the LENGTH of the typed phrase, never the phrase')
        check(all(r['ev'] != 'evil_event' for r in recs) and 'C:' not in text, 'an unlisted page event is refused and its content never written')
        check(recs[0]['ev'] == 'session_start' and set(recs[0]) <= {'t', 's', 'ev', 'n', 'maker', 'python', 'os'}, 'the first line says only the log revision, the Python version and the system family')
        check(get(f'{s.base}/api/log', s.tok)[0] == 200 and json.loads(get(f'{s.base}/api/log', s.tok)[1]) == {'on': True, 'path': str(s.log)}, 'the page can ask where the log is and whether it is on')

        print('B  the off switch')
        n0 = len(lines(s.log))
        st, r = s.api('/api/log', {'on': False})
        check(st == 200 and r['on'] is False, 'the switch turns it off')
        last = lines(s.log)[-1]
        check(last['ev'] == 'log_off' and len(lines(s.log)) == n0 + 1, 'turning it off writes ONE last line, saying so')
        n1 = len(lines(s.log))
        full_flow(s, clips)
        check(len(lines(s.log)) == n1, 'MUST-FAIL: with the log off, a whole session (every button) writes NO line')
        check((s.out / dm.ACTIVITY_OFF_NAME).is_file(), 'the choice is remembered by an empty marker file in the same folder')
        s.stop()
        s2 = Session(tmp, 'one-restart', out=s.out)
        get(f'{s2.base}/?t=testtoken'); full_flow(s2, clips)
        check(len(lines(s2.log)) == n1, 'MUST-FAIL: after a restart it is STILL off (nothing new written)')
        st, r = s2.api('/api/log', {'on': True})
        check(r['on'] is True and not (s2.out / dm.ACTIVITY_OFF_NAME).exists() and lines(s2.log)[-1]['ev'] == 'log_on', 'turning it on removes the marker and writes "log_on"')
        get(f'{s2.base}/?t=testtoken')
        check(lines(s2.log)[-1]['ev'] == 'page_opened', 'and it records again')
        s2.stop()
        s3 = Session(tmp, 'noflag', activity=False)
        full_flow(s3, clips)
        check(not s3.log.exists(), 'MUST-FAIL: --no-activity-log (activity=False) never creates the file')
        s3.stop()

        print('C  the log never breaks the maker')
        s4 = Session(tmp, 'delete')
        get(f'{s4.base}/?t=testtoken')
        s4.log.unlink()
        st, _ = s4.api('/api/check', {'recipe': 'great-news.json', 'binds': {}})
        check(st == 200 and s4.log.is_file() and lines(s4.log)[-1]['ev'] == 'check', 'a deleted log file is simply made again; the request still works')
        shutil.rmtree(s4.out)
        st, _ = s4.api('/api/check', {'recipe': 'great-news.json', 'binds': {}})
        check(st == 200, 'a deleted folder does not break a request')
        blocker = tmp / 'a-file-not-a-folder'
        blocker.write_text('x')
        s5 = Session(tmp, 'blocked', out=blocker / 'films')
        st, _ = s5.api('/api/check', {'recipe': 'great-news.json', 'binds': {}})
        check(st == 200 and not (blocker / 'films').exists(), 'MUST-FAIL: a log folder that cannot be made is ignored; the maker answers as normal')
        s5.stop()
        s4.stop()

        print('D  nothing leaves the computer')
        attempts = []
        real_connect, real_create, real_gai = socket.socket.connect, socket.create_connection, socket.getaddrinfo

        def spy_connect(self, address, *a, **k):
            host = address[0] if isinstance(address, tuple) else str(address)
            attempts.append(host)
            if host not in ('127.0.0.1', 'localhost', '::1'):
                raise OSError('refused by the check: not a loopback address')
            return real_connect(self, address, *a, **k)

        def spy_create(address, *a, **k):
            attempts.append(address[0])
            if address[0] not in ('127.0.0.1', 'localhost', '::1'):
                raise OSError('refused by the check: not a loopback address')
            return real_create(address, *a, **k)
        socket.socket.connect, socket.create_connection = spy_connect, spy_create
        try:
            s6 = Session(tmp, 'net')
            full_flow(s6, clips)
            s6.stop()
        finally:
            socket.socket.connect, socket.create_connection = real_connect, real_create
        outside = [h for h in attempts if h not in ('127.0.0.1', 'localhost', '::1')]
        check(attempts and not outside, f'MUST-FAIL: with every non-loopback connection refused, a whole session, log and all, makes no attempt ({len(attempts)} loopback only)')
        net_imports = re.findall(r'^\s*(?:import|from)\s+(urllib\.request|http\.client|smtplib|ftplib|requests|httpx|aiohttp|urllib3|socket|ssl|xmlrpc[\w.]*|telnetlib|asyncio)\b', SRC, re.M)
        check(not net_imports, f'the maker program imports no client for the internet ({net_imports})')
        block = SRC[SRC.index('class ActivityLog'):SRC.index('def act(')]
        check(not re.search(r'socket|urllib|http|requests|smtp|ftp|ssl|webbrowser|subprocess|winreg|environ|getpass|gethostname|getlogin|expanduser|home\(\)', block), 'the logger class itself has no network, process, registry, user-name or computer-name code')
        check('winreg' not in SRC and 'getpass' not in SRC and 'gethostname' not in SRC and 'getlogin' not in SRC, 'the whole program never reads the registry, the user name or the computer name')

        print('E  where it writes')
        stray = [str(p) for d in fake.values() for p in d.rglob('*')]
        check(not stray, f'MUST-FAIL: the home, AppData and LocalAppData folders stay EMPTY through every session above ({stray[:3]})')
        keepcap = dm.ACTIVITY_MAX_BYTES
        dm.ACTIVITY_MAX_BYTES = 300
        capped = dm.ActivityLog(tmp / 'cap', True)
        for _ in range(50):
            capped.log('page_opened')
        size = (tmp / 'cap' / dm.ACTIVITY_NAME).stat().st_size
        dm.ACTIVITY_MAX_BYTES = keepcap
        check(size < 300 + 200, f'MUST-FAIL: the log stops growing at its cap ({size} bytes after 50 lines with a 300-byte cap)')

        print('F  the notice, and the seven wording lines')
        s7 = Session(tmp, 'page')
        page = get(f'{s7.base}/?t=testtoken')[1].decode('utf-8')
        js = get(f'{s7.base}/maker.js')[1].decode('utf-8')
        check('keeps a short activity log on this computer' in page and 'id="log-on"' in page and 'Nothing is sent anywhere' in page and 'file names' in page and 'Keep this log' in page,
              'the first screen says, in plain words, that it keeps a log on this PC, what is in it, that nothing is sent, and how to turn it off')
        check(page.index('A note about a small log') < page.index('1. Recipe'), 'the notice comes BEFORE the first step')
        check("api('/api/log'" in js and "api('/api/log', { on: box.checked })" in js, 'the page script shows the real path and sends the switch')
        w = {'1 old text gone': 'pass the door checks' not in js and 'Your files are ready to use.' in js,
             '2': 'Use the same one the finder used' not in page and 'Pick the same one you used before, or leave it as it is.' in page,
             '3 hidden': '<details class="paste" hidden>' in page and "get('advanced') === '1'" in js,
             '4': 'network attempts:' not in js and 'Nothing went online (' in js and 'A list of where each word came from is saved beside the film.' in js,
             '5': "f.mb < 1 ? 'under 1 MB'" in js,
             '7': "$('words').placeholder = current ? current.find : ''" in js and 'Type a short phrase one of your videos really says.' in js}
        for k, v in w.items():
            check(v, f'wording line {k}')
        short = dm.wait_words(120, 'base')
        longer = dm.wait_words(600, 'base')
        check('about 2 minutes, often much less' in short and 'often much less' not in longer, f'6: under 5 minutes of video the wait says "often much less"; longer videos do not ({short[:70]!r})')
        s7.stop()
    finally:
        for k, v in keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(tmp, ignore_errors=True)
    print('\nFAILED: ' + '; '.join(FAILED) if FAILED else '\nall passed')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())
