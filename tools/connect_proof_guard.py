"""The one rule every CONNECT proof tool applies before it touches a project: ONLY the proof project, by an ALLOW-list.

A deny-list of the live ref lets a third project (a future staging, a typo in .env) through. This lets exactly one project through: the
proof project's ref must be the whole host of the API URL, and must be the project named in the database URL. No import side effects."""
from __future__ import annotations

import re

PROOF_REF = "awjbjersplaqhxhuvozi"
_URL = re.compile(r"^https://([a-z0-9]{20})\.supabase\.co/?$")
_DB_HOST = re.compile(r"^db\.([a-z0-9]{20})\.supabase\.co$")
_DB_USER = re.compile(r"^postgres\.([a-z0-9]{20})$")


def refusal(url: str, db: str | None = None) -> str | None:
    """None when url (and db, if given) name the proof project and nothing else; otherwise the reason, which never repeats a secret."""
    m = _URL.match((url or "").strip())
    if not m:
        return "REFUSED: the API URL is not https://<ref>.supabase.co"
    if m.group(1) != PROOF_REF:
        return "REFUSED: not the proof project"
    if db is not None:
        m2 = re.match(r"^postgres(?:ql)?://([^:@/]+)(?::[^@/]*)?@([^:/?#]+)", db.strip())
        if not m2:
            return "REFUSED: the database URL is not understood"
        refs = {x.group(1) for x in (_DB_USER.match(m2.group(1)), _DB_HOST.match(m2.group(2))) if x}
        if refs != {PROOF_REF}:
            return "REFUSED: the database URL is not the proof project"
    return None


def require_proof(url: str, db: str | None = None) -> None:
    why = refusal(url, db)
    if why:
        raise SystemExit(why)
