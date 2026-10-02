-- engine/02-definitions-service.md §8.2. The derived index: `definitions`
-- composes and posts rows to `POST /v1/internal/index`; `api` owns the tables
-- and reads them through the three seams in §8.6. Rebuildable from the repos
-- alone, so nothing here is authoritative.
--
-- §8.2 also says the tables are owned by role `harness_index` with `SELECT`
-- only for `api`'s record role. Roles are cluster-global, not per-database,
-- so granting them is a deployment step and not this migration's; and the
-- `POST /v1/internal/index` writer in this same milestone is `api` itself.
create table idx_refs (
  org uuid not null, ref text not null, commit text not null,
  indexed_at timestamptz not null default now(),
  primary key (org, ref));

create table idx_stale (                              -- a ref whose index write failed; the broker refuses the org while any row exists
  org uuid not null, ref text not null, commit text not null,
  error text not null, at timestamptz not null default now(),
  primary key (org, ref));

create table idx_nodes (
  org uuid not null, path text not null, kind text not null check (kind in ('org','team','user')),
  ref text not null, parent_path text,
  primary key (org, path));

create table idx_assets (                             -- one row per (node, asset): placement
  org uuid not null, node_path text not null, id uuid not null,
  kind text not null, name text not null, tree text not null, sidecar jsonb not null,
  primary key (org, node_path, id));
create index on idx_assets (org, id);

create table idx_harnesses (
  org uuid not null, node_path text not null, id uuid not null,
  name text not null, def jsonb not null,
  primary key (org, id));

create table idx_policy (                             -- the parsed policy files per node, verbatim
  org uuid not null, node_path text not null, file text not null, body jsonb not null,
  primary key (org, node_path, file));

create table idx_effective (                          -- per person: the winning copy of each id
  org uuid not null, user_id uuid not null, asset_id uuid not null,
  from_path text not null, shadows_path text,
  primary key (org, user_id, asset_id));

create table idx_edges (                              -- the relationships; both directions are one row
  org uuid not null,
  -- The ref whose index write owns this row. Not in 02 §8.2, and needed there:
  -- edges are derived per ref (§8.3 step 4) and carry no other node column, so
  -- without it a re-index of one ref cannot delete only that ref's edges.
  ref text not null,
  from_kind text not null, from_id text not null,
  rel text not null,
  to_kind text not null, to_id text not null,
  primary key (org, ref, from_kind, from_id, rel, to_kind, to_id));
create index on idx_edges (org, to_kind, to_id, rel);

do $$
declare
  t text;
begin
  foreach t in array array[
    'idx_refs','idx_stale','idx_nodes','idx_assets','idx_harnesses',
    'idx_policy','idx_effective','idx_edges'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;
