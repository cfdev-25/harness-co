-- docs/archive/agents.md §11: a control ships only if a choke point we own refuses
-- it. `load_policy.default` never had one — whether a skill loads eagerly or
-- on demand is the agent's own context strategy, and neither Pi nor Claude
-- Code takes direction on it from us. `app/domain/org_tree.py` no longer
-- reads or writes the key; a row still carrying it would be a control that
-- comes back the next time somebody greps for it, so it comes out of the
-- data in the same change (docs/archive/agents.md §14.9, docs/archive/scoping.md §9's file
-- list; matches the shape of 0012_drop_unimplemented_columns.sql).
--
-- `policy - 'load_policy'` is the jsonb "delete key" operator: a no-op on a
-- row that never set it, so this is safe to run against every unit.
update org_unit_boundaries
   set policy = policy - 'load_policy'
 where policy ? 'load_policy';
