-- The exact undo of migrations/20261027000800_invite_email.sql (Q302 B, invite email sent by Ryagram). NOT a migration: nothing applies it by itself.
-- WHAT IT LOSES: every invite_sends row (the address each invite was bound to, and its send counts), and every ops_outbox row of kind 'invite' (the old constraint cannot hold them).
-- The invite codes themselves are not touched. The send-invite function (if already redeployed) then fails closed because its two database functions are gone: redeploy the old commit of send-invite too.
begin;
drop function if exists public.admin_invite_send_begin(text, text);
drop function if exists public.admin_invite_send_undo(text);
drop function if exists ryagram_private.invite_address(text);
drop table if exists public.invite_sends;
delete from public.ops_outbox where kind = 'invite';
alter table public.ops_outbox drop constraint if exists ops_outbox_kind_check;
alter table public.ops_outbox add constraint ops_outbox_kind_check check (kind in ('alert', 'digest', 'ack', 'urgent'));
commit;
