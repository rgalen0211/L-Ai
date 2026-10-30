"""Public-domain footage for compilations, the app's side of it (NEXT-CONNECT 168, slice P1a of proposals/CONNECT-FOOTAGE-PD-DESIGN.md). OFF: nothing calls this yet.

Standard library only; no network of its own (the strict fetch in tools/maker_fetch.py does the fetching, and every network call here is a function the caller passes in). What it decides:

  * WHICH ADDRESSES: the AI never sends an address. It names a source and an item id; THIS module builds every address from a fixed template and checks the id first. A source that is not in SOURCES does not exist.
  * WHETHER AN ITEM MAY BE OFFERED: judge(source, record) reads the source's OWN record of the item and returns ok only when that record says it can be reused. It FAILS CLOSED: an item whose rights cannot be read,
    a third-party marker, a donor-restricted series, a record of another kind or id all come back refused with the reason in plain words. "Ryagram cannot confirm an item's rights; the source's label is shown as it is."
  * WHICH FILE: pick_asset() chooses one video file from the source's own list, only on the source's own file host, https only, smallest acceptable quality first.
  * WHAT TO SHOW AND KEEP: the credit line, and the receipt (host, size, SHA-256, the rights wording AS SHOWN, the date) with no file name or folder in the cloud copy.

NASA is read from its documented Image and Video Library shape. The National Archives catalogue's record shape is NOT verified here: its field paths are the one table NARA_PATHS, the status must read exactly
"Unrestricted", and when no path finds a status the item is refused, so a wrong guess can only refuse, never allow. Whoever turns this on must check both shapes against the live sources first (the design paper, section 8).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

MAX_FOOTAGE_BYTES = 2 * (1 << 30)          # one clip, at most 2 GB (the person approves the size shown, and the fetch refuses more)
MIN_FOOTAGE_BYTES = 10_000                 # smaller than this is an error page or a stub, not a film
VIDEO_EXTS = ("mp4", "m4v", "mov", "webm", "mkv")
WHY_MAX = 300

SOURCES = {
    "nasa": {
        "name": "NASA",
        "id_re": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.~-]{2,99}$"),
        "meta_host": "images-api.nasa.gov",
        "meta_url": "https://images-api.nasa.gov/search?nasa_id={id}&media_type=video",
        "asset_list_url": "https://images-api.nasa.gov/asset/{id}",
        "file_hosts": ("images-assets.nasa.gov",),
        "label": "NASA's media guidelines (nasa.gov): NASA images, audio and video generally are not subject to copyright in the United States; NASA asks to be acknowledged as the source; third-party items are labelled with their owner and NASA's permission does not cover them.",
        "credit": "Source: NASA",
    },
    "nara": {
        "name": "U.S. National Archives",
        "id_re": re.compile(r"^[0-9]{3,12}$"),
        "meta_host": "catalog.archives.gov",
        "meta_url": "https://catalog.archives.gov/api/v2/records/search?naId={id}",
        "asset_list_url": None,
        "file_hosts": ("s3.amazonaws.com",),
        "label": "The National Archives record's own Use Restriction Status. NARA does not confirm the copyright status of an item; securing any permission is the user's responsibility.",
        "credit": "Source: U.S. National Archives",
    },
}

# Third-party and donor markers: any of these in the text fields of a record means "not offered" (fail closed; a person can still download such a film themselves).
THIRD_PARTY = re.compile(
    r"copyright|©|\(c\)\s*\d{4}|all rights reserved|courtesy of|used with permission|by permission|licen[cs]ed|getty|shutterstock|associated press|\bap\b photo|reuters|"
    r"\besa\b|jaxa|roscosmos|\bcnsa\b|\bcsa\b|\bisro\b|bbc|cbs|nbc|abc news|cnn|fox news|youtube|vimeo|istock|alamy|pond5|footage\.com", re.IGNORECASE)
DONOR_SERIES = re.compile(r"march of time|paramount|universal newsreel|movietone|hearst|pathe|pathé|fox movietone|rko|warner|metro-goldwyn|columbia pictures|walt disney|donated", re.IGNORECASE)


class Refused(Exception):
    """A plain sentence for the person and for the log."""


def _text(v, limit=400) -> str:
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()[:limit]


def check_plan(plan: dict) -> dict:
    """A plan from the site: {source, item_id, why}. Returns the clean plan with the addresses built from fixed templates, or raises Refused. No address from the AI is ever used."""
    if not isinstance(plan, dict):
        raise Refused("That footage plan is not readable.")
    extra = set(plan) - {"source", "item_id", "why", "id"}
    if extra:
        raise Refused("That footage plan carries more than a source, an item and a reason, so it was not used.")
    src = SOURCES.get(str(plan.get("source")))
    if not src:
        raise Refused("That source is not one Ryagram takes footage from.")
    item_id = str(plan.get("item_id", ""))
    if not src["id_re"].fullmatch(item_id):
        raise Refused(f"That is not a {src['name']} item id.")
    why = _text(plan.get("why"), WHY_MAX)
    if re.search(r"https?://|www\.|[A-Za-z]:[\\/]|\\\\", why):
        raise Refused("The reason may not hold an address or a folder.")
    q = quote(item_id, safe="")
    out = {"source": str(plan["source"]), "item_id": item_id, "why": why, "meta_url": src["meta_url"].format(id=q)}
    out["asset_list_url"] = src["asset_list_url"].format(id=q) if src["asset_list_url"] else None
    return out


def _dig(rec, path):
    for k in path:
        if not isinstance(rec, dict) or k not in rec:
            return None
        rec = rec[k]
    return rec


def _texts(rec, keys) -> str:
    return " ".join(_text(rec.get(k)) for k in keys if isinstance(rec, dict) and rec.get(k))


def judge_nasa(record: dict, item_id: str) -> dict:
    """`record` is the one `data` object of the item in the Image and Video Library search answer. Returns {ok, label, credit, reasons, title}."""
    reasons = []
    if not isinstance(record, dict):
        return _no("NASA's record of this item could not be read.")
    if _text(record.get("nasa_id")) != item_id:
        reasons.append("NASA's record is for another item.")
    if _text(record.get("media_type")).lower() != "video":
        reasons.append("NASA lists this item as something other than a video.")
    blob = _texts(record, ("title", "description", "description_508", "secondary_creator", "photographer", "keywords", "location"))
    if isinstance(record.get("keywords"), list):
        blob += " " + " ".join(_text(k, 60) for k in record["keywords"])
    if THIRD_PARTY.search(blob):
        reasons.append("NASA's record names a copyright, a licence or another owner, so Ryagram does not offer it.")
    if not _text(record.get("title")):
        reasons.append("NASA's record has no title.")
    if reasons:
        return _no(*reasons)
    who = _texts(record, ("center", "secondary_creator", "photographer"))
    credit = SOURCES["nasa"]["credit"] + (f" ({_text(who, 120)})" if who else "") + f", {item_id}"
    return {"ok": True, "label": SOURCES["nasa"]["label"], "credit": credit, "reasons": [], "title": _text(record.get("title"), 200)}


# The National Archives catalogue record: WHERE the status and the file live. NOT VERIFIED against the live API; see the module note. First path that finds a value wins.
NARA_STATUS_PATHS = (("useRestriction", "status"), ("record", "useRestriction", "status"), ("_source", "record", "useRestriction", "status"), ("record", "useRestriction", "note"))
NARA_FILE_PATHS = (("digitalObjects",), ("record", "digitalObjects"), ("_source", "record", "digitalObjects"))
NARA_TEXT_KEYS = ("title", "scopeAndContentNote", "generalNotes", "seriesTitle", "collectionTitle", "donor", "description")


def judge_nara(record: dict, item_id: str) -> dict:
    if not isinstance(record, dict):
        return _no("The National Archives' record of this item could not be read.")
    naid = _text(record.get("naId") or _dig(record, ("record", "naId")) or _dig(record, ("_source", "record", "naId")))
    status = ""
    for path in NARA_STATUS_PATHS:
        v = _dig(record, path)
        if v:
            status = _text(v, 80)
            break
    reasons = []
    if naid != item_id:
        reasons.append("The Archives' record is for another item.")
    if not status:
        reasons.append("The record shows no Use Restriction Status, so Ryagram cannot offer it.")
    elif status.lower() != "unrestricted":
        reasons.append(f"The record's Use Restriction Status is \"{status}\", not Unrestricted.")
    inner = record.get("record") if isinstance(record.get("record"), dict) else record
    blob = _texts(inner, NARA_TEXT_KEYS)
    if THIRD_PARTY.search(blob) or DONOR_SERIES.search(blob):
        reasons.append("The record names a copyright holder, a donor or a restricted newsreel series, so Ryagram does not offer it.")
    if reasons:
        return _no(*reasons)
    return {"ok": True, "label": f"{SOURCES['nara']['label']} Status shown: {status}.", "credit": SOURCES["nara"]["credit"] + f", NAID {item_id}", "reasons": [], "title": _text(inner.get("title"), 200)}


def _no(*reasons: str) -> dict:
    return {"ok": False, "label": "", "credit": "", "reasons": list(reasons), "title": ""}


def judge(source: str, record, item_id: str) -> dict:
    if source == "nasa":
        return judge_nasa(record, item_id)
    if source == "nara":
        return judge_nara(record, item_id)
    return _no("That source is not one Ryagram takes footage from.")


_QUALITY = ("~medium.", "~small.", "~mobile.", "~large.", "~orig.")


def pick_asset(source: str, listing) -> dict:
    """Choose ONE video file from the source's own list of files. Returns {ok, url, host, reason}. https only (NASA's list gives http; it is upgraded on its own file host only), the host must be the
    source's file host, the extension a video one; medium quality first (the original can be many gigabytes)."""
    src = SOURCES.get(source)
    if not src:
        return {"ok": False, "url": "", "host": "", "reason": "That source is not one Ryagram takes footage from."}
    hrefs = []
    if source == "nasa":
        items = _dig(listing, ("collection", "items")) or []
        hrefs = [i.get("href") for i in items if isinstance(i, dict) and isinstance(i.get("href"), str)]
    elif source == "nara":
        for path in NARA_FILE_PATHS:
            objs = _dig(listing, path)
            if isinstance(objs, list):
                hrefs = [o.get("objectUrl") for o in objs if isinstance(o, dict) and isinstance(o.get("objectUrl"), str)]
                if hrefs:
                    break
    good = []
    for h in hrefs:
        u = urlsplit(h)
        host = (u.hostname or "").lower()
        ext = u.path.rsplit(".", 1)[-1].lower() if "." in u.path else ""
        if host not in src["file_hosts"] or ext not in VIDEO_EXTS or u.scheme not in ("http", "https") or u.username or u.password or u.query or u.fragment:
            continue
        good.append((f"https://{host}{u.path}", host))
    if not good:
        return {"ok": False, "url": "", "host": "", "reason": "The source lists no video file on its own file host that Ryagram will fetch."}

    def rank(item):
        low = item[0].lower()
        for i, q in enumerate(_QUALITY):
            if q in low:
                return i
        return len(_QUALITY)
    url, host = sorted(good, key=rank)[0]
    return {"ok": True, "url": url, "host": host, "reason": ""}


def check_video_head(head: bytes, size: int | None) -> str | None:
    """A reason the fetched bytes are not a usable video, or None. The name and the site's claim are never trusted; the first bytes are."""
    if size is not None and size > MAX_FOOTAGE_BYTES:
        return f"The file is {size / (1 << 30):.2f} GB, more than the {MAX_FOOTAGE_BYTES / (1 << 30):.0f} GB Ryagram keeps for one clip."
    if size is not None and size < MIN_FOOTAGE_BYTES:
        return "The file is too small to be a film."
    if len(head) >= 8 and head[4:8] == b"ftyp" and head[:1] == b"\x00":
        return None
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return None
    return "That is not a video file."


def receipt(plan: dict, rights: dict, got: dict, *, now=None, folder_label: str = "") -> dict:
    """The receipt kept BESIDE the film on the person's computer: everything needed to defend the use later. The cloud copy is cloud_receipt()."""
    when = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    return {"source": plan["source"], "item_id": plan["item_id"], "title": rights.get("title", ""), "rights_label_as_shown": rights.get("label", ""), "credit_line": rights.get("credit", ""),
            "retrieved": when, "host": got.get("host", ""), "bytes": int(got.get("bytes", 0)), "sha256": got.get("sha256", ""), "name": got.get("name", ""), "folder": folder_label,
            "note": "Ryagram cannot confirm this item's rights; the source's label is shown as it is."}


def cloud_receipt(local: dict) -> dict:
    """What may go back to the site: no file name, no folder, no title."""
    return {k: local[k] for k in ("source", "item_id", "rights_label_as_shown", "retrieved", "host", "bytes", "sha256")}
