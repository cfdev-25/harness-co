-- The public site is served without the API, so the access-request form writes
-- through this function instead. It is the only way `anon` may touch any table:
-- definer rights let it insert, while the table's own grants stay revoked, so a
-- caller can write a request and still cannot read one.
create or replace function public.request_access(
  p_email text,
  p_name text default null,
  p_company text default null,
  p_team_size text default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(btrim(p_email));
  seen timestamptz;
begin
  -- Confirmed by mailing it, not by a regex; this only rejects the obviously wrong.
  if clean_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' or length(clean_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  select created_at into seen from access_requests where lower(email) = clean_email;

  -- Asking twice is not an error, but hammering one address is: a repeat inside
  -- the minute is accepted and ignored, so the caller learns nothing either way.
  if seen is not null and seen > now() - interval '1 minute' then
    return;
  end if;

  insert into access_requests (email, name, company, team_size, note)
  values (
    clean_email,
    nullif(btrim(left(p_name, 120)), ''),
    nullif(btrim(left(p_company, 120)), ''),
    nullif(btrim(left(p_team_size, 40)), ''),
    nullif(btrim(left(p_note, 1000)), '')
  )
  on conflict (lower(email)) do update
    set name = coalesce(excluded.name, access_requests.name),
        company = coalesce(excluded.company, access_requests.company),
        team_size = coalesce(excluded.team_size, access_requests.team_size),
        note = coalesce(excluded.note, access_requests.note);
end
$$;

revoke all on function public.request_access(text, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.request_access(text,text,text,text,text) to anon, authenticated';
  end if;
end
$$;
