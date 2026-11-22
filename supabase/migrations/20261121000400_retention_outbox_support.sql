-- RETENTION OF THE MAIL WE SENT AND OF UNANSWERED HELP REQUESTS (GEO, 2026-11-21; CC1 11:0x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md
-- M4 and the second half of M5). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, AFTER 20261121000100_account_delete_paid.sql. It
-- CHANGES TWO FUNCTIONS: public.retention_purge (copied from 20261017000900_funnel_events.sql, its newest version, with only new lines
-- added) and public.account_redact_contact (from 20261121000100, the same way). Grants and owners are kept (create or replace).
-- The numbers, for the Privacy page:
--   * mail we sent a person (invites and approvals, kind 'invite': address, first name, code, app link): removed 12 months after it was sent;
--   * Ryan's own alerts, digests and acks: removed after 12 months;
--   * urgent (child-safety) mail: NOT purged here (kept as long as the law requires; LEGAL-QUESTIONS T5);
--   * a help request nobody answered: removed 12 months after it was sent (answered ones stay 3 years, as before);
--   * on 'delete my account': every outbox row addressed to the person is erased (urgent mail excepted), and their address inside any
--     other message is replaced by '[deleted address]'.
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

create or replace function public.account_redact_contact(p_owner uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(coalesce(p_email, '')));
  support int;
  invites int;
  out_gone int := 0;
  out_redacted int := 0;
  pat text;
  applications int;
  labels int;
  creator_labels int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  update public.support_requests s set email = 'redacted@deleted.invalid'
    where s.email <> 'redacted@deleted.invalid'
      and (s.owner_id = p_owner or (s.owner_id is null and addr <> '' and lower(s.email) = addr));   -- never another person's row (CC1 10:57)
  get diagnostics support = row_count;
  -- the code a person was invited with names them ('invite: <name>'): its label goes first, while the redemption still points at it
  -- (CC1 11:15 LOW d); retention_purge still removes it 12 months on (its label still starts 'invite: ')
  update public.invite_codes k set label = 'invite: (deleted)'
    where k.label like 'invite: %' and k.label <> 'invite: (deleted)'
      and exists (select 1 from public.invite_redemptions r where r.code_hash = k.code_hash
                    and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr)));
  get diagnostics labels = row_count;
  -- a creator's invite is labelled 'creator #<application id> <name>' (creator_flow.sql): its name goes too, found by the application, before that is redacted
  update public.invite_codes k set label = 'creator #' || c.id || ' (deleted)'
    from public.creator_applications c
    where addr <> '' and lower(c.email) = addr and k.label like 'creator #' || c.id || ' %' and k.label <> 'creator #' || c.id || ' (deleted)';
  get diagnostics creator_labels = row_count;
  labels := labels + creator_labels;
  update public.invite_redemptions r set email = 'redacted'
    where r.email <> 'redacted'
      and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr));
  get diagnostics invites = row_count;                    -- right after its own update (CC1 11:15 LOW a)
  -- a creator application names no account: matched by the address alone (CC1 10:57 LOW 5). lower(email) is UNIQUE
  -- (creator_applications_email_key), so each row gets ITS OWN address: one fixed address would collide on the second applicant (CC1 11:15 HIGH)
  update public.creator_applications c set email = 'redacted+' || c.id || '@deleted.invalid', name = 'Deleted'
    where addr <> '' and lower(c.email) = addr;
  get diagnostics applications = row_count;
  -- GEO 11-21 (review M4): mail we sent TO the person is erased (invites, approvals); urgent (child-safety) mail is kept.
  if addr <> '' then
    delete from public.ops_outbox o where o.kind <> 'urgent' and lower(o.to_addr) = addr;
    get diagnostics out_gone = row_count;
    -- and their address inside any other message (an alert or a digest to Ryan) is replaced: the WHOLE address only, in any case
    -- (CC1 11:15 MEDIUM): every non-letter, non-digit is escaped, and no address character may touch it on either side,
    -- so bryan@example.com or ryan@example.company stay; a sentence's full stop after it is not part of it.
    pat := '(?<![a-z0-9._%+@-])' || regexp_replace(addr, '([^a-z0-9])', '\\\1', 'g') || '(?![a-z0-9_%+@-]|\.[a-z0-9])';
    update public.ops_outbox o set body = regexp_replace(o.body, pat, '[deleted address]', 'gi')
      where o.kind <> 'urgent' and o.body ~* pat;
    get diagnostics out_redacted = row_count;
  end if;
  return jsonb_build_object('support_requests_redacted', support, 'invite_redemptions_redacted', invites, 'invite_labels_redacted', labels,
                            'creator_applications_redacted', applications,
                            'outbox_rows_erased', out_gone, 'outbox_rows_redacted', out_redacted);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (both functions are service role only)
commit;
