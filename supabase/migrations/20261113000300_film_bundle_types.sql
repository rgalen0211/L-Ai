-- Ryagram: film bundles (the editor's real frames), part 1 of 2: the new job type and artifact kind. CONNECT, 2026-11-13 (CC1's item 1, the L-Ai half; ENGINE's paper proposals/ENGINE-LIVE-EDITOR-REAL-FRAMES-1112.md, WORKER's job worker-film-bundle-1113).
--
-- Postgres cannot use a new enum value in the transaction that adds it, so the values live in their own file, run (and committed) before 20261113000400_film_bundles.sql. No data changes, nothing visible.
-- Undo: an enum value cannot be removed; it is harmless on its own (nothing uses it until part 2). supabase/rollbacks/20261113000400_film_bundles_rollback.sql undoes part 2.

-- 'scene_bundle' is BUILDER's older scene bundle (20261006, never merged): the worker's contract (ryagram/worker/contract.py) already names its kind and job type next to the film bundle, and tests/worker_contract.py
-- reads every one of them from the SQL, so both values must exist here. A scene_bundle job cannot be made (part 2 refuses it) and is switched off.
alter type public.job_type add value if not exists 'scene_bundle';
alter type public.artifact_kind add value if not exists 'scene_bundle';
alter type public.job_type add value if not exists 'film_bundle';
alter type public.artifact_kind add value if not exists 'film_bundle';
