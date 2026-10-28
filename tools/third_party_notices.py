"""THIRD-PARTY NOTICES for the portable app (NEXT-CONNECT 133; CC1 2026-10-26 20:01). Standard library only. Used by tools/make_app_bundle.py; writes docs/THIRD-PARTY-NOTICES.txt INSIDE the zip.

WHAT IT LISTS: every library copied into the app's own Python (name, version, the licence the package declares, and the full text of each licence file the package itself ships), Python's own licence text,
and FFmpeg: its exact version line, the build's own README (which names the exact upstream source commit), and the full licence file that comes with the build. A library that ships NO licence text is
listed as such with its declared licence and its home page, never with a made-up text.
WHAT IT DOES NOT DO: it writes no legal wording of its own about Ryagram (the personal-use notice is the lawyer's), it decides nothing about whether the notices are enough (that is the attorney's question,
LEGAL-QUESTIONS-FOR-ATTORNEY.md), and it fetches nothing from the internet.
PUBLIC BUILDS (make_app_bundle.py --public): the build is REFUSED unless FFmpeg's licence text and README are present, a contact for the source offer is given, and every library carries a licence text."""
from __future__ import annotations

import re
from pathlib import Path

LICENCE_FILE = re.compile(r"^(LICEN[SC]E|COPYING|NOTICE|COPYRIGHT)", re.IGNORECASE)
SOURCES_SENTENCE = "Each library is listed above with its exact version; its source code is available from that project's official website."
MAX_TEXT = 300_000                    # one licence file; a larger file is cut (and the cut is said)


def _read(p: Path) -> str:
    t = p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
    return t if len(t) <= MAX_TEXT else t[:MAX_TEXT] + "\n[... cut by the notices tool: the full file is in the package's own folder ...]\n"


def _field(meta: str, key: str) -> str:
    m = re.search(rf"^{key}: (.+)$", meta, re.M)
    return m.group(1).strip() if m else ""


def _key(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def libraries(site_packages: Path, supplements: Path | None = None) -> list:
    """One row per *.dist-info folder: {name, version, licence (as declared), home, texts: [(file name, text)], supplied: bool}. A package that ships no licence text gets the one in `supplements`
    (a file <name>.txt, the project's own licence text, put there by a person; its first line says where it came from) if there is one; nothing is ever invented."""
    rows = []
    for d in sorted(Path(site_packages).glob("*.dist-info"), key=lambda p: p.name.lower()):
        meta_file = d / "METADATA"
        meta = meta_file.read_text(encoding="utf-8", errors="replace") if meta_file.is_file() else ""
        lic = _field(meta, "License-Expression") or _field(meta, "License")
        if not lic or len(lic) > 80:
            cls = re.findall(r"^Classifier: License :: (.+)$", meta, re.M)
            lic = cls[0].replace("OSI Approved :: ", "") if cls else (lic[:80] if lic else "not declared")
        home = _field(meta, "Home-page") or (re.search(r"^Project-URL: (?:Homepage|Source|Repository)[^,]*, (\S+)", meta, re.M | re.I) or [None, ""])[1]
        texts = [(p.name, _read(p)) for p in sorted(d.rglob("*")) if p.is_file() and LICENCE_FILE.match(p.name) and p.suffix.lower() in ("", ".txt", ".md", ".rst")]
        name = _field(meta, "Name") or d.name
        supplied = False
        if not texts and supplements is not None and (Path(supplements) / (_key(name) + ".txt")).is_file():
            texts, supplied = [((_key(name) + ".txt (the project's own licence text, added by the Ryagram build)"), _read(Path(supplements) / (_key(name) + ".txt")))], True
        rows.append({"name": name, "version": _field(meta, "Version"), "licence": lic, "home": home, "texts": texts, "supplied": supplied})
    return rows


def ffmpeg_facts(version_text: str) -> dict:
    """What the build says about itself ('ffmpeg -version'): the version line and whether it was configured GPL or version3."""
    first = (version_text or "").strip().splitlines()[0] if (version_text or "").strip() else ""
    cfg = re.search(r"^configuration: (.+)$", version_text or "", re.M)
    flags = cfg.group(1) if cfg else ""
    return {"version_line": first, "gpl": "--enable-gpl" in flags, "version3": "--enable-version3" in flags, "nonfree": "--enable-nonfree" in flags}


def model_rows(models_dir: Path | None, shipped: list) -> list:
    """The bundled MODEL FILES (not libraries): for each model name in `shipped`, the row from <models_dir>/MANIFEST.json with its licence text read from the file the manifest names. A model with no manifest
    row, a missing licence file, or a licence file whose SHA-256 is not the one recorded is returned with text '' (a public build is then refused). Nothing is fetched here."""
    import hashlib
    import json
    rows = []
    man = {}
    if models_dir is not None and (Path(models_dir) / "MANIFEST.json").is_file():
        try:
            man = {m["model"]: m for m in json.loads((Path(models_dir) / "MANIFEST.json").read_text(encoding="utf-8"))}
        except (ValueError, KeyError, TypeError):
            man = {}
    for name in shipped:
        m = man.get(name)
        if not m:
            rows.append({"model": name, "name": name, "text": "", "problem": "no licence record"})
            continue
        f = Path(models_dir) / m.get("licence_file", "")
        text = ""
        if f.is_file():
            body = f.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n").partition("\n")[2]
            if hashlib.sha256(body.encode("utf-8")).hexdigest() == m.get("licence_file_sha256"):
                text = body
        rows.append(dict(m, text=text, problem="" if text else "its licence text is missing or is not the recorded one"))
    return rows


def public_problems(libs: list, ffmpeg: dict | None, ffmpeg_licence: str, ffmpeg_readme: str, contact: str, models: list | None = None) -> list:
    """What would stop a PUBLIC build (each is a sentence for the person who runs the build)."""
    out = []
    if ffmpeg:
        if ffmpeg["nonfree"]:
            out.append("This ffmpeg is configured --enable-nonfree: it cannot be redistributed at all. Use another build.")
        if not ffmpeg_licence.strip():
            out.append("ffmpeg's licence text is missing (the LICENSE file next to the build's bin folder). A public download must carry it.")
        if not ffmpeg_readme.strip() or "source" not in ffmpeg_readme.lower():
            out.append("ffmpeg's README (which names the exact upstream source) is missing. A public download must say where the source is.")
        if (ffmpeg["gpl"] or ffmpeg["version3"]) and not contact.strip():
            out.append("This ffmpeg is a GPL build, so the notices need a contact for a source request (--notices-contact). That wording is Ryan's and the attorney's.")
    for lib in libs:
        if not lib["texts"]:
            out.append(f"{lib['name']} {lib['version']} ships no licence text (declared: {lib['licence']}).")
    for mo in models or []:
        if not mo.get("text", "").strip():
            out.append(f"The model file {mo.get('name', mo.get('model'))} is in the folder but {mo.get('problem') or 'has no licence text'}.")
    return out


def render(libs: list, python_licence: str, ffmpeg: dict | None, ffmpeg_licence: str, ffmpeg_readme: str, contact: str, models: list | None = None) -> str:
    L = ["THIRD-PARTY NOTICES", "=" * 19, "",
         "This folder contains software written by others. Each is used under its own licence, listed below with the licence text the package itself ships.",
         "Ryagram's own files (the folders ryagram, tools, recipes) are Ryagram's; the notice about using them is the lawyer's and is not part of this list.", ""]
    if ffmpeg:
        L += ["-" * 79, "FFmpeg (ffmpeg\\ffmpeg.exe and ffmpeg\\ffprobe.exe)", "-" * 79, ffmpeg["version_line"],
              "Licence of this build: " + ("GNU General Public License version 3 (the build is configured --enable-gpl --enable-version3)" if ffmpeg["gpl"] and ffmpeg["version3"] else
                                           "GNU General Public License (configured --enable-gpl)" if ffmpeg["gpl"] else "see the licence text below"),
              "The two programs are run as separate programs by Ryagram's app; Ryagram does not link them into its own code.",
              "SOURCE: the build's own README below names the exact upstream source it was made from. A copy of that source is also available on request: "
              + (contact.strip() or "[no contact given: this is NOT a public build]"), "",
              "----- the build's README, verbatim -----", ffmpeg_readme.strip() or "(not available)", "",
              "----- the licence text that comes with the build, verbatim -----", ffmpeg_licence.strip() or "(not available)", ""]
    L += ["-" * 79, "Python (python\\)", "-" * 79, "Python is used under the Python Software Foundation licence, whose text is python\\LICENSE.txt and is repeated here:", "", python_licence.strip() or "(not available)", ""]
    for mo in models or []:
        L += ["-" * 79, f"Model file: {mo.get('name', mo.get('model'))} (models\\{mo.get('file', '')})", "-" * 79,
              f"Licence: {mo.get('licence', 'see below')}. {mo.get('copyright', '')}".strip(),
              f"Where it comes from: {mo.get('model_source', '')}",
              f"The file is pinned by its SHA-256: {mo.get('sha256', '')} ({mo.get('bytes', '')} bytes). It finds where faces are in a picture; it does not say who anyone is.",
              f"The licence text below was fetched from {mo.get('licence_source_url', '')} on {mo.get('fetched', '')}.", "",
              "----- the licence text, verbatim -----", (mo.get("text") or "").strip() or "(not available)", ""]
    L += ["-" * 79, f"Libraries in python\\Lib\\site-packages ({len(libs)})", "-" * 79]
    for lib in libs:
        L += ["", f"* {lib['name']} {lib['version']}", f"  licence declared by the package: {lib['licence']}"] + ([f"  home: {lib['home']}"] if lib["home"] else [])
        if lib["name"].lower() == "av":
            L += ["  note: this package carries its own copies of FFmpeg libraries (folder av.libs) under their own, mostly LGPL, licences; see the licence files of the package."]
        if not lib["texts"]:
            L += ["  (this package ships no licence text of its own; the licence above is what it declares)"]
        for fname, text in lib["texts"]:
            L += [f"  ----- {fname} -----", text.rstrip(), ""]
    L += [SOURCES_SENTENCE]                  # Ryan's own words (Q252 (b), 2026-10-26 21:15), verbatim, as the last line of the list
    return "\n".join(L) + "\n"
