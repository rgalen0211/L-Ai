"""Perfect City private-name filter (FACES 11-27, HIGH H3): tools/perfect-city/name_filter.py, with FACES' 25 INVENTED cases
(every name here is made up; none comes from OpenStreetMap), and the exporter's wiring: the filter runs on the OpenStreetMap
kinds before a row is added, never on the FDIC bank rows, and the exporter prints counts only, never a dropped name.
  py -I -B tests/test_perfect_city_name_filter.py
"""
import importlib.util
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools' / 'perfect-city'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


NF = load(TOOLS / 'name_filter.py', '_pc_name_filter')

# (tags, expected keep); every name is invented (FACES' 25 cases, unchanged)
CASES = [
    ({'name': 'Test Place 1', 'amenity': 'restaurant'}, True),
    ({'name': "Joe's Burgers", 'amenity': 'fast_food'}, True),
    ({'name': "Marie's Pizza", 'amenity': 'restaurant'}, True),
    ({'name': 'Dayton Drive Thru', 'amenity': 'fast_food'}, True),
    ({'name': 'Home Depot Cafe', 'amenity': 'cafe'}, True),
    ({'name': "Mama Lena's Home Cooking", 'amenity': 'restaurant'}, True),
    ({'name': 'Waffle House', 'amenity': 'restaurant', 'brand': 'Waffle House'}, True),
    ({'name': 'Smith', 'amenity': 'fast_food', 'brand': 'Smith Chain'}, True),
    ({'name': 'John Smith Pizzeria', 'amenity': 'restaurant', 'addr:housenumber': '12'}, True),
    ({'name': 'Pancake House', 'amenity': 'restaurant'}, True),
    ({'name': 'Sunrise Diner', 'amenity': 'restaurant', 'building': 'house'}, True),
    ({'amenity': 'fast_food'}, True),
    ({'name': 'Hamburger Heaven Grill', 'amenity': 'fast_food', 'addr:housenumber': '5'}, True),
    ({'name': 'Qwik Stop', 'amenity': 'fast_food', 'brand': 'Qwik Stop', 'building': 'residential'}, True),
    ({'name': 'Test Taco', 'amenity': 'fast_food', 'addr:housenumber': '77'}, True),
    ({'name': 'Smith family home', 'amenity': 'restaurant'}, False),
    ({'name': 'John Smith', 'amenity': 'restaurant'}, False),
    ({'name': 'Apartment 4B', 'amenity': 'fast_food'}, False),
    ({'name': "Lee's house", 'amenity': 'restaurant'}, False),
    ({'name': 'Private Residence', 'amenity': 'restaurant'}, False),
    ({'name': 'Rivera Place Cafe', 'amenity': 'cafe', 'access': 'private'}, False),
    ({'name': 'Grace Allen', 'amenity': 'fast_food', 'building': 'house'}, False),
    ({'name': 'Maple Court', 'amenity': 'restaurant', 'addr:housenumber': '14'}, False),
    ({'name': 'Mary', 'amenity': 'restaurant'}, False),
    ({'name': 'Unit 12', 'amenity': 'restaurant'}, False),
]


class NameFilter(unittest.TestCase):
    def test_the_25_cases(self):
        self.assertEqual(len(CASES), 25)
        self.assertEqual(sum(1 for _, k in CASES if k), 15)
        for tags, want in CASES:
            keep, why = NF.decide(tags)
            self.assertEqual(keep, want, f'{tags} -> {keep} ({why}), wanted {want}')
            self.assertIs(NF.keep_place(tags), want)

    def test_a_reason_never_carries_the_name(self):
        for tags, _ in CASES:
            name = tags.get('name')
            if name:
                self.assertNotIn(name.lower(), NF.decide(tags)[1].lower(), tags)

    def test_curly_apostrophe_is_a_plain_one(self):
        self.assertEqual(NF.decide({'name': 'Lee' + chr(0x2019) + 's house'})[0], False)
        self.assertEqual(NF.decide({'name': 'Joe' + chr(0x2019) + 's Burgers'})[0], True)


class Wiring(unittest.TestCase):
    """The exporter's places(): the filter sits in the OpenStreetMap element loop, before the row is added; the FDIC loop never calls it."""
    SRC = (TOOLS / 'export_perfect_city.py').read_text(encoding='utf-8').replace('\r\n', '\n')

    def body(self):
        m = re.search(r'\ndef places\(args\):\n(.*?)\n(?=def )', self.SRC, re.S)
        self.assertIsNotNone(m, 'places() not found')
        return m.group(1)

    def test_filter_runs_before_the_osm_row_and_not_on_fdic(self):
        b = self.body()
        osm_loop = b[b.index("for e in doc['elements']:"):b.index('fips = int(')]
        fdic_loop = b[b.index('fips = int('):b.index('rows = sorted(set(rows))')]
        self.assertIn('name_filter.decide(tags)', osm_loop)
        self.assertLess(osm_loop.index('name_filter.decide(tags)'), osm_loop.index('rows.append('))
        self.assertIn('continue', osm_loop[osm_loop.index('name_filter.decide(tags)'):osm_loop.index('rows.append(')])
        self.assertNotIn('decide(', fdic_loop)

    def test_drops_are_counted_never_named(self):
        b = self.body()
        drop = b[b.index('name_filter.decide(tags)'):]
        drop = drop[:drop.index('continue')]
        self.assertNotRegex(drop, r"tags\.get\('name'\)|\bname\b\s*[,)]", 'the drop branch must not touch the name')
        self.assertNotRegex(b, r"print\([^\n]*dropped_names", 'no dropped name is printed')


if __name__ == '__main__':
    unittest.main()
