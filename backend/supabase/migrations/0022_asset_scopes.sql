-- Nothing is shared by containment. A unit sees what it owns, plus what an
-- ancestor has explicitly scoped to it (docs/scoping.md §0). This table is
-- the "plus": a row means *this asset is available to this unit and
-- everything beneath it*.
--
-- Keyed by asset_id, not (kind, name). `harness_assets` keys on the name on
-- purpose — a harness says "include the skill called triage" and leaves the
-- tree to decide whose triage answers it (0017_harnesses.sql:26-28). Scope is
-- the opposite question: an owner is scoping *its own copy*. Keyed by name,
-- the org scoping out `triage` would also scope out a team's own `triage`,
-- which nobody asked it to do and which the org may not even know exists
-- (docs/scoping.md §3).
--
-- A row grants reach; it says nothing about which copy wins where two units
-- both have a `triage`. That is resolution's job (resolve.py
-- `resolved_assets`) and is unchanged by this table — scope only decides
-- which assets are candidates, never which candidate the window function
-- picks.
--
-- An owner never needs a row naming itself: scope governs descendants only,
-- and resolution treats "I own it" as its own, separate condition.
create table asset_scopes (
  asset_id     uuid not null references assets(id) on delete cascade,
  org_unit_id  uuid not null references org_units(id) on delete cascade,
  -- Per-recipient credential override (docs/scoping.md §5.3): null means the
  -- asset's own. Nothing reads this column yet — it is here only so this
  -- backfill does not have to be rewritten the day something does.
  key_ref      text,
  -- Not a foreign key, matching asset_versions.author_auth_user_id
  -- (0003_assets.sql:21): for a real grant this is the granting admin's
  -- auth_user_id. The backfill below has no admin to name, so it uses the
  -- documented sentinel of the asset's own owning-unit id — see below.
  granted_by   uuid not null,
  granted_at   timestamptz not null default now(),
  primary key (asset_id, org_unit_id)
);

-- 0011's posture: nothing reaches this table except the service role. Same
-- rule 0017 applied to harnesses/harness_assets, for the same reason — this
-- table decides who sees what, so it is no less sensitive than the tables it
-- governs.
alter table asset_scopes enable row level security;

-- Backfill: preserve today's behaviour exactly. Before this table existed,
-- every asset was available to every descendant of its owning unit,
-- automatically and unconditionally. Scoping each existing asset to all of
-- its owner's current descendants makes that the recorded state instead of
-- an assumption, so deploying this migration changes no live session's
-- manifest (docs/v3.md §5) — it is the honest record of what those assets'
-- reach already was (docs/scoping.md §4.1), not a new grant.
--
-- granted_by here is the asset's own owning-unit id, standing in for "this
-- was already true, nobody granted it" — the sentinel is documented here
-- because there is no admin action to attribute it to.
-- One row per asset, naming the unit that owns it. A scope row means "this
-- unit and everything beneath it", so that single row is exactly the reach
-- every asset already had, and it keeps that reach for units created later.
--
-- Enumerating (asset, descendant) pairs instead would be wrong, not merely
-- verbose: it excludes the owning unit, so a user added to a team after this
-- migration would inherit the org's assets (a row names their team) but not
-- their own team's (no row names it). A new hire would see the org and not
-- their colleagues.
insert into asset_scopes (asset_id, org_unit_id, granted_by)
select id, org_unit_id, org_unit_id from assets;
