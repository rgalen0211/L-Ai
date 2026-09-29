-- Waitlist behind Turnstile, part B: close the direct door.
--
-- Run only AFTER the page with the Turnstile check is live and a test signup through it worked.
-- Until now the public (publishable) key could insert into ryagram_waitlist directly, which is
-- how a bot would skip the check. After this, the only way in is the waitlist-join Edge Function.

begin;

revoke insert on table public.ryagram_waitlist from anon, authenticated;
drop policy if exists "Visitors can join the waitlist" on public.ryagram_waitlist;

commit;
