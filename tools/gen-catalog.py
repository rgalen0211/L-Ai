"""Generate assets/app-catalog-data.js: the app's dataset catalog, from the ENGINE's own registry.

    python tools/gen-catalog.py --engine <engine checkout> --setup <WORKER-SETUP.ps1>

The catalog is generated, never typed (two hand-kept lists drift): every dataset the engine
registers (ryagram.maprace.datasets.listing()), minus fixtures, private data and shapes the app
can't build yet, each marked with the worker's state:

  usable  on the INSTALLED worker's allowlist (WORKER-SETUP.ps1, $AllowToml)
  next    measured by WORKER and arriving with the next worker update ($UpdateCandidates)
  later   registered by the engine, not measured for the worker's cache yet

Run it with the engine's own Python (it imports the engine). The output records the engine commit
and the setup file's allowlist, and tests/app-catalog.test.cjs checks the data against both the
credits ledger and (when present) WORKER-SETUP.ps1.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_VIEWS = ('map', 'bars', 'line', 'paired', 'panel')       # the worker's story schema v1 render views
EXCLUDE = re.compile(r'(^example_corp_|_fixture(_|$)|^ryan_)')
PUBLIC_SHAPES = ('areas',)                                   # flows, lines and networks aren't buildable in the app yet
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
    counts = {s: sum(1 for e in entries if e['status'] == s) for s in ('usable', 'next', 'later')}
    print(f'{len(entries)} datasets from engine {commit}: {counts}')


if __name__ == '__main__':
    main()
