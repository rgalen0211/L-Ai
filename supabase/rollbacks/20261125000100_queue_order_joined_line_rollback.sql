-- QUEUE ORDER BY WHEN A JOB JOINED THE LINE: the exact undo of migrations/20261125000100_queue_order_joined_line.sql. NOT a migration: it lives
-- outside migrations/ so nothing applies it by accident. It puts the three ordering clauses back to created_at (claim_next_job, node_claim,
-- queue_position), drops the trigger, its function, the index and the jobs.joined_line_at column. The line goes back to the order by when a job
-- was made (an approved full film can again go ahead of jobs queued after it was asked for).
begin;

do $do$
declare
  def text; n int; i int; fn text; o text; nw text;
  -- the same four short pairs as the migration, each put back
  fns  constant text[] := array['public.claim_next_job()', 'public.claim_next_job()', 'public.node_claim(text)', 'public.queue_position(uuid)'];
  news constant text[] := array['and o.joined_line_at < now() - interval ''', 'then 0 else 1 end, joined_line_at, id',
                                'order by joined_line_at, id for update skip locked limit 1;', '(q.joined_line_at, q.id) < (j.joined_line_at, j.id)'];
  olds constant text[] := array['and o.created_at < now() - interval ''', 'then 0 else 1 end, created_at, id',
                                'order by created_at, id for update skip locked limit 1;', '(q.created_at, q.id) < (j.created_at, j.id)'];
begin
  for i in 1 .. array_length(fns, 1) loop
    fn := fns[i]; nw := news[i]; o := olds[i];
    select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure(fn);
    if def is null then continue; end if;
    def := replace(def, chr(13), '');
    n := (length(def) - length(replace(def, nw, ''))) / length(nw);
    if n = 0 then continue; end if;                                 -- already back
    if n <> 1 then
      raise exception '% does not hold the joined_line_at clause exactly once; nothing was changed. Send this sentence to BUILDER.', fn;
    end if;
    execute replace(def, nw, o);
  end loop;
end $do$;

drop trigger if exists jobs_joined_line on public.jobs;
drop function if exists ryagram_private.jobs_joined_line();
drop index if exists public.jobs_queued_line_idx;
alter table public.jobs drop column if exists joined_line_at;

commit;
