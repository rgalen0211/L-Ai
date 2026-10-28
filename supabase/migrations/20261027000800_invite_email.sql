-- Invite email sent by Ryagram (NEXT-WEB 155, Ryan 2026-10-27: "it should just send them an invite code from Ryagram"). NOT APPLIED: Ryan applies it.
-- Until now 'Invite someone' made a code and a mailto: link, so Ryan's own mail program sent it. The send-invite edge function now sends it through Ryagram's own mail
-- (the ops mail path, OPS_MAIL_MODE=resend). This migration holds the three things the database must decide:
--   * the invite's email address is bound to its code on the FIRST send, so a later send to any other address is refused (an admin cannot use this to mail strangers);
--   * a resend waits 60 seconds after the last send and stops after 3 sends per invite;
--   * every send is a row in ops_outbox (a new kind, 'invite'), so it shows in Recent messages.
-- The address is now stored (it was not before): invite_sends holds code_hash + address + counts, and goes with its code (on delete cascade), which the 12-month
-- retention purge already removes (retention_purge, 20261017000200). The Privacy draft needs one sentence for it (LEGAL-QUESTIONS-FOR-ATTORNEY.md).
-- Apply AFTER: 20261017000200_invite_someone.sql, 20261010000100_ops_readiness.sql.

alter table public.ops_outbox drop constraint ops_outbox_kind_check;
alter table public.ops_outbox add constraint ops_outbox_kind_check check (kind in ('alert', 'digest', 'ack', 'urgent', 'invite'));

create table public.invite_sends (
  code_hash text primary key references public.invite_codes (code_hash) on delete cascade,
  to_addr text not null check (char_length(to_addr) between 3 and 320),
  sends int not null default 0 check (sends between 0 and 3),
  first_sent_at timestamptz,
  last_sent_at timestamptz
);
alter table public.invite_sends enable row level security;
revoke all on table public.invite_sends from anon, authenticated, service_role;

-- The address as it is compared and mailed: trimmed, lower case, one @, no spaces, no angle brackets or commas (one recipient, never a list).
create function ryagram_private.invite_address(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when a ~ '^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$' and char_length(a) <= 320 then a end
  from (select lower(btrim(coalesce(p_email, ''))) as a) x
$$;

-- A new function gets EXECUTE for PUBLIC by default; the private schema stays closed (test_policy_grants: only the five policy functions). The two public functions below are definer functions that call it.
revoke execute on function ryagram_private.invite_address(text) from public, anon, authenticated, service_role;

-- Step 1 of a send (the admin's own login calls this from the edge function): checks everything and RESERVES the send; returns what the email needs.
create function public.admin_invite_send_begin(p_code text, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h text := ryagram_private.invite_hash(p_code); a text := ryagram_private.invite_address(p_email); c public.invite_codes; s public.invite_sends; wait_s int;
begin
  if not ryagram_private.is_app_admin() then raise exception 'Only an admin can send invites.' using errcode = '42501'; end if;
  if a is null then raise exception 'That does not look like one email address.' using errcode = 'P0001'; end if;
  select * into c from public.invite_codes where code_hash = h;
  if not found or c.label not like 'invite: %' then raise exception 'That invite code is not one you can send from here.' using errcode = 'P0001'; end if;
  if c.disabled or c.expires_at <= now() or c.uses >= c.max_uses then raise exception 'That invite code has expired or was already used.' using errcode = 'P0001'; end if;
  select * into s from public.invite_sends where code_hash = h for update;
  if found then
    if s.to_addr <> a then raise exception 'That invite was made for another address, so it cannot be sent to this one.' using errcode = 'P0001'; end if;
    if s.sends >= 3 then raise exception 'That invite has been sent 3 times, the most it allows. Make a new one.' using errcode = 'P0001'; end if;
    wait_s := ceil(60 - extract(epoch from now() - s.last_sent_at))::int;
    if wait_s > 0 then raise exception 'Wait % more seconds before sending it again.', wait_s using errcode = 'P0001'; end if;
    update public.invite_sends set sends = sends + 1, last_sent_at = now() where code_hash = h;
  else
    insert into public.invite_sends (code_hash, to_addr, sends, first_sent_at, last_sent_at) values (h, a, 1, now(), now());
  end if;
  return jsonb_build_object('to', a, 'name', btrim(substr(c.label, 9)), 'credits', c.grant_credits, 'expires_at', c.expires_at,
    'sends', coalesce(s.sends, 0) + 1);
end $$;

-- Step 2 when the mail service refused the message: give the reservation back, so a failed send does not use up one of the 3 (and the 60 seconds).
create function public.admin_invite_send_undo(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare h text := ryagram_private.invite_hash(p_code);
begin
  if not ryagram_private.is_app_admin() then raise exception 'Only an admin can send invites.' using errcode = '42501'; end if;
  update public.invite_sends set sends = sends - 1, last_sent_at = case when sends = 1 then null else now() - interval '61 seconds' end,
    first_sent_at = case when sends = 1 then null else first_sent_at end where code_hash = h and sends > 0;
  delete from public.invite_sends where code_hash = h and sends = 0;
end $$;

revoke execute on function public.admin_invite_send_begin(text, text), public.admin_invite_send_undo(text) from public, anon;
grant execute on function public.admin_invite_send_begin(text, text), public.admin_invite_send_undo(text) to authenticated;
