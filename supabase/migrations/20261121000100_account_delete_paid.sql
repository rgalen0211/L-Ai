-- ACCOUNT DELETION FOR A CUSTOMER WHO PAID, AND EMAILS LEFT BEHIND (GEO, 2026-11-21; CC1 10:4x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md
-- M1 and M5). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. It adds TWO new functions (service role only) and changes no existing one.
-- Why M1: delete-account recorded only a REQUEST for anyone with credit history (the ledger is a financial record) and removed nothing,
-- so a paying customer's uploads and films stayed until a hand step that has no procedure. Now the function removes both buckets' files
-- first (as for everyone), then account_erase_paid_content leaves only tombstones: an upload becomes 'Deleted data' with no name, file
-- label, report or mapping (exactly mark_uploads_removed's tombstone), and a film row is marked deleted. Both only where the file is
-- really gone from Storage, so a failed removal is retried by asking again. The ledger, the account and its login are NOT touched: the
-- request row stays, and Ryan closes the account by hand.
-- Why M5: support_requests.email and invite_redemptions.email outlived the account (support_requests set owner_id to null on delete;
-- an unanswered request was kept with no end). account_redact_contact replaces the address in both, for the person's own rows
-- (by owner, or by the address itself in any case where the row has no owner; a creator application by its address), BEFORE the login goes. The support message itself is kept (its retention is
-- support's: answered requests 3 years); the row no longer names the person.
-- Nothing here reaches the Stripe customer record (it keeps the email at Stripe); the Privacy page says so (GEO review L4).
begin;

create function public.account_erase_paid_content(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uploads int;
  films int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  uploads := public.mark_uploads_removed(array(select d.id from public.datasets d where d.owner_id = p_owner and d.deleted_at is null));
  update public.artifacts a set deleted_at = now()
    where a.owner_id = p_owner and a.deleted_at is null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path);
  get diagnostics films = row_count;
  return jsonb_build_object('uploads_erased', uploads, 'films_marked_deleted', films,
    'uploads_left', (select count(*) from public.datasets d where d.owner_id = p_owner and d.deleted_at is null and d.storage_path is not null),
    'films_left', (select count(*) from public.artifacts a where a.owner_id = p_owner and a.deleted_at is null));
end $$;

create function public.account_redact_contact(p_owner uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(coalesce(p_email, '')));
  support int;
  invites int;
  applications int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  update public.support_requests s set email = 'redacted@deleted.invalid'
    where s.email <> 'redacted@deleted.invalid'
      and (s.owner_id = p_owner or (s.owner_id is null and addr <> '' and lower(s.email) = addr));   -- never another person's row (CC1 10:57)
  get diagnostics support = row_count;
  update public.invite_redemptions r set email = 'redacted'
    where r.email <> 'redacted'
      and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr));
  -- a creator application names no account: matched by the address alone (CC1 10:57 LOW 5)
  update public.creator_applications c set email = 'redacted@deleted.invalid', name = 'Deleted'
    where c.email <> 'redacted@deleted.invalid' and addr <> '' and lower(c.email) = addr;
  get diagnostics applications = row_count;
  get diagnostics invites = row_count;
  return jsonb_build_object('support_requests_redacted', support, 'invite_redemptions_redacted', invites,
                            'creator_applications_redacted', applications);
end $$;

revoke execute on function public.account_erase_paid_content(uuid), public.account_redact_contact(uuid, text)
  from public, anon, authenticated;
grant execute on function public.account_erase_paid_content(uuid), public.account_redact_contact(uuid, text) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (both functions are service role only)
commit;
