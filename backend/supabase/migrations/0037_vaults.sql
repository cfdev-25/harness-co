-- console/00-overview.md §4.11 (*Connect a vault* · *Disconnect a vault*) and
-- engine 04 §7. A key vault is a record, not a definition: a branch only ever
-- *names* one, through `SecretRef.vault` in `policy/groups.json`, and that name
-- is not validated at push (engine 01 §4.2) — an unknown vault is refused at
-- mint. This table is what "connected" means, so `DELETE /v1/vaults/{id}` can
-- be refused while a group still names it.
--
-- `id` is the id a group writes, not a uuid: `bundled`, `aws-prod`. It is
-- unique per organisation because the groups that name it are.
create table vaults (
  org_unit_id uuid not null references org_units(id),
  id text not null,
  provider text not null,                                  -- bundled · aws · vault · …
  auth jsonb not null default '{}'::jsonb,                 -- how we reach it; never a value
  lists_secrets boolean not null default false,            -- prd-v2 §6.2 honest degradation
  connected_by uuid,
  connected_at timestamptz not null default now(),
  primary key (org_unit_id, id)
);

alter table vaults enable row level security;
