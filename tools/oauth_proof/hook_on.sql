-- Turns the pre-request chokepoint ON (throwaway project only).
alter role authenticator set pgrst.db_pre_request = 'public.proof_pre_request';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
