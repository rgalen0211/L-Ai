-- CALIBRATE: PEOPLE HELP TUNE THE COMPILATION MAKER AND EARN FREE CREDITS -- THE EARN RULES (BUILDER 2026-11-27, revision 3: RENDERER's 12:43 review, ONE contract with WEB aee1ec4f and CONNECT).
-- DESIGN STAGE. NOT APPLIED, NOT RUN: Ryan applies it (live step 84 checks it). Undo: supabase/rollbacks/20261127001100_calibrate_earn_rollback.sql. Plan in words: proposals/BUILDER-CALIBRATE-EARN-RULES-1127.md.
-- Every number in ryagram_private.calibrate_rules and ryagram_private.calibrate_task_kinds is a PROPOSAL FOR RYAN'S YES (change it in the dashboard, no code change).
-- THE PAGE'S CALLS, exactly as WEB's docs/calibrate-contract-needs-1127.md names them (every one returns jsonb; an error MESSAGE starts with the contract's code word):
--   public.my_calibration_consent_get()                       public.my_calibration_consent_set(p_on boolean, p_words_id text)
--   public.my_calibration_round_get()                         public.my_calibration_answer_set(p_round text, p_item text, p_answer text)
--   public.my_calibration_earned_get()                        public.my_calibration_undo(p_ledger uuid)
--   and CONNECT's one read: public.connect_calibration_status(p_token_hash text), schema ryagram.calibration-status/0, CONNECT's keys exactly.
-- Task types are the page's: better_cut, confirm_speaker, is_phrase, rate_match (FACES' ab_padding = better_cut, speaker_same = confirm_speaker; FACES' trim has no page card yet, so it is not served).
-- Who can play: the master switch ops_settings.calibrate_enabled (off = no new rounds AND no releases, at once), switch 'calibrate' on the account, active (the waiting gate),
--   not a worker, consent to the CURRENT words (a new words version needs a new yes), min_account_days old AND one server-rendered film (a 'capture' or 'purchase' row), not paused.
-- RING LEAK (RENDERER 2): every served item carries a per-round token (15 minutes, then re-issued), the kind's generic prompt (never per-item words), a per-round opaque media handle
--   (the server resolves it; never the item's media_ref), and options in a per-round shuffled order with positional ids (a, b, c ...). Two accounts never see the same reference.
-- FINISH TELLS NOTHING (RENDERER 4): the last answer closes the round and returns round_done with round_result null. The outcome appears later in my_calibration_earned_get, only once
--   the hold is over, as a ledger row paid or 0, never why. Rounds, awards, releases and credit moves are not readable directly; caps count rounds (potential pay), not awards.
-- BUDGET (RENDERER 5): a round RESERVES its full pay from the global weekly budget when it starts; no room = state budget_used and no round. Unused reservation returns at close.
--   A lifetime cap per account (lifetime_cap_tenths, proposal 100 credits, FOR RYAN'S YES).
-- WITHDRAWAL (RENDERER 3): consent_set(false) cancels every held award at once (a reversal row with the reason), and every release re-checks consent; a withdrawn person is never paid.
-- STRIKES: strike_rounds rounds failing the known-answer bar inside strike_days pause the account for pause_days (state paused; the reason is never shown).
-- Answering is a PERSON's act: every my_calibration_* call needs require_app_session AND refuses a connector login (RENDERER T5b).
-- Apply AFTER: phase-2b/credits_ledger.sql, 20261010000100_ops_readiness.sql (ops_settings), 20261017000600_pipe1_orders.sql, 20261018000100_connect_ai.sql (connect_actor, connect_runner),
--   20261110000400_account_switches.sql, 20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
begin;

-- ---------------------------------------------------------------------------------------------------- the master switch (Ryan's, in the existing ops settings row)
alter table public.ops_settings add column calibrate_enabled boolean not null default false;   -- off: no new round, no answer, no release, at once (held awards wait)

-- ---------------------------------------------------------------------------------------------------- the numbers (proposals for Ryan's yes)
create table ryagram_private.calibrate_rules (
  id boolean primary key default true check (id),
  round_size int not null default 18 check (round_size between 6 and 50),
  gold_per_round int not null default 3 check (gold_per_round between 1 and 25),                  -- 3 of 18 = 1 in 6
  gold_round_min int not null default 2 check (gold_round_min between 1 and 25),
  gold_min_pct int not null default 80 check (gold_min_pct between 50 and 100),
  gold_window int not null default 20 check (gold_window between 1 and 200),
  round_tenths int not null default 5 check (round_tenths between 0 and 50),                      -- 0.5 credit a verified round
  daily_cap_tenths int not null default 30 check (daily_cap_tenths between 0 and 1000),           -- rounds' full pay in any 24 hours
  weekly_cap_tenths int not null default 100 check (weekly_cap_tenths between 0 and 5000),        -- in any 7 days
  lifetime_cap_tenths int not null default 1000 check (lifetime_cap_tenths between 0 and 100000), -- 100 credits per account, ever (FOR RYAN'S YES)
  hold_hours int not null default 24 check (hold_hours between 0 and 720),
  weekly_budget_credits int not null default 50 check (weekly_budget_credits between 0 and 200),  -- everyone together, per week (Monday, UTC)
  max_fast int not null default 2 check (max_fast between 0 and 50),
  min_account_days int not null default 7 check (min_account_days between 0 and 365),
  round_minutes int not null default 30 check (round_minutes between 5 and 240),
  token_minutes int not null default 15 check (token_minutes between 1 and 60),                   -- an item token lives this long, then round_get issues a new one
  rounds_per_day int not null default 10 check (rounds_per_day between 1 and 100),
  strike_rounds int not null default 3 check (strike_rounds between 1 and 20),
  strike_days int not null default 7 check (strike_days between 1 and 60),
  pause_days int not null default 7 check (pause_days between 1 and 90),
  media_url_base text not null default 'https://media.invalid/calibrate/' check (media_url_base ~ '^https://[^\s/@]+/[^\s]*/$'),   -- WEB/Ryan set the real resolver address
  own_app_url_base text not null default 'http://127.0.0.1:47811/calibrate/clip/' check (own_app_url_base ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/[^\s]*/$'),
  check (gold_per_round < round_size and gold_round_min <= gold_per_round)
);
insert into ryagram_private.calibrate_rules default values;
revoke all on ryagram_private.calibrate_rules from public, anon, authenticated, service_role;

-- The page's four task types. prompt: the ONLY words a served item carries (per-item words travel inside the media, e.g. a caption), so a prompt never identifies an item.
create table ryagram_private.calibrate_task_kinds (
  kind text primary key check (kind in ('better_cut', 'confirm_speaker', 'is_phrase', 'rate_match')),
  min_seconds numeric(4,1) not null check (min_seconds between 0 and 60),
  prompt text not null check (char_length(prompt) between 5 and 300),
  labels jsonb not null default '{}'::jsonb,                  -- canonical choice -> label (yes/no/unsure, 1..5)
  positional_labels text[],                                   -- better_cut: labels by served place, so a shuffled A/B never names the canonical side
  shuffle boolean not null default true                       -- rate_match keeps 1..5 in order
);
insert into ryagram_private.calibrate_task_kinds (kind, min_seconds, prompt, labels, positional_labels, shuffle) values
  ('better_cut', 4.0, 'Which cut is better?', '{}', '{Cut A,Cut B}', true),
  ('confirm_speaker', 3.0, 'Is this the same person speaking?', '{"yes": "Yes, the same person", "no": "No, a different person", "unsure": "Can''t tell"}', null, true),
  ('is_phrase', 2.0, 'Does the clip say the words shown on it?', '{"yes": "Yes", "no": "No", "unsure": "Can''t tell"}', null, true),
  ('rate_match', 3.0, 'How good a match is this clip?', '{"1": "1 (poor)", "2": "2", "3": "3", "4": "4", "5": "5 (great)"}', null, false);
revoke all on ryagram_private.calibrate_task_kinds from public, anon, authenticated, service_role;

-- The consent words, kept server-side by id. Exactly one row is current; a new current row means everyone says yes again.
create table ryagram_private.calibrate_consent_words (
  id text primary key check (id ~ '^calibrate-consent-[0-9]{1,4}$'),
  words text not null check (char_length(words) between 10 and 1000),
  withdraw_note text not null check (char_length(withdraw_note) between 10 and 600),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index calibrate_consent_words_one_current on ryagram_private.calibrate_consent_words (is_current) where is_current;
insert into ryagram_private.calibrate_consent_words (id, words, withdraw_note, is_current) values ('calibrate-consent-1',
  'My answers may be used to improve Ryagram. I answer each task myself: no AI tool or script answers for me. Credits I earn can be taken back if checks show the answers were not really mine. I can stop at any time.',
  'If you stop, credits not yet added are cancelled and never added. Credits already added stay yours. Your earlier answers stay with Ryagram, without your name.', true);   -- FOR RYAN'S YES (both sentences)
revoke all on ryagram_private.calibrate_consent_words from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- the items (closed: the gold answer lives here)
create table ryagram_private.calibrate_items (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null references ryagram_private.calibrate_task_kinds (kind),
  source_kind text not null check (source_kind in ('own_app', 'public_domain', 'licensed')),
  owner_id uuid references auth.users (id) on delete cascade,                                                    -- own_app: whose footage (served only to them)
  licence_note text check (licence_note is null or char_length(licence_note) between 3 and 300),
  status text not null default 'pending' check (status in ('pending', 'cleared', 'withdrawn')),               -- only 'cleared' is ever served (T13)
  media_ref text check (media_ref is null or char_length(media_ref) between 1 and 300),                       -- never served: the round hands out an opaque handle
  option_media text[],                                                                                         -- better_cut: one media ref per choice, also never served
  choices text[] not null check (cardinality(choices) between 2 and 6),
  is_gold boolean not null default false,
  gold_answer text,
  created_at timestamptz not null default now(),
  check ((source_kind = 'own_app') = (owner_id is not null)),
  check (source_kind = 'own_app' or licence_note is not null),
  check (media_ref is not null or option_media is not null),
  check (option_media is null or cardinality(option_media) = cardinality(choices)),
  check (source_kind <> 'own_app' or (licence_note is null and not is_gold
                                      and (media_ref is null or media_ref ~ '^loc_[A-Za-z0-9]{16,64}$')
                                      and (option_media is null or array_to_string(option_media, ',') ~ '^loc_[A-Za-z0-9]{16,64}(,loc_[A-Za-z0-9]{16,64})*$'))),
  check (array_to_string(choices, ',') ~ '^[a-z0-9_]{1,20}(,[a-z0-9_]{1,20})*$'),
  check (is_gold = (gold_answer is not null)),
  check (gold_answer is null or gold_answer = any (choices))
);
create index calibrate_items_pick_idx on ryagram_private.calibrate_items (is_gold, status);
revoke all on ryagram_private.calibrate_items from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- the person's rows (read only through the my_calibration_* calls)
create table public.calibrate_consents (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  words_id text not null references ryagram_private.calibrate_consent_words (id),
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table public.calibrate_rounds (
  id uuid primary key default gen_random_uuid(),                                -- the page's round token (opaque to it)
  owner_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  items_total int not null check (items_total between 1 and 50),
  budget_week date not null,
  reserved_tenths int not null check (reserved_tenths >= 0),                    -- taken from the week's budget at start; the unused part goes back at close
  tenths int check (tenths >= 0),
  result text check (result in ('held', 'gold_too_low', 'too_fast', 'nothing_paid', 'expired')),   -- internal: never returned to the person
  check ((finished_at is null) = (result is null) and (finished_at is null) = (tenths is null))
);
create index calibrate_rounds_owner_idx on public.calibrate_rounds (owner_id, started_at);

create table ryagram_private.calibrate_round_items (
  round_id uuid not null references public.calibrate_rounds (id) on delete cascade,
  item_id uuid not null references ryagram_private.calibrate_items (id),
  owner_id uuid not null,
  position int not null check (position between 1 and 50),
  item_token uuid not null default gen_random_uuid() unique,                   -- per person, round and 15 minutes
  token_expires_at timestamptz not null,
  choice_order text[] not null,                                                -- this round's order of the item's choices: served id a = choice_order[1]
  media_handle text unique check (media_handle is null or media_handle ~ '^[0-9a-f]{64}$'),
  option_handles text[],
  primary key (round_id, item_id),
  unique (owner_id, item_id),                                                  -- an item is served to a person once, ever
  unique (round_id, position)
);
revoke all on ryagram_private.calibrate_round_items from public, anon, authenticated, service_role;

-- What a handle opens, and until when. Only the (not yet built) media resolver reads it; closed to every API role here.
create table ryagram_private.calibrate_media_handles (
  handle text primary key check (handle ~ '^[0-9a-f]{64}$'),
  round_id uuid not null references public.calibrate_rounds (id) on delete cascade,
  owner_id uuid not null,
  media_ref text not null,
  expires_at timestamptz not null
);
revoke all on ryagram_private.calibrate_media_handles from public, anon, authenticated, service_role;

create table public.calibrate_answers (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.calibrate_rounds (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references ryagram_private.calibrate_items (id),
  answer text not null check (char_length(answer) between 1 and 200),         -- the CANONICAL choice (mapped from the served letter), or 'skip'
  answered_at timestamptz not null default now(),
  unique (round_id, item_id),
  unique (owner_id, item_id)
);

-- The award ledger, APPEND-ONLY: an 'award' row (+tenths, release_at) and at most one 'reversal' row (-tenths) pointing at it.
create table public.calibrate_awards (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
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
create unique index calibrate_awards_round_once on public.calibrate_awards (round_id) where kind = 'award';
create index calibrate_awards_owner_idx on public.calibrate_awards (owner_id, created_at);

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

create table ryagram_private.calibrate_points (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  tenths int not null default 0 check (tenths < 10)
);
create table ryagram_private.calibrate_budget (
  week_start date primary key,
  used_tenths int not null default 0 check (used_tenths >= 0)                  -- reserved by open rounds plus awarded
);
revoke all on ryagram_private.calibrate_points, ryagram_private.calibrate_budget from public, anon, authenticated, service_role;

-- RLS on and NO grant to any API role: rounds, awards, releases and moves would tell a person (or a ring) right after a round whether its checks passed. The calls below read them.
alter table public.calibrate_consents enable row level security;
alter table public.calibrate_rounds enable row level security;
alter table public.calibrate_answers enable row level security;
alter table public.calibrate_awards enable row level security;
alter table public.calibrate_releases enable row level security;
alter table public.calibrate_credit_moves enable row level security;
revoke all on public.calibrate_consents, public.calibrate_rounds, public.calibrate_answers, public.calibrate_awards, public.calibrate_releases, public.calibrate_credit_moves
  from public, anon, authenticated, service_role;
create policy "Owners only" on public.calibrate_consents for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners only" on public.calibrate_rounds for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners only" on public.calibrate_answers for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners only" on public.calibrate_awards for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners only" on public.calibrate_releases for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners only" on public.calibrate_credit_moves for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------- the checks
create function ryagram_private.calibrate_master_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.calibrate_enabled from public.ops_settings s limit 1), false)
$$;

create function ryagram_private.calibrate_switch_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner is not null
     and ryagram_private.calibrate_master_on()
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
     and coalesce((select 'calibrate' = any (s.switches_on) from public.account_settings s where s.owner_id = p_owner), false)
$$;

-- consent to the CURRENT words, not withdrawn
create function ryagram_private.calibrate_consented(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.calibrate_consents c join ryagram_private.calibrate_consent_words w on w.id = c.words_id
                  where c.owner_id = p_owner and c.withdrawn_at is null and w.is_current)
$$;

-- null when the account may help; else {days_needed, needs_film}. A PC-reported compilation never counts (WORKER HIGH 2).
create function ryagram_private.calibrate_gate(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin   -- plpgsql, not sql: public.credit_ledger (phase-2b) is resolved when called, not when created
  return (with g as (
    select greatest(0, ceil(extract(epoch from (u.created_at + make_interval(days => r.min_account_days) - now())) / 86400.0))::int as days,
           not exists (select 1 from public.credit_ledger l where l.owner_id = p_owner and l.entry in ('capture', 'purchase')) as film
      from auth.users u, ryagram_private.calibrate_rules r where u.id = p_owner and r.id)
  select case when g.days > 0 or g.film then jsonb_build_object('days_needed', case when g.days > 0 then g.days end, 'needs_film', g.film) end from g);
end
$$;

create function ryagram_private.calibrate_eligible(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner is not null and exists (select 1 from auth.users u where u.id = p_owner) and ryagram_private.calibrate_gate(p_owner) is null
$$;

-- strike_rounds rounds failing the known-answer bar inside strike_days: paused for pause_days after the last of them
create function ryagram_private.calibrate_paused(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.calibrate_rounds s, ryagram_private.calibrate_rules r
                  where r.id and s.owner_id = p_owner and s.result = 'gold_too_low'
                    and s.finished_at > now() - make_interval(days => r.pause_days)
                    and (select count(*) from public.calibrate_rounds q
                          where q.owner_id = p_owner and q.result = 'gold_too_low'
                            and q.finished_at between s.finished_at - make_interval(days => r.strike_days) and s.finished_at) >= r.strike_rounds)
$$;

-- RENDERER T5b: connect_actor makes a connector transaction look like the owner without a client_id, so require_app_session alone is not enough.
create function ryagram_private.calibrate_refuse_connector() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if session_user::text = 'connect_runner'
     or exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
                 where g.rolname = 'connect_runner' and u.rolname = session_user::text) then
    raise exception 'not_person: only the person, in Ryagram, can do this. A connected AI cannot.' using errcode = '42501', hint = 'calibrate_person_only';
  end if;
end $$;

-- The person in the app, with the switches on. Every my_calibration_* call starts here.
create function ryagram_private.calibrate_person() returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  perform ryagram_private.calibrate_refuse_connector();
  if exists (select 1 from public.workers w where w.user_id = auth.uid()) then
    me := null;                                                    -- the worker login: not_on below, before require_signed_in's own worker words (the contract's code word first)
  else
    me := ryagram_private.require_app_session();                   -- refuses a connected AI's token (it has a client_id)
  end if;
  if me is null or not ryagram_private.calibrate_switch_on(me) or not ryagram_private.account_active(me) then
    raise exception 'not_on: helping tune Ryagram is not open for your account.' using errcode = '42501', hint = 'calibrate_off';
  end if;
  return me;
end $$;

-- The gold check over the last gold_window golds served in CLOSED rounds plus p_round. A skip or no answer is wrong.
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

-- The caps, counted on ROUNDS (each at its full possible pay), never on awards, so a cap never tells whether a round's checks passed. Returns null, 'day', 'week' or 'lifetime'.
create function ryagram_private.calibrate_cap(p_owner uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules; d int; w int; n int; life int;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  select coalesce(sum(o.reserved_tenths) filter (where o.started_at > now() - interval '24 hours'), 0),
         coalesce(sum(o.reserved_tenths) filter (where o.started_at > now() - interval '7 days'), 0),
         count(*) filter (where o.started_at > now() - interval '24 hours')
    into d, w, n from public.calibrate_rounds o where o.owner_id = p_owner and o.result is distinct from 'expired';
  life := coalesce((select sum(a.tenths) from public.calibrate_awards a where a.owner_id = p_owner and a.kind = 'award'), 0)
        + coalesce((select sum(o.reserved_tenths) from public.calibrate_rounds o where o.owner_id = p_owner and o.finished_at is null and o.expires_at > now()), 0);
  if life + r.round_tenths > r.lifetime_cap_tenths then return 'lifetime'; end if;
  if w + r.round_tenths > r.weekly_cap_tenths then return 'week'; end if;
  if d + r.round_tenths > r.daily_cap_tenths or n >= r.rounds_per_day then return 'day'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------- held awards: cancel (withdrawal) and release (after the hold)
create function ryagram_private.calibrate_cancel_held(p_owner uuid, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform ryagram_private.lock_owner(p_owner);
  insert into public.calibrate_awards (owner_id, round_id, kind, tenths, reverses, note)
    select w.owner_id, w.round_id, 'reversal', -w.tenths, w.id, p_note from public.calibrate_awards w
     where w.owner_id = p_owner and w.kind = 'award'
       and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
       and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Releases every due award of one person, oldest first. The budget was reserved when the round started, so a release never waits on it.
-- At release time: master switch and account switch on (else it stays held), consent NOT withdrawn (withdrawn: cancelled, never paid), consent to the current words (else held), gold record ok (else held).
create function ryagram_private.calibrate_release_owner(p_owner uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare a record; pts int; whole int; lid bigint; given int := 0;
begin
  perform ryagram_private.lock_owner(p_owner);
  if exists (select 1 from public.calibrate_consents c where c.owner_id = p_owner and c.withdrawn_at is not null)
     or not exists (select 1 from public.calibrate_consents c where c.owner_id = p_owner) then
    perform ryagram_private.calibrate_cancel_held(p_owner, 'consent withdrawn: cancelled, not paid');
    return 0;
  end if;
  if not ryagram_private.calibrate_switch_on(p_owner) or not ryagram_private.calibrate_consented(p_owner)
     or not ryagram_private.calibrate_gold_ok(p_owner, null) then
    return 0;                                                                  -- stays held; Ryan looks
  end if;
  for a in select w.id, w.tenths from public.calibrate_awards w
            where w.owner_id = p_owner and w.kind = 'award' and w.release_at <= now()
              and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
              and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id)
            order by w.id loop
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

-- Ryan's tick (dashboard or a scheduled job). The master switch off stops every release at once.
create function ryagram_private.calibrate_release_due() returns int
language plpgsql security definer set search_path = '' as $$
declare o uuid; n int := 0;
begin
  if not ryagram_private.calibrate_master_on() then
    return 0;
  end if;
  for o in select distinct w.owner_id from public.calibrate_awards w
            where w.kind = 'award' and w.release_at <= now()
              and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
              and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id) loop
    n := n + ryagram_private.calibrate_release_owner(o);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------- closing a round (scored once; a repeat returns the same)
-- Called by the last answer (p_expired false) or for a round that ran out of time (p_expired true: earns nothing). Returns ONLY {"done": true}: nothing about the checks.
create function ryagram_private.calibrate_round_close(p_round uuid, p_expired boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules; o public.calibrate_rounds; g_round int; fast int; paid_ok int; pay int := 0; res text;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  select * into o from public.calibrate_rounds where id = p_round for update;
  if o.id is null then
    raise exception 'task_unknown: no such round.' using errcode = 'PT404';
  end if;
  if o.finished_at is not null then
    return jsonb_build_object('done', true);                               -- a repeat: the same answer, nothing new
  end if;
  perform ryagram_private.lock_owner(o.owner_id);
  if p_expired then
    res := 'expired';
  else
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
    if g_round < r.gold_round_min or not ryagram_private.calibrate_gold_ok(o.owner_id, p_round) then
      res := 'gold_too_low';                                                -- a strike (calibrate_paused counts these)
    elsif fast > r.max_fast then
      res := 'too_fast';
    else
      pay := least((r.round_tenths * paid_ok) / o.items_total, o.reserved_tenths);
      res := case when pay > 0 then 'held' else 'nothing_paid' end;
    end if;
  end if;
  if pay > 0 then
    insert into public.calibrate_awards (owner_id, round_id, kind, tenths, release_at)
      values (o.owner_id, p_round, 'award', pay, now() + make_interval(hours => r.hold_hours));
  end if;
  update ryagram_private.calibrate_budget set used_tenths = greatest(used_tenths - (o.reserved_tenths - pay), 0) where week_start = o.budget_week;   -- the unused reservation goes back
  update public.calibrate_rounds set finished_at = now(), tenths = pay, result = res where id = p_round;
  return jsonb_build_object('done', true);
end $$;

-- The page's round object: tasks not yet answered, each with a live token (re-issued when past token_minutes), the kind's prompt, opaque clips, shuffled positional options.
create function ryagram_private.calibrate_round_json(p_round uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r ryagram_private.calibrate_rules; o public.calibrate_rounds; tasks jsonb; answered int;
begin
  select * into r from ryagram_private.calibrate_rules where id;
  select * into o from public.calibrate_rounds where id = p_round;
  update ryagram_private.calibrate_round_items x set item_token = gen_random_uuid(), token_expires_at = least(now() + make_interval(mins => r.token_minutes), o.expires_at)
   where x.round_id = p_round and x.token_expires_at <= now()
     and not exists (select 1 from public.calibrate_answers a where a.round_id = x.round_id and a.item_id = x.item_id);
  select count(*) into answered from public.calibrate_answers a where a.round_id = p_round;
  select coalesce(jsonb_agg(t.task order by t.position), '[]'::jsonb) into tasks from (
    select x.position, jsonb_build_object(
             'token', x.item_token::text, 'type', i.task_kind, 'prompt', k.prompt,
             'clip', case when x.media_handle is null then null
                          when i.source_kind = 'own_app' then jsonb_build_object('kind', 'own_app', 'url', r.own_app_url_base || x.media_handle)
                          else jsonb_build_object('kind', 'licensed', 'url', r.media_url_base || x.media_handle, 'label', null) end,
             'options', (select jsonb_agg(jsonb_build_object(
                                 'id', chr(96 + c.n::int),
                                 'label', coalesce(k.positional_labels[c.n::int], k.labels ->> c.choice),
                                 'clip', case when x.option_handles is null then null
                                              when i.source_kind = 'own_app' then jsonb_build_object('kind', 'own_app', 'url', r.own_app_url_base || x.option_handles[c.n::int])
                                              else jsonb_build_object('kind', 'licensed', 'url', r.media_url_base || x.option_handles[c.n::int], 'label', null) end)
                                 order by c.n)
                           from unnest(x.choice_order) with ordinality as c(choice, n))) as task
      from ryagram_private.calibrate_round_items x
      join ryagram_private.calibrate_items i on i.id = x.item_id
      join ryagram_private.calibrate_task_kinds k on k.kind = i.task_kind
     where x.round_id = p_round
       and not exists (select 1 from public.calibrate_answers a where a.round_id = x.round_id and a.item_id = x.item_id)) t;
  return jsonb_build_object('token', o.id::text, 'total', o.items_total, 'answered', answered, 'tasks', tasks);
end $$;

-- ---------------------------------------------------------------------------------------------------- the page's calls
create function public.my_calibration_consent_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; c public.calibrate_consents; w ryagram_private.calibrate_consent_words; ok boolean;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  select * into w from ryagram_private.calibrate_consent_words where is_current;
  select * into c from public.calibrate_consents where owner_id = me;
  ok := ryagram_private.calibrate_consented(me);
  return jsonb_build_object('consented', ok, 'at', case when ok then c.consented_at end, 'words_id', w.id,
                            'withdraw_note', w.withdraw_note, 'gate', case when ok then null else ryagram_private.calibrate_gate(me) end);
end $$;

create function public.my_calibration_consent_set(p_on boolean, p_words_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; w ryagram_private.calibrate_consent_words; at_ timestamptz := now();
begin
  perform ryagram_private.require_active();
  if p_on is false then                                            -- withdrawing always works, even with a switch off (still the person, never a connector)
    perform ryagram_private.calibrate_refuse_connector();
    me := ryagram_private.require_app_session();
  else
    me := ryagram_private.calibrate_person();
  end if;
  select * into w from ryagram_private.calibrate_consent_words where is_current;
  if p_on is null then
    raise exception 'bad_choice: say yes or no.' using errcode = '22023';
  end if;
  if p_on then
    if p_words_id is null or p_words_id <> w.id then
      raise exception 'words_unknown: the words shown are not the current ones. Reload the page.' using errcode = '22023', hint = 'calibrate_words';
    end if;
    insert into public.calibrate_consents (owner_id, words_id, consented_at) values (me, w.id, at_)
      on conflict (owner_id) do update set words_id = excluded.words_id, consented_at = excluded.consented_at, withdrawn_at = null;
    return jsonb_build_object('consented', true, 'at', at_, 'words_id', w.id, 'note', null);
  end if;
  update public.calibrate_consents set withdrawn_at = at_ where owner_id = me and withdrawn_at is null;
  perform ryagram_private.calibrate_cancel_held(me, 'consent withdrawn: cancelled, not paid');   -- held awards stop here, never paid
  update public.calibrate_rounds set expires_at = least(expires_at, at_) where owner_id = me and finished_at is null;
  return jsonb_build_object('consented', false, 'at', at_, 'words_id', null, 'note', w.withdraw_note);
end $$;

create function public.my_calibration_round_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; r ryagram_private.calibrate_rules; o record; rid uuid; cap text; wk date := (date_trunc('week', now() at time zone 'utc'))::date; used int;
        gold_ids uuid[]; plain_ids uuid[]; no_cap constant jsonb := '{"reached": false, "period": null}';
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  select * into r from ryagram_private.calibrate_rules where id;
  if not ryagram_private.calibrate_consented(me) then
    return jsonb_build_object('state', 'not_consented', 'round', null, 'gate', null, 'cap', no_cap);
  end if;
  if ryagram_private.calibrate_gate(me) is not null then
    return jsonb_build_object('state', 'gate', 'round', null, 'gate', ryagram_private.calibrate_gate(me), 'cap', no_cap);
  end if;
  perform ryagram_private.calibrate_release_owner(me);
  perform pg_advisory_xact_lock(hashtextextended('calibrate:' || me::text, 0));          -- two calls at once never both open a round
  for o in select id from public.calibrate_rounds where owner_id = me and finished_at is null and expires_at <= now() loop
    perform ryagram_private.calibrate_round_close(o.id, true);                           -- ran out of time: earns nothing, its reservation goes back
  end loop;
  select id into rid from public.calibrate_rounds where owner_id = me and finished_at is null and expires_at > now();
  if rid is not null then
    return jsonb_build_object('state', 'ready', 'round', ryagram_private.calibrate_round_json(rid), 'gate', null, 'cap', no_cap);
  end if;
  if ryagram_private.calibrate_paused(me) then
    return jsonb_build_object('state', 'paused', 'round', null, 'gate', null, 'cap', no_cap);
  end if;
  cap := ryagram_private.calibrate_cap(me);
  if cap is not null then
    return jsonb_build_object('state', 'cap_reached', 'round', null, 'gate', null,
                              'cap', jsonb_build_object('reached', true, 'period', case when cap in ('day', 'week') then cap end));
  end if;
  insert into ryagram_private.calibrate_budget (week_start) values (wk) on conflict (week_start) do nothing;
  select used_tenths into used from ryagram_private.calibrate_budget where week_start = wk for update;   -- the budget lock
  if used + r.round_tenths > r.weekly_budget_credits * 10 then
    return jsonb_build_object('state', 'budget_used', 'round', null, 'gate', null, 'cap', no_cap);       -- no round, so no award can be made
  end if;
  -- the SERVER picks: cleared items only; gold from the site's own pack (never own footage); every choice must have a label (no item words leak through a label)
  gold_ids := array(select i.id from ryagram_private.calibrate_items i join ryagram_private.calibrate_task_kinds k on k.kind = i.task_kind
                      where i.is_gold and i.status = 'cleared' and i.source_kind in ('public_domain', 'licensed')
                        and (select bool_and(k.positional_labels[c.n::int] is not null or k.labels ? c.ch) from unnest(i.choices) with ordinality c(ch, n))
                        and not exists (select 1 from ryagram_private.calibrate_round_items x where x.owner_id = me and x.item_id = i.id)
                      order by random() limit r.gold_per_round);
  plain_ids := array(select i.id from ryagram_private.calibrate_items i join ryagram_private.calibrate_task_kinds k on k.kind = i.task_kind
                      where not i.is_gold and i.status = 'cleared' and (i.source_kind <> 'own_app' or i.owner_id = me)
                        and (select bool_and(k.positional_labels[c.n::int] is not null or k.labels ? c.ch) from unnest(i.choices) with ordinality c(ch, n))
                        and not exists (select 1 from ryagram_private.calibrate_round_items x where x.owner_id = me and x.item_id = i.id)
                      order by random() limit r.round_size - r.gold_per_round);
  if cardinality(gold_ids) < r.gold_per_round or cardinality(plain_ids) < r.round_size - r.gold_per_round then
    return jsonb_build_object('state', 'none', 'round', null, 'gate', null, 'cap', no_cap);
  end if;
  update ryagram_private.calibrate_budget set used_tenths = used + r.round_tenths where week_start = wk;   -- reserved now; the unused part goes back at close
  insert into public.calibrate_rounds (owner_id, expires_at, items_total, budget_week, reserved_tenths)
    values (me, now() + make_interval(mins => r.round_minutes), r.round_size, wk, r.round_tenths) returning id into rid;
  insert into ryagram_private.calibrate_round_items (round_id, item_id, owner_id, position, token_expires_at, choice_order, media_handle, option_handles)
    select rid, i.id, me, row_number() over (order by random()),
           least(now() + make_interval(mins => r.token_minutes), now() + make_interval(mins => r.round_minutes)),
           case when k.shuffle then array(select ch from unnest(i.choices) ch order by random()) else i.choices end,
           case when i.media_ref is null then null else replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') end,
           null
      from unnest(gold_ids || plain_ids) as u(id)
      join ryagram_private.calibrate_items i on i.id = u.id
      join ryagram_private.calibrate_task_kinds k on k.kind = i.task_kind;
  -- per-option handles follow this round's shuffled order (so handle 1 always plays the choice served as 'a')
  update ryagram_private.calibrate_round_items x
     set option_handles = array(select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') from unnest(x.choice_order))
    from ryagram_private.calibrate_items i where i.id = x.item_id and x.round_id = rid and i.option_media is not null;
  insert into ryagram_private.calibrate_media_handles (handle, round_id, owner_id, media_ref, expires_at)
    select x.media_handle, rid, me, i.media_ref, now() + make_interval(mins => r.round_minutes)
      from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id
     where x.round_id = rid and x.media_handle is not null
    union all
    select x.option_handles[c.n::int], rid, me, i.option_media[array_position(i.choices, c.ch)], now() + make_interval(mins => r.round_minutes)
      from ryagram_private.calibrate_round_items x join ryagram_private.calibrate_items i on i.id = x.item_id,
           unnest(x.choice_order) with ordinality c(ch, n)
     where x.round_id = rid and x.option_handles is not null;
  return jsonb_build_object('state', 'ready', 'round', ryagram_private.calibrate_round_json(rid), 'gate', null, 'cap', no_cap);
end $$;

-- One answer: the round token, the item token, a served option id (a, b, ...) or 'skip'. Nothing that tells right from wrong; the last answer closes the round (round_result null).
create function public.my_calibration_answer_set(p_round text, p_item text, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; rid uuid; tok uuid; o public.calibrate_rounds; x ryagram_private.calibrate_round_items; pick text; n int; done boolean := false; cap text;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  if not ryagram_private.calibrate_consented(me) then
    raise exception 'not_consented: first say yes to the words about how your answers are used.' using errcode = '42501', hint = 'calibrate_consent';
  end if;
  if p_round !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_item !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'task_unknown: that task is not known.' using errcode = 'PT404';
  end if;
  rid := p_round::uuid; tok := p_item::uuid;
  perform ryagram_private.lock_owner(me);
  select * into o from public.calibrate_rounds where id = rid and owner_id = me for update;
  if o.id is null then
    raise exception 'task_unknown: that round is not yours.' using errcode = 'PT404';
  end if;
  if o.finished_at is not null or o.expires_at <= now() then
    raise exception 'round_ended: that round is closed.' using errcode = '22023', hint = 'calibrate_closed';
  end if;
  select * into x from ryagram_private.calibrate_round_items where round_id = rid and item_token = tok;
  if x.item_id is null then
    raise exception 'task_unknown: that task is not in this round.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.calibrate_answers a where a.owner_id = me and a.item_id = x.item_id) then
    raise exception 'item_used: that one is already answered.' using errcode = '22023', hint = 'calibrate_twice';
  end if;
  if x.token_expires_at <= now() then
    raise exception 'round_ended: that task waited too long. Load the round again.' using errcode = '22023', hint = 'calibrate_token_expired';
  end if;
  if p_answer = 'skip' then
    pick := 'skip';
  elsif p_answer ~ '^[a-f]$' and ascii(p_answer) - 96 <= cardinality(x.choice_order) then
    pick := x.choice_order[ascii(p_answer) - 96];                            -- the served letter to the canonical choice
  else
    raise exception 'task_unknown: pick one of the answers shown, or skip.' using errcode = '22023';
  end if;
  insert into public.calibrate_answers (round_id, owner_id, item_id, answer) values (rid, me, x.item_id, pick);
  select count(*) into n from public.calibrate_answers a where a.round_id = rid;
  if n >= o.items_total then
    perform ryagram_private.calibrate_round_close(rid, false);
    done := true;
  end if;
  cap := ryagram_private.calibrate_cap(me);
  return jsonb_build_object('ok', true, 'answered', n, 'total', o.items_total, 'cap_reached', done and cap is not null,
                            'cap_period', case when done and cap in ('day', 'week') then cap end,
                            'round_done', done, 'round_result', null);       -- never awarded / no_award here: the outcome shows later in earned_get
end $$;

-- What the person has earned. Rows appear only once a round's hold is over (paid, or 0 when not paid, never why); 'round' and 'pending' are always null (they would tell at once).
create function public.my_calibration_earned_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; r ryagram_private.calibrate_rules;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  select * into r from ryagram_private.calibrate_rules where id;
  perform ryagram_private.calibrate_release_owner(me);
  return jsonb_build_object(
    'round', null, 'pending', null,
    'today', coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me and m.created_at > now() - interval '24 hours'), 0),
    'week', coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me and m.created_at > now() - interval '7 days'), 0),
    'total', greatest(coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me), 0), 0),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id::text, 'at', l.at, 'task_type', null, 'credits', l.credits, 'undone', l.undone) order by l.at desc)
                          from (select o.id, o.finished_at as at,
                                       coalesce((select w.tenths from public.calibrate_awards w join public.calibrate_releases x on x.award_id = w.id
                                                  where w.round_id = o.id and w.kind = 'award'), 0) / 10.0 as credits,
                                       exists (select 1 from public.calibrate_awards v where v.round_id = o.id and v.kind = 'reversal') as undone
                                  from public.calibrate_rounds o
                                 where o.owner_id = me and o.finished_at is not null and o.result <> 'expired'
                                   and o.finished_at <= now() - make_interval(hours => r.hold_hours)
                                   and not exists (select 1 from public.calibrate_awards w where w.round_id = o.id and w.kind = 'award'      -- still held: not shown yet
                                                    and not exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
                                                    and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id))
                                 order by o.finished_at desc limit 20) l), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------- the undo (one core; the person for their own award, Ryan from the dashboard)
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
    update ryagram_private.calibrate_points set tenths = pts where owner_id = w.owner_id;
  end if;
  return jsonb_build_object('reversal', rid, 'credits_taken_back', k, 'debt_tenths', greatest(-coalesce(pts, 0), 0));
end $$;

-- The page's "Take back": the person gives back their own award (p_ledger = the ledger row id earned_get showed, which is the round's id).
create function public.my_calibration_undo(p_ledger uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; aid bigint;
begin
  perform ryagram_private.require_active();
  me := ryagram_private.calibrate_person();
  select w.id into aid from public.calibrate_awards w
   where w.round_id = p_ledger and w.owner_id = me and w.kind = 'award'
     and exists (select 1 from public.calibrate_releases x where x.award_id = w.id)
     and not exists (select 1 from public.calibrate_awards v where v.reverses = w.id);
  if aid is null then
    raise exception 'not_undoable: that award cannot be taken back.' using errcode = 'PT404';
  end if;
  perform ryagram_private.calibrate_award_undo(aid, 'taken back by the person');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------------------------------- the connector's one read (CONNECT's schema /0 and keys, exactly)
-- Whole credits only, from credits actually granted, and the daily limit counted on rounds: nothing here moves the moment a round's checks pass.
create function public.connect_calibration_status(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); r ryagram_private.calibrate_rules; cap_c int; used int; tot int; today int;
begin
  if not ryagram_private.calibrate_switch_on(me) then
    raise exception 'Calibrate is not switched on for this account.' using errcode = '42501';
  end if;
  select * into r from ryagram_private.calibrate_rules where id;
  cap_c := r.daily_cap_tenths / 10;
  used := coalesce((select sum(o.reserved_tenths) from public.calibrate_rounds o where o.owner_id = me and o.result is distinct from 'expired' and o.started_at > now() - interval '24 hours'), 0);
  tot := greatest(coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me), 0), 0);
  today := least(greatest(coalesce((select sum(m.credits) from public.calibrate_credit_moves m where m.owner_id = me and m.created_at > now() - interval '24 hours'), 0), 0), tot);
  return jsonb_build_object('schema', 'ryagram.calibration-status/0',
    'open', ryagram_private.account_active(me), 'eligible', ryagram_private.calibrate_eligible(me) and not ryagram_private.calibrate_paused(me),
    'consent_given', ryagram_private.calibrate_consented(me),
    'tasks_per_round', r.round_size, 'daily_cap', cap_c, 'earned_today', today,
    'remaining_today', greatest(cap_c - (used + 9) / 10, 0), 'earned_total', tot, 'page_path', '#/calibrate');
end $$;

-- ---------------------------------------------------------------------------------------------------- grants
revoke execute on function ryagram_private.calibrate_append_only(), ryagram_private.calibrate_master_on(), ryagram_private.calibrate_switch_on(uuid),
  ryagram_private.calibrate_consented(uuid), ryagram_private.calibrate_gate(uuid), ryagram_private.calibrate_eligible(uuid), ryagram_private.calibrate_paused(uuid),
  ryagram_private.calibrate_refuse_connector(), ryagram_private.calibrate_person(), ryagram_private.calibrate_gold_ok(uuid, uuid), ryagram_private.calibrate_cap(uuid),
  ryagram_private.calibrate_cancel_held(uuid, text), ryagram_private.calibrate_release_owner(uuid), ryagram_private.calibrate_release_due(),
  ryagram_private.calibrate_round_close(uuid, boolean), ryagram_private.calibrate_round_json(uuid), ryagram_private.calibrate_award_undo(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.my_calibration_consent_get(), public.my_calibration_consent_set(boolean, text), public.my_calibration_round_get(),
  public.my_calibration_answer_set(text, text, text), public.my_calibration_earned_get(), public.my_calibration_undo(uuid), public.connect_calibration_status(text)
  from public, anon, service_role;
revoke execute on function public.connect_calibration_status(text) from authenticated;
grant execute on function public.my_calibration_consent_get(), public.my_calibration_consent_set(boolean, text), public.my_calibration_round_get(),
  public.my_calibration_answer_set(text, text, text), public.my_calibration_earned_get(), public.my_calibration_undo(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'connect_runner') then   -- the connector gets the status read and nothing else (T5b)
    revoke execute on function public.my_calibration_consent_get(), public.my_calibration_consent_set(boolean, text), public.my_calibration_round_get(),
      public.my_calibration_answer_set(text, text, text), public.my_calibration_earned_get(), public.my_calibration_undo(uuid) from connect_runner;
    grant execute on function public.connect_calibration_status(text) to connect_runner;
  end if;
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
