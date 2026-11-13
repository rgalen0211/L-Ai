-- THE SITE'S OWN FILM LOOK CARD (CONNECT 2026-11-13; BACKLOG WEB 4: "a person's own film shows its real colours on the site too"; WORKER's plan 10:00: "an owner SQL function for the card (CONNECT)").
-- NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Nothing happens until the website's editor calls these two functions (WEB's piece) AND the house worker's film-card job is on (it is built and off).
-- The chat editor already shows a film's REAL colours and one REAL frame from a "look card" (20261109000100_film_cards.sql): the connector asks through connect_film_card_ask / connect_film_card_get, which are
-- token-checked and runnable only by the connector. The website has no connector token, so these are the SAME two operations for the signed-in person's own session: my_film_card_ask(project) and my_film_card_get(project).
-- Same table, same rules, same lock: the request row is one per (person, project, saved story), so a card asked for from the chat is the card the site shows and the other way round (asking twice is one request),
-- at most 5 open and 100 a day per person, a failed card is tried again only for an engine error and only after 10 minutes, another person's film looks absent, and the story is never typed by the caller (the database
-- finds the project's CURRENT saved story itself). The advisory lock has the SAME key as the connector's ask, so a chat ask and a site ask at the same instant still count one after the other.
-- Differences from the connector twins, and only these: the person is the signed-in session (auth.uid() through require_signed_in()), not a token; and a waiting-list account is refused by the gate (gate_apply at the end),
-- the same way it refuses every other function a signed-in account can run. The two functions are runnable by a signed-in session only (not public, not anon).
-- Needs 20261109000100_film_cards.sql and 20261104000100_waiting_accounts.sql. Undo: supabase/rollbacks/20261113000500_my_film_cards_rollback.sql. (Undo this BEFORE 20261109000100_film_cards_rollback.sql: the reverse of the order applied.) After: supabase/live-steps/28_my_film_cards_after_check.sql.

begin;

create function public.my_film_card_ask(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions; same public.film_card_requests; waiting int; today int; nid uuid;
begin
  -- the same lock key as connect_film_card_ask: two asks together (chat and site, or two tabs) are counted one after the other
  perform pg_advisory_xact_lock(hashtextextended('film_card:' || me::text, 0));
  perform ryagram_private.film_card_sweep();
  select ver.* into v from public.versions ver join public.projects p on p.id = ver.project_id
    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;
  if not found then
    raise exception 'That film was not found among your projects.' using errcode = '22023';
  end if;
  select * into same from public.film_card_requests where owner_id = me and project_id = p_project and story_sha256 = v.story_sha256;
  if found then
    if same.state = 'failed' and same.fail_code = 'engine_error' and same.finished_at < now() - interval '10 minutes' then
      delete from public.film_card_requests where id = same.id;
    else
      return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);
    end if;
  end if;
  select count(*) into waiting from public.film_card_requests where owner_id = me and state in ('asked', 'claimed');
  if waiting >= 5 then
    raise exception 'There are already 5 film pictures waiting to be drawn. Wait for those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.film_card_requests where owner_id = me and asked_at > now() - interval '24 hours';
  if today >= 100 then
    raise exception 'That is 100 film pictures in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.film_card_requests (owner_id, project_id, version_id, story_sha256) values (me, p_project, v.id, v.story_sha256) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'asked', 'repeat', false);
end $$;

-- The newest card for the film (stale if the film has been saved again since), or where the newest request for the CURRENT saved story stands. Another person's film looks absent (null).
create function public.my_film_card_get(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  cur text; ok public.film_card_requests; r public.film_card_requests; retry boolean;
begin
  perform ryagram_private.film_card_sweep();
  select ver.story_sha256 into cur from public.versions ver join public.projects p on p.id = ver.project_id
    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;
  if not found then return null; end if;
  select * into ok from public.film_card_requests where owner_id = me and project_id = p_project and state = 'answered' order by (story_sha256 = cur) desc, finished_at desc limit 1;
  select * into r from public.film_card_requests where owner_id = me and project_id = p_project and story_sha256 = cur;
  retry := r.id is not null and r.state = 'failed' and r.fail_code = 'engine_error' and r.finished_at < now() - interval '10 minutes';
  if ok.id is not null then
    return jsonb_build_object('state', 'ready', 'id', ok.id, 'card', ok.answer, 'built_sha256', ok.story_sha256, 'current_sha256', cur, 'stale', ok.story_sha256 <> cur,
                              'refresh', case when ok.story_sha256 = cur or r.id is null then null else jsonb_build_object('state', r.state, 'fail_code', r.fail_code, 'retry', retry) end,
                              'waited_s', floor(extract(epoch from (ok.finished_at - ok.asked_at)))::int);
  end if;
  if r.id is null then return jsonb_build_object('state', 'none', 'current_sha256', cur); end if;
  return jsonb_build_object('state', r.state, 'id', r.id, 'current_sha256', cur, 'fail_code', r.fail_code, 'fail_detail', r.fail_detail, 'retry', retry,
                            'waited_s', floor(extract(epoch from (coalesce(r.finished_at, now()) - r.asked_at)))::int);
end $$;

revoke execute on function public.my_film_card_ask(uuid), public.my_film_card_get(uuid) from public, anon;
grant execute on function public.my_film_card_ask(uuid), public.my_film_card_get(uuid) to authenticated;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused here like everywhere else

commit;
