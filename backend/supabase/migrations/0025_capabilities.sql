-- `allowed_tools`/`deploy_tools` stored Pi's own tool names ("bash", "read",
-- "edit") in a boundary meant to hold team infrastructure in no agent's
-- language (agents.md §7.1). An admin typing "bash" was writing Pi's private
-- vocabulary into a policy Claude Code has to obey too, and Claude Code has
-- no tool called "bash".
--
-- The fix is the same move as 0013: stop storing an agent's name for the
-- thing and store the effect instead. A capability is identical on every
-- agent because it describes what happens to the world, not what a
-- particular tool dispatcher calls it.
--
-- Unlike `asset_kinds`, this table only carries the four *fixed* capabilities
-- every agent can imply from its own built-in tools. `tool.<name>` and
-- `connector.<name>` are parameterized by an asset that already exists in
-- `assets` (kind 'tool' / 'connection') — there is no finite set of rows to
-- seed for them, and no FK is possible for the same reason `asset_kinds`
-- cannot enumerate asset names. Adding a *built-in* capability (a fifth
-- fixed effect some future agent exposes that today's four don't cover)
-- costs one row here; a team tool or connector costs nothing, because it is
-- already named by the asset it capability-gates.
create table capabilities (
  capability text primary key,
  description text not null
);

insert into capabilities(capability, description) values
  ('filesystem.read',  'May read files inside the session''s work tree'),
  ('filesystem.write', 'May write files inside the session''s work tree'),
  ('process.exec',     'May run a subprocess'),
  ('network.fetch',    'May make an outbound network request');

-- One-time data migration: rewrite whatever is already sitting in
-- `allowed_tools` / `deploy_tools` from Pi's seven built-in tool names into
-- the capabilities they imply, and every other name (a team tool, e.g.
-- "deploy") into `tool.<name>`, unchanged apart from the prefix. This exact
-- mapping is also `app.domain.capabilities.to_capability`, which the boundary
-- validator applies to every new write from here on — this function is its
-- one-time SQL equivalent for rows that predate that validator, scoped to
-- this migration and dropped once it has run.
create function migrate_0025_capability(name text) returns text
language sql immutable as $$
  select case name
    -- Pi's seven built-ins (adapters/pi.ts's old hardcoded list), frozen here
    -- because this mapping only ever needs to explain what already-stored
    -- data meant, not grow for whatever a future agent calls its own tools.
    when 'read'  then 'filesystem.read'
    when 'grep'  then 'filesystem.read'
    when 'find'  then 'filesystem.read'
    when 'ls'    then 'filesystem.read'
    when 'edit'  then 'filesystem.write'
    when 'write' then 'filesystem.write'
    when 'bash'  then 'process.exec'
    -- Already a capability (a row run twice, or a fixture seeded post-launch):
    -- left as-is, so this stays safe to run more than once.
    when 'filesystem.read'  then 'filesystem.read'
    when 'filesystem.write' then 'filesystem.write'
    when 'process.exec'     then 'process.exec'
    when 'network.fetch'    then 'network.fetch'
    else case
      when name like 'tool.%' or name like 'connector.%' then name
      else 'tool.' || name
    end
  end;
$$;

-- `coalesce(..., '[]')` because `jsonb_agg` over zero rows is `NULL`, and a
-- policy that named an empty list on purpose (permits no tool at all) must
-- not become "field absent, so unrestricted" — the same absent-vs-empty
-- distinction `merge_boundaries` already draws for `egress_allowlist`.
update org_unit_boundaries
   set policy = policy
     || (case when policy ? 'allowed_tools' then jsonb_build_object(
             'allowed_tools',
             coalesce(
               (select jsonb_agg(to_jsonb(migrate_0025_capability(value)))
                  from jsonb_array_elements_text(policy->'allowed_tools') as value),
               '[]'::jsonb
             )
           ) else '{}'::jsonb end)
     || (case when policy ? 'deploy_tools' then jsonb_build_object(
             'deploy_tools',
             coalesce(
               (select jsonb_agg(to_jsonb(migrate_0025_capability(value)))
                  from jsonb_array_elements_text(policy->'deploy_tools') as value),
               '[]'::jsonb
             )
           ) else '{}'::jsonb end)
 where policy ? 'allowed_tools' or policy ? 'deploy_tools';

drop function migrate_0025_capability(text);
