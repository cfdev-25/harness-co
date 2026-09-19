-- A team may hold a team, so a group like `interns` is an ordinary org unit
-- (docs/scoping.md §5.4). `validate_role_order` in app/domain/org_tree.py was
-- changed for this; the trigger that actually guards the table was not, so a
-- real insert still failed while the Python gate passed.
--
-- The lesson is in the test, not here: test_org_tree.py exercised only the
-- pure-Python function, so a rule enforced in two places was changed in one
-- and nothing noticed. Anything the database also enforces needs a test that
-- reaches the database.
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
     or (new.role = 'user' and parent_role <> 'team') then
    raise exception using
      errcode = '23514',
      message = case new.role
        when 'org' then 'An org can only be created at the root or inside another org.'
        when 'team' then 'A team can only be created inside an org or another team.'
        when 'user' then 'A user can only be created inside a team.'
      end;
  end if;

  new.path := parent_path || '.' || unit_slug;
  return new;
end
$$;
