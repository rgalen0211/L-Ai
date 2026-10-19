-- Throwaway project only. Step 2 of 3: is the setting stored? One result grid.
-- Success looks like a rolconfig list that includes pgrst.db_pre_request=public.proof_pre_request.
select rolconfig from pg_roles where rolname = 'authenticator';
