create table personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  token_hash text not null unique,
  name text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
