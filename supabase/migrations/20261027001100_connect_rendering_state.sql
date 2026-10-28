-- THE RENDER MACHINE'S STATE FOR THE CONNECTED AI (NEXT-CONNECT 153, Ryan 22:54 after Maria's test). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- A connected AI that queued a contact sheet or a preview kept asking job_status in a loop while the render machine was offline, and every ask used the person's own AI allowance. The tools now say, in
-- words, when the machine is not responding and tell the AI to stop checking; for that they need ONE fact: the same 'rendering' state the public status page shows (ok / delayed / unknown), computed by
-- ryagram_private.service_state() from the workers' last check-in. It is a plain word, it names no worker and no person, and it changes nothing.
-- Same shape as every connect_* function: the token hash is the only identity (scope 'read'), EXECUTE only to connect_runner.
-- Undo: supabase/rollbacks/20261027001100_connect_rendering_state_rollback.sql.

begin;

create function public.connect_rendering_state(p_token_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return ryagram_private.service_state();
end $$;

revoke all on function public.connect_rendering_state(text) from public, anon, authenticated;
grant execute on function public.connect_rendering_state(text) to connect_runner;

commit;
