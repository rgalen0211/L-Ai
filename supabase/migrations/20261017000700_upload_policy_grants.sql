-- Upload policy grants (CC1, 2026-10-17; WEB's read-only live check the same day found both false).
--
-- The two storage policies below call these functions as the SIGNED-IN person, so `authenticated` must be able to
-- execute them:
--   * ryagram_private.upload_slot_ok(text)          policy "People fill their own upload slot once"
--   * ryagram_private.worker_may_read_upload(text)  policy "Worker reads the uploads it is working on"
-- 20261004000200_uploads_schema.sql granted them. phase-2b/credits_ledger.sql and phase-2b/stripe_test_mode.sql,
-- applied by hand after it, end with "revoke execute on all functions in schema ryagram_private" and re-granted only
-- owner_may_read, worker_may_write and is_worker. So on live these two lost execute, and an upload would fail with
-- "permission denied" (uploads are off, so nothing live has failed yet). Both phase-2b files now re-grant all five.
--
-- Exactly these two functions; `authenticated` only, never public or anon. Safe to run more than once.
-- Checked by supabase/tests/test_policy_grants.py.

revoke execute on function ryagram_private.upload_slot_ok(text), ryagram_private.worker_may_read_upload(text)
  from public, anon;
grant execute on function ryagram_private.upload_slot_ok(text), ryagram_private.worker_may_read_upload(text)
  to authenticated;
