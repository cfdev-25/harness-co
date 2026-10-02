-- 00 D30g: the platform scope is reserved, not built. `staff` is never an org
-- role, so it is its own table and not a level in `org_unit_admins`; a publish
-- request (00 §4.10) is refused for anyone without a row here.
create table platform_staff (
  auth_user_id uuid primary key,
  added_at timestamptz not null default now()
);
alter table platform_staff enable row level security;
