"""Publish the Ryagram Terms of Use and the updated Privacy Policy from their drafts, ONLY after Ryan has approved the wording.

    python tools/legal-approve.py --date "October 18, 2026" --decisions decisions.json --requires-ok account-tools,... [--cut film-pages,...] [--apply]

Without --apply it only checks and says what it WOULD do (nothing is written). It refuses to go on while:
  * a highlighted decision in a draft has no final wording in --decisions (a JSON file: {"commercial-use": "yes, including commercially", ...}; the
    wording replaces the highlighted text exactly as given), or
  * a "requires" statement (true only once something is live) is not named in --requires-ok: by naming it Ryan confirms it is true on the day. A statement that is
    NOT true yet can be left out of the published page with --cut <name> (it is removed, sentence and all) instead of being confirmed.
On --apply it writes terms/index.html and privacy-policy.html (draft banners, noindex, the draft stylesheet and the highlights removed), adds a
"Terms of Use" link beside the privacy link in the page footers and a sign-in consent line in the app, deletes legal-drafts/ and the draft stylesheet,
and can be re-run safely. It never touches git: review the diff and commit it yourself.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECISION = re.compile(r'<mark class="draft-decision" data-decision="([a-z0-9-]+)">(.*?)</mark>', re.S)
REQUIRES = re.compile(r'<span class="draft-requires" data-requires="([a-z0-9-]+)">(.*?)</span>', re.S)
FOOTERS = ['ryagram/index.html', 'app/index.html', 'film/index.html', 'help/index.html', 'report/index.html']


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


def clean(html, decisions, date, cut=()):
    html = re.sub(r'<!-- Ryagram (?:Terms of Use|privacy policy): DRAFT.*?-->\n', '', html, flags=re.S)
    html = re.sub(r'  <div class="draft-banner".*?</div>\n', '', html, flags=re.S)
    html = html.replace('<meta name="robots" content="noindex, nofollow">\n', '')
    html = html.replace('<link rel="stylesheet" href="/assets/legal-draft.css">\n', '')
    html = DECISION.sub(lambda m: date if m.group(1) == 'last-updated' else decisions[m.group(1)], html)
    html = REQUIRES.sub(lambda m: '' if m.group(1) in cut else m.group(2), html)
    html = re.sub(r'(\S) {2,}(\S)', r'\1 \2', html.replace(' </p>', '</p>').replace('<p> ', '<p>'))     # (only runs of spaces BETWEEN words: indentation is untouched)
    return html


def link_footers(apply):
    done = []
    for p in FOOTERS:
        path = ROOT / p
        if not path.exists():
            continue
        s = path.read_text(encoding='utf-8')
        if '/terms/' in s:
            continue
        s2 = re.sub(r'(<footer[^>]*>.*?)(<a href="/privacy-policy\.html">Privacy Policy</a>)', r'\1<a href="/terms/">Terms of Use</a>\2', s, count=1, flags=re.S)   # the FOOTER's privacy link only
        if p == 'app/index.html':
            s2 = s2.replace('<p class="form-intro">Ryagram is invite-only for now.</p>',
                            '<p class="form-intro">Ryagram is invite-only for now.</p>\n    <p class="form-note">By joining you agree to the <a href="/terms/">Terms of Use</a> and the <a href="/privacy-policy.html">Privacy Policy</a>.</p>', 1)
        if p == 'ryagram/index.html':
            s2 = s2.replace('We will only use this to contact you about the beta. See our <a href="/privacy-policy.html">Privacy Policy</a>.',
                            'By applying you agree to the <a href="/terms/">Terms of Use</a>. We will only use this to contact you about the beta. See our <a href="/privacy-policy.html">Privacy Policy</a>.', 1)
        if s2 != s:
            done.append(p)
            if apply:
                path.write_text(s2, encoding='utf-8', newline='')
    return done


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--date', help='the "last updated" date as it should read, e.g. "October 18, 2026"')
    ap.add_argument('--decisions', help='JSON file: decision name -> the final wording')
    ap.add_argument('--requires-ok', default='', help='comma-separated "requires" names you confirm are true today')
    ap.add_argument('--cut', default='', help='comma-separated "requires" names to REMOVE from the page because they are not true yet')
    ap.add_argument('--apply', action='store_true', help='write the files (without it nothing is written)')
    ap.add_argument('--root', help='(tests) a different repository root')
    a = ap.parse_args(argv)
    global ROOT
    if a.root:
        ROOT = Path(a.root)
    terms, privacy = read('legal-drafts/terms.html'), read('legal-drafts/privacy-policy.html')
    decisions = json.loads(Path(a.decisions).read_text(encoding='utf-8')) if a.decisions else {}
    ok = {x.strip() for x in a.requires_ok.split(',') if x.strip()}
    cut = {x.strip() for x in a.cut.split(',') if x.strip()}
    both = ok & cut
    open_decisions = sorted({m.group(1) for m in DECISION.finditer(terms + privacy) if m.group(1) != 'last-updated' and not str(decisions.get(m.group(1), '')).strip()})
    unconfirmed = sorted({m.group(1) for m in REQUIRES.finditer(terms + privacy)} - ok - cut)
    problems = []
    marked = sorted(k for k in decisions if k.startswith('_DRAFT'))                  # e.g. "_DRAFT_FOR_COUNSEL": the wording is a draft until counsel has signed it off and the key is deleted
    if marked and a.apply:
        problems.append('the decisions file is marked ' + ', '.join(marked) + ': counsel has not signed it off. Delete that key from the file once they have, then run again')
    if both:
        problems.append('named in both --requires-ok and --cut: ' + ', '.join(sorted(both)))
    unknown_cut = sorted(cut - {m.group(1) for m in REQUIRES.finditer(terms + privacy)})
    if unknown_cut:
        problems.append('--cut names no statement in the drafts: ' + ', '.join(unknown_cut))
    if not a.date or not a.date.strip():
        problems.append('--date is missing ("last updated" must be a real date)')
    if open_decisions:
        problems.append('decisions without final wording (give them in --decisions): ' + ', '.join(open_decisions))
    if unconfirmed:
        problems.append('statements that are true only once something is live; confirm each with --requires-ok: ' + ', '.join(unconfirmed))
    for name, text in decisions.items():
        if name.startswith('_DRAFT'):
            continue
        if re.search(r'[\[\]<>]', str(text)) or 'TODO' in str(text):
            problems.append(f'decision "{name}" still looks like a placeholder: {text!r}')
    if problems:
        print('NOT PUBLISHED. Nothing was written.')
        for p in problems:
            print(' -', p)
        return 1
    out_terms, out_privacy = clean(terms, decisions, a.date.strip(), cut), clean(privacy, decisions, a.date.strip(), cut)
    for name, html in (('terms', out_terms), ('privacy', out_privacy)):
        assert 'draft-' not in html and 'DRAFT' not in html and 'noindex' not in html, name
    linked = link_footers(False)
    if marked:
        print('NOTE: the decisions file is marked ' + ', '.join(marked) + ' (--apply will refuse until that key is deleted).')
    print(('WROTE' if a.apply else 'WOULD WRITE') + ': terms/index.html, privacy-policy.html; links added to: ' + (', '.join(linked) or '(already linked)'))
    if a.apply:
        (ROOT / 'terms').mkdir(exist_ok=True)
        (ROOT / 'terms' / 'index.html').write_text(out_terms, encoding='utf-8', newline='')
        (ROOT / 'privacy-policy.html').write_text(out_privacy, encoding='utf-8', newline='')
        link_footers(True)
        for f in ('legal-drafts/terms.html', 'legal-drafts/privacy-policy.html', 'assets/legal-draft.css'):
            (ROOT / f).unlink(missing_ok=True)
        try:
            (ROOT / 'legal-drafts').rmdir()
        except OSError:
            pass
        print('Done. Review the diff (git diff) and commit it; nothing was committed or pushed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
