create table org_invites (
  id uuid primary key default gen_random_uuid(),
  team_unit_id uuid not null references org_units(id) on delete cascade,
  admin_unit_id uuid references org_units(id) on delete cascade,
  admin_level text check (admin_level in ('admin','platform')),
  email text not null,
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_auth_user_id uuid,
  check ((admin_unit_id is null) = (admin_level is null))
);

create unique index org_invites_pending_email_idx
  on org_invites (lower(email))
  where accepted_at is null;

create function public.org_invites_link_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  invite record;
  unit_id uuid;
begin
  select * into invite
    from org_invites
   where lower(email) = lower(new.email)
     and accepted_at is null
   order by created_at
   limit 1;
  if not found then
    return new;
  end if;

  insert into org_units (parent_id, role, name)
  values (invite.team_unit_id, 'user', lower(new.email))
  returning id into unit_id;

  insert into org_unit_members (auth_user_id, user_unit_id)
  values (new.id, unit_id);

  if invite.admin_unit_id is not null then
    insert into org_unit_admins (auth_user_id, org_unit_id, level)
    values (new.id, invite.admin_unit_id, invite.admin_level);
  end if;

  update org_invites
     set accepted_at = now(),
         accepted_auth_user_id = new.id
   where id = invite.id;

  return new;
end
$$;

create trigger org_invites_link_new_user
after insert on auth.users
for each row
execute function public.org_invites_link_new_user();
