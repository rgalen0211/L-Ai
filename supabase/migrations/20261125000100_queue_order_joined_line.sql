-- QUEUE ORDER BY WHEN A JOB JOINED THE LINE (BUILDER 11-25; GAMES 11-24 09:31 (2), CC1 11-24 09:33 and 11-25 12:04: branch only, ready if strangers hit it).
-- THE PROBLEM: the render PC claims, and the page counts a stranger's place, by jobs.created_at. A full film is created when it is ASKED for
-- (state awaiting_approval) and joins the line only when Ryan approves it. So a full film asked for at 10:05 and approved at 11:30 goes IN FRONT
-- of every sheet and preview queued after 10:05: a stranger who read 'Number 3 in line' then reads 'Number 4'. jobs.queued_at cannot be the order:
-- a retry (a job put back after a fault) resets it, and that job must KEEP its place.
-- THE FIX: one new column, jobs.joined_line_at: now() when a job is made (backfilled = created_at, so today's order is unchanged for every job),
-- and now() again ONLY when Ryan approves a full film (state awaiting_approval -> queued, a BEFORE UPDATE trigger). A retry never touches it.
-- The three places that read the line use it: public.claim_next_job (the house claim), public.node_claim (a tester's own PC) and
-- public.queue_position (the number a stranger reads). Like 20261113000400_film_bundles.sql, each is changed by reading its LIVE text and
-- replacing exactly one ordering clause; if that clause is not there exactly once, nothing is changed and the reason is said in words.
-- Undo: rollbacks/20261125000100_queue_order_joined_line_rollback.sql (puts the three clauses back, drops the trigger and the column).
begin;

alter table public.jobs add column if not exists joined_line_at timestamptz;
update public.jobs set joined_line_at = created_at where joined_line_at is null;
alter table public.jobs alter column joined_line_at set default now(), alter column joined_line_at set not null;

create or replace function ryagram_private.jobs_joined_line() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.state = 'awaiting_approval' and new.state = 'queued' then
    new.joined_line_at := now();                                   -- Ryan approved a full film: it joins the line now, at the end
  end if;
  return new;
end $$;
revoke execute on function ryagram_private.jobs_joined_line() from public, anon, authenticated, service_role;
drop trigger if exists jobs_joined_line on public.jobs;
create trigger jobs_joined_line before update of state on public.jobs
  for each row execute function ryagram_private.jobs_joined_line();

create index if not exists jobs_queued_line_idx on public.jobs (joined_line_at, id) where state = 'queued';

do $do$
declare
  def text; n int; i int;
  -- Each pair is SHORT on purpose: a planted fault in the film_bundles line that leaves these pieces in place (its two mutants change the
  -- number of minutes, or add 'and false') then still reaches its own test, which catches it on an assertion (tests/mutant_blind_check.py).
  -- public.claim_next_job (20261113000400's ordering line): its 2-minute starvation guard AND its oldest-first tie order both read the line
  -- (GAMES 12:23: with only the tie order moved, an old film Ryan approves just now would count as waiting for days and stop every bundle jump)
  -- public.node_claim (20261026000200); public.queue_position (20260928000100)
  fns  constant text[] := array['public.claim_next_job()', 'public.claim_next_job()', 'public.node_claim(text)', 'public.queue_position(uuid)'];
  olds constant text[] := array['and o.created_at < now() - interval ''', 'then 0 else 1 end, created_at, id',
                                'order by created_at, id for update skip locked limit 1;', '(q.created_at, q.id) < (j.created_at, j.id)'];
  news constant text[] := array['and o.joined_line_at < now() - interval ''', 'then 0 else 1 end, joined_line_at, id',
                                'order by joined_line_at, id for update skip locked limit 1;', '(q.joined_line_at, q.id) < (j.joined_line_at, j.id)'];
  fn text; o text; nw text;
begin
  for i in 1 .. array_length(fns, 1) loop
    fn := fns[i]; o := olds[i]; nw := news[i];
    select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure(fn);
    if def is null then
      raise exception '% is not on this database; this change expects it (nothing was changed).', fn;
    end if;
    def := replace(def, chr(13), '');
    if position(nw in def) > 0 and position(o in def) = 0 then
      raise notice '%: already in the joined_line_at order, left alone.', fn;
      continue;
    end if;
    n := (length(def) - length(replace(def, o, ''))) / length(o);
    if n <> 1 then
      raise exception '% is not the one this change expects (its queue ordering clause differs from the repository); nothing was changed. Send this sentence to BUILDER.', fn;
    end if;
    execute replace(def, o, nw);
  end loop;
end $do$;

select ryagram_private.gate_apply();                       -- every migration after the waiting-accounts file ends with it (tests/waiting-gate.test.mjs)

commit;
