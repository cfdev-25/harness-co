# Development seed

Run from `backend/` after applying migrations:

```sh
DATABASE_URL=postgresql://... \
HARNESS_MASTER_KEY=<base64-encoded-32-byte-key> \
uv run python -m supabase.seed.seed_dev
```

The script requires `asyncpg` and `PyNaCl`, supplied by the backend environment in
T1.3. `HARNESS_MASTER_KEY` must decode to exactly 32 bytes and is used with
PyNaCl `SecretBox`; no default key is provided. The seed replaces its named
development PATs on every run and prints the new values once. Do not use the
seed credentials outside a disposable local database.
