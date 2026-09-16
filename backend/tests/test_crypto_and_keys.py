import base64
import os
from uuid import uuid4

import pytest

from app.crypto import decrypt, encrypt
from app.domain.api_keys import key_is_visible, key_ref, last_four, rotate


def master_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def test_secretbox_round_trip_uses_random_nonce():
    key = master_key()
    first = encrypt("very-secret-value", key=key)
    second = encrypt("very-secret-value", key=key)
    assert first != second
    assert decrypt(first, key=key) == "very-secret-value"
    assert decrypt(second, key=key) == "very-secret-value"


def test_wrong_key_cannot_decrypt():
    ciphertext = encrypt("secret", key=master_key())
    with pytest.raises(ValueError, match="could not be opened"):
        decrypt(ciphertext, key=master_key())


@pytest.mark.parametrize("bad_key", ["", base64.b64encode(b"short").decode(), "not base64!"])
def test_master_key_must_be_32_base64_bytes(bad_key):
    with pytest.raises(ValueError, match="HARNESS_MASTER_KEY"):
        encrypt("secret", key=bad_key)


def test_key_metadata_never_needs_plaintext():
    assert key_ref("acme.finance", "Oracle ERP production") == (
        "secret://acme.finance/oracle-erp-production"
    )
    assert last_four("a-secret-value") == "alue"


def test_key_visibility_requires_an_ancestor_scope():
    key_unit, user_unit = uuid4(), uuid4()
    assert key_is_visible(key_unit, {key_unit, user_unit})
    assert not key_is_visible(uuid4(), {key_unit, user_unit})


class RotationConnection:
    def __init__(self, api_key_id):
        self.api_key_id = api_key_id
        self.statements = []

    async def fetchval(self, statement, *args):
        self.statements.append((statement, args))
        if statement.startswith("select id"):
            return self.api_key_id
        return 2

    async def execute(self, statement, *args):
        self.statements.append((statement, args))

    async def fetchrow(self, statement, *args):
        self.statements.append((statement, args))
        return {"version": 2, "status": "active", "last4": args[3], "ciphertext": args[2]}


@pytest.mark.asyncio
async def test_rotation_moves_active_to_grace_and_creates_one_active():
    api_key_id = uuid4()
    connection = RotationConnection(api_key_id)
    result = await rotate(connection, api_key_id, "replacement", master_key=master_key())
    statements = [statement for statement, _args in connection.statements]
    assert any("set status='grace'" in statement for statement in statements)
    assert any("values($1,$2,$3,$4,'active')" in statement for statement in statements)
    assert result["status"] == "active"
    assert result["last4"] == "ment"
