-- engine/04-broker.md §6. The session record carries everything the session
-- ran on, so the record stays true for its whole life.
alter table harness_sessions
  drop column access,                                   -- never read
  add column provider_id       text not null default 'pi',
  add column provider_version  text not null default '',
  add column model_provider    text,
  add column model             text,
  add column commits           jsonb not null default '{}',   -- ref → commit
  add column slots             jsonb not null default '{}',   -- alias → {state, evidence, resolvedFrom, via, kind, expires_at, version}
  add column revoked_reason    text,
  add column endpoints_tally   jsonb,
  add column preflight         jsonb;                          -- the CLI's PreflightReport, posted once (console D7); never a value

comment on column harness_sessions.slots is
  'Provenance only (04 B6): state, evidence, resolvedFrom, via, kind, expires_at, '
  'and version — the vault provider''s version id, compared at the next open to '
  'mark the alias retired (11 §5.6). Never a value.';

alter table harness_sessions drop constraint harness_sessions_status_check;
alter table harness_sessions add constraint harness_sessions_status_check
  check (status in ('active','revoked','closed'));
create index harness_sessions_active_by_org on harness_sessions (org_unit_id) where status = 'active';

alter table api_key_versions add column grace_until timestamptz;

-- 04 §6, *Grace expiry*. `api_keys.rotate` moves the previous version to
-- 'grace'; the window is set here so one rotation path cannot forget it.
create function api_key_versions_grace_window()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'grace' and old.status is distinct from 'grace' then
    new.grace_until := now() + interval '24 hours';
  end if;
  return new;
end
$$;

create trigger api_key_versions_grace_window
before update of status
on api_key_versions
for each row
execute function api_key_versions_grace_window();
