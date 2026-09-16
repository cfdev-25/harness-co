-- Managed credential registry.
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  name text not null,
  ref text not null unique,
  kind text not null check (kind in ('provider_api_key','static_api_key')),
  env_var text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (org_unit_id, name)
);

-- Encrypted, versioned values keep stable refs across rotation.
create table api_key_versions (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references api_keys(id) on delete cascade,
  version integer not null,
  ciphertext bytea not null,
  last4 text not null,
  status text not null default 'active' check (status in ('active','grace','retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (api_key_id, version)
);
