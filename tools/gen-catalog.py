"""Generate assets/app-catalog-data.js: the app's dataset catalog, from the ENGINE's own registry.

    python tools/gen-catalog.py --engine <engine checkout> --setup <WORKER-SETUP.ps1> \n        --allowlist supabase/functions/_shared/worker_allowlist.txt

The catalog is generated, never typed (two hand-kept lists drift): every dataset the engine
registers (ryagram.maprace.datasets.listing()), minus fixtures, private data and shapes the app
can't build yet, each marked with the worker's state:

  usable  on the INSTALLED worker's allowlist: the COMMITTED export supabase/functions/_shared/worker_allowlist.txt
          (--allowlist), never a machine-local read
          AND passing the MOTION GATE (--motion, REQUIRED): WORKER's committed motion record says pass or na, or Ryan named
          a skip dataset, or it is in the baseline (usable on main before the gate). No line = next, skip = next, fail = later
          (Ryan 2026-10-17: a default film that does not pass the strict motion check after pacing is not usable).
  next    measured by WORKER and arriving with the next worker update ($UpdateCandidates)
  later   registered by the engine, not measured for the worker's cache yet

It also writes supabase/catalog_sources_seed.sql: the same datasets as the database's internal
`catalog_sources` table (publisher, coverage, short licence, full licence, runnable), which the
sources screen reads server side so a card's facts never come from the browser. Idempotent: rerun
the seed whenever this generator is rerun.

SERVER-ONLY DETAIL (optional: `--detail-out supabase/functions/_shared/catalog_data.ts`). The same
datasets with what the guided builder's back end needs and the browser never gets: every measure with its
unit and role, the geography, known gaps, methodology breaks, the engine's notes, the full licence, the
pinned style for datasets that need one, and the worker's story schema vendored from
<engine>/ryagram/worker/story.schema.json (its source path and sha256 are in the file header, so drift is
visible). It is built from the SAME filtered rows as the two outputs above, so it cannot list a dataset they
do not. Without the flag this script behaves as before, except that every dataset declared by the engine's
ingested loader is excluded by rule (a person's own ingested files and sources are never in a catalog, listable or
not). With --detail-out the engine is read from its COMMITTED tree (a git archive of HEAD), never the working tree, so
the same commit gives the same file on any machine and an untracked or ingested file cannot reach a catalog. The
detail file is never written under
assets/: it is for server-side callers. (RULINGS 2026-10-17 now lets the guided builder LIST datasets to
signed-in, invited users with source and licence shown; that listing is WEB's front end and uses the public
catalog, not this file.)

Run it with the engine's own Python (it imports the engine). The output records the engine commit
and the setup file's allowlist, and tests/app-catalog.test.cjs checks the data against both the
credits ledger and (when present) WORKER-SETUP.ps1.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_VIEWS = ('map', 'bars', 'line', 'paired', 'panel')       # the worker's story schema v1 render views
EXCLUDE = re.compile(r'(^example_corp_|_fixture(_|$)|^ryan_)')
PUBLIC_SHAPES = ('areas',)                                   # flows, lines and networks aren't buildable in the app yet
#: Datasets whose frame needs a style the engine would not choose itself. MUST equal the `style` of the same
#: dataset in supabase/functions/_shared/templates.ts DATASETS (tests/film-compile.test.mjs checks).
STYLE_PINS = {'bps_county_permits': {'choropleth': {'mode': 'solid', 'continuous': True}}}
#: The film types the guided builder offers: the app's tested templates that need no per-story measurement. `paired` is NOT here:
#: a paired story must carry keyframes_per_year measured for that story (Ryan, 2026-09-28), which takes minutes of rendering.
FILM_TYPES = ('map', 'bars', 'line')
LEVELS = {'us_states': 'U.S. states', 'us_counties': 'U.S. counties', 'tx_counties': 'Texas counties'}


def group_of(d):
    i = d['id']
    if i.startswith('cbp_') or i.startswith('bls_'):
        return 'work'
    if i.startswith('bps_'):
        return 'housing'
    if i.startswith('county_population'):
        return 'population'
    if i in ('cdc_state_obesity', 'state_obesity_fastfood'):
        return 'health'
    if i in ('fhwa_hm212', 'brooks_liscow_interstate'):
        return 'roads'
    if i.startswith('fdic_'):
        return 'banking'
    if i.startswith('tx_county_income'):
        return 'income'
    if i == 'redistricting_2026':
        return 'politics'
    return 'other'


def family_of(d):
    i = d['id']
    m = re.match(r'^cbp_(.+)_(employment|establishments|share_state|share)$', i)
    if m and i != 'cbp_county_establishments':
        return {'employment': 'cbp-employment', 'establishments': 'cbp-establishments',
                'share_state': 'cbp-share-state', 'share': 'cbp-share-county'}[m.group(2)]
    if i.startswith('county_population'):
        return 'county-population'
    if re.match(r'^bps_county_unit_share_', i):
        return 'bps-unit-share'
    return None


def clean_title(d):
    t = d['label']
    t = re.sub(r'^County Business Patterns:\s*', '', t)
    m = re.search(r'\s*\(([^)]*)\)\s*$', t)
    if m:
        inner = [p.strip() for p in m.group(1).split(';')]
        keep = [p for p in inner if p and not re.match(r'^(Census|BLS|CDC|FDIC|annual|monthly|daily)\b', p, re.I)
                and not re.match(r'^[A-Z][A-Za-z .&+-]*,\s*(annual|monthly|daily)$', p)]
        t = t[:m.start()] + (' (' + '; '.join(keep) + ')' if keep else '')
    return t.strip()


def period_text(d):
    a, b = d.get('available_from'), d.get('available_to')
    if a and b:
        return f'{a} to {b}'
    return f'{a} onward' if a else ''


def blurb(d):
    ms = d.get('measures') or []
    banded = next((m for m in ms if m.get('role') == 'banded'), ms[0] if ms else None)
    what = (banded or {}).get('label') or clean_title(d)
    unit = (banded or {}).get('unit') or ''
    level = LEVELS.get(d.get('geography_id')) or d.get('geography') or ''
    line = what + (f' ({unit})' if unit and '(' not in unit and unit.lower() not in what.lower() else '')
    if level:
        line += f' across {level}'
    pt = period_text(d)
    return f'{line}, {pt}, {d.get("cadence") or "annual"}.' if pt else f'{line}.'


def short_licence(text):
    """The first sentence of the engine's licence text, for a card's one-line licence."""
    t = re.sub(r'\s+', ' ', (text or '').strip())
    first = re.split(r'(?<=[a-z0-9)])\.\s', t, maxsplit=1)[0].rstrip('.')
    if len(first) > 90:
        first = first[:89].rstrip() + '...'
    return first or 'See the publisher'


def coverage_text(d):
    place = d.get('geography') or LEVELS.get(d.get('geography_id')) or ''
    pt = period_text(d)
    return ', '.join(x for x in (place, pt, d.get('cadence') or '') if x)


def sql_str(v):
    return "'" + str(v if v is not None else '').replace("'", "''") + "'"


def write_seed(path, commit, rows):
    lines = [
        '-- GENERATED by tools/gen-catalog.py from the engine registry (engine %s). Do not edit by hand.' % commit,
        '-- Fills public.catalog_sources, the sources screen\'s server-side facts. Idempotent. Run after',
        '-- migrations/20261004000100_version_sources.sql, and again whenever the generator is rerun.',
        'begin;',
        'insert into public.catalog_sources (id, title, publisher, source_url, coverage, licence_short, licence_full, runnable) values']
    vals = []
    for r in rows:
        vals.append('  (%s, %s, %s, %s, %s, %s, %s, %s)' % (
            sql_str(r['id']), sql_str(r['title']), sql_str(r['publisher']), sql_str(r['url']), sql_str(r['coverage']),
            sql_str(r['licence_short']), sql_str(r['licence_full'][:2000]), 'true' if r['runnable'] else 'false'))
    lines.append(',\n'.join(vals))
    lines.append('on conflict (id) do update set title = excluded.title, publisher = excluded.publisher,')
    lines.append('  source_url = excluded.source_url, coverage = excluded.coverage, licence_short = excluded.licence_short,')
    lines.append('  licence_full = excluded.licence_full, runnable = excluded.runnable, updated_at = now();')
    lines.append('commit;')
    Path(path).write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')


def committed_tree(engine):
    """A temporary export of the engine's committed tree (HEAD), or `engine` itself when it is not a git checkout.

    Untracked and ignored files, and uncommitted edits, are not in a `git archive`, so they cannot reach the catalog.
    """
    import io
    import tarfile
    import tempfile
    probe = subprocess.run(['git', '-C', engine, 'rev-parse', '--git-dir'], capture_output=True, text=True)
    if probe.returncode != 0:
        return engine
    tar = subprocess.run(['git', '-C', engine, 'archive', '--format=tar', 'HEAD', 'ryagram'], capture_output=True)
    if tar.returncode != 0:
        sys.exit('gen-catalog: could not export the engine commit: ' + tar.stderr.decode('utf-8', 'replace')[:300])
    out = tempfile.mkdtemp(prefix='gen-catalog-engine-')
    import atexit
    import shutil
    atexit.register(shutil.rmtree, out, True)            # the export is a temporary copy: never leave it behind
    with tarfile.open(fileobj=io.BytesIO(tar.stdout)) as t:
        try:
            t.extractall(out, filter='data')            # no absolute paths, links or device files
        except TypeError:                                # Python before 3.12 has no filter argument
            t.extractall(out)
    return out


def ingested_ids():
    """The ids declared by the engine's INGESTED loader (a person's own ingested files and URL sources).

    They are never in a catalog, listable or not: a search must not be able to show that one exists. In a committed tree
    there are none (manifests are not tracked), so this is the second guard for a run over a working tree.
    """
    try:
        from ryagram.maprace.datasets import ingested
    except Exception:                                    # the loader is absent: nothing was ingested
        return set()
    return {s.id for s in getattr(ingested, 'DATASETS', [])}


def story_measure(m):
    """The worker story's `measure` setting a catalog measure maps to, or None when a story cannot choose it."""
    return {'banded': 'rate', 'counted': 'count'}.get(m.get('role') or '')


#: RULINGS 2026-10-17 (Ryan): a dataset may be LISTED to people only if it is not personal and its licence allows showing
#: derived visuals publicly; CC BY-SA, in whole or in part, is NOT listable in v1 (Ryan, 2026-10-17, with a must-fail).
#:
#: `listable` is a FIELD, DECIDED PER DATASET in supabase/functions/_shared/listing_decisions.json (who and why recorded),
#: not a regex over the registry's prose. A new dataset with no decision is an ERROR, never listed by default. Two guards
#: read the prose to CATCH a wrong decision, never to make one: a `listable: true` whose licence or notes trip a restriction
#: word (INTERNAL, BY-SA, non-commercial, no derivatives, all rights reserved, "not public", private, personal, confidential,
#: proprietary, or a licence that is private or personal) is an error, and so is a `true` whose licence names no open licence. catalog_rules.ts re-checks the same
#: two guards on the generated data (tests).
TRIPWIRE = re.compile(r'\bINTERNAL\b|BY-SA|share-?alike|\bBY-NC\b|\bBY-ND\b|non-?commercial|no ?derivatives?|all rights reserved|'
                      r'not for (public|redistribution)|\bnot\s+(a\s+)?public\b|confidential|proprietary', re.I)
#: In the LICENCE text only (prose such as "private-sector" or "personal income" is ordinary): a private or personal licence.
PRIVATE_LICENCE = re.compile(r'^\s*(private|personal|local file)\b|\b(private|personal)\s+(data|dataset|use|file)\b', re.I)
OPEN_LICENCE = re.compile(r'public domain|17 USC 105|U\.S\. Government works?|\bCC0\b|\bCC BY\b', re.I)
LISTING_CLASSES = ('us-gov-public-domain', 'open-licence', 'not-listable')


def read_listing(path):
    """The per-dataset listing decisions: {id: {'listable': bool, 'class': str, 'why': str}}."""
    raw = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    out = {}
    for i, dec in (raw.get('decisions') or {}).items():
        if not re.fullmatch(r'[a-z0-9_]{1,64}', i):
            sys.exit(f'gen-catalog: {path}: {i!r} is not a dataset id')
        if not isinstance(dec.get('listable'), bool) or dec.get('class') not in LISTING_CLASSES or not str(dec.get('why') or '').strip():
            sys.exit(f'gen-catalog: {path}: the decision for {i} needs listable (true or false), a class from {LISTING_CLASSES} and a why')
        if dec['listable'] == (dec['class'] == 'not-listable'):
            sys.exit(f'gen-catalog: {path}: the decision for {i} says listable={dec["listable"]} with class {dec["class"]}')
        out[i] = {'listable': dec['listable'], 'class': dec['class'], 'why': ' '.join(str(dec['why']).split())}
    return out


def listing_for(d, decisions):
    """(listable, class, why) for one registry dataset, from its DECISION, checked against its own prose."""
    i = d['id']
    lic = re.sub(r'\s+', ' ', d.get('license') or '').strip()
    notes = re.sub(r'\s+', ' ', d.get('notes') or '').strip()
    if EXCLUDE.search(i) or d.get('synthetic'):
        return False, 'not-listable', 'personal, fixture or synthetic data is never listed'
    dec = decisions.get(i)
    if dec is None:
        sys.exit(f'gen-catalog: no listing decision for {i}: add it to listing_decisions.json (listable true or false, with a why); '
                 f'a dataset is never listed by default')
    if dec['listable']:
        hit = TRIPWIRE.search(lic + ' ' + notes) or PRIVATE_LICENCE.search(lic)
        if hit:
            sys.exit(f'gen-catalog: {i} is decided listable but its licence or notes say {hit.group(0)!r}: fix the decision or the text')
        if not OPEN_LICENCE.search(lic):
            sys.exit(f'gen-catalog: {i} is decided listable but its licence names no open licence: {lic[:80]!r}')
    return dec['listable'], dec['class'], dec['why']


def detail_entry(d, status, window, title, short, family, views, decisions):
    ms = d.get('measures') or []
    listable, lclass, why = listing_for(d, decisions)
    return {
        'listable': listable, 'listable_class': lclass, 'listable_why': why,
        'id': d['id'], 'title': title, 'short': short, 'group': group_of(d), 'family': family, 'status': status,
        'publisher': d.get('source') or '', 'source_line': d.get('source_line') or '',
        'url': d.get('url') if str(d.get('url') or '').startswith('https://') else '',
        'licence': re.sub(r'\s+', ' ', d.get('license') or '').strip(), 'licence_short': short_licence(d.get('license')),
        'topic': d.get('topic') or '', 'notes': re.sub(r'\s+', ' ', d.get('notes') or '').strip(),
        'geography': {'id': d.get('geography_id') or '', 'label': d.get('geography') or '',
                      'level': LEVELS.get(d.get('geography_id')) or d.get('geography') or '',
                      'noun': d.get('entity_noun') or '', 'kind': d.get('entity_kind') or 'geographic'},
        'period': {'from': d.get('available_from') or '', 'to': d.get('available_to') or '',
                   'cadence': d.get('cadence') or ''},
        'window': list(window) if window else None,
        'measures': [{'id': m.get('id') or '', 'label': m.get('label') or '', 'unit': m.get('unit') or '',
                      'role': m.get('role') or '', 'story_measure': story_measure(m)} for m in ms],
        'film_types': [v for v in views if v in FILM_TYPES],
        'known_gaps': d.get('known_gaps') or {},
        'methodology_breaks': [{'period': str(b.get('period') or ''), 'what': b.get('what') or '',
                                'effect': b.get('effect') or ''} for b in (d.get('methodology_breaks') or [])],
        'missing_is_ambiguous': bool(d.get('missing_is_ambiguous')),
        'style': STYLE_PINS.get(d['id'])}


def detail_text(commit, entries, schema_path):
    """The exact text of catalog_data.ts: plain data, ASCII only, stable order. Pure, so a test can regenerate it."""
    # LINE-ENDING PROOF: the hash is of the file with CRLF turned into LF, so it is the same whether the engine tree was read
    # from an LF checkout, a CRLF checkout (core.autocrlf) or a git archive (BUILDER LOW-8).
    raw = Path(schema_path).read_bytes().replace(bytes([13, 10]), bytes([10]))
    schema = json.loads(raw.decode('utf-8'))
    sha = hashlib.sha256(raw).hexdigest()
    dump = lambda v: json.dumps(v, indent=1, ensure_ascii=True)
    return (
        "// GENERATED by tools/gen-catalog.py --detail-out, do not edit. Regenerate: see the header of that script.\n"
        "// Engine %s. Story schema vendored from ryagram/worker/story.schema.json, sha256 %s (of the LF-normalised file).\n"
        "// SERVER ONLY: never copy this under assets/. It is the internal list Ryagram's AI and the guided builder's\n"
        "// server function choose from. (RULINGS 2026-10-17 lets a front end list datasets to invited users with source\n"
        "// and licence shown; that is a separate, public-catalog change, not this file.)\n"
        "export const CATALOG_ENGINE = %s;\n"
        "export const STORY_SCHEMA_SHA256 = %s;\n\n"
        "export const CATALOG: any[] = %s;\n\n"
        "// The worker's story schema v1, so the Edge Functions can refuse a story the worker would refuse.\n"
        "// The worker's own check is still the authority.\n"
        "export const STORY_SCHEMA: any = %s;\n" % (commit, sha, json.dumps(commit), json.dumps(sha), dump(entries), dump(schema)))


def read_allowlist(path):
    """The installed worker's allowlist, from a COMMITTED export (supabase/functions/_shared/worker_allowlist.txt).

    One dataset id per line; blank lines and `#` lines are comments. If a `# count: N` header is present it must equal the
    number of ids (a hand edit or a truncated export fails here, not later). A `#views <id> <view,view>` line records a
    view restriction the worker enforces (worker.toml [datasets.views]); the catalog then offers only those views.
    """
    ids, count, views = [], None, {}
    for n, raw in enumerate(Path(path).read_text(encoding='utf-8-sig').splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            m = re.match(r'#\s*count:\s*(\d+)\s*$', line)
            if m:
                count = int(m.group(1))
            v = re.match(r'#views\s+([a-z0-9_]{1,64})\s+([a-z,]+)\s*$', line)      # a view restriction the worker enforces
            if v:
                views[v.group(1)] = [x for x in v.group(2).split(',') if x]
            continue
        if not re.fullmatch(r'[a-z0-9_]{1,64}', line):
            sys.exit(f'gen-catalog: {path}:{n}: {line!r} is not a dataset id')
        ids.append(line)
    if len(set(ids)) != len(ids):
        sys.exit(f'gen-catalog: {path} lists an id twice')
    if count is not None and count != len(ids):
        sys.exit(f'gen-catalog: {path} says count: {count} but lists {len(ids)} ids')
    for i in views:
        if i not in ids:
            sys.exit(f'gen-catalog: {path}: #views names {i}, which is not on the allowlist')
    return ids, views


MOTION_LINE = re.compile(r'^([a-z0-9_]{1,64}) motion=(pass|fail|skip|na) paced=(\S+) engine=([0-9a-f]{7,40}) measured=(\d{4}-\d{2}-\d{2})$')


def read_motion(path, allow):
    """WORKER's measured motion record, COMMITTED beside the allowlist (RULINGS 2026-10-17: a dataset whose default film still
    fails the strict motion check after pacing is not usable). At most one line per allowlisted dataset:

        <id> motion=pass|fail|skip|na paced=<years or none> engine=<commit> measured=<date>

    pass = every clip measured and passed; skip = some clip was not measured (a skip is NOT a pass); fail; na = nothing to
    measure (with a reason in WORKER's report). A MISSING line is allowed here and means NOT MEASURED: that dataset is not usable
    (see usable_by_motion). Refused here: a line that does not parse, an id twice, an id that is not on the allowlist.
    Returns {id: (motion, paced)}."""
    rec = {}
    for n, raw in enumerate(Path(path).read_text(encoding='utf-8-sig').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        m = MOTION_LINE.match(line)
        if not m:
            sys.exit(f'gen-catalog: {path}:{n}: not a motion line: {line!r}')
        i = m.group(1)
        if i in rec:
            sys.exit(f'gen-catalog: {path} has two lines for {i}')
        if i not in allow:
            sys.exit(f'gen-catalog: {path}:{n}: {i} is not on the allowlist')
        rec[i] = (m.group(2), m.group(3))
    return rec


def read_id_list(path, what):
    """One dataset id per line, `#` comments: the baseline (usable on main before the gate) or the skips Ryan named."""
    ids = []
    for n, raw in enumerate(Path(path).read_text(encoding='utf-8-sig').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if not re.fullmatch(r'[a-z0-9_]{1,64}', line):
            sys.exit(f'gen-catalog: {path}:{n}: {line!r} is not a dataset id ({what})')
        ids.append(line)
    if len(set(ids)) != len(ids):
        sys.exit(f'gen-catalog: {path} lists an id twice ({what})')
    return ids


def usable_by_motion(i, motion, baseline, skip_named):
    """(usable, status_if_not): THE MOTION GATE. Ryan's ruling (RULINGS 5b16d78): a dataset whose default film does not pass the
    strict motion check after pacing is not usable. An allowlisted dataset is usable only if
      * its motion line says pass (or na: nothing to measure), or
      * it says skip and Ryan NAMED the dataset (skip_named), or
      * it has NO line but is in the BASELINE: usable on main before this gate existed, grandfathered, not measured under pacing.
    Everything else is not usable: no line -> next (never usable by omission); skip -> next; fail -> later."""
    m = motion.get(i)
    if m is None:
        return (i in baseline), 'next'
    if m[0] in ('pass', 'na'):
        return True, 'next'
    if m[0] == 'skip':
        return (i in skip_named), 'next'
    return False, 'later'


def read_setup(path):
    """WORKER-SETUP.ps1's UpdateCandidates: datasets measured and arriving with the next worker update (`next`).
    The setup file no longer decides what is USABLE: that is the allowlist export (read_allowlist)."""
    text = Path(path).read_text(encoding='utf-8-sig')
    cand_block = re.search(r'\$UpdateCandidates\s*=\s*\[ordered\]@\{(.*?)\n\}', text, re.S).group(1)
    nxt = {}
    for line in cand_block.splitlines():
        m = re.match(r"\s*'([a-z0-9_]+)'\s*=\s*'([^']*)'", line)
        if m:
            nxt[m.group(1)] = m.group(2)
    return nxt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--listing', required=True, help='the per-dataset listing decisions (listing_decisions.json): who may be LISTED')
    ap.add_argument('--setup', required=True, help="WORKER-SETUP.ps1: only its UpdateCandidates are read (the `next` list)")
    ap.add_argument('--allowlist', required=True, help="the committed export of the installed worker's allowlist (one id per line)")
    ap.add_argument('--motion', required=True, help="WORKER's committed motion record: REQUIRED. Usable needs a pass/na line (or the baseline or a skip Ryan named)")
    ap.add_argument('--motion-baseline', required=True, help='datasets usable on main before the motion gate (grandfathered, not measured under pacing)')
    ap.add_argument('--motion-skip-ok', required=True, help='skip datasets Ryan NAMED as usable (empty until he names one)')
    ap.add_argument('--out', default=str(ROOT / 'assets' / 'app-catalog-data.js'))
    ap.add_argument('--detail-out', default='', help='also write the server-only detail (see the header)')
    ap.add_argument('--commit', default='', help="the engine commit (an exported tree has no .git)")
    a = ap.parse_args()
    engine = a.engine
    commit = a.commit or subprocess.run(['git', '-C', a.engine, 'rev-parse', '--short=12', 'HEAD'],
                                        capture_output=True, text=True).stdout.strip() or 'unknown'
    if a.detail_out:
        # THE SAME COMMIT GIVES THE SAME FILE ON ANY MACHINE: read the engine from the committed tree, never from the
        # working tree. A checkout also holds untracked files (an ingested manifest is exactly where a person's own data
        # lives) and local edits; none of that may reach a catalog. A path that is not a git checkout (an exported tree)
        # is used as it is.
        engine = committed_tree(a.engine)
    sys.path.insert(0, engine)
    from ryagram.maprace import datasets as D            # the engine's own registry
    ingested = ingested_ids()
    allow, restricted = read_allowlist(a.allowlist)
    motion = read_motion(a.motion, allow)
    baseline = set(read_id_list(a.motion_baseline, 'baseline'))
    skip_named = set(read_id_list(a.motion_skip_ok, 'skip named by Ryan'))
    decisions = read_listing(a.listing)
    nxt = read_setup(a.setup)
    registry_ids = {d['id'] for d in D.listing()}
    stale = [i for i in allow if i not in registry_ids]
    if stale:
        sys.exit('gen-catalog: the allowlist names datasets the engine does not register (a stale export): ' + ', '.join(stale))
    # Windows the app already knows are good (tested templates); read from the app's own file.
    tpl = (ROOT / 'assets' / 'app-templates.js').read_text(encoding='utf-8')
    known = {m.group(1): (m.group(2), m.group(3))
             for m in re.finditer(r"^\s*(\w+): \{ label: '[^']*', start: '([^']*)', end: '([^']*)'", tpl, re.M)}
    entries = []
    seed = []
    detail = []
    for d in D.listing():
        if EXCLUDE.search(d['id']) or d['id'] in ingested or d.get('synthetic') or d.get('shape') not in PUBLIC_SHAPES:
            continue
        views = [v for v in d.get('views', []) if v in APP_VIEWS]
        if d.get('entity_kind') == 'plain':
            views = [v for v in views if v != 'map']
        if d['id'] in restricted:                            # the worker offers this dataset in these views only
            views = [v for v in views if v in restricted[d['id']]]
        if not views:
            continue
        status = 'usable' if d['id'] in allow else 'next' if d['id'] in nxt else 'later'   # usable = on the worker's allowlist
        if status == 'usable':
            ok, not_status = usable_by_motion(d['id'], motion, baseline, skip_named)
            if not ok:
                status = not_status       # unmeasured or skip -> next; fail -> later (its default film does not pass the strict check)
        window = known.get(d['id']) or ((d['available_from'], d['available_to'])
                                        if d.get('available_from') and d.get('available_to') else None)
        measure = ((d.get('measures') or [{}])[0]).get('label') or ''
        title = clean_title(d)
        if measure and title[:1].islower():                  # a bare label like "grocery stores"
            unit = ((d.get('measures') or [{}])[0]).get('unit') or ''
            title = measure[0].upper() + measure[1:] + (f' ({unit})' if unit and unit.lower() not in measure.lower() else '')
        family = family_of(d)
        # Inside a family the sector is the row: "Manufacturing", not the full dataset title.
        short = re.sub(r':\s*share of CBP-covered jobs$', '', measure) if family and measure else title
        seed.append({'id': d['id'], 'title': title, 'publisher': d.get('source') or '', 'url': (d.get('url') or '') if str(d.get('url') or '').startswith('https://') else '',
                     'coverage': coverage_text(d), 'licence_short': short_licence(d.get('license')),
                     'licence_full': re.sub(r'\s+', ' ', d.get('license') or '').strip(), 'runnable': status == 'usable'})
        detail.append(detail_entry(d, status, window, title, short, family, views, decisions))
        if not detail[-1]['listable']:
            continue        # THE PUBLIC FILE HOLDS LISTABLE DATASETS ONLY (RULINGS 2026-10-17): anyone can fetch it
        entries.append({
            'id': d['id'], 'title': title, 'short': short, 'blurb': blurb(d), 'source': d.get('source') or '', 'url': d.get('url') or '',
            'group': group_of(d), 'family': family, 'status': status,
            'level': LEVELS.get(d.get('geography_id')) or d.get('geography') or '',
            'cadence': d.get('cadence') or '', 'from': d.get('available_from') or '', 'to': d.get('available_to') or '',
            'window': list(window) if window else None, 'views': views,
            'kind': d.get('entity_kind') or 'geographic', 'measure': measure})
    entries.sort(key=lambda e: (e['group'], e['family'] or '', e['title'].lower()))
    data = {'engine': commit, 'allow': allow, 'next': nxt, 'entries': entries}
    body = json.dumps(data, indent=1, ensure_ascii=True)
    Path(a.out).write_text(
        "// GENERATED by tools/gen-catalog.py from the engine's registry (engine %s) and the worker's committed allowlist export.\n"
        "// LISTABLE datasets only (RULINGS 2026-10-17): this file is public, so a dataset that may not be listed is not in it.\n"
        "// Do not edit by hand: regenerate. See the header of tools/gen-catalog.py.\n"
        "window.ryagramCatalogData = %s;\n" % (commit, body), encoding='utf-8', newline='\n')
    write_seed(ROOT / 'supabase' / 'catalog_sources_seed.sql', commit, seed)
    if a.detail_out:
        detail.sort(key=lambda e: (e['group'], e['family'] or '', e['title'].lower()))
        Path(a.detail_out).write_text(
            detail_text(commit, detail, Path(engine) / 'ryagram' / 'worker' / 'story.schema.json'),
            encoding='utf-8', newline='\n')
    counts = {s: sum(1 for e in entries if e['status'] == s) for s in ('usable', 'next', 'later')}
    print(f'{len(entries)} datasets from engine {commit}: {counts}')


if __name__ == '__main__':
    main()
