-- PIPE-1, step 1 of 2: the job state a full render waits in for Ryan's approval (JOB-CONTRACT-v1, frozen 2026-10-17,
-- sha256 eedfe74a5778e3234e2a8cd6326b55e079b99220be16ef5f448ee833fdeebf94, section 2).
--
-- APPLY THIS FILE ON ITS OWN AND LET IT COMMIT before 20261017000600_pipe1_orders.sql. Postgres refuses to USE a new
-- enum value in the transaction that added it (CC1's note at the freeze), and the next file uses it in a function,
-- a CASE and an insert. In the SQL editor: run this file, then run the next one as a separate query.
--
-- claim_next_job takes 'queued' jobs only, so the worker never sees a job in this state.
alter type public.job_state add value if not exists 'awaiting_approval';
