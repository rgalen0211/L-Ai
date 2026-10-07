-- Ryagram: scene bundles, part 1 of 2. The new job type and artifact kind.
--
-- Postgres cannot use a new enum value in the transaction that adds it, so the
-- values live in their own file, run (and committed) before
-- 20261006000300_scene_bundles.sql. No data changes.

alter type public.job_type add value if not exists 'scene_bundle';
alter type public.artifact_kind add value if not exists 'scene_bundle';
