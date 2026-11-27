-- CALIBRATE: PEOPLE HELP TUNE THE COMPILATION MAKER AND EARN FREE CREDITS -- THE EARN RULES (BUILDER 2026-11-27, revision 2: FACES' abuse model, WORKER's 11:52 HIGHs, CONNECT's 12:01 contract, the review).
-- DESIGN STAGE. NOT APPLIED: Ryan applies it (live step 84 checks it). Undo: supabase/rollbacks/20261127001100_calibrate_earn_rollback.sql. Plan in words: proposals/BUILDER-CALIBRATE-EARN-RULES-1127.md.
-- Every number in ryagram_private.calibrate_rules and ryagram_private.calibrate_task_kinds is a PROPOSAL FOR RYAN'S YES (change it in the dashboard, no code change).
-- Who can play: switch 'calibrate' on (account_settings.switches_on), active (the waiting gate), not a worker, consent recorded and not withdrawn,
--   the account at least min_account_days old AND one SERVER-RENDERED film: a 'capture' row (a render hold spent) or a 'purchase' row in public.credit_ledger. A compilation the PC reports never counts.
-- A round: the SERVER picks gold_per_round known-answer items from its own pack (public_domain or licensed, never own_app) and puts them at random places; the page and the PC never decide.
--   Own-footage items (own_app) carry only an opaque local reference (loc_...), no label, no times, no words; answers to them earn nothing in v1.
-- Finish scores the round ONCE and returns only the round's result and its tenths (never an accepted count, never which items were gold). An expired round is refused.
--   Pay: round_tenths (0.5 credit) for a verified round, scaled by the share of the round's items that are paid (known-answer or site-served) and answered with care.
--   Verified: at least gold_round_min of this round's golds right AND gold_min_pct over the last gold_window golds (closed rounds + this one; a skip or no answer is wrong).
--   More than max_fast answers under the task kind's minimum seconds (the server's clock): the round pays 0. A skip is never "too fast".
--   Caps (rolling, never a calendar day): daily_cap_tenths in 24 hours, weekly_cap_tenths in 7 days, counting EVERY award row, undone ones included.
-- An award waits hold_hours, then a release turns tenths into whole credits through public.grant_credits ('grant', 'granted' pool, created_by 'calibrate:<award>'),
--   only while the global weekly budget (weekly_budget_credits, never above 200) has room. Nothing writes a balance.
-- calibrate_awards, calibrate_releases and calibrate_credit_moves are APPEND-ONLY (a trigger refuses update and delete): an undo is a NEW 'reversal' row.
--   Taking credits back uses public.adjust_credits on the 'granted' pool, at most what calibrate itself granted net, at most the pool balance; the rest becomes a calibrate debt
--   that later releases pay first. A balance never goes below zero.
--   LIMIT, said plainly: the ledger has ONE 'granted' pool for welcome and calibrate credits alike, so if the person already spent their calibrate credits the take-back lands on welcome credits.
-- Answering is a PERSON's act: consent, answer and finish need require_app_session AND refuse a connector login (RENDERER T5b: connect_actor sets claims without client_id).
--   The connector gets one read-only call, public.connect_calibration_status (CONNECT's 12:01 contract, in tenths). No AI round opener exists.
-- Apply AFTER: phase-2b/credits_ledger.sql, 20261017000600_pipe1_orders.sql, 20261018000100_connect_ai.sql (connect_actor, connect_runner), 20261110000400_account_switches.sql,
--   20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
begin;

-- ---------------------------------------------------------------------------------------------------- the numbers (proposals for Ryan's yes)
create table ryagram_private.calibrate_rules (
  id boolean primary key default true check (id),
  round_size int not null default 18 check (round_size between 6 and 50),
  gold_per_round int not null default 3 check (gold_per_round between 1 and 25),                  -- 3 of 18 = 1 in 6
  gold_round_min int not null default 2 check (gold_round_min between 1 and 25),                  -- this round's golds right, at least
  gold_min_pct int not null default 80 check (gold_min_pct between 50 and 100),
  gold_window int not null default 20 check (gold_window between 1 and 200),
  round_tenths int not null default 5 check (round_tenths between 0 and 50),                      -- 0.5 credit a verified round
  daily_cap_tenths int not null default 30 check (daily_cap_tenths between 0 and 1000),           -- 3 credits in any 24 hours
  weekly_cap_tenths int not null default 100 check (weekly_cap_tenths between 0 and 5000),        -- 10 credits in any 7 days
  hold_hours int not null default 24 check (hold_hours between 0 and 720),
  weekly_budget_credits int not null default 50 check (weekly_budget_credits between 0 and 200),  -- everyone together, per week (Monday, UTC)
  max_fast int not null default 2 check (max_fast between 0 and 50),                              -- a third too-fast answer makes the round pay 0
  min_account_days int not null default 7 check (min_account_days between 0 and 365),
  round_minutes int not null default 30 check (round_minutes between 5 and 240),
  rounds_per_day int not null default 10 check (rounds_per_day between 1 and 100),
  check (gold_per_round < round_size and gold_round_min <= gold_per_round)
);
insert into ryagram_private.calibrate_rules default values;
revoke all on ryagram_private.calibrate_rules from public, anon, authenticated, service_role;

create table ryagram_private.calibrate_task_kinds (
  kind text primary key check (kind ~ '^[a-z_]{3,30}$'),
  min_seconds numeric(4,1) not null check (min_seconds between 0 and 60)
);
insert into ryagram_private.calibrate_task_kinds (kind, min_seconds) values
  ('is_phrase', 2.0), ('pick_cut', 4.0), ('confirm_speaker', 3.0), ('trim', 6.0), ('rate_match', 3.0);   -- FACES 2.8; FACES tunes them against Ryan's own times
revoke all on ryagram_private.calibrate_task_kinds from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- the items (closed: the gold answer lives here)
create table ryagram_private.calibrate_items (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null references ryagram_private.calibrate_task_kinds (kind),
  source_kind text not null check (source_kind in ('own_app', 'public_domain', 'licensed')),                     -- nothing else can be stored
  owner_id uuid references auth.users (id) on delete cascade,                                                    -- own_app: whose footage (served only to them)
  licence_note text check (licence_note is null or char_length(licence_note) between 3 and 300),
  media_ref text not null check (char_length(media_ref) between 1 and 300),
  prompt jsonb not null default '{}'::jsonb,
  choices text[] not null check (cardinality(choices) between 2 and 6),
  is_gold boolean not null default false,
  gold_answer text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((source_kind = 'own_app') = (owner_id is not null)),
  check (source_kind = 'own_app' or licence_note is not null),
  -- own footage: an opaque local reference only; no label, no times, no words; canonical choice letters; never gold (WORKER HIGH 3)
  check (source_kind <> 'own_app' or (licence_note is null and media_ref ~ '^loc_[A-Za-z0-9]{16,64}$' and prompt = '{}'::jsonb
                                      and array_to_string(choices, ',') ~ '^[a-z0-9_]{1,20}(,[a-z0-9_]{1,20})*$' and not is_gold)),
  check (is_gold = (gold_answer is not null)),
  check (gold_answer is null or gold_answer = any (choices)),
  check (not ('skip' = any (choices)))
);
create index calibrate_items_pick_idx on ryagram_private.calibrate_items (is_gold, active);
revoke all on ryagram_private.calibrate_items from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- what a person may read: their own rows only
create table public.calibrate_consents (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  words_version text not null check (char_length(words_version) between 1 and 40),
  words text not null check (char_length(words) between 10 and 1000),
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table public.calibrate_rounds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  items_total int not null check (items_total between 1 and 50),
  tenths int check (tenths >= 0),                                               -- the round total, once it closes; never an accepted count
  result text check (result in ('held', 'gold_too_low', 'too_fast', 'cap_reached', 'nothing_paid')),
  check ((finished_at is null) = (result is null) and (finished_at is null) = (tenths is null))
);
create index calibrate_rounds_owner_idx on public.calibrate_rounds (owner_id, started_at);

create table ryagram_private.calibrate_round_items (
  round_id uuid not null references public.calibrate_rounds (id) on delete cascade,
  item_id uuid not null references ryagram_private.calibrate_items (id),
  owner_id uuid not null,
  position int not null check (position between 1 and 50),
  item_token uuid not null default gen_random_uuid() unique,                   -- what the page sees and sends: per person and round, so two accounts can never match items by id
  primary key (round_id, item_id),
  unique (owner_id, item_id),                                                  -- an item is served to a person once, ever
  unique (round_id, position)
);
revoke all on ryagram_private.calibrate_round_items from public, anon, authenticated, service_role;

create table public.calibrate_answers (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.calibrate_rounds (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references ryagram_private.calibrate_items (id),
  answer text not null check (char_length(answer) between 1 and 200),         -- one of the choices, or 'skip'
  answered_at timestamptz not null default now(),                              -- the server's clock, never the page's
  unique (round_id, item_id),
  unique (owner_id, item_id)
);

-- The award ledger, APPEND-ONLY: an 'award' row (+tenths, release_at) and at most one 'reversal' row (-tenths) pointing at it.
create table public.calibrate_awards (
  id bigint generated always as identity primary key,
  owner_id uuid not null,                                                      -- no foreign keys: like the credit ledger, these rows are never cascaded away
  round_id uuid not null,
  kind text not null check (kind in ('award', 'reversal')),
  tenths int not null,
  release_at timestamptz,
  reverses bigint unique references public.calibrate_awards (id),
  note text check (note is null or char_length(note) between 3 and 200),
  created_at timestamptz not null default now(),
  check (case kind when 'award' then tenths > 0 and release_at is not null and reverses is null
                   else tenths < 0 and release_at is null and reverses is not null and note is not null end)
);
create unique index calibrate_awards_round_once on public.calibrate_awards (round_id) where kind = 'award';   -- one award per round, ever
create index calibrate_awards_owner_idx on public.calibrate_awards (owner_id, created_at);

-- A release moves an award's tenths into the person's tenths; a credit move is each whole-credit grant (+) or take-back (-), with its credit_ledger row.
create table public.calibrate_releases (
  award_id bigint primary key references public.calibrate_awards (id),
  owner_id uuid not null,
  released_at timestamptz not null default now()
);
create table public.calibrate_credit_moves (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  award_id bigint not null references public.calibrate_awards (id),
  credits int not null check (credits <> 0),
  ledger_id bigint not null unique,
  created_at timestamptz not null default now()
);

create function ryagram_private.calibrate_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Calibrate awards are append-only: write a reversal row instead.' using errcode = '55000';
end $$;
create trigger calibrate_awards_append_only before update or delete on public.calibrate_awards for each row execute function ryagram_private.calibrate_append_only();
create trigger calibrate_releases_append_only before update or delete on public.calibrate_releases for each row execute function ryagram_private.calibrate_append_only();
create trigger calibrate_credit_moves_append_only before update or delete on public.calibrate_credit_moves for each row execute function ryagram_private.calibrate_append_only();

-- Working state (closed): the tenths not yet granted (negative = a calibrate debt), and the global weekly budget.
create table ryagram_private.calibrate_points (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  tenths int not null default 0 check (tenths < 10)
);
create table ryagram_private.calibrate_budget (
  week_start date primary key,
  used_tenths int not null default 0 check (used_tenths >= 0)
);
revoke all on ryagram_private.calibrate_points, ryagram_private.calibrate_budget from public, anon, authenticated, service_role;

alter table public.calibrate_consents enable row level security;
alter table public.calibrate_rounds enable row level security;
alter table public.calibrate_answers enable row level security;
alter table public.calibrate_awards enable row level security;
alter table public.calibrate_releases enable row level security;
alter table public.calibrate_credit_moves enable row level security;
revoke all on public.calibrate_consents, public.calibrate_rounds, public.calibrate_answers, public.calibrate_awards, public.calibrate_releases, public.calibrate_credit_moves
  from public, anon, authenticated, service_role;
grant select on public.calibrate_consents, public.calibrate_rounds, public.calibrate_awards, public.calibrate_releases, public.calibrate_credit_moves
  to authenticated;                                                            -- read only; every write is a function below
grant select (id, round_id, owner_id, answer, answered_at) on public.calibrate_answers to authenticated;   -- never item_id: the same item id across accounts would let a ring share gold answers
create policy "Owners read their calibrate consent" on public.calibrate_consents for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their calibrate rounds" on public.calibrate_rounds for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their calibrate answers" on public.calibrate_answers for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their calibrate awards" on public.calibrate_awards for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their calibrate releases" on public.calibrate_releases for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read their calibrate credit moves" on public.calibrate_credit_moves for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------- the checks every person call makes
create function ryagram_private.calibrate_switch_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner is not null
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
     and coalesce((select 'calibrate' = any (s.switches_on) from public.account_settings s where s.owner_id = p_owner), false)
$$;

-- min_account_days old AND one server-rendered film (a spent render hold) or a purchase. Never a PC-reported compilation (WORKER HIGH 2).
create function ryagram_private.calibrate_eligible(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u, ryagram_private.calibrate_rules r
                  where u.id = p_owner and r.id and u.created_at <= now() - make_interval(days => r.min_account_days))
     and exists (select 1 from public.credit_ledger l where l.owner_id = p_owner and l.entry in ('capture', 'purchase'))
$$;

-- RENDERER T5b: connect_actor makes a connector transaction look like the owner without a client_id, so require_app_session alone is not enough.
create function ryagram_private.calibrate_refuse_connector() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  -- the login itself, or a direct member of it (pg_has_role would say yes for every superuser, so it is not used)
  if session_user::text = 'connect_runner'
     or exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
                 where g.rolname = 'connect_runner' and u.rolname = session_user::text) then
    raise exception 'Only the person, in Ryagram, can do this. A connected AI cannot.' using errcode = '42501', hint = 'calibrate_person_only';
  end if;
end $$;

create function ryagram_private.calibrate_person() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform ryagram_private.calibrate_refuse_connector();
  return ryagram_private.require_app_session();                    -- refuses a connected AI's token (it has a client_id)
end $$;

-- Everything a round needs, refused in words in this order: sign-in, worker, switch, waiting, consent, age and a server-rendered film.
create function ryagram_private.calibrate_require(p_owner uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  if p_owner is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workers w where w.user_id = p_owner) then
    raise exception 'A worker account is not a person and cannot help tune Ryagram.' using errcode = '42501';
  end if;
  if not ryagram_private.calibrate_switch_on(p_owner) then
    raise exception 'Helping tune Ryagram is not open for your account yet.' using errcode = '42501', hint = 'calibrate_off';
  end if;
  if not ryagram_private.account_active(p_owner) then
    raise exception 'Your account is on the waiting list, so this is not open to you yet.' using errcode = '42501', hint = 'waiting';
  end if;
  if not exists (select 1 from public.calibrate_consents c where c.owner_id = p_owner and c.withdrawn_at is null) then
    raise exception 'First say yes to the words about how your answers are used.' using errcode = '42501', hint = 'calibrate_consent';
  end if;
  if not ryagram_private.calibrate_eligible(p_owner) then
    raise exception 'This opens when your account is % days old and Ryagram has made a film for you.', r.min_account_days using errcode = '42501', hint = 'calibrate_too_new';
  end if;
end $$;

-- The gold check over the last gold_window golds served in CLOSED rounds (finished or expired) plus p_round. A skip or no answer is wrong. Rounds, not days: the window spans rounds.
create function ryagram_private.calibrate_gold_ok(p_owner uuid, p_round uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules; n int; ok int;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  select count(*), count(*) filter (where a.answer is not distinct from i.gold_answer) into n, ok
    from (select x.item_id, x.round_id from ryagram_private.calibrate_round_items x
            join ryagram_private.calibrate_items i on i.id = x.item_id
            join public.calibrate_rounds ro on ro.id = x.round_id
           where x.owner_id = p_owner and i.is_gold
             and (ro.finished_at is not null or ro.expires_at <= now() or ro.id = p_round)
           order by ro.started_at desc, x.position desc limit r.gold_window) s
    join ryagram_private.calibrate_items i on i.id = s.item_id
    left join public.calibrate_answers a on a.round_id = s.round_id and a.item_id = s.item_id;
  return n > 0 and ok * 100 >= r.gold_min_pct * n;
end $$;

-- ---------------------------------------------------------------------------------------------------- consent (first, and withdrawable)
create function public.calibrate_consent_set(p_yes boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid; w constant text := 'My answers may be used to improve Ryagram. I answer each task myself: no AI tool or script answers for me. Credits I earn can be taken back if checks show the answers were not really mine. I can stop at any time.';
        v constant text := 'proposal-1127';
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();                        -- a person in the app, never a connected AI
  if not ryagram_private.calibrate_switch_on(me) then
    raise exception 'Helping tune Ryagram is not open for your account yet.' using errcode = '42501', hint = 'calibrate_off';
  end if;
  if p_yes is null then
    raise exception 'Say yes or no.' using errcode = '22023';
  end if;
  if p_yes then
    insert into public.calibrate_consents (owner_id, words_version, words) values (me, v, w)
      on conflict (owner_id) do update set words_version = excluded.words_version, words = excluded.words, consented_at = now(), withdrawn_at = null;
  else
    update public.calibrate_consents set withdrawn_at = now() where owner_id = me and withdrawn_at is null;
  end if;
  return jsonb_build_object('consented', p_yes, 'words', w, 'words_version', v);
end $$;

-- ---------------------------------------------------------------------------------------------------- releases (after the hold, inside the global budget)
-- Releases every due award of one person, oldest first. Called by the person's own start and finish, and by Ryan's tick. Returns the whole credits granted.
create function ryagram_private.calibrate_release_owner(p_owner uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules; a record; wk date := (date_trunc('week', now() at time zone 'utc'))::date; used int; pts int; whole int; lid bigint; given int := 0;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  perform ryagram_private.lock_owner(p_owner);
  for a in select w.id, w.tenths from public.calibrate_awards w
            where w.owner_id = p_owner and w.kind = 'award' and w.release_at <= now()
              and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
              and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id)
            order by w.id loop
    if not ryagram_private.calibrate_switch_on(p_owner) or not ryagram_private.calibrate_gold_ok(p_owner, null) then
      exit;                                                                    -- stays held while the switch is off or the gold record fell; Ryan looks
    end if;
    insert into ryagram_private.calibrate_budget (week_start) values (wk) on conflict (week_start) do nothing;
    select used_tenths into used from ryagram_private.calibrate_budget where week_start = wk for update;   -- the budget lock: two releases never both pass
    if used + a.tenths > r.weekly_budget_credits * 10 then
      exit;                                                                    -- the week's budget is used: stays held into next week
    end if;
    update ryagram_private.calibrate_budget set used_tenths = used + a.tenths where week_start = wk;
    insert into public.calibrate_releases (award_id, owner_id) values (a.id, p_owner);
    insert into ryagram_private.calibrate_points (owner_id) values (p_owner) on conflict (owner_id) do nothing;
    select tenths + a.tenths into pts from ryagram_private.calibrate_points where owner_id = p_owner for update;
    whole := case when pts >= 10 then pts / 10 else 0 end;                     -- a debt (negative) is paid first
    if whole > 0 then
      lid := public.grant_credits(p_owner, 'grant', whole, 'Calibrate: helped tune Ryagram', 'calibrate:' || a.id::text);
      if lid is null then
        raise exception 'The credits ledger did not take the award, so nothing was given.' using errcode = '55000';
      end if;
      insert into public.calibrate_credit_moves (owner_id, award_id, credits, ledger_id) values (p_owner, a.id, whole, lid);
      given := given + whole;
    end if;
    update ryagram_private.calibrate_points set tenths = pts - whole * 10 where owner_id = p_owner;
  end loop;
  return given;
end $$;

-- Ryan's tick (dashboard or a scheduled job): every person with a due award.
create function ryagram_private.calibrate_release_due() returns int
language plpgsql security definer set search_path = '' as $$
declare o uuid; n int := 0;
begin
  for o in select distinct w.owner_id from public.calibrate_awards w
            where w.kind = 'award' and w.release_at <= now()
              and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
              and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id) loop
    n := n + ryagram_private.calibrate_release_owner(o);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------- a round
create function public.calibrate_round_start()
returns table (round_id uuid, item_token uuid, item_position int, task_kind text, prompt jsonb, choices text[], media_ref text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid; r ryagram_private.calibrate_rules; rid uuid; gold_ids uuid[]; plain_ids uuid[];
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  perform ryagram_private.calibrate_require(me);
  perform ryagram_private.calibrate_release_owner(me);
  select * into r from ryagram_private.calibrate_rules where id;
  perform pg_advisory_xact_lock(hashtextextended('calibrate:' || me::text, 0));          -- two starts at once never both pass the limits
  if exists (select 1 from public.calibrate_rounds o where o.owner_id = me and o.finished_at is null and o.expires_at > now()) then
    raise exception 'You already have a round open. Finish it first.' using errcode = '22023', hint = 'calibrate_round_open';
  end if;
  if (select count(*) from public.calibrate_rounds o where o.owner_id = me and o.started_at > now() - interval '24 hours') >= r.rounds_per_day then
    raise exception 'That is % rounds in a day. Come back later.', r.rounds_per_day using errcode = '22023', hint = 'calibrate_rounds_day';
  end if;
  -- the SERVER picks the known-answer items, from its own pack only (never own footage)
  gold_ids := array(select i.id from ryagram_private.calibrate_items i
                      where i.is_gold and i.active and i.source_kind in ('public_domain', 'licensed')
                        and not exists (select 1 from ryagram_private.calibrate_round_items x where x.owner_id = me and x.item_id = i.id)
                      order by random() limit r.gold_per_round);
  plain_ids := array(select i.id from ryagram_private.calibrate_items i
                      where not i.is_gold and i.active and (i.source_kind <> 'own_app' or i.owner_id = me)
                        and not exists (select 1 from ryagram_private.calibrate_round_items x where x.owner_id = me and x.item_id = i.id)
                      order by random() limit r.round_size - r.gold_per_round);
  if cardinality(gold_ids) < r.gold_per_round or cardinality(plain_ids) < r.round_size - r.gold_per_round then
    raise exception 'There are no tasks for you right now. Try again later.' using errcode = '22023', hint = 'calibrate_no_items';
  end if;
  insert into public.calibrate_rounds (owner_id, expires_at, items_total)
    values (me, now() + make_interval(mins => r.round_minutes), r.round_size) returning id into rid;
  insert into ryagram_private.calibrate_round_items (round_id, item_id, owner_id, position)
    select rid, u.id, me, row_number() over (order by random()) from unnest(gold_ids || plain_ids) as u(id);   -- gold at random places
  return query select x.round_id, x.item_token, x.position, i.task_kind, i.prompt, i.choices, i.media_ref, o.expires_at
                 from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id
                 join public.calibrate_rounds o on o.id = x.round_id
                where x.round_id = rid order by x.position;                                                -- no is_gold, no gold_answer, no source_kind
end $$;

create function public.calibrate_round_items(p_round uuid)
returns table (item_token uuid, item_position int, task_kind text, prompt jsonb, choices text[], media_ref text, my_answer text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid;
begin
  perform ryagram_private.require_active();
  perform ryagram_private.calibrate_refuse_connector();
  me := ryagram_private.require_app_session();
  perform ryagram_private.calibrate_require(me);
  if not exists (select 1 from public.calibrate_rounds o where o.id = p_round and o.owner_id = me) then
    raise exception 'No round of yours with that number.' using errcode = 'PT404';
  end if;
  return query select x.item_token, x.position, i.task_kind, i.prompt, i.choices, i.media_ref, a.answer
                 from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id
                 left join public.calibrate_answers a on a.round_id = x.round_id and a.item_id = x.item_id
                where x.round_id = p_round order by x.position;
end $$;

-- One answer (a shown choice, or 'skip'), once per item, only by the person in the app, only while the round is open. Returns nothing that tells right from wrong.
create function public.calibrate_answer(p_round uuid, p_item_token uuid, p_answer text) returns bigint
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid; o public.calibrate_rounds; ch text[]; aid bigint; p_item uuid;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  perform ryagram_private.calibrate_require(me);
  select * into o from public.calibrate_rounds where id = p_round and owner_id = me for update;
  select x.item_id into p_item from ryagram_private.calibrate_round_items x where x.round_id = p_round and x.item_token = p_item_token;
  if o.id is null then
    raise exception 'No round of yours with that number.' using errcode = 'PT404';
  end if;
  if o.finished_at is not null or o.expires_at <= now() then
    raise exception 'That round is closed.' using errcode = '22023', hint = 'calibrate_closed';
  end if;
  select i.choices into ch from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id
   where x.round_id = p_round and x.item_id = p_item;                         -- p_item is null for a token not in this round: refused below
  if ch is null then
    raise exception 'That task is not in this round.' using errcode = 'PT404';
  end if;
  if p_answer is null or not (p_answer = any (ch) or p_answer = 'skip') then
    raise exception 'Pick one of the answers shown, or skip.' using errcode = '22023';
  end if;
  if exists (select 1 from public.calibrate_answers a where a.owner_id = me and a.item_id = p_item) then
    raise exception 'You already answered that one.' using errcode = '22023', hint = 'calibrate_twice';
  end if;
  insert into public.calibrate_answers (round_id, owner_id, item_id, answer) values (p_round, me, p_item, p_answer) returning id into aid;
  return aid;
end $$;

-- Score a round, once. Returns ONLY {result, tenths, release_at}: never an accepted count, never which items were gold.
create function public.calibrate_round_finish(p_round uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid; r ryagram_private.calibrate_rules; o public.calibrate_rounds;
        g_round int; fast int; paid_ok int; pay int := 0; day_used int; week_used int; res text; rel timestamptz;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();                        -- a connected AI can never finish (and so never earn)
  perform ryagram_private.calibrate_require(me);
  select * into r from ryagram_private.calibrate_rules where id;
  perform ryagram_private.lock_owner(me);                          -- the ledger's own lock: two finishes for one account never both pass the caps
  select * into o from public.calibrate_rounds where id = p_round and owner_id = me for update;
  if o.id is null then
    raise exception 'No round of yours with that number.' using errcode = 'PT404';
  end if;
  if o.finished_at is not null then
    raise exception 'That round was already scored.' using errcode = '22023', hint = 'calibrate_finished';
  end if;
  if o.expires_at <= now() then
    raise exception 'That round ran out of time, so it earns nothing. Start a new one.' using errcode = '22023', hint = 'calibrate_expired';
  end if;
  -- per answer: the gap since the answer before it (or the round's start), against the task kind's minimum seconds
  with t as (
    select a.answer, i.is_gold, i.gold_answer, i.source_kind, k.min_seconds,
           extract(epoch from a.answered_at - coalesce(lag(a.answered_at) over (order by a.answered_at, a.id), o.started_at)) as gap
      from public.calibrate_answers a join ryagram_private.calibrate_items i on i.id = a.item_id
      join ryagram_private.calibrate_task_kinds k on k.kind = i.task_kind
     where a.round_id = p_round)
  select count(*) filter (where is_gold and answer = gold_answer),
         count(*) filter (where answer <> 'skip' and gap < min_seconds),
         count(*) filter (where source_kind <> 'own_app' and answer <> 'skip' and gap >= min_seconds and (not is_gold or answer = gold_answer))
    into g_round, fast, paid_ok from t;
  if g_round < r.gold_round_min or not ryagram_private.calibrate_gold_ok(me, p_round) then
    res := 'gold_too_low';
  elsif fast > r.max_fast then
    res := 'too_fast';
  else
    pay := (r.round_tenths * paid_ok) / o.items_total;                -- own-footage answers sit in the round but earn nothing (v1)
    day_used := coalesce((select sum(w.tenths) from public.calibrate_awards w where w.owner_id = me and w.kind = 'award' and w.created_at > now() - interval '24 hours'), 0);
    week_used := coalesce((select sum(w.tenths) from public.calibrate_awards w where w.owner_id = me and w.kind = 'award' and w.created_at > now() - interval '7 days'), 0);
    if pay > 0 and (day_used >= r.daily_cap_tenths or week_used >= r.weekly_cap_tenths) then
      pay := 0; res := 'cap_reached';                                -- undone awards still count: an 'award' row is never removed
    else
      pay := greatest(least(pay, r.daily_cap_tenths - day_used, r.weekly_cap_tenths - week_used), 0);
      if pay = 0 then
        res := 'nothing_paid';
      else
        rel := now() + make_interval(hours => r.hold_hours);
        insert into public.calibrate_awards (owner_id, round_id, kind, tenths, release_at) values (me, p_round, 'award', pay, rel);
        res := 'held';                                                 -- every award waits hold_hours; calibrate_release_owner pays it inside the budget
      end if;
    end if;
  end if;
  update public.calibrate_rounds set finished_at = now(), tenths = pay, result = res where id = p_round;
  perform ryagram_private.calibrate_release_owner(me);               -- anything older that is now due
  return jsonb_build_object('result', res, 'tenths', pay, 'release_at', rel);
end $$;

-- ---------------------------------------------------------------------------------------------------- the connector's one read (CONNECT 12:01, adapted to tenths)
create function public.connect_calibration_status(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); r ryagram_private.calibrate_rules; d int; t int; h int;
begin
  if not ryagram_private.calibrate_switch_on(me) then
    raise exception 'Calibrate is not switched on for this account.' using errcode = '42501';
  end if;
  select * into r from ryagram_private.calibrate_rules where id;
  d := coalesce((select sum(w.tenths) from public.calibrate_awards w where w.owner_id = me and w.kind = 'award' and w.created_at > now() - interval '24 hours'), 0);
  t := coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me), 0);
  h := coalesce((select sum(w.tenths) from public.calibrate_awards w where w.owner_id = me and w.kind = 'award'
                   and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
                   and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id)), 0);
  return jsonb_build_object('schema', 'ryagram.calibration-status/1',
    'open', ryagram_private.account_active(me), 'eligible', ryagram_private.calibrate_eligible(me),
    'consent_given', exists (select 1 from public.calibrate_consents c where c.owner_id = me and c.withdrawn_at is null),
    'tasks_per_round', r.round_size, 'daily_cap_tenths', r.daily_cap_tenths, 'counted_today_tenths', d,
    'remaining_today_tenths', greatest(r.daily_cap_tenths - d, 0), 'held_tenths', h, 'credits_kept_total', greatest(t, 0), 'page_path', '#/calibrate');
end $$;

-- ---------------------------------------------------------------------------------------------------- Ryan's dashboard call: the undo (closed to every API role)
-- Appends a reversal row. A held award is then never released. A released one: its tenths come out of the person's tenths; a shortfall is taken in whole credits
-- through adjust_credits on 'granted', at most calibrate's own net grants, at most the pool; what is still short stays as a calibrate debt.
create function ryagram_private.calibrate_award_undo(p_award bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.calibrate_awards; rid bigint; pts int; need int; cal_net int; k int := 0; lid bigint; note text := btrim(p_note, E' \t\r\n');
begin
  if p_note is null or char_length(note) not between 3 and 200 then
    raise exception 'Say why it is being undone, in a few words.' using errcode = '22023';
  end if;
  select * into w from public.calibrate_awards where id = p_award and kind = 'award';
  if w.id is null then raise exception 'No calibrate award with that number.' using errcode = 'PT404'; end if;
  perform ryagram_private.lock_owner(w.owner_id);
  if exists (select 1 from public.calibrate_awards v where v.reverses = p_award) then
    raise exception 'That award was already undone.' using errcode = '22023';
  end if;
  insert into public.calibrate_awards (owner_id, round_id, kind, tenths, reverses, note) values (w.owner_id, w.round_id, 'reversal', -w.tenths, w.id, note) returning id into rid;
  if exists (select 1 from public.calibrate_releases x where x.award_id = p_award) then
    insert into ryagram_private.calibrate_points (owner_id) values (w.owner_id) on conflict (owner_id) do nothing;
    select tenths - w.tenths into pts from ryagram_private.calibrate_points where owner_id = w.owner_id for update;
    if pts < 0 then
      need := (-pts + 9) / 10;
      cal_net := coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = w.owner_id), 0);
      k := least(need, greatest(cal_net, 0), greatest(ryagram_private.pool_balance(w.owner_id, 'granted'), 0));
      if k > 0 then
        lid := public.adjust_credits(w.owner_id, 'granted', -k, 'Undo of calibrate award ' || w.id || ': ' || note, 'calibrate-undo:' || w.id::text);
        insert into public.calibrate_credit_moves (owner_id, award_id, credits, ledger_id) values (w.owner_id, w.id, -k, lid);
        pts := pts + k * 10;
      end if;
    end if;
    update ryagram_private.calibrate_points set tenths = pts where owner_id = w.owner_id;   -- negative = a debt that later releases pay first
  end if;
  return jsonb_build_object('reversal', rid, 'credits_taken_back', k, 'debt_tenths', greatest(-coalesce(pts, 0), 0));
end $$;

revoke execute on function ryagram_private.calibrate_append_only(), ryagram_private.calibrate_switch_on(uuid), ryagram_private.calibrate_eligible(uuid),
  ryagram_private.calibrate_refuse_connector(), ryagram_private.calibrate_person(), ryagram_private.calibrate_require(uuid), ryagram_private.calibrate_gold_ok(uuid, uuid),
  ryagram_private.calibrate_release_owner(uuid), ryagram_private.calibrate_release_due(), ryagram_private.calibrate_award_undo(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.calibrate_consent_set(boolean), public.calibrate_round_start(), public.calibrate_round_items(uuid),
  public.calibrate_answer(uuid, uuid, text), public.calibrate_round_finish(uuid), public.connect_calibration_status(text) from public, anon, service_role;
revoke execute on function public.connect_calibration_status(text) from authenticated;
grant execute on function public.calibrate_consent_set(boolean), public.calibrate_round_start(), public.calibrate_round_items(uuid),
  public.calibrate_answer(uuid, uuid, text), public.calibrate_round_finish(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'connect_runner') then   -- the connector gets the status read and nothing else (T5b)
    revoke execute on function public.calibrate_consent_set(boolean), public.calibrate_round_start(), public.calibrate_round_items(uuid),
      public.calibrate_answer(uuid, uuid, text), public.calibrate_round_finish(uuid) from connect_runner;
    grant execute on function public.connect_calibration_status(text) to connect_runner;
  end if;
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
