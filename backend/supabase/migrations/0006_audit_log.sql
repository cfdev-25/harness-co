create table audit_log (
  id bigint generated always as identity,
  org_unit_id uuid not null,
  actor_type text not null check (actor_type in ('user','runner','system')),
  actor_id uuid,
  class text not null check (class in ('authoritative','attested')),
  action text not null,
  payload jsonb not null default '{}',
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

-- The migration is date-independent: create the UTC current and following
-- calendar-month partitions whenever it is applied.
do $$
declare
  partition_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  partition_end timestamptz;
  partition_name text;
begin
  for month_offset in 0..1 loop
    partition_end := partition_start + interval '1 month';
    partition_name := 'audit_log_' || to_char(partition_start at time zone 'UTC', 'YYYY_MM');
    execute format(
      'create table if not exists %I partition of audit_log for values from (%L) to (%L)',
      partition_name,
      partition_start,
      partition_end
    );
    partition_start := partition_end;
  end loop;
end
$$;

-- The tip of each org unit's hash chain.
create table audit_log_latest_hashes (
  org_unit_id uuid primary key,
  last_hash text not null
);
