-- Turns the pre-request chokepoint OFF (throwaway project only), to show what an OAuth token can do without it.
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
