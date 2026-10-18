-- BRING YOUR OWN DATA, wide files (Q6, ENGINE + WEB, 2026-10-18; ENGINE-BYOD-GAPS.md gap 5).
--
-- A file with its years across the columns used to be turned away in words. The reader (ryagram/worker/sheetread.py) now melts it in
-- memory and reports on the LONG form (id columns, `period`, the measure), with `wide_groups` (the measure groups it could melt,
-- up to 8) and `wide_chosen` (the default). The person ticks "These columns are years", and the mapping carries `melt_wide: true`
-- and, if they chose another group, `wide_prefix`.
--
-- WHAT THIS CHANGES, and only this:
--   ingest_report_ok  accepts wide_groups (1-8 of {prefix, first, last, count 3-60}) and wide_chosen (one of the groups), and only
--                     on a report whose guess.wide is true;
--   mapping_ok        accepts melt_wide (boolean) and wide_prefix (text up to 40, only with melt_wide). A wide report with groups
--                     needs melt_wide (new sentence); a wide report WITHOUT groups (an older reader) keeps the OLD refusal; melt_wide on
--                     a long file is refused; a prefix that is not one of the groups is refused; an EMPTY prefix means wide_chosen;
--                     every index is checked against the report's columns, which for a wide file are the LONG columns.
-- confirm_dataset_mapping and everything else are unchanged (they call mapping_ok). Existing reports and mappings validate exactly
-- as before. Apply AFTER the worker and engine half is live (a wide report is only produced by it).

create or replace function ryagram_private.ingest_report_ok(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c jsonb;
  s jsonb;
  g jsonb;
begin
  if r is null or jsonb_typeof(r) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in
       ('format', 'sheet', 'sheets', 'sha256', 'rows', 'columns', 'guess', 'periods', 'unmatched', 'state_column_index',
        'wide_groups', 'wide_chosen')) then
    return false;
  end if;
  if r->>'format' not in ('csv', 'tsv', 'xlsx', 'ods') then return false; end if;
  if (r->>'sha256') !~ '^[0-9a-f]{64}$' then return false; end if;
  -- Nested ifs, not AND/OR chains: SQL does not promise to stop at the first false.
  if coalesce(jsonb_typeof(r->'rows'), '') <> 'number' then return false; end if;
  if (r->>'rows')::numeric not between 0 and 1000000 then return false; end if;
  if coalesce(jsonb_typeof(r->'columns'), '') <> 'array' then return false; end if;
  if jsonb_array_length(r->'columns') not between 1 and 60 then return false; end if;
  for c in select * from jsonb_array_elements(r->'columns') loop
    if jsonb_typeof(c) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('index', 'header', 'kind', 'sample')) then return false; end if;
    if coalesce(jsonb_typeof(c->'index'), '') <> 'number' then return false; end if;
    if coalesce(jsonb_typeof(c->'header'), '') <> 'string' then return false; end if;
    if char_length(c->>'header') > 80 then return false; end if;
    if coalesce(c->>'kind', '') not in ('place', 'period', 'number', 'text') then return false; end if;
    if coalesce(jsonb_typeof(c->'sample'), '') <> 'array' then return false; end if;
    if jsonb_array_length(c->'sample') > 5 then return false; end if;
    for s in select * from jsonb_array_elements(c->'sample') loop
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 40 then return false; end if;
    end loop;
  end loop;
  -- column positions are exactly 0..n-1 in order
  if exists (select 1 from jsonb_array_elements(r->'columns') with ordinality t(col, ord)
             where (col->>'index')::int <> ord - 1) then return false; end if;
  if r ? 'sheets' then
    if jsonb_typeof(r->'sheets') <> 'array' then return false; end if;
    if jsonb_array_length(r->'sheets') > 20 then return false; end if;
    if exists (select 1 from jsonb_array_elements(r->'sheets') e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 60) then return false; end if;
  end if;
  if r ? 'sheet' and r->'sheet' <> 'null'::jsonb then
    if jsonb_typeof(r->'sheet') <> 'string' then return false; end if;
    if char_length(r->>'sheet') > 60 then return false; end if;
  end if;
  if r ? 'guess' then
    if jsonb_typeof(r->'guess') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'guess') k
               where k not in ('place_index', 'period_index', 'value_indexes', 'geography', 'cadence', 'wide')) then return false; end if;
    if coalesce(r->'guess'->>'geography', '') not in ('', 'us_states', 'us_counties') then return false; end if;
    if coalesce(r->'guess'->>'cadence', '') not in ('', 'annual', 'monthly') then return false; end if;
  end if;
  if r ? 'periods' and r->'periods' <> 'null'::jsonb then
    if jsonb_typeof(r->'periods') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'periods') k where k not in ('first', 'last', 'count')) then return false; end if;
  end if;
  if r ? 'unmatched' then
    if jsonb_typeof(r->'unmatched') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(r->'unmatched') k where k not in ('count', 'names')) then return false; end if;
    if coalesce(jsonb_typeof(r->'unmatched'->'names'), '') <> 'array' then return false; end if;
    if jsonb_array_length(r->'unmatched'->'names') > 20 then return false; end if;
  end if;
  -- A FILE WITH ITS YEARS ACROSS THE COLUMNS (Q6): the worker melts it in memory and reports the LONG form; wide_groups are the
  -- measure groups it could melt (one is chosen), wide_chosen the default. Only a wide file carries them.
  if r ? 'wide_groups' then
    if coalesce((r->'guess'->>'wide')::boolean, false) is not true then return false; end if;
    if coalesce(jsonb_typeof(r->'wide_groups'), '') <> 'array' then return false; end if;
    if jsonb_array_length(r->'wide_groups') not between 1 and 8 then return false; end if;
    for g in select * from jsonb_array_elements(r->'wide_groups') loop
      if jsonb_typeof(g) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_object_keys(g) k where k not in ('prefix', 'first', 'last', 'count')) then return false; end if;
      if coalesce(jsonb_typeof(g->'prefix'), '') <> 'string' or char_length(g->>'prefix') > 40 then return false; end if;
      if coalesce(jsonb_typeof(g->'first'), '') <> 'string' or char_length(g->>'first') > 20 then return false; end if;
      if coalesce(jsonb_typeof(g->'last'), '') <> 'string' or char_length(g->>'last') > 20 then return false; end if;
      if coalesce(jsonb_typeof(g->'count'), '') <> 'number' then return false; end if;
      if (g->>'count')::numeric not between 3 and 60 then return false; end if;
    end loop;
  end if;
  if r ? 'wide_chosen' then
    if not (r ? 'wide_groups') then return false; end if;
    if coalesce(jsonb_typeof(r->'wide_chosen'), '') <> 'string' or char_length(r->>'wide_chosen') > 40 then return false; end if;
    if not exists (select 1 from jsonb_array_elements(r->'wide_groups') wg where wg->>'prefix' = r->>'wide_chosen') then return false; end if;
  end if;
  return true;
end $$;

create or replace function ryagram_private.mapping_ok(m jsonb, r jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  n int := jsonb_array_length(r->'columns');
  v int;
  idx int[];
  used int[];
  st text;
begin
  if m is null or jsonb_typeof(m) <> 'object' then return 'The mapping is missing.'; end if;
  if exists (select 1 from jsonb_object_keys(m) k where k not in
       ('place_index', 'period_index', 'value_indexes', 'geography', 'cadence', 'state_index', 'state', 'measure_names', 'banded_index',
        'melt_wide', 'wide_prefix')) then
    return 'The mapping has something unexpected in it.';
  end if;
  -- A FILE WITH ITS YEARS ACROSS THE COLUMNS (Q6, ENGINE + WEB, 2026-10-18). The report is on the LONG form (every index below is
  -- checked against the long columns). The person must confirm that the columns are years (melt_wide); a long file may not claim it.
  if m ? 'melt_wide' and coalesce(jsonb_typeof(m->'melt_wide'), '') <> 'boolean' then
    return 'The mapping has something unexpected in it.';
  end if;
  if coalesce((r->'guess'->>'wide')::boolean, false) then
    if not (r ? 'wide_groups') then
      -- a report from a reader that does not melt (an older worker): the old refusal, in the old words
      return 'This file has its years across the columns. Put the years in one column, with one row per place and year, and upload it again.';
    end if;
    if coalesce((m->>'melt_wide')::boolean, false) is not true then
      return 'This file has its years across the columns. Tick "These columns are years" and confirm, or put the years in one column and upload it again.';
    end if;
  elsif coalesce((m->>'melt_wide')::boolean, false) then
    return 'This file does not have its years across the columns.';
  end if;
  if m ? 'wide_prefix' then
    if coalesce(jsonb_typeof(m->'wide_prefix'), '') <> 'string' or char_length(m->>'wide_prefix') > 40
       or coalesce((m->>'melt_wide')::boolean, false) is not true then
      return 'The mapping has something unexpected in it.';
    end if;
    -- an empty prefix means the reader's default group (wide_chosen); any other must be one of the file's own groups
    if (m->>'wide_prefix') <> '' and not exists (select 1 from jsonb_array_elements(r->'wide_groups') wg where wg->>'prefix' = m->>'wide_prefix') then
      return 'That choice is not one of the file''s year columns.';
    end if;
  end if;
  if coalesce(jsonb_typeof(m->'place_index'), '') <> 'number' or coalesce(jsonb_typeof(m->'period_index'), '') <> 'number' then
    return 'Choose which column is the place and which is the period.';
  end if;
  if coalesce(m->>'geography', '') not in ('us_states', 'us_counties') then return 'Choose whether the places are U.S. states or counties.'; end if;
  if coalesce(m->>'cadence', '') not in ('annual', 'monthly') then return 'Choose whether the periods are yearly or monthly.'; end if;
  if coalesce(jsonb_typeof(m->'value_indexes'), '') <> 'array' then return 'Choose 1 to 8 columns of values.'; end if;
  if jsonb_array_length(m->'value_indexes') not between 1 and 8 then return 'Choose 1 to 8 columns of values.'; end if;
  if exists (select 1 from jsonb_array_elements(m->'value_indexes') e where jsonb_typeof(e) <> 'number') then
    return 'Choose 1 to 8 columns of values.';
  end if;
  select array_agg((e #>> '{}')::int) into idx from jsonb_array_elements(m->'value_indexes') e;
  used := array[(m->>'place_index')::int, (m->>'period_index')::int] || idx;
  if m ? 'state_index' and m->'state_index' <> 'null'::jsonb then
    if jsonb_typeof(m->'state_index') <> 'number' then return 'The state column isn''t a column.'; end if;
    used := used || (m->>'state_index')::int;
  end if;
  foreach v in array used loop
    if v < 0 or v >= n then return 'One of the chosen columns isn''t in the file.'; end if;
  end loop;
  if (select count(distinct x) from unnest(used) x) <> array_length(used, 1) then
    return 'Each column can only be used for one thing.';
  end if;
  if m->>'geography' = 'us_counties' then
    st := m->>'state';
    if (m->'state_index' is null or m->'state_index' = 'null'::jsonb) and st is null then
      return 'County names need a state. Choose the state, or the column that has it.';
    end if;
    if st is not null and st not in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA',
                                     'MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
                                     'UT','VT','VA','WA','WV','WI','WY') then
      return 'That isn''t a U.S. state.';
    end if;
  end if;
  if m ? 'banded_index' and m->'banded_index' <> 'null'::jsonb
     and (jsonb_typeof(m->'banded_index') <> 'number' or not ((m->>'banded_index')::int = any (idx))) then
    return 'The main column has to be one of the value columns.';
  end if;
  if m ? 'measure_names' and (jsonb_typeof(m->'measure_names') <> 'object'
       or exists (select 1 from jsonb_each(m->'measure_names') e
                  where e.key !~ '^[0-9]{1,2}$' or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') not between 1 and 80
                        or not (e.key::int = any (idx)))) then
    return 'Each value column''s name needs 1 to 80 characters.';
  end if;
  return null;
end $$;

revoke execute on function ryagram_private.ingest_report_ok(jsonb), ryagram_private.mapping_ok(jsonb, jsonb)
  from public, anon, authenticated;
