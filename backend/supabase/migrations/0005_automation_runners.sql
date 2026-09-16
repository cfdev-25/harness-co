create table automation_runners (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  name text not null,
  enrollment_token_hash text,
  status text not null default 'pending' check (status in ('pending','enrolled','revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
