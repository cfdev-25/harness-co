-- Interest in an account, submitted from the public site. This is the one
-- table an unauthenticated request may write to, and it is written only
-- through the API: RLS is on with no policies, so anon and authenticated
-- reach nothing, exactly as 0011 left every other table.
create table access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  company text,
  team_size text,
  note text,
  -- Salted hash, never the address itself: enough to rate limit, useless later.
  ip_hash text,
  status text not null default 'new' check (status in ('new','contacted','invited','declined')),
  created_at timestamptz not null default now()
);

-- One row per address. A repeat submission updates the row it already has,
-- so the form can answer the same way whether or not the address is known.
create unique index access_requests_email_key on access_requests (lower(email));

create index access_requests_created_at_idx on access_requests (created_at desc);
create index access_requests_ip_hash_idx on access_requests (ip_hash, created_at desc);

alter table access_requests enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table access_requests from anon, authenticated';
  end if;
end
$$;
