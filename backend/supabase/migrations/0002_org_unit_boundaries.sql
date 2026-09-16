create table org_unit_boundaries (
  org_unit_id uuid primary key references org_units(id) on delete cascade,
  policy jsonb not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
