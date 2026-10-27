# The listening-model download (NEXT-CONNECT 106)

The maker app fetches a listening model only through `tools/model_download.py`, from a button on the page: **Download the listening model**. Balanced (about 464 MB) is preselected; Fast (about 142 MB) and the quickest test (about 75 MB) are listed too. It is the only step of the app that uses the internet for a model.

## The rules (CC1, 2026-10-20 17:15) and where each is enforced

| Rule | In `model_download.py` | Tried by `tools/check-model-download.py` |
|---|---|---|
| One fixed host written into the app | `HOST = "huggingface.co"`; URL is `https://HOST/<repo>/resolve/<revision>/<file>` built from `PINS` only | the source check, the 12 address cases of `check_hop`, every request path seen by the test server |
| A redirect only to that host's own content domains | `REDIRECT_DOMAINS = ("huggingface.co", "hf.co")`, https, port 443, no user name, 5 hops | wrong host, user name, port, scheme, look-alike suffixes (`evilhuggingface.co`, `huggingface.co.evil.com`) refused |
| Each file's size and SHA-256 pinned | `PINS` (tiny, base, small): four files each | wrong hash, short, long, no length, wrong length: each refused, nothing kept |
| Size shown before it starts, progress bar, Cancel | the page note and `progress` / `cancel` | the app-level steps in `tools/check-maker-models.py` and a real browser pass |
| Mismatch is deleted and refused | files are staged in `.downloading-<size>` and moved in only after all four pass | three good files and a bad fourth keep nothing |
| Nothing downloaded is run | data files only; no import, unpack or exec in the module | the source check (no `exec`, `eval`, `subprocess`, `zipfile`, `tarfile`, `importlib`, `pickle`, `ctypes`) |
| Never follows a URL a page, recipe or reply gives it | the repo, revision and file names come from `PINS`; the app passes no host or address in | the app calls `md.download(model, root, progress=, cancel=)` and nothing else |

No proxy variable is read and no cookie or login is sent (a fixed `User-Agent` and `Accept-Encoding: identity`).

## The pins and what they rest on

Sizes and SHA-256 of `Systran/faster-whisper-{tiny,base,small}` at the revisions in the file (tiny `d90ca5fe`, base `ebe41f70`, small `536b0662`). How they were made, on 2026-10-20: the host's published file list and LFS hashes for `model.bin`; the three small files of each model (`config.json`, `tokenizer.json`, `vocabulary.txt`, 2.7 MB each model) were read once and hashed, and each matched the host's git blob id.

* **Tiny: all four files equal the copy the engine downloaded earlier on this PC**, byte for byte, and the real engine library loads it from the folder this code writes (`tools/check-model-download.py`).
* **Base and small `model.bin`: the host's published hash, not yet confirmed by a download of the body.** All twelve real URLs were opened through the real opener (not read): each answered 200, announced exactly the pinned size, and redirected only to `us.aws.cdn.hf.co` (on the list). The first real download of Balanced (needs Ryan's yes) is what confirms the 464 MB hash.

To refresh a pin (a new model revision): read the host's file list for the new commit, hash the small files, edit `PINS`, run the check. A pin is never taken from the same download it protects.

## What it does not do

No resume (a stopped download starts again), no proxy support, no download of anything but the four model files, no check that a finished folder still hashes (it checks sizes when asked to download again; the bundle's start-time check covers the app files, not the model).
