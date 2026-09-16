import base64

from nacl.exceptions import CryptoError
from nacl.secret import SecretBox

from app.config import get_settings


def _box(key: str | None = None) -> SecretBox:
    encoded = key if key is not None else get_settings().harness_master_key
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("HARNESS_MASTER_KEY must be valid base64.") from exc
    if len(raw) != SecretBox.KEY_SIZE:
        raise ValueError("HARNESS_MASTER_KEY must decode to exactly 32 bytes.")
    return SecretBox(raw)


def encrypt(value: str, *, key: str | None = None) -> bytes:
    return bytes(_box(key).encrypt(value.encode()))


def decrypt(ciphertext: bytes, *, key: str | None = None) -> str:
    try:
        return _box(key).decrypt(ciphertext).decode()
    except CryptoError as exc:
        raise ValueError("The encrypted value could not be opened.") from exc
