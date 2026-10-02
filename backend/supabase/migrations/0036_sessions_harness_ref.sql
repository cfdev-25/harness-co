-- engine 04 §6 / console 03 §7: a session names a harness by id from the index (idx_harnesses), which is
-- derived from git and may hold ids the legacy `harnesses` table never saw. The FK to that table would
-- refuse every session on an index-only harness. Drop it; `closed_at` gives SessionRow.closedAt a source.
alter table harness_sessions drop constraint if exists harness_sessions_harness_id_fkey;
alter table harness_sessions add column if not exists closed_at timestamptz;
