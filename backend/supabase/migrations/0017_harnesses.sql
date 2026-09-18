-- A harness is the job you sit down to do: a named list of what is in front
-- of the agent, with a description and a small drawing. It changes what a
-- session loads, never what resolves, what the boundary permits, or what the
-- work tree holds. See docs/harnesses.md.

create table harnesses (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  name text not null,
  description text not null default '',
  -- {"palette": ["#rrggbb", ...], "rows": ["0.1...", ...]} — validated by
  -- app.domain.harnesses.Icon, not here: a CHECK cannot say "16 strings of 16
  -- characters, each a hex digit below the palette length".
  icon jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_unit_id, name)
);

-- What a harness contains. A harness starts empty and holds only what is put
-- in it.
--
-- The row names a (kind, name), not an asset id, because resolution already
-- decides *whose* copy of a name a user gets. A harness says "Support
-- includes the skill called triage"; the tree says which triage. So a user
-- who pushes their own triage keeps it in Support, and promoting one unit's
-- copy to another needs no bookkeeping here at all.
--
-- A name with nothing behind it is allowed and loads nothing: an assignment
-- is a declaration of intent, so it survives an asset being archived,
-- renamed back, or created later.
create table harness_assets (
  harness_id uuid not null references harnesses(id) on delete cascade,
  kind text not null references asset_kinds(kind),
  name text not null,
  primary key (harness_id, kind, name)
);

-- Which harness a session was started in. Null means no harness, which is
-- not an empty harness: it is the whole resolved set, exactly as sessions
-- behaved before harnesses existed.
-- A deleted harness must not take its sessions' history with it.
alter table harness_sessions
  add column harness_id uuid references harnesses(id) on delete set null;

-- 0011's posture: nothing reaches these tables except the service role.
alter table harnesses enable row level security;
alter table harness_assets enable row level security;
