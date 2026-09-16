-- One row per connection/tool/skill/memory attached to an org unit.
create table assets (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  kind text not null check (kind in ('connection','tool','skill','memory')),
  name text not null,
  head_version_id uuid,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  unique (org_unit_id, kind, name)
);

-- Immutable history: one row per saved version of an asset.
create table asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  parent_version_id uuid references asset_versions(id),
  seq integer not null,
  file_hashes jsonb not null,
  author_auth_user_id uuid not null,
  message text not null,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (asset_id, seq)
);

alter table assets add constraint assets_head_fk
  foreign key (head_version_id) references asset_versions(id);

-- Content-addressed file bodies shared by all versions and promoted copies.
create table asset_files (
  hash text primary key,
  content bytea not null,
  size integer not null,
  created_at timestamptz not null default now()
);
