-- SIGN-UP DAY BY OPENED EMAILS: the exact undo of migrations/20261126000100_join_day_by_opened.sql. NOT a migration: it lives outside
-- migrations/ so nothing applies it by accident. It takes the two edits out of public.join_reserve (the ask-ceiling block, then the 'opened' clause),
-- drops the confirmation trigger and its function, and the two columns (join_attempts.confirmed_at, ops_settings.join_asks_max: write a value Ryan
-- set down first).
begin;

do $do$
declare
  def text;
  p1_old constant text := E'from public.join_attempts where at > now() - interval ''1 day'')';
  p1_new constant text := E'from public.join_attempts where at > now() - interval ''1 day'' and confirmed_at is not null)';
  asks   constant text := E'  -- the ceiling on ASKS (BUILDER 11-26): every different address asked for in 24 hours, opened or not; empty = 2 x the day''s size\n  if (select count(distinct email_hash) from public.join_attempts where at > now() - interval ''1 day'')\n       >= coalesce((select o.join_asks_max from public.ops_settings o limit 1), 2 * coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200))\n     and not exists (select 1 from public.join_attempts a where a.email_hash = eh and a.at > now() - interval ''1 day'') then\n    return jsonb_build_object(''ok'', false, ''reason'', ''full'');\n  end if;\n';
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.join_reserve(text, text)');
  if def is null then return; end if;
  def := replace(def, chr(13), '');
  if position(asks in def) = 0 and position(p1_new in def) = 0 then return; end if;          -- already back
  if (length(def) - length(replace(def, asks, ''))) / length(asks) <> 1 or (length(def) - length(replace(def, p1_new, ''))) / length(p1_new) <> 1 then
    raise exception 'public.join_reserve does not hold this change exactly once; nothing was changed. Send this sentence to BUILDER.';
  end if;
  execute replace(replace(def, asks, ''), p1_new, p1_old);
end $do$;

drop trigger if exists join_attempt_confirmed_trg on auth.users;
drop function if exists ryagram_private.join_attempt_confirmed();
alter table public.join_attempts drop column if exists confirmed_at;
alter table public.ops_settings drop column if exists join_asks_max;

commit;
