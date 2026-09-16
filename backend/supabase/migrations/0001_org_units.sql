create extension if not exists pgcrypto;

-- The recursive tree from PRD 1.2. Every row is one org, team, or user ("org unit").
create table org_units (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references org_units(id) on delete restrict,
  role text not null check (role in ('org','team','user')),
  name text not null,
  path text not null,
  region text not null default 'us',
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);
create unique index org_units_path_idx on org_units(path);

create function org_units_slugify(value text)
returns text
language sql
immutable
strict
as $$
  select regexp_replace(
    regexp_replace(lower(trim(value)), '\s+', '-', 'g'),
    '[^a-z0-9-]',
    '',
    'g'
  )
$$;

create function org_units_role_order()
returns trigger
language plpgsql
as $$
declare
  parent_role text;
  parent_path text;
  unit_slug text;
begin
  unit_slug := org_units_slugify(new.name);
  if unit_slug = '' then
    raise exception using
      errcode = '23514',
      message = 'An org unit name must contain a letter or number.';
  end if;

  if new.parent_id is null then
    if new.role <> 'org' then
      raise exception using
        errcode = '23514',
        message = 'Only an org can be created without a parent.';
    end if;
    new.path := unit_slug;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception using
      errcode = '23514',
      message = 'An org unit cannot be its own parent.';
  end if;

  select role, path
    into parent_role, parent_path
    from org_units
   where id = new.parent_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'The parent org unit does not exist.';
  end if;

  if tg_op = 'UPDATE'
     and (parent_path = old.path or parent_path like old.path || '.%') then
    raise exception using
      errcode = '23514',
      message = 'An org unit cannot be moved inside itself.';
  end if;

  if (new.role = 'org' and parent_role <> 'org')
     or (new.role = 'team' and parent_role <> 'org')
     or (new.role = 'user' and parent_role <> 'team') then
    raise exception using
      errcode = '23514',
      message = case new.role
        when 'org' then 'An org can only be created at the root or inside another org.'
        when 'team' then 'A team can only be created inside an org.'
        when 'user' then 'A user can only be created inside a team.'
      end;
  end if;

  new.path := parent_path || '.' || unit_slug;
  return new;
end
$$;

create trigger org_units_role_order
before insert or update
on org_units
for each row
execute function org_units_role_order();

-- Recompute descendants when a unit is renamed or moved. Updating direct children
-- invokes this trigger recursively, so every descendant receives its new path.
create function org_units_refresh_descendant_paths()
returns trigger
language plpgsql
as $$
begin
  if new.path is distinct from old.path or new.role is distinct from old.role then
    update org_units
       set parent_id = parent_id
     where parent_id = new.id;
  end if;
  return null;
end
$$;

create trigger org_units_refresh_descendant_paths
after update of parent_id, role, name
on org_units
for each row
execute function org_units_refresh_descendant_paths();

-- Which login (Supabase auth user) owns which user-role org unit.
create table org_unit_members (
  auth_user_id uuid not null,
  user_unit_id uuid not null references org_units(id) on delete cascade,
  primary key (auth_user_id),
  unique (user_unit_id)
);

-- Which logins hold admin/platform rights over an org unit and its subtree.
create table org_unit_admins (
  auth_user_id uuid not null,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  level text not null check (level in ('admin','platform')),
  primary key (auth_user_id, org_unit_id)
);
