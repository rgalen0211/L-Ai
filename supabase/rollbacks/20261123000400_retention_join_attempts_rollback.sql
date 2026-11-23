-- THE EXACT UNDO of migrations/20261123000400_retention_join_attempts.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts public.retention_purge back as 20261121000400_retention_outbox_support.sql defined it (no join_attempts or invite_attempts delete, and no such keys in the answer). Rows already deleted stay deleted. Ends with gate_apply.
begin;
create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; people int := 0; helps int := 0; reps int := 0; funnel int := 0; ids bigint[];
        unanswered int := 0; out_invites int := 0; out_ops int := 0;        -- GEO 11-21 (review M4, M5)
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  -- Invites Ryan made for a person directly (label 'invite: <name>', admin_invite_person): the code row holds the name and its redemption holds the email.
  -- Removed 12 months after the code was last redeemed, or, if nobody used it, 12 months after it expired. Never earlier: a valid, unused invite stays.
  delete from public.invite_codes c where c.label like 'invite: %'
    and coalesce((select max(r.created_at) from public.invite_redemptions r where r.code_hash = c.code_hash), c.expires_at) < now() - interval '12 months';
  get diagnostics people = row_count;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  -- Funnel events: 13 months after they happened (the account's source row stays while the account does).
  delete from public.funnel_events where at < now() - interval '13 months';
  get diagnostics funnel = row_count;
  -- GEO 11-21 (review M5): a help request nobody answered is removed 12 months after it was sent (answered ones: 3 years, above).
  delete from public.support_requests where answered_at is null and created_at < now() - interval '12 months';
  get diagnostics unanswered = row_count;
  -- GEO 11-21 (review M4): the mail we sent. Invites and approvals ('invite': a person's address, first name, code, app link) go
  -- 12 months after sending, as invite_email.sql's comment promised for the address; Ryan's own alerts, digests and acks go after
  -- 12 months too. Urgent (child-safety) mail is NOT purged here: it is kept as long as the law requires (LEGAL-QUESTIONS T5).
  delete from public.ops_outbox where kind = 'invite' and created_at < now() - interval '12 months';
  get diagnostics out_invites = row_count;
  delete from public.ops_outbox where kind in ('alert', 'digest', 'ack') and created_at < now() - interval '12 months';
  get diagnostics out_ops = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'person_invites', people, 'help_requests', helps, 'reports', reps, 'funnel_events', funnel,
                            'help_requests_unanswered', unanswered, 'outbox_invites', out_invites, 'outbox_ops_mail', out_ops);
end $$;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;
