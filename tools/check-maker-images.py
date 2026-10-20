"""The desktop maker's pictures-and-rules slice (maker v2, OFF by default): which files count as pictures, the rights tick, the one-sentence rule, where it would fire, the overlays.json stub
for ENGINE, and the proof that none of it exists unless asked for. Real recipe and bind checks (the engine folder is REQUIRED); no browser, no network, nothing drawn into a film.

    python tools/check-maker-images.py <the kit's own folder, or a current Ryagram checkout> [<scratch base folder>]
"""
import importlib.util
import json
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import urllib.error
import urllib.request
import zlib
from pathlib import Path

if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout.")
ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "well that is great news",
          "slots": [{"id": "source-1", "label": "First footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "well that is great news", "unit": "words", "slots": ["source-1"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}
FAILED = []


def check(c, what):
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c:
        FAILED.append(what)


def png(w=4, h=3, extra_before_idat=b''):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\x80\x80\x80' * w for _ in range(min(h, 8)))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + extra_before_idat + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def jpeg(w, h):
    return bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])


def webp_lossless(w, h):
    bits = (w - 1) | ((h - 1) << 14)
    body = b'VP8L' + struct.pack('<I', 5) + b'\x2f' + struct.pack('<I', bits)
    return b'RIFF' + struct.pack('<I', 4 + len(body)) + b'WEBP' + body


def webp_ext(w, h, animated):
    body = b'VP8X' + struct.pack('<I', 10) + bytes([0x02 if animated else 0]) + b'\0\0\0' + (w - 1).to_bytes(3, 'little') + (h - 1).to_bytes(3, 'little')
    return b'RIFF' + struct.pack('<I', 4 + len(body)) + b'WEBP' + body


def call(base, path, body=None, tok='tok'):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers={'X-Maker-Token': tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def serve(tmp, name, v2, activity=False):
    srv = dm.make_server(tmp / 'engine', tmp / 'recipes', tmp / f'work-{name}', tmp / f'films-{name}', port=0, token='tok', activity=activity, v2=v2)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{dm.STATE['port']}"


def main():
    tmp = Path(tempfile.mkdtemp(prefix='maker-images-', dir=BASE if BASE else None))
    try:
        shutil.copytree(ENGINE / 'ryagram', tmp / 'engine' / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'great-news.json').write_text(json.dumps(RECIPE), encoding='utf8')
        pics = tmp / 'My Private Pictures'
        pics.mkdir()
        dm.faster_whisper_missing = lambda: False

        print('which files count as pictures')
        good = {'a.png': png(40, 30), 'b.jpg': jpeg(64, 48), 'c.webp': webp_lossless(32, 24)}
        for n, b in good.items():
            (pics / n).write_bytes(b)
        got = {n: dm.inspect_image(pics / n) for n in good}
        check(all(g['ok'] for g in got.values()) and [(g['kind'], g['width'], g['height']) for g in got.values()] == [('png', 40, 30), ('jpeg', 64, 48), ('webp', 32, 24)],
              f"a real PNG, JPEG and WEBP are accepted with their true size ({[(g['kind'], g['width'], g['height']) for g in got.values()]})")
        check(got['a.png']['id'].startswith('img-') and len(got['a.png']['sha256']) == 64, 'each picture gets a stable id and a SHA-256 from its bytes')
        bad = {
            'renamed-text.png': b'this is just text pretending to be a picture, long enough to look like a file ' * 3,
            'real-gif.png': b'GIF89a' + b'\x01\x00\x01\x00' + b'\x00' * 40,
            'script.svg': b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            'cut-off.png': b'\x89PNG\r\n\x1a\n\x00\x00',
            'png-named-jpg.jpg': png(10, 10),
            'animated.webp': webp_ext(20, 20, True),
            'animated.png': png(10, 10, extra_before_idat=struct.pack('>I', 8) + b'acTL' + b'\0' * 8 + struct.pack('>I', 0)),
            'huge.png': png(20000, 10000),
        }
        for n, b in bad.items():
            (pics / n).write_bytes(b)
        (pics / 'too-big.png').write_bytes(png(10, 10) + b'\0' * (dm.MAX_IMAGE_BYTES + 10))
        for n in list(bad) + ['too-big.png']:
            r = dm.inspect_image(pics / n)
            check(not r['ok'] and r['problem'], f"MUST-FAIL: {n} is refused in words ({r['problem'][:70]})")
        check(not dm.inspect_image(pics / 'missing.png')['ok'], 'MUST-FAIL: a file that is not there is refused')
        check(not dm.inspect_image(pics / 'a.png'.replace('a.png', 'a.bmp'))['ok'] and 'not a picture type' in dm.inspect_image(pics / 'x.bmp')['problem'], 'a picture type the tool does not read (bmp) is refused')

        print('\nthe slice does not exist unless asked for')
        srv, base = serve(tmp, 'off', False)
        page = urllib.request.urlopen(urllib.request.Request(base + '/?t=tok'), timeout=10).read().decode()
        check('Pictures to show' not in page and 'id="v2"' not in page, 'without --v2 the page has no pictures section')
        check(call(base, '/api/overlays')[0] == 404 and call(base, '/api/image/pick', {})[0] == 404 and call(base, '/api/overlays', {'rules': []})[0] == 404, 'MUST-FAIL: without --v2 every new address answers 404')
        srv.shutdown()
        srv.server_close()

        srv, base = serve(tmp, 'on', True, activity=True)
        page = urllib.request.urlopen(urllib.request.Request(base + '/?t=tok'), timeout=10).read().decode()
        check('Pictures to show' in page and 'does not draw them into the film yet' in page, 'with --v2 the section is there and says plainly that nothing is drawn into the film yet')
        check(call(base, '/api/overlays')[1] == {'images': [], 'rules': [], 'occurrences': [], 'warnings': []}, 'and it starts empty')

        print('\npictures, the rights tick, the rule')
        dm.pick_images = lambda: [str(pics / 'a.png'), str(pics / 'b.jpg'), str(pics / 'renamed-text.png')]
        st, r = call(base, '/api/image/pick', {})
        ids = {i['name']: i['id'] for i in r['images']}
        check(st == 200 and set(ids) == {'a.png', 'b.jpg'} and len(r['refused']) == 1 and 'does not look like a real picture' in r['refused'][0]['problem'], 'two real pictures are listed; the fake one is refused with its reason')
        check(all(i['rights'] is False for i in r['images']) and 'path' not in json.dumps(r) and str(pics) not in json.dumps(r), 'rights start UNTICKED, and the page is never sent a path')
        rule = {'phrase': 'great news', 'image_id': ids['a.png'], 'seconds': 2, 'mode': 'full', 'fade_s': 0.2}
        st, r = call(base, '/api/overlays', {'rules': [rule]})
        check(st == 400 and 'Tick' in r['error'] and 'a.png' in r['error'], f"MUST-FAIL: a rule cannot use a picture until the rights box is ticked ({r.get('error', '')[:70]})")
        st, r = call(base, '/api/image/rights', {'id': ids['a.png'], 'ok': True})
        check(st == 200 and [i['rights'] for i in r['images'] if i['id'] == ids['a.png']] == [True], 'ticking the box is recorded')
        for k, (bad_rule, word) in enumerate([({**rule, 'phrase': '   '}, 'Type the word'), ({**rule, 'image_id': 'img-zzzz'}, 'Choose one of the pictures'),
                                              ({**rule, 'seconds': 0.2}, 'between 0.5 and 10'), ({**rule, 'seconds': 30}, 'between 0.5 and 10'), ({**rule, 'seconds': 1, 'fade_s': 0.9}, 'at most half'),
                                              ({**rule, 'mode': 'spin'}, 'where the picture goes'), ({**rule, 'seconds': 'x'}, 'must be numbers')]):
            st, r = call(base, '/api/overlays', {'rules': [bad_rule]})
            check(st == 400 and word in r['error'], f"MUST-FAIL: rule check {k + 1} refuses in plain words ({word})")
        check(call(base, '/api/overlays', {'rules': [rule] * 21})[0] == 400, 'MUST-FAIL: more than 20 rules are refused')
        st, r = call(base, '/api/overlays', {'rules': [rule]})
        check(st == 200 and len(r['rules']) == 1 and r['warnings'] == ['Press Plan to see where each rule would show its picture.'], 'a valid rule is saved; with no plan yet the page says to press Plan')

        print('\nwhere the rule would fire (approximate, until ENGINE reports word times)')
        dm.STATE['last_plan'] = {'clips': [{'words': 'well that is great news', 'duration_ms': 2000}, {'words': 'for everyone', 'duration_ms': 1000}, {'words': 'great news', 'duration_ms': 1000}]}
        st, r = call(base, '/api/overlays', {'rules': [rule, {**rule, 'phrase': 'news for'}, {**rule, 'phrase': 'never said'}]})
        at = [o['at_s'] for o in r['occurrences']]
        check(at == [[1.2, 3.0], [1.6], []] and all(o['approximate'] for o in r['occurrences']), f"every occurrence is found, including a phrase across two clips, and marked approximate ({at})")
        check(any('never said' in w and 'not said' in w for w in r['warnings']), 'MUST-FAIL: a phrase that is not in the film gives a warning (zero overlays), never a guess')
        ov = json.loads((tmp / 'work-on' / 'overlays.json').read_text(encoding='utf-8'))
        check(ov['schema'] == dm.OVERLAYS_SCHEMA and ov['images'][0]['rights_ticked'] is True and ov['images'][0]['sha256'] == got['a.png']['sha256'] and ov['images'][0]['file_name'] == 'a.png'
              and len(ov['rules']) == 3 and ov['occurrences'][0]['at_s'] == [1.2, 3.0], 'overlays.json (the stub for ENGINE) holds the pictures with hash and rights tick, the rules and the occurrences')
        st, r = call(base, '/api/image/rights', {'id': ids['a.png'], 'ok': False})
        check(r['rules'] == [] and (tmp / 'work-on' / 'overlays.json').is_file(), 'MUST-FAIL: un-ticking the rights box removes every rule that used the picture')
        call(base, '/api/image/rights', {'id': ids['b.jpg'], 'ok': True})
        call(base, '/api/overlays', {'rules': [{**rule, 'image_id': ids['b.jpg']}]})
        st, r = call(base, '/api/image/remove', {'id': ids['b.jpg']})
        check(r['rules'] == [] and [i['name'] for i in r['images']] == ['a.png'], 'removing a picture removes its rules')

        print('\ndropping a file')
        dm.STATE['search_roots'] = [pics]
        f = pics / 'b.jpg'
        stt = f.stat()
        st, r = call(base, '/api/image/locate', {'name': 'b.jpg', 'size': stt.st_size, 'mtime_ms': stt.st_mtime * 1000})
        check(st == 200 and 'b.jpg' in [i['name'] for i in r['images']], 'a dropped picture is found by its name, size and time and added')
        st, r = call(base, '/api/image/locate', {'name': 'b.jpg', 'size': 5, 'mtime_ms': 1})
        check(r['refused'] and 'could not find' in r['refused'][0]['problem'], 'a drop that cannot be found says so')
        st, r = call(base, '/api/image/locate', {'name': 'clip.mp4', 'size': 5, 'mtime_ms': 1})
        check(st == 400 and 'not a picture file' in r['error'], 'MUST-FAIL: a video dropped on the picture box is refused in words')

        print('\nthe local log and the network')
        logtxt = (tmp / 'films-on' / dm.ACTIVITY_NAME).read_text(encoding='utf-8')
        evs = [json.loads(x) for x in logtxt.splitlines()]
        names = [e['ev'] for e in evs]
        check(all(n in names for n in ('image_added', 'image_refused', 'image_rights', 'rule_saved', 'occurrences_listed', 'image_removed')), f'the new buttons are logged ({sorted(set(names) - {"session_start"})})')
        leak = [w for w in ('a.png', 'b.jpg', 'renamed-text', 'My Private', 'great news', 'never said', str(tmp)) if w.lower() in logtxt.lower()]
        check(not leak, f'MUST-FAIL: the log holds counts only: no picture name, no folder, no phrase ({leak})')
        a = dm.ActivityLog(tmp / 'unit', True)
        a.log('image_added', count='C:\\Users\\Sam\\holiday.png')
        a.log('rule_saved', count='secret words')
        vals = [json.loads(x).get('count') for x in (tmp / 'unit' / dm.ACTIVITY_NAME).read_text(encoding='utf-8').splitlines()]
        check(vals == ['?', '?'], f'hostile values in the new events are written as "?" ({vals})')
        attempts = []
        real = socket.socket.connect

        def spy(self, address, *a, **k):
            attempts.append(address[0] if isinstance(address, tuple) else str(address))
            if attempts[-1] not in ('127.0.0.1', 'localhost', '::1'):
                raise OSError('refused by the check')
            return real(self, address, *a, **k)
        socket.socket.connect = spy
        try:
            call(base, '/api/image/pick', {})
            call(base, '/api/overlays', {'rules': []})
        finally:
            socket.socket.connect = real
        check(attempts and all(h in ('127.0.0.1', 'localhost', '::1') for h in attempts), 'with every non-loopback connection refused the new addresses make no outside attempt')
        srv.shutdown()
        srv.server_close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('\nFAILED: ' + '; '.join(FAILED) if FAILED else '\nall passed')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())
