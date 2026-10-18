-- Throwaway project only. The minimal hook: no logging, no table access, a pure function. This is also the shape the real
-- one must have (a hook that can raise locks every person out of sign-in).
-- Grants follow Supabase's Custom Access Token hook guide (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook,
-- read 2026-10-17): the auth service role may execute it; nobody else may call it through the API. They are repeated here so this
-- file is complete on its own (aud_hook_1_function.sql already granted them; repeating is harmless).
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql immutable as $$
declare
  claims jsonb := event -> 'claims';
begin
  -- The guide lists authentication_method 'oauth_provider/authorization_code' for tokens issued by the OAuth server and
  -- 'token_refresh' for refreshes; whether client_id is present in claims at hook time is NOT documented, so test both.
  if claims ? 'client_id' or coalesce(event ->> 'authentication_method', '') = 'oauth_provider/authorization_code' then
    claims := jsonb_set(claims, '{aud}', '"ryagram-connect"');
  end if;
  return jsonb_set(event, '{claims}', claims);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
