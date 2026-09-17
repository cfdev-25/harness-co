import base64
import json

from app.domain.resolve import model_from_assets


def test_model_connection_is_read_from_cas_asset():
    model = {
        "provider": "openai-compatible",
        "model_id": "example-model",
        "base_url": "https://api.example.com/v1",
        "key_ref": "secret://acme/default-provider",
    }
    assets = [
        {
            "kind": "connection",
            "name": "model-default",
            "files": [
                {
                    "path": "model.json",
                    "content_b64": base64.b64encode(json.dumps(model).encode()).decode(),
                }
            ],
        }
    ]
    assert model_from_assets(assets) == model


def test_missing_or_invalid_model_connection_returns_none():
    assert model_from_assets([]) is None
    assert (
        model_from_assets(
            [
                {
                    "kind": "connection",
                    "name": "model-default",
                    "files": [{"path": "model.json", "content_b64": "bm90IGpzb24="}],
                }
            ]
        )
        is None
    )
