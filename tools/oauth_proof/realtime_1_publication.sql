-- Throwaway project only. Puts the test table in the Realtime publication (the real app does this for jobs). One statement.
alter publication supabase_realtime add table public.proof_notes;
