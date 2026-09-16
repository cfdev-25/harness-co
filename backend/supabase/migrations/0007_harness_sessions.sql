create table harness_sessions (
  id uuid primary key,
  org_unit_id uuid not null references org_units(id),
  owner_auth_user_id uuid not null,
  name text,
  access jsonb not null default '{"visibility":"private"}',
  legal_hold boolean not null default false,
  retention_until timestamptz,
  model_metadata jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);
