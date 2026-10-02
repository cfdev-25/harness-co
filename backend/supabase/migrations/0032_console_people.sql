-- console/03-data-and-naming.md §7, the `0032_people.sql` delta. A person who
-- has left is not deleted: their sessions, their audit rows and their branch
-- stay true, so `PersonRow.state` reads `deactivated` from a timestamp rather
-- than from an absent row (console 00 §4.9).
--
-- §7's third delta, `alter table harness_sessions add column preflight jsonb`,
-- is not repeated here: 0030_sessions_broker.sql already added that column.
alter table org_unit_members add column deactivated_at timestamptz;
