-- A personal account is an organization with zero teams (prd-v2 §12.1, engine
-- 00 D30f): the chain is `org · me`, so the person's user node hangs directly
-- off the org. `org_units_role_order` (0001, widened for sub-teams in 0027)
-- refuses that — `user` was only ever allowed inside a `team` — so sign-up
-- could not create the two-node chain the personal edition is.
--
-- This changes one clause: a user may sit inside an org or a team. Teams keep
-- 0027's rule (inside an org or another team) and orgs keep 0001's, so an
-- enterprise tree is validated exactly as before. 0027's lesson holds: the
-- rule lives in two places (`app/domain/org_tree.py` `validate_role_order` is
-- the other), and the test that proves this one reaches the database.
create or replace function org_units_role_order()
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
      message = 'An org unit needs a name with at least one letter or number.';
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
     or (new.role = 'team' and parent_role not in ('org', 'team'))
     or (new.role = 'user' and parent_role not in ('org', 'team')) then
    raise exception using
      errcode = '23514',
      message = case new.role
        when 'org' then 'An org can only be created at the root or inside another org.'
        when 'team' then 'A team can only be created inside an org or another team.'
        when 'user' then 'A person can only be created inside an org or a team.'
      end;
  end if;

  new.path := parent_path || '.' || unit_slug;
  return new;
end
$$;
