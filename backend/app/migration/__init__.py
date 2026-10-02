"""The one-shot Postgres → git exporter of docs/engine/02 §11 (D6).

Dry run only at M1 (09 §M1 item 3): it reads the records, writes bare repos
under a directory you name, and changes nothing. Its acceptance test —
`backend/tests/test_migration_export.py` — is the proof that `compose()` is
`resolve.py`'s semantics before anything moves.

Deleted after cutover, with its tests (10 rule 5).
"""
