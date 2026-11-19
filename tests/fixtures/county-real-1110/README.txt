GEO real county answers for CONNECT, 2026-11-10 (public Census and BLS figures only; no drive path, no cache folder name, no non-ASCII byte)

Each file is {ask, answer}: the answer exactly as tools/geo_county_profile.py returned it on Ryagram branch
geo-li-slim-compare-1110 (on geo-li-grocery-1110), read from the per-county extracts.
SHA256SUMS.txt holds each file's hash.

What is new against yesterday's nine (tests/fixtures/county-real):
  1. the grocery kind (Ryan Q551): kind 'grocery', NAICS 445110; kind_title 'supermarkets and other grocery stores';
     the establishments note names what is NOT counted; one extra say line; a comparison carries the kind's own 'not a ranking' line.
  2. the comparison schema ryagram.geo-compare-counties/1 (CC1 09:06): 'profiles' is gone; 'county_figures' has one entry per shown county:
     {county, name, read_how, series (only establishments and per_10k, exactly as in that county's profile), not_held_items,
      full_profile: {tool: 'county_profile', county, kind, words}}. counties, rule, ordered, order_words, rule_table, say, forecast are as before.
  3. the profile shape is unchanged: greene_profile_limited.json is shown by readCountyAnswer at cb988eb.

Run through readCountyAnswer at L-Ai cb988eb (county.ts copied unchanged, node strip-types):
  greene_profile_limited                  SHOWN
  greene_profile_grocery                  refused: the reader takes kind limited_service only
  compare_* (6, both kinds, 3 rule cases) refused: the reader takes schema /0 with 'profiles'

The files:
  greene_profile_limited.json                  profile, Greene, limited_service
  greene_profile_grocery.json                  profile, Greene, grocery
  compare_<kind>_norule.json                   Montgomery + Greene, no rule
  compare_<kind>_per_10k_low_first.json        Montgomery + Greene, per 10,000 lowest first, latest common year
  compare_<kind>_count_high_first.json         Montgomery + Greene, count highest first, year 2015

ADDED 2026-11-10 10:35 (CC1 10:29), from Ryagram geo-li-eating-places-1110 cda4ce13 (which holds grocery, the /1 comparison, pharmacy and eating places):
  greene_profile_pharmacy.json, greene_profile_eating_places.json      profiles, Greene
  compare_<kind>_<rule>.json   (kind pharmacy or eating_places)        Montgomery + Greene, every rule: norule, per_10k_low_first, per_10k_high_first,
                                                                        count_high_first (year 2015)
  compare3_<kind>_<rule>.json                                          Montgomery + Greene + Clark County, Ohio (39023), every rule. NOTE: the tool's closed
                                                                        county list is still Greene and Montgomery, so a real request cannot name Clark yet; these
                                                                        were made with Clark added to the list in the generating process only, to show the
                                                                        3-county shape a widened list gives. Your reader will refuse them for Clark being off
                                                                        COUNTY_LIST until the list widens; that is expected.
  New in these answers:
    pharmacy: every QCEW series has breaks [2022] and a note naming 446110 to 456110.
    eating_places: a 15th series, measure establishments_sum_1998_2011 (Calculated, years 1998-2011 only); the Observed establishments series
      has no figure 1998-2011 with a per-year note saying why; per_10k before 2012 is from the sum and each such year says so.
      Comparisons carry only establishments and per_10k, but those per-year notes make a 3-county eating-places comparison 26.8 KB compact
      (41% of 64 KB); pharmacy 16.7 KB (25%). Measured.
  SHA256SUMS.txt now has 26 lines (8 earlier + 18 new); all verify.

CHANGED 2026-11-10 11:25 (CONNECT 11:16): the 9 eating_places files (greene_profile_eating_places, the four compare_eating_places_*, the four
compare3_eating_places_*) were regenerated from Ryagram geo-li-eating-places-1110 566fe4cf, where the count's note now reads 'A count of places,
not of sales, meals or customers.' (was 'not of meals, customers or sales.'). Nothing else in them changed. SHA256SUMS.txt was rebuilt over all
26 files (sorted by name); the other 17 hashes are unchanged.

CHANGED 2026-11-10 12:05 (NEXT-GEO 27): the same 9 eating_places files regenerated from Ryagram geo-li-eating-places-1110 d07b797f. The pre-2012
reason is now said once, in the series notes; each empty pre-2012 year carries only 'no figure before 2012: see the series note', and summed
per-10,000 years carry no per-year note. A 3-county eating-places comparison is 18.8 KB compact (was 26.8 KB); the profile 22.8 KB (was 28.5 KB).
SHA256SUMS.txt rebuilt over all 26; exactly these 9 hashes changed.
