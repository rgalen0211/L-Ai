-- Throwaway project only. The Realtime half of the chokepoint: a RESTRICTIVE select policy on every table in the
-- Realtime publication that denies any JWT carrying client_id. (The real migration generates this for each table in
-- pg_publication_tables, today only public.jobs.) Run only after doors.mjs "before-fix" has shown the hazard.
create policy proof_notes_no_oauth_select on public.proof_notes as restrictive for select to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);
