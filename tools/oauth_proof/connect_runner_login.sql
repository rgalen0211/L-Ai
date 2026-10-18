-- NON-LIVE project only. Gives the connect_runner role a login. YOU choose the password: replace CHOOSE_A_LONG_RANDOM_PASSWORD below
-- with a long random one (a password manager's generator is fine), run this in the SQL Editor, and keep the password out of chat and files.
-- Then build the connection string yourself and put it in the Edge secret CONNECT_DB_URL (Dashboard > Edge Functions > Secrets):
--   postgresql://connect_runner.<PROJECT-REF>:<THE-PASSWORD>@<the pooler host shown under Connect > Transaction pooler>:6543/postgres
-- (the user name is connect_runner, a dot, then the project ref; port 6543 is the transaction pooler).
-- This role can execute the connect_* functions and NOTHING else: no table, no storage, no other function.
alter role connect_runner login password 'CHOOSE_A_LONG_RANDOM_PASSWORD';
