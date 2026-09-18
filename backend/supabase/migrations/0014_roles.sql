-- Roles were 'admin' | 'platform', and nothing ever read the column: is_admin
-- only asked whether a grant existed. Name them for what they mean and make
-- the distinction real.
--
-- A role is always a grant AT A NODE and applies to that node's whole subtree,
-- which is what makes "admin of Marketing" and "owner of the org" the same
-- mechanism at different heights. There is no 'user' row: being a member with
-- no grant is what "user" means.
alter table org_unit_admins drop constraint if exists org_unit_admins_level_check;
update org_unit_admins set level = 'owner' where level = 'platform';
alter table org_unit_admins add constraint org_unit_admins_level_check
  check (level in ('owner', 'admin'));

comment on table org_unit_admins is
  'Role grants. level owner|admin, inherited by every descendant of org_unit_id.';
