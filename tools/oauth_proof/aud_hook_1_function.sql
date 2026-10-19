-- Throwaway project only. Candidate fix for the Supabase Auth door: give tokens issued to an AI connection a DIFFERENT
-- audience, so Supabase Auth's own user endpoints (change password, enrol 2FA, read email) stop accepting them, while
-- PostgREST (which the connect_* functions use) still does. Run as one file, then do dashboard step "Auth hook" below.
--
-- It also writes the event's key NAMES (never values) to proof_hook_log so we can see what the hook is given.

create table if not exists public.proof_hook_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  event_keys text,
  claim_keys text,
  auth_method text,
  tagged boolean
);
alter table public.proof_hook_log enable row level security;       -- no policies: only the secret key reads it

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
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

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant insert on public.proof_hook_log to supabase_auth_admin;
grant usage, select on sequence public.proof_hook_log_id_seq to supabase_auth_admin;
