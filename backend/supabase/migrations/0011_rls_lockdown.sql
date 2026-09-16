do $$
declare
  t text;
begin
  foreach t in array array[
    'org_units','org_unit_members','org_unit_admins','org_unit_boundaries',
    'assets','asset_versions','asset_files',
    'api_keys','api_key_versions',
    'automation_runners',
    'audit_log','audit_log_latest_hashes',
    'harness_sessions','personal_access_tokens','org_invites'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
  end if;
end
$$;
