-- Waitlist behind Turnstile, part A: the function the waitlist-join Edge Function calls.
--
-- Run BEFORE deploying the page change. Harmless on its own: the page keeps working as today.
-- Part B (20260929000300) then removes the public key's direct insert, once the new page is live.

begin;

-- Adds one address (ignoring case); an address already listed is not an error, so the Edge
-- Function answers the same either way. Only service_role (the Edge Function) may call it.
create function public.waitlist_join(p_email text, p_use_case text, p_source text default 'uselai.com/ryagram')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ryagram_waitlist (email, use_case, source)
    values (trim(p_email), nullif(trim(p_use_case), ''), coalesce(p_source, 'uselai.com/ryagram'));
exception when unique_violation then
  null;                                            -- already on the list
end $$;

revoke execute on function public.waitlist_join(text, text, text) from public, anon, authenticated;
grant execute on function public.waitlist_join(text, text, text) to service_role;
grant usage on schema public to service_role;      -- "expose new tables" is OFF

commit;
