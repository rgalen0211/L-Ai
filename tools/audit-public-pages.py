"""Public pages sanity (static crawl of the checked-out tree, no browser): for every HTML page that is served (not the Supabase e-mail templates) it checks the title and description, the language and
viewport, one h1, images with alt, links that open a new tab without noopener, the robots rule (a page marked DRAFT, a thank-you page, the 404 and the app shell are NOT meant to be found by a search engine; a
public page must not say noindex by accident), whether a noindex page is linked from anywhere, every internal link and its #anchor (root-relative and relative; app hash routes are skipped), and every OUTSIDE
address grouped by host. Prints findings by page; exit 1 if any.

    python tools/audit-public-pages.py [--hosts]        (--hosts also prints every outside host and where it is used)
"""
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urldefrag, urlparse

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIR = ('supabase/', 'node_modules/', 'tests/')
# Pages that must keep search engines away: unfinished or private or not a destination.
SHOULD_BE_NOINDEX = {'connect-ai/index.html', 'legal-drafts/privacy-policy.html', 'legal-drafts/terms.html', 'ai-content/index.html', 'terms/index.html', 'thank-you.html', 'workflow-audit-thanks.html', '404.html', 'app/index.html'}   # ai-content and terms are DRAFT shells until Ryan publishes them
# Pages that must also be linked from nowhere (the legal shells are linked from footers on purpose, as placeholders).
UNLISTED = {'connect-ai/index.html', 'legal-drafts/privacy-policy.html', 'legal-drafts/terms.html'}
# Pages that are the public face and must be findable.
SHOULD_BE_INDEXED = {'index.html', 'ryagram/index.html', 'help/index.html', 'privacy-policy.html'}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ''
        self.in_title = False
        self.meta = {}
        self.links = []          # (kind, url, attrs)
        self.ids = set()
        self.h1 = 0
        self.imgs_noalt = []
        self.blank_no_noopener = []
        self.lang = ''
        self.text = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('id'):
            self.ids.add(a['id'])
        if a.get('name') and tag == 'a':
            self.ids.add(a['name'])
        if tag == 'html':
            self.lang = a.get('lang', '')
        elif tag == 'title':
            self.in_title = True
        elif tag == 'meta' and a.get('name'):
            self.meta[a['name'].lower()] = a.get('content', '')
        elif tag == 'h1':
            self.h1 += 1
        elif tag == 'img':
            if 'alt' not in a:
                self.imgs_noalt.append(a.get('src', '?'))
            if a.get('src'):
                self.links.append(('img', a['src'], a))
        elif tag == 'a' and a.get('href') is not None:
            self.links.append(('a', a['href'], a))
            if a.get('target') == '_blank' and 'noopener' not in a.get('rel', ''):
                self.blank_no_noopener.append(a['href'])
        elif tag == 'link' and a.get('href'):
            self.links.append(('link', a['href'], a))
        elif tag in ('script', 'source', 'video', 'audio', 'iframe') and (a.get('src') or a.get('poster')):
            if a.get('src'):
                self.links.append((tag, a['src'], a))
            if a.get('poster'):
                self.links.append(('poster', a['poster'], a))
        elif tag == 'form' and a.get('action'):
            self.links.append(('form', a['action'], a))

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        else:
            self.text.append(data)


def served_pages():
    out = subprocess.run(['git', 'ls-files', '*.html'], cwd=ROOT, capture_output=True, text=True).stdout.split()
    return [p for p in out if not p.startswith(SKIP_DIR)]


def resolve(from_page, url):
    """The file in the tree a root-relative or relative link points to, or None when it is not ours to check."""
    u = urlparse(url)
    if u.scheme or u.netloc or url.startswith(('mailto:', 'tel:', 'javascript:', 'data:', '#')):
        return None
    path = unquote(u.path)
    base = ROOT if path.startswith('/') else (ROOT / from_page).parent
    target = (base / path.lstrip('/')).resolve()
    if target.is_dir():
        target = target / 'index.html'
    return target


def main():
    show_hosts = '--hosts' in sys.argv
    pages = served_pages()
    data = {}
    for rel in pages:
        p = Page()
        p.feed((ROOT / rel).read_text(encoding='utf8', errors='replace'))
        data[rel] = p
    findings = {}

    def add(page, text):
        findings.setdefault(page, []).append(text)

    inbound = {rel: [] for rel in pages}
    outside = {}
    for rel, p in data.items():
        robots = p.meta.get('robots', '').lower()
        noindex = 'noindex' in robots
        if not p.title.strip():
            add(rel, 'no <title>')
        elif len(p.title.strip()) > 70:
            add(rel, f'title is {len(p.title.strip())} characters (search results cut it at about 60)')
        desc = p.meta.get('description', '').strip()
        local_tool = rel.startswith('tools/')            # pages the maker serves on the person's own computer: never public, so noindex is required and the public description and heading rules do not apply
        if local_tool and not noindex:
            add(rel, 'a local tool page must say noindex')
        if not local_tool and (rel in SHOULD_BE_INDEXED or (not noindex and rel not in SHOULD_BE_NOINDEX)):
            if not desc:
                add(rel, 'no meta description (a public page should have one)')
            elif not 50 <= len(desc) <= 175:
                add(rel, f'meta description is {len(desc)} characters (50 to 175 reads well in results)')
        if not p.lang:
            add(rel, 'no lang on <html>')
        if 'viewport' not in p.meta:
            add(rel, 'no viewport meta (it will not scale on a phone)')
        if p.h1 != 1 and not local_tool and rel not in ('app/index.html', 'film/index.html'):      # the app and the film page build their headings with script
            add(rel, f'{p.h1} h1 headings (a page should have exactly one)')
        for src in p.imgs_noalt:
            add(rel, f'image with no alt text: {src}')
        for href in p.blank_no_noopener:
            add(rel, f'opens a new tab without rel="noopener": {href}')
        if rel in SHOULD_BE_NOINDEX and not noindex:
            add(rel, 'should keep search engines away (an unfinished, private or not-a-destination page) but has no noindex')
        if rel in SHOULD_BE_INDEXED and noindex:
            add(rel, 'is a public page but says noindex')
        body = ' '.join(p.text)
        if re.search(r'\bDRAFT\b', body) and not noindex and rel not in SHOULD_BE_INDEXED:
            add(rel, 'says DRAFT in its text but has no noindex')
        for kind, url, a in p.links:
            u = urlparse(url)
            if u.scheme in ('http', 'https') or url.startswith('//'):
                host = u.netloc or urlparse('https:' + url).netloc
                outside.setdefault(host, []).append((rel, kind, url))
                continue
            target = resolve(rel, url)
            if target is None:
                continue
            if url.startswith('#') or not (u.path or u.fragment):
                continue
            try:
                trel = target.relative_to(ROOT).as_posix()
            except ValueError:
                add(rel, f'{kind} points outside the site: {url}')
                continue
            if not target.exists():
                add(rel, f'broken {kind}: {url} (no file {trel})')
                continue
            if kind == 'a' and trel in inbound:
                inbound[trel].append(rel)
            if u.fragment and trel in data and not u.fragment.startswith('/') and u.fragment not in data[trel].ids:
                add(rel, f'broken anchor: {url} (no id "{u.fragment}" in {trel})')
    # pages that must stay unlisted: linked from nowhere
    for rel in sorted(UNLISTED):
        links = [x for x in inbound.get(rel, []) if x != rel]
        if links:
            add(rel, f'is meant to stay unlisted but is linked from: {", ".join(sorted(set(links)))}')
    # duplicate titles and descriptions among the public pages
    seen_t, seen_d = {}, {}
    for rel, p in data.items():
        if rel in SHOULD_BE_NOINDEX:
            continue
        seen_t.setdefault(p.title.strip(), []).append(rel)
        d = p.meta.get('description', '').strip()
        if d:
            seen_d.setdefault(d, []).append(rel)
    for t, rels in seen_t.items():
        if len(rels) > 1:
            for r in rels:
                add(r, f'shares its title "{t[:50]}" with {", ".join(x for x in rels if x != r)}')
    for d, rels in seen_d.items():
        if len(rels) > 1:
            for r in rels:
                add(r, f'shares its description with {", ".join(x for x in rels if x != r)}')
    for rel in sorted(findings):
        print(f'\n{rel}')
        for f in findings[rel]:
            print(f'  - {f}')
    if show_hosts:
        print('\nOUTSIDE HOSTS')
        for host in sorted(outside):
            print(f'  {host}')
            for rel, kind, url in outside[host][:4]:
                print(f'      {rel}  [{kind}]  {url[:90]}')
    total = sum(len(v) for v in findings.values())
    print(f'\nPAGES: {len(pages)}   FINDINGS: {total} on {len(findings)} pages   OUTSIDE HOSTS: {len(outside)}')
    print('RESULT:', 'PASS' if not total else 'FAIL')
    return 0 if not total else 1


if __name__ == '__main__':
    sys.exit(main())
