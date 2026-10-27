-- Throwaway project only. Replaces the hook function: the first version was declared STABLE, which forbids the log insert
-- and made every sign-in fail with "Error running hook". Grants on the function are kept by CREATE OR REPLACE.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql as $$
declare
  claims jsonb := event -> 'claims';
  method text := coalesce(event ->> 'authentication_method', '');
  is_ai boolean := (claims ? 'client_id') or method ilike 'oauth%';
begin
  insert into public.proof_hook_log (event_keys, claim_keys, auth_method, tagged)
    select string_agg(k, ','), (select string_agg(k2, ',') from jsonb_object_keys(claims) k2), method, is_ai
    from jsonb_object_keys(event) k;
  if is_ai then
    claims := jsonb_set(claims, '{aud}', '"ryagram-connect"');
  end if;
  return jsonb_set(event, '{claims}', claims);
end $$;
