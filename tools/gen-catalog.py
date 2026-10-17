"""Generate assets/app-catalog-data.js: the app's dataset catalog, from the ENGINE's own registry.

    python tools/gen-catalog.py --engine <engine checkout> --setup <WORKER-SETUP.ps1>

The catalog is generated, never typed (two hand-kept lists drift): every dataset the engine
registers (ryagram.maprace.datasets.listing()), minus fixtures, private data and shapes the app
can't build yet, each marked with the worker's state:

  usable  on the INSTALLED worker's allowlist (WORKER-SETUP.ps1, $AllowToml)
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
do not. Without the flag this script behaves exactly as before. The detail file is never written under
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
#: The film types the guided builder offers: the app's tested templates.
FILM_TYPES = ('map', 'bars', 'line', 'paired')
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


def story_measure(m):
    """The worker story's `measure` setting a catalog measure maps to, or None when a story cannot choose it."""
    return {'banded': 'rate', 'counted': 'count'}.get(m.get('role') or '')


#: RULINGS 2026-10-17 (Ryan): a dataset may be LISTED to people only if it is not personal and its licence allows
#: showing derived visuals publicly. The rule is decided here, from the registry's own licence text, and re-derived by
#: supabase/functions/_shared/catalog_rules.ts (tests compare the two). Unknown or restrictive licences are NOT listable:
#: the default is no. Terms: public domain, U.S. Government work, 17 USC 105, CC0, or CC BY (any version) with no NC or ND.
PERSONAL_LICENCE = re.compile(r'\b(private|personal)\b', re.I)
PUBLIC_LICENCE = re.compile(r'public domain|17 USC 105|U\.S\. Government works?|\bCC0\b|\bCC BY\b', re.I)
RESTRICTED_LICENCE = re.compile(r'\bCC BY[- ](NC|ND)|non-?commercial|no ?derivatives?|all rights reserved|not for (public|redistribution)', re.I)


def listable_of(d):
    """(listable, why): personal and synthetic data are never listed; otherwise only a recognised open licence is."""
    lic = re.sub(r'\s+', ' ', d.get('license') or '').strip()
    if EXCLUDE.search(d['id']) or PERSONAL_LICENCE.search(lic):
        return False, 'personal'
    if d.get('synthetic'):
        return False, 'synthetic'
    if RESTRICTED_LICENCE.search(lic):
        return False, 'licence restricts public use'
    if PUBLIC_LICENCE.search(lic):
        return True, 'public domain' if re.search(r'public domain|17 USC 105|U\.S\. Government', lic, re.I) else 'open licence'
    return False, 'licence not recognised'


def detail_entry(d, status, window, title, short, family, views):
    ms = d.get('measures') or []
    listable, why = listable_of(d)
    return {
        'listable': listable, 'listable_why': why,
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
    raw = Path(schema_path).read_bytes()
    schema = json.loads(raw.decode('utf-8'))
    sha = hashlib.sha256(raw).hexdigest()
    dump = lambda v: json.dumps(v, indent=1, ensure_ascii=True)
    return (
        "// GENERATED by tools/gen-catalog.py --detail-out, do not edit. Regenerate: see the header of that script.\n"
        "// Engine %s. Story schema vendored from ryagram/worker/story.schema.json, sha256 %s.\n"
        "// SERVER ONLY: never copy this under assets/. It is the internal list Ryagram's AI and the guided builder's\n"
        "// server function choose from. (RULINGS 2026-10-17 lets a front end list datasets to invited users with source\n"
        "// and licence shown; that is a separate, public-catalog change, not this file.)\n"
        "export const CATALOG_ENGINE = %s;\n"
        "export const STORY_SCHEMA_SHA256 = %s;\n\n"
        "export const CATALOG: any[] = %s;\n\n"
        "// The worker's story schema v1, so the Edge Functions can refuse a story the worker would refuse.\n"
        "// The worker's own check is still the authority.\n"
        "export const STORY_SCHEMA: any = %s;\n" % (commit, sha, json.dumps(commit), json.dumps(sha), dump(entries), dump(schema)))


def read_setup(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    allow_block = re.search(r"\$AllowToml\s*=\s*@'\s*(.*?)\s*'@", text, re.S).group(1)
    allow = re.findall(r"'([a-z0-9_]+)'", allow_block)
    cand_block = re.search(r'\$UpdateCandidates\s*=\s*\[ordered\]@\{(.*?)\n\}', text, re.S).group(1)
    nxt = {}
    for line in cand_block.splitlines():
        m = re.match(r"\s*'([a-z0-9_]+)'\s*=\s*'([^']*)'", line)
        if m:
            nxt[m.group(1)] = m.group(2)
    return allow, nxt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--setup', required=True)
    ap.add_argument('--out', default=str(ROOT / 'assets' / 'app-catalog-data.js'))
    ap.add_argument('--detail-out', default='', help='also write the server-only detail (see the header)')
    ap.add_argument('--commit', default='', help="the engine commit (an exported tree has no .git)")
    a = ap.parse_args()
    sys.path.insert(0, a.engine)
    from ryagram.maprace import datasets as D            # the engine's own registry
    commit = a.commit or subprocess.run(['git', '-C', a.engine, 'rev-parse', '--short=12', 'HEAD'],
                                        capture_output=True, text=True).stdout.strip() or 'unknown'
    allow, nxt = read_setup(a.setup)
    # Windows the app already knows are good (tested templates); read from the app's own file.
    tpl = (ROOT / 'assets' / 'app-templates.js').read_text(encoding='utf-8')
    known = {m.group(1): (m.group(2), m.group(3))
             for m in re.finditer(r"^\s*(\w+): \{ label: '[^']*', start: '([^']*)', end: '([^']*)'", tpl, re.M)}
    entries = []
    seed = []
    detail = []
    for d in D.listing():
        if EXCLUDE.search(d['id']) or d.get('synthetic') or d.get('shape') not in PUBLIC_SHAPES:
            continue
        views = [v for v in d.get('views', []) if v in APP_VIEWS]
        if d.get('entity_kind') == 'plain':
            views = [v for v in views if v != 'map']
        if not views:
            continue
        status = 'usable' if d['id'] in allow else 'next' if d['id'] in nxt else 'later'
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
        detail.append(detail_entry(d, status, window, title, short, family, views))
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
        "// GENERATED by tools/gen-catalog.py from the engine's registry (engine %s) and WORKER-SETUP.ps1's allowlist.\n"
        "// Do not edit by hand: regenerate. See the header of tools/gen-catalog.py.\n"
        "window.ryagramCatalogData = %s;\n" % (commit, body), encoding='utf-8', newline='\n')
    write_seed(ROOT / 'supabase' / 'catalog_sources_seed.sql', commit, seed)
    if a.detail_out:
        detail.sort(key=lambda e: (e['group'], e['family'] or '', e['title'].lower()))
        Path(a.detail_out).write_text(
            detail_text(commit, detail, Path(a.engine) / 'ryagram' / 'worker' / 'story.schema.json'),
            encoding='utf-8', newline='\n')
    counts = {s: sum(1 for e in entries if e['status'] == s) for s in ('usable', 'next', 'later')}
    print(f'{len(entries)} datasets from engine {commit}: {counts}')


if __name__ == '__main__':
    main()
