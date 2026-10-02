-- console/03-data-and-naming.md §7, widened to the three subjects the engine
-- contract carries (00 §4.10: promotion, role, publish). §7's promotion-only
-- columns `paths` and `commit` are the subject's fields, so they live in
-- `subject` and are not duplicated here; `harness_id` and `base_commit` stay
-- as columns because the console indexes on the first and the server derives
-- the second (the team ref's head at open, never sent by the client).
create table requests (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id),        -- the team decided at
  harness_id uuid,                                           -- promotion only, and optional there
  author_auth_user_id uuid not null,
  title text not null check (length(title) between 1 and 120),
  reasoning text not null default '',
  subject jsonb not null,
  subject_kind text not null check (subject_kind in ('promotion','role','publish')),
  base_commit text,                                          -- the team ref at open; stale = moved since
  state text not null default 'open' check (state in ('open','closed')),
  decision text check (decision in ('accepted','declined','withdrawn')),
  decided_by uuid, decided_at timestamptz, reason text,
  created_at timestamptz not null default now()
);
create index requests_org_unit_id_state_created_at_idx on requests (org_unit_id, state, created_at desc);

create table request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  author_auth_user_id uuid not null, text text not null check (length(text) <= 4000),
  created_at timestamptz not null default now()
);

alter table requests enable row level security;
alter table request_comments enable row level security;
