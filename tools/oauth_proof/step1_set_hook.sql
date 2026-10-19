-- Throwaway project only. Step 1 of 3: store the pre-request setting. This one statement, alone.
alter role authenticator set pgrst.db_pre_request = 'public.proof_pre_request';
