-- Throwaway project only. The hook's log table has row security on and no insert rule, so the auth service's insert
-- fails and every sign-in returns 500 "Error running hook". This lets the auth service (and only it) insert.
create policy proof_hook_log_insert on public.proof_hook_log for insert to supabase_auth_admin with check (true);
