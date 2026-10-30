"""Public-domain footage, the app's side, slice P1a (NEXT-CONNECT 168): tools/footage_sources.py and the video kind of tools/maker_fetch.py, with MUST-FAILs. OFF: nothing in the app calls these yet.

    py -I tools/check-footage-sources.py <scratch base folder on D:>

Nothing touches the network: the records are stand-ins in the documented shape of NASA's Image and Video Library and in the (unverified) shape of the National Archives record, and the fetch runs on a stand-in
transport. What it proves: the AI cannot name an address; an item is offered only when the source's own record says it can be reused and ANY doubt refuses; one file is chosen only on the source's own file host;
only a real video is kept, and only by a fetch that asked for a video."""
import io
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import footage_sources as FS            # noqa: E402
import maker_fetch as MF                # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="footage-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        FAILED.append(what)


def refused(fn):
    try:
        fn()
    except (FS.Refused, MF.FetchError) as e:
        return str(e)
    return None


print("A. a plan from the site: a source and an item, never an address")
p = FS.check_plan({"source": "nasa", "item_id": "NHQ_2019_0716_Apollo50th", "why": "the launch for the intro"})
check(p["meta_url"] == "https://images-api.nasa.gov/search?nasa_id=NHQ_2019_0716_Apollo50th&media_type=video" and p["asset_list_url"] == "https://images-api.nasa.gov/asset/NHQ_2019_0716_Apollo50th", "NASA: both addresses are built from fixed templates on NASA's own host")
n = FS.check_plan({"source": "nara", "item_id": "12345678", "why": "a 1940s bridge"})
check(n["meta_url"].startswith("https://catalog.archives.gov/") and n["asset_list_url"] is None, "National Archives: the address is built from the template")
for label, plan in (("an unknown source", {"source": "youtube", "item_id": "abcdefghijk", "why": "x"}),
                    ("an address as the id", {"source": "nasa", "item_id": "https://evil.example/a.mp4", "why": "x"}),
                    ("a path as the id", {"source": "nasa", "item_id": "../../etc/passwd", "why": "x"}),
                    ("an id with a query", {"source": "nasa", "item_id": "abc?x=1", "why": "x"}),
                    ("a too-short id", {"source": "nasa", "item_id": "ab", "why": "x"}),
                    ("a letter id for the Archives (they are numbers)", {"source": "nara", "item_id": "abc123", "why": "x"}),
                    ("an extra field (a url)", {"source": "nasa", "item_id": "NHQ_2019_0716", "why": "x", "url": "https://evil.example/a.mp4"}),
                    ("an address in the reason", {"source": "nasa", "item_id": "NHQ_2019_0716", "why": "see https://evil.example/a.mp4"}),
                    ("a folder in the reason", {"source": "nasa", "item_id": "NHQ_2019_0716", "why": "put it in C:/Users/x"}),
                    ("not a plan", ["nasa"])):
    why = refused(lambda: FS.check_plan(plan))
    check(why is not None, f"MUST-FAIL: {label} is refused: {why}")
check(FS.check_plan({"source": "nasa", "item_id": "NHQ_2019_0716", "why": "x" * 1000})["why"] == "x" * FS.WHY_MAX, "a long reason is cut to 300 characters")

print("B. NASA: an item is offered only when its own record says a video, the right id, and no other owner")
good = {"nasa_id": "NHQ_2019_0716", "media_type": "video", "title": "Apollo 11 launch", "center": "HQ", "description": "The Saturn V lifts off from Kennedy Space Center.", "keywords": ["Apollo", "launch"]}
r = FS.judge_nasa(good, "NHQ_2019_0716")
check(r["ok"] and "NASA" in r["credit"] and "NHQ_2019_0716" in r["credit"] and "not subject to copyright" in r["label"] and r["title"] == "Apollo 11 launch", "a plain NASA video is offered, with NASA's own wording and a credit line")
for label, mod in (("an image", {"media_type": "image"}), ("audio", {"media_type": "audio"}), ("a missing media type", {"media_type": None}), ("another item's record", {"nasa_id": "OTHER_ITEM"}),
                   ("no title", {"title": ""}),
                   ("a copyright line", {"description": "Copyright 2015 Example Films"}), ("the copyright sign", {"description": "\u00a9 2015 Example"}), ("courtesy of", {"description": "Courtesy of an airline"}),
                   ("a news organisation", {"secondary_creator": "Associated Press"}), ("another space agency", {"description": "Footage from ESA"}), ("a stock site", {"keywords": ["shutterstock"]}),
                   ("a licence", {"description": "Licensed from a studio"}), ("permission", {"description": "Used with permission of the family"})):
    rec = dict(good, **mod)
    if "media_type" in mod and mod["media_type"] is None:
        rec.pop("media_type")
    jr = FS.judge_nasa(rec, "NHQ_2019_0716")
    check(not jr["ok"] and jr["reasons"], f"MUST-FAIL: {label} is refused: {jr['reasons'][:1]}")
check(not FS.judge_nasa("nope", "x")["ok"] and not FS.judge_nasa(None, "x")["ok"], "MUST-FAIL: a record that cannot be read is refused")
check(not FS.judge("youtube", good, "NHQ_2019_0716")["ok"], "MUST-FAIL: a source that is not on the list is refused")

print("C. the National Archives: only a record whose OWN status reads Unrestricted (shape not verified: a wrong shape can only refuse)")
rec = {"naId": "12345678", "title": "Bridge construction, 1941", "scopeAndContentNote": "Film of a bridge under construction.", "useRestriction": {"status": "Unrestricted"}}
r = FS.judge_nara(rec, "12345678")
check(r["ok"] and "Unrestricted" in r["label"] and "NAID 12345678" in r["credit"], "an Unrestricted record is offered, with the Archives' own disclaimer and a credit line")
for path in (("record", "useRestriction", "status"), ("_source", "record", "useRestriction", "status")):
    nested = {"naId": "12345678"}
    cur = nested
    for k in path[:-1]:
        cur[k] = {}
        cur = cur[k]
    cur[path[-1]] = "Unrestricted"
    nested.setdefault("record", {}).setdefault("title", "x") if path[0] == "record" else None
    check(FS.judge_nara(nested, "12345678")["ok"], f"the status is found at {'/'.join(path)}")
for label, rec2 in (("Restricted - Fully", dict(rec, useRestriction={"status": "Restricted - Fully"})), ("Restricted - Possibly", dict(rec, useRestriction={"status": "Restricted - Possibly"})),
                    ("Undetermined", dict(rec, useRestriction={"status": "Undetermined"})), ("no status at all", {k: v for k, v in rec.items() if k != "useRestriction"}),
                    ("an empty status", dict(rec, useRestriction={"status": ""})), ("another item", dict(rec, naId="999999")),
                    ("a donor newsreel series", dict(rec, seriesTitle="March of Time newsreels")), ("a studio", dict(rec, title="Paramount News, 1941")),
                    ("a copyright holder", dict(rec, scopeAndContentNote="Copyright held by the donor"))):
    jr = FS.judge_nara(rec2, "12345678")
    check(not jr["ok"] and jr["reasons"], f"MUST-FAIL: {label} is refused: {jr['reasons'][:1]}")
check(FS.judge_nara(dict(rec, useRestriction={"status": "UNRESTRICTED"}), "12345678")["ok"], "the status word is read without regard to capitals")

print("D. choosing one file, only on the source's own file host")
listing = {"collection": {"items": [{"href": "http://images-assets.nasa.gov/video/X/X~orig.mp4"}, {"href": "http://images-assets.nasa.gov/video/X/X~medium.mp4"}, {"href": "http://images-assets.nasa.gov/video/X/X~small.mp4"},
                                     {"href": "http://images-assets.nasa.gov/video/X/X~mobile.mp4"}, {"href": "http://images-assets.nasa.gov/video/X/X.srt"}, {"href": "http://images-assets.nasa.gov/video/X/metadata.json"}]}}
a = FS.pick_asset("nasa", listing)
check(a["ok"] and a["url"] == "https://images-assets.nasa.gov/video/X/X~medium.mp4" and a["host"] == "images-assets.nasa.gov", "the medium-quality video is chosen, upgraded to https on NASA's own file host, not the original and not a caption file")
only_orig = {"collection": {"items": [{"href": "https://images-assets.nasa.gov/video/X/X~orig.mp4"}]}}
check(FS.pick_asset("nasa", only_orig)["url"].endswith("~orig.mp4"), "when only the original exists it is chosen (the size cap and the person's approval still apply)")
for label, lst in (("a foreign host", {"collection": {"items": [{"href": "https://evil.example/X~medium.mp4"}]}}),
                   ("a look-alike host", {"collection": {"items": [{"href": "https://images-assets.nasa.gov.evil.example/X~medium.mp4"}]}}),
                   ("an address with a user name", {"collection": {"items": [{"href": "https://user@images-assets.nasa.gov/X~medium.mp4"}]}}),
                   ("an address with a query", {"collection": {"items": [{"href": "https://images-assets.nasa.gov/X~medium.mp4?redirect=evil"}]}}),
                   ("a program", {"collection": {"items": [{"href": "https://images-assets.nasa.gov/X.exe"}]}}),
                   ("an ftp address", {"collection": {"items": [{"href": "ftp://images-assets.nasa.gov/X~medium.mp4"}]}}),
                   ("no list", {}), ("a list that is not a list", {"collection": {"items": "x"}})):
    pr = FS.pick_asset("nasa", lst)
    check(not pr["ok"] and pr["reason"], f"MUST-FAIL: {label}: nothing is chosen")
check(not FS.pick_asset("nope", listing)["ok"], "MUST-FAIL: an unknown source chooses nothing")
nl = {"digitalObjects": [{"objectUrl": "https://s3.amazonaws.com/NARAprodstorage/lz/x/film.mp4"}, {"objectUrl": "https://evil.example/film.mp4"}]}
check(FS.pick_asset("nara", nl)["url"] == "https://s3.amazonaws.com/NARAprodstorage/lz/x/film.mp4", "National Archives: only the object on the Archives' own file host")

print("E. is it a video: the first bytes decide")
mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 40
webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 40
check(FS.check_video_head(mp4, 50_000) is None and FS.check_video_head(webm, 50_000) is None, "an mp4 and a webm are videos")
for label, head, size in (("a web page", b"<!doctype html><html>", 50_000), ("a program", b"MZ\x90\x00" + b"\x00" * 40, 50_000), ("text with ftyp inside", b"abcdftypefgh", 50_000),
                          ("a too-large file", mp4, FS.MAX_FOOTAGE_BYTES + 1), ("a stub", mp4, 100), ("empty", b"", 50_000)):
    check(FS.check_video_head(head, size) is not None, f"MUST-FAIL: {label} is not a video")

print("F. what is kept and what goes back to the site")
plan = FS.check_plan({"source": "nasa", "item_id": "NHQ_2019_0716", "why": "x"})
rights = FS.judge_nasa(good, "NHQ_2019_0716")
local = FS.receipt(plan, rights, {"host": "images-assets.nasa.gov", "bytes": 123456, "sha256": "ab" * 32, "name": "X~medium.mp4"}, now=datetime(2026, 10, 30, tzinfo=timezone.utc), folder_label="Footage")
check(local["retrieved"] == "2026-10-30" and local["rights_label_as_shown"] == rights["label"] and local["credit_line"] == rights["credit"] and "cannot confirm this item's rights" in local["note"], "the local receipt keeps the rights wording as shown, the credit line and the date")
cloud = FS.cloud_receipt(local)
check(set(cloud) == {"source", "item_id", "rights_label_as_shown", "retrieved", "host", "bytes", "sha256"} and "name" not in cloud and "folder" not in cloud and "title" not in cloud, "the cloud copy has no file name, no folder and no title")

print("G. the strict fetch keeps a video only when asked for one")


class Body:
    def __init__(self, data):
        self.b = io.BytesIO(data)

    def read(self, n):
        return self.b.read(n)

    def close(self):
        pass


class Net:
    def __init__(self):
        self.sites, self.seen = {}, []

    def resolver(self, host):
        return ["93.184.216.34"]

    def transport(self, host, ip, path, method, headers):
        self.seen.append((host, path, method))
        st, h, data = self.sites.get((host, path), (404, {}, b""))
        h = {k.lower(): v for k, v in h.items()}
        if method == "HEAD":
            return st, dict(h, **({"content-length": str(len(data))} if st == 200 else {})), None
        return st, dict(h, **({"content-length": str(len(data))} if st == 200 and "location" not in h else {})), Body(data)


net = Net()
F = MF.Fetcher(resolver=net.resolver, transport=net.transport)
video = b"\x00\x00\x00\x18ftypmp42" + b"v" * 30_000
net.sites[("images-assets.nasa.gov", "/video/X/X~medium.mp4")] = (200, {"content-type": "video/mp4"}, video)
net.sites[("images-assets.nasa.gov", "/video/X/fake.mp4")] = (200, {"content-type": "video/mp4"}, b"a,b,c" + b"\n1,2,3" * 5000)
net.sites[("images-assets.nasa.gov", "/video/X/page.mp4")] = (200, {"content-type": "video/mp4"}, b"<!doctype html><html>nope</html>" * 2000)
net.sites[("images-assets.nasa.gov", "/video/X/moved.mp4")] = (302, {"location": "https://evil.example/x.mp4"}, b"")
net.sites[("images-assets.nasa.gov", "/data/a.csv")] = (200, {"content-type": "text/csv"}, b"a,b\n1,2\n" * 2000)
d = BASE / "g1"
got = F.download("https://images-assets.nasa.gov/video/X/X~medium.mp4", d, max_bytes=1 << 20, allow_video=True)
check(got["kind"] == "video" and got["name"].endswith(".mp4") and got["bytes"] == len(video) and len(got["sha256"]) == 64 and Path(got["path"]).read_bytes() == video, "a real video is kept with its own SHA-256 when the fetch asked for a video")
why = refused(lambda: F.download("https://images-assets.nasa.gov/video/X/X~medium.mp4", BASE / "g2", max_bytes=1 << 20))
check(why is not None and "video, not a data file" in why and not list((BASE / "g2").glob("*.mp4")), "MUST-FAIL: a data download never keeps a video")
why = refused(lambda: F.download("https://images-assets.nasa.gov/video/X/fake.mp4", BASE / "g3", max_bytes=1 << 20, allow_video=True))
check(why is not None and "not a video file" in why and not [p for p in (BASE / "g3").glob("*") if p.is_file()], "MUST-FAIL: a file called .mp4 that is really text is not kept as footage")
why = refused(lambda: F.download("https://images-assets.nasa.gov/video/X/page.mp4", BASE / "g4", max_bytes=1 << 20, allow_video=True))
check(why is not None and not [p for p in (BASE / "g4").glob("*") if p.is_file()], f"MUST-FAIL: a web page called .mp4 is not kept: {why}")
why = refused(lambda: F.download("https://images-assets.nasa.gov/video/X/moved.mp4", BASE / "g5", max_bytes=1 << 20, allow_video=True, allow_hosts=("images-assets.nasa.gov",)))
check(why is not None and "another website" in why and not any(h == "evil.example" for h, _p, _m in net.seen), "MUST-FAIL: a redirect off the approved host is refused and the other host is never contacted")
why = refused(lambda: F.download("https://images-assets.nasa.gov/video/X/X~medium.mp4", BASE / "g6", max_bytes=1000, allow_video=True))
check(why is not None and "more than" in why and not [p for p in (BASE / "g6").glob("*") if p.is_file()], "MUST-FAIL: a clip bigger than the size the person approved is refused and nothing is kept")
okc = F.download("https://images-assets.nasa.gov/data/a.csv", BASE / "g7", max_bytes=1 << 20)
check(okc["kind"] == "text" and okc["name"].endswith(".csv"), "a data download is exactly as before")
check(MF.sniff(b"abcdftypefgh") == "text" and MF.sniff(b"\x00\x00\x00\x18ftypmp42") == "video" and MF.sniff(b"\x1a\x45\xdf\xa3\x00") == "video", "sniff: a video is a video, text that merely contains ftyp is still text")
check(MF.safe_name("films/launch.MOV", "video") == "launch.mov" and MF.safe_name("films/launch.bin", "video") == "launch.mp4" and MF.safe_name("a/b.exe", "video") == "b.mp4", "a video keeps a video extension, whatever the address called it")

print()
if FAILED:
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all passed")
