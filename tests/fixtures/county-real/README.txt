GEO's nine REAL county-tool answers, for CONNECT's reader fixtures (CC1 2026-11-09 19:15).

Made by geo-li-connect-fields-1109 74af1feb (tools/geo_county_profile.py) on 2026-11-09 from files already held, read-only:
public U.S. Census Bureau (County Business Patterns, Building Permits Survey, Population Estimates) and BLS QCEW figures only.
Greene (39057) and Montgomery (39113), limited-service restaurants, from the per-county extracts unless the file name says otherwise.

Each file is {"ask": {shape, counties, rule, year}, "answer": <exactly what the tool returned>}.
  greene_profile, montgomery_profile          one county each
  compare_norule                              Greene, Montgomery; no rule (order as asked)
  compare_per10k_low                          per_10k_low_first, latest common year (2023)
  compare_count_high_2015                     asked Montgomery, Greene; count_high_first, year 2015
  edge_no_qcew                                Greene, no QCEW folder held (not_held names BLS QCEW)
  edge_no_permits                             Greene, no permits file held (not_held names Census Building Permits)
  edge_bad_cbp_year                           Montgomery, national files with only 2021-2023 present and 2022 an unreadable page
                                              (the 1998-2020 'not in the cache' line is an artefact of that small test folder)
  edge_no_extract                             Greene, no extract held, read from the national files (read_how national_files)

Checked before handing over: no drive path, no cache folder name, no non-ASCII byte in any file; SHA256SUMS.txt lists each file's hash.
CONNECT's reader at L-Ai 1f30d26 shows 0 of 9; with the unit cap at 60 and 'permitted' allowed after 'housing units' it shows 9 of 9.
