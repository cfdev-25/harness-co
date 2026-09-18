import base64
import json

from app.domain.resolve import model_from_assets, resolved_assets


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


class FakeConnection:
    """Returns canned candidate rows, then canned file bodies."""

    def __init__(self, candidates, files):
        self.candidates = candidates
        self.files = files
        self.queries = []

    async def fetch(self, query, *args):
        self.queries.append(query)
        return self.candidates if "with recursive chain" in query else self.files


def _candidate(kind, name, choice, *, unit, seq, version_id, asset_id):
    return {
        "id": asset_id,
        "kind": kind,
        "name": name,
        "choice": choice,
        "org_unit_path": unit,
        "version_id": version_id,
        "seq": seq,
        "file_hashes": {"SKILL.md": "h1"},
    }


async def test_resolved_assets_reports_the_asset_a_personal_override_shadows():
    rows = [
        _candidate(
            "skill", "triage", 1, unit="acme.eng.ana", seq=3, version_id="v-mine", asset_id="a-mine"
        ),
        _candidate(
            "skill", "triage", 2, unit="acme.eng", seq=7, version_id="v-team", asset_id="a-team"
        ),
        _candidate(
            "skill", "solo", 1, unit="acme.eng", seq=1, version_id="v-solo", asset_id="a-solo"
        ),
    ]
    connection = FakeConnection(rows, [{"hash": "h1", "content": b"body"}])

    assets = await resolved_assets(connection, "unit-id")

    # Only the winner of each (kind, name) is returned.
    assert [a["name"] for a in assets] == ["triage", "solo"]
    triage, solo = assets
    assert triage["asset_id"] == "a-mine"
    assert triage["version_id"] == "v-mine"
    assert triage["version_seq"] == 3
    assert triage["org_unit_path"] == "acme.eng.ana"
    assert triage["shadows"] == {
        "asset_id": "a-team",
        "org_unit_path": "acme.eng",
        "version_id": "v-team",
        "seq": 7,
    }
    # An asset nobody overrides shadows nothing.
    assert solo["shadows"] is None
    assert solo["files"] == [
        {"path": "SKILL.md", "content_b64": base64.b64encode(b"body").decode()}
    ]
