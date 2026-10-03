-- Ryagram 2A-8..12: the AI editor's tables and the caps it runs under.
--
-- Run before deploying the ai-editor Edge Function. Harmless on its own: control.ai_enabled is
-- false, so nothing can use it until Ryan switches it on.
-- Design: Ryagram-logs\proposals\WEB-2A-AI-EDITOR.md, with Ryan's rulings (2026-09-28):
-- Sonnet capped at 8k output tokens; caps count a rolling 24 hours; the chat is a panel on the
-- version page.
--
-- The Edge Function verifies the person's sign-in itself, runs every tool with THEIR token (so
-- RLS applies exactly as in the app), and uses service_role only to call the functions below.
-- People can read their own conversation and usage; nobody but the function can write them.

begin;

-- Caps and the kill switch live on the existing control row: tuned in Table Editor, no deploy.
alter table public.control
  add column ai_turns_per_day int not null default 100,          -- rolling 24 hours
  add column ai_exec_calls_per_hour int not null default 30,     -- sheets/previews the editor starts
  add column ai_tool_calls_per_turn int not null default 12,
  add column ai_project_alert_usd numeric not null default 3.00; -- hidden alert, not a limit
-- control.ai_enabled already exists (default false).

create table public.ai_prices (
  price_version text not null,
  model text not null,
  input_per_mtok numeric not null check (input_per_mtok >= 0),
  output_per_mtok numeric not null check (output_per_mtok >= 0),
  cache_read_per_mtok numeric not null check (cache_read_per_mtok >= 0),
  cache_write_5m_per_mtok numeric not null check (cache_write_5m_per_mtok >= 0),
  effective_from timestamptz not null,
  primary key (price_version, model)
);
-- Anthropic first-party rates per million tokens (cache read 0.1x input, 5-minute write 1.25x).
insert into public.ai_prices values
  ('2026-09', 'claude-haiku-4-5', 1.00, 5.00, 0.10, 1.25, '2026-09-01'),
  ('2026-09', 'claude-sonnet-5', 2.00, 10.00, 0.20, 2.50, '2026-09-01');

create table public.ai_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  summary text check (char_length(summary) <= 8000),                       -- older turns, summarised
  rulings jsonb not null default '[]' check (jsonb_typeof(rulings) = 'array' and pg_column_size(rulings) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, version_id)                                            -- one conversation per version
);

create table public.ai_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.ai_sessions (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  created_at timestamptz not null default now()
);
create index ai_messages_session_idx on public.ai_messages (session_id, id);

create table public.ai_turns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.ai_sessions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'refused')),
  escalated boolean not null default false,
  tool_calls int not null default 0 check (tool_calls >= 0),
  execution_tool_calls int not null default 0 check (execution_tool_calls >= 0),
  spend_alert boolean not null default false,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index ai_turns_owner_time_idx on public.ai_turns (owner_id, created_at);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  turn_id uuid not null references public.ai_turns (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  purpose text not null default 'turn' check (purpose in ('turn', 'summary')),
  model text not null check (char_length(model) <= 80),
  message_id text check (char_length(message_id) <= 200),
  input_tokens int check (input_tokens >= 0),                    -- NULL = unknown, never 0
  output_tokens int check (output_tokens >= 0),
  cache_read_input_tokens int check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens int check (cache_creation_input_tokens >= 0),
  tool_calls int check (tool_calls >= 0),
  stop_reason text check (char_length(stop_reason) <= 40),
  latency_ms int check (latency_ms >= 0),
  price_version text,
  cost_usd numeric(12, 6),                                       -- NULL when a count or price is unknown
  tool_log jsonb check (jsonb_typeof(tool_log) = 'array' and pg_column_size(tool_log) <= 16384),
  error text check (char_length(error) <= 2000)
);
create index ai_usage_project_idx on public.ai_usage (project_id);

alter table public.ai_prices enable row level security;
alter table public.ai_sessions enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_turns enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_prices, public.ai_sessions, public.ai_messages, public.ai_turns, public.ai_usage
  from anon, authenticated, service_role;
grant select on public.ai_sessions, public.ai_messages, public.ai_turns, public.ai_usage to authenticated;
create policy "Owners read AI sessions" on public.ai_sessions for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read AI messages" on public.ai_messages for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read AI turns" on public.ai_turns for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners read AI usage" on public.ai_usage for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- the function's calls
-- p_owner is always the id the Edge Function verified from the caller's JWT, never request data.

-- The conversation for this person's version, created on first use. Refuses versions that
-- aren't theirs, and worker accounts.
create function public.ai_session_for(p_owner uuid, p_version uuid) returns public.ai_sessions
language plpgsql security definer set search_path = '' as $$
declare v public.versions; s public.ai_sessions;
begin
  if exists (select 1 from public.workers where user_id = p_owner) then
    raise exception 'The worker account can''t use the editor.' using errcode = '42501';
  end if;
  select * into v from public.versions where id = p_version and owner_id = p_owner;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;
  insert into public.ai_sessions (owner_id, project_id, version_id) values (p_owner, v.project_id, v.id)
    on conflict (owner_id, version_id) do update set updated_at = now()
    returning * into s;
  return s;
end $$;

-- Kill switch + rolling-24-hour turn cap, then a turn row. One advisory lock per person closes
-- the race where two tabs both pass the count.
create function public.ai_reserve_turn(p_owner uuid, p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ctl public.control; s public.ai_sessions; turn uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
  select * into ctl from public.control where id;
  if not ctl.ai_enabled then
    raise exception 'The AI editor is switched off.' using errcode = 'PT503';
  end if;
  select * into s from public.ai_sessions where id = p_session and owner_id = p_owner;
  if not found then
    raise exception 'Session not found.' using errcode = 'PT404';
  end if;
  if (select count(*) from public.ai_turns
      where owner_id = p_owner and created_at > now() - interval '24 hours') >= ctl.ai_turns_per_day then
    raise exception 'You have reached today''s limit for the editor. It resets over the next 24 hours.'
      using errcode = 'PT429';
  end if;
  insert into public.ai_turns (owner_id, session_id, project_id) values (p_owner, s.id, s.project_id)
    returning id into turn;
  return turn;
end $$;

-- Counts one execution-heavy tool call (a sheet or preview) against the hourly cap and the turn.
-- false = refuse that tool. Also false if the switch went off mid-turn.
create function public.ai_allow_execution(p_turn uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t public.ai_turns; ctl public.control;
begin
  select * into t from public.ai_turns where id = p_turn and status = 'running';
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(t.owner_id::text, 43));
  select * into ctl from public.control where id;
  if not ctl.ai_enabled then return false; end if;
  if (select coalesce(sum(execution_tool_calls), 0) from public.ai_turns
      where owner_id = t.owner_id and created_at > now() - interval '1 hour') >= ctl.ai_exec_calls_per_hour then
    return false;
  end if;
  update public.ai_turns set execution_tool_calls = execution_tool_calls + 1 where id = t.id;
  return true;
end $$;

-- Records one Claude call and prices it at the current price version. Returns the project's
-- total AI spend so far (NULL if any cost is unknown), and flags the turn when it passes the alert.
create function public.ai_record_usage(p_turn uuid, p_usage jsonb) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  t public.ai_turns;
  ctl public.control;
  pr public.ai_prices;
  v_model text := p_usage->>'model';
  inp int := (p_usage->>'input_tokens')::int;
  outp int := (p_usage->>'output_tokens')::int;
  cr int := (p_usage->>'cache_read_input_tokens')::int;
  cw int := (p_usage->>'cache_creation_input_tokens')::int;
  cost numeric;
  spend numeric;
begin
  select * into t from public.ai_turns where id = p_turn;
  if not found then
    raise exception 'Turn not found.' using errcode = 'PT404';
  end if;
  select * into pr from public.ai_prices
    where ai_prices.model = v_model and effective_from <= now()
    order by effective_from desc limit 1;
  if pr.model is not null and inp is not null and outp is not null and cr is not null and cw is not null then
    cost := (inp * pr.input_per_mtok + outp * pr.output_per_mtok
             + cr * pr.cache_read_per_mtok + cw * pr.cache_write_5m_per_mtok) / 1000000.0;
  end if;
  insert into public.ai_usage (turn_id, owner_id, project_id, purpose, model, message_id, input_tokens, output_tokens,
                               cache_read_input_tokens, cache_creation_input_tokens, tool_calls, stop_reason,
                               latency_ms, price_version, cost_usd, tool_log, error)
    values (t.id, t.owner_id, t.project_id, coalesce(p_usage->>'purpose', 'turn'), v_model, p_usage->>'message_id',
            inp, outp, cr, cw, (p_usage->>'tool_calls')::int, p_usage->>'stop_reason',
            (p_usage->>'latency_ms')::int, pr.price_version, cost,
            case when jsonb_typeof(p_usage->'tool_log') = 'array' then p_usage->'tool_log' end,
            left(p_usage->>'error', 2000));
  select case when bool_or(u.cost_usd is null) then null else sum(u.cost_usd) end into spend
    from public.ai_usage u where u.project_id = t.project_id;
  select * into ctl from public.control where id;
  if spend is not null and spend >= ctl.ai_project_alert_usd then
    update public.ai_turns set spend_alert = true where id = t.id;
  end if;
  return spend;
end $$;

-- Ends a turn and appends its messages (the person's words and the editor's reply, as text).
create function public.ai_finish_turn(p_turn uuid, p_status text, p_escalated boolean, p_tool_calls int,
                                      p_user_text text, p_reply_text text, p_summary text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare t public.ai_turns;
begin
  select * into t from public.ai_turns where id = p_turn and status = 'running' for update;
  if not found then
    raise exception 'Turn not found or already finished.' using errcode = 'PT404';
  end if;
  update public.ai_turns set status = p_status, escalated = coalesce(p_escalated, false),
      tool_calls = greatest(coalesce(p_tool_calls, 0), 0), ended_at = now()
    where id = t.id;
  if p_user_text is not null then
    insert into public.ai_messages (session_id, owner_id, role, content) values (t.session_id, t.owner_id, 'user', left(p_user_text, 20000));
  end if;
  if p_reply_text is not null then
    insert into public.ai_messages (session_id, owner_id, role, content) values (t.session_id, t.owner_id, 'assistant', left(p_reply_text, 20000));
  end if;
  if p_summary is not null then
    update public.ai_sessions set summary = left(p_summary, 8000), updated_at = now() where id = t.session_id;
  end if;
end $$;

-- Adds a short project ruling the editor should keep to ("bars start at zero", "use 2016-2022").
create function public.ai_add_ruling(p_turn uuid, p_text text) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.ai_turns; n int;
begin
  select * into t from public.ai_turns where id = p_turn and status = 'running';
  if not found then
    raise exception 'Turn not found.' using errcode = 'PT404';
  end if;
  if coalesce(char_length(trim(p_text)), 0) not between 1 and 300 then
    raise exception 'A ruling is 1 to 300 characters.' using errcode = '22023';
  end if;
  update public.ai_sessions set rulings = (rulings || to_jsonb(trim(p_text)))
    where id = t.session_id and jsonb_array_length(rulings) < 20
    returning jsonb_array_length(rulings) into n;
  if n is null then
    raise exception 'This project already has 20 rulings.' using errcode = '22023';
  end if;
  return n;
end $$;

-- What the editor needs at the start of a turn: the running summary, the project's rulings,
-- the last p_limit messages (oldest first) and the per-turn tool-call cap.
create function public.ai_turn_context(p_turn uuid, p_limit int default 12) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'summary', s.summary,
    'rulings', s.rulings,
    'tool_calls_per_turn', (select ai_tool_calls_per_turn from public.control where id),
    'message_count', (select count(*) from public.ai_messages m where m.session_id = s.id),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role, 'content', r.content) order by r.id)
      from (select id, role, content from public.ai_messages m where m.session_id = s.id
            order by id desc limit least(greatest(p_limit, 0), 40)) r), '[]'::jsonb))
  from public.ai_turns t join public.ai_sessions s on s.id = t.session_id
  where t.id = p_turn and t.status = 'running'
$$;

revoke execute on function public.ai_session_for(uuid, uuid), public.ai_reserve_turn(uuid, uuid),
  public.ai_allow_execution(uuid), public.ai_record_usage(uuid, jsonb),
  public.ai_finish_turn(uuid, text, boolean, int, text, text, text), public.ai_add_ruling(uuid, text),
  public.ai_turn_context(uuid, int)
  from public, anon, authenticated;
grant execute on function public.ai_session_for(uuid, uuid), public.ai_reserve_turn(uuid, uuid),
  public.ai_allow_execution(uuid), public.ai_record_usage(uuid, jsonb),
  public.ai_finish_turn(uuid, text, boolean, int, text, text, text), public.ai_add_ruling(uuid, text),
  public.ai_turn_context(uuid, int)
  to service_role;
grant usage on schema public to service_role;

commit;
