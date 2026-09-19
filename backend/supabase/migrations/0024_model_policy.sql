-- boundary.model_policy (agents.md §5.1, closing G13): two independent
-- axes describing which model a session may use. `policy` has always been
-- unconstrained jsonb — app.domain.org_tree.Boundary is the real validator —
-- but every other enum this table carries (asset kind, role level, api-key
-- kind...) also gets a defense-in-depth CHECK, and this one is worth it in
-- particular: a value outside these two sets would silently fail the
-- `_MODEL_SOURCE_PROVIDES_MODEL` / `_MODEL_CREDENTIALS_PERMIT_OWN` lookups in
-- validate_tightening with a KeyError instead of a clean 422, on writes that
-- reach the database directly rather than through the API.
--
-- A key that is absent is "nobody set a policy here" (merge_boundaries'
-- existing rule for every boundary field) and is deliberately not
-- constrained by this CHECK: only a *set* value must be one of the two
-- axes' cases.
alter table org_unit_boundaries add constraint org_unit_boundaries_model_policy_source_check
  check (
    policy->'model_policy'->>'source' is null
    or policy->'model_policy'->>'source' in ('proxied', 'gateway', 'none')
  );

alter table org_unit_boundaries add constraint org_unit_boundaries_model_policy_user_credentials_check
  check (
    policy->'model_policy'->>'user_credentials' is null
    or policy->'model_policy'->>'user_credentials' in ('forbidden', 'allowed', 'required')
  );
