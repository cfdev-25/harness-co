-- A harness definition may sit on more than one node of a chain: the org's
-- copy and a person's version of it, same id (engine 01 D3, extended to
-- harnesses on 28 Sep 2026). The index keys it per node, as idx_assets and
-- idx_policy already are; the first personal harness update 500'd on the old
-- key and marked the person's ref stale.
alter table idx_harnesses drop constraint idx_harnesses_pkey;
alter table idx_harnesses add primary key (org, node_path, id);
