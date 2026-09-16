import base64

import pytest

from app.domain.asset_store import decode_files, lint_files
from app.errors import ApiError


def encoded(path: str, content: str) -> dict[str, str]:
    return {"path": path, "content_b64": base64.b64encode(content.encode()).decode()}


def test_files_are_decoded_and_content_addressed():
    first = decode_files([encoded("SKILL.md", "hello")])[0]
    second = decode_files([encoded("docs/readme.md", "hello")])[0]
    assert first.hash == second.hash
    assert first.content == b"hello"


@pytest.mark.parametrize("path", ["../secret", "/absolute", "a//b", "bad name.md"])
def test_unsafe_paths_are_rejected(path):
    with pytest.raises(ApiError) as caught:
        decode_files([encoded(path, "x")])
    assert caught.value.code == "invalid_file_path"


def test_lint_accepts_requirements_inside_boundary():
    files = decode_files(
        [
            encoded(
                "SKILL.md",
                """---
requires:
  connections: [slack]
  egress: [api.example.com]
---
Use secret://acme/mock-provider.
""",
            )
        ]
    )
    lint_files(
        files,
        {"connector_allowlist": ["slack"], "egress_allowlist": ["api.example.com"]},
        {"secret://acme/mock-provider"},
    )


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("---\nrequires:\n  connections: [slack]\n---\n", "connection 'slack'"),
        ("---\nrequires:\n  egress: [evil.example]\n---\n", "destination 'evil.example'"),
        ("Read secret://other/private.", "key reference 'secret://other/private'"),
    ],
)
def test_lint_explains_boundary_violation(content, message):
    with pytest.raises(ApiError) as caught:
        lint_files(decode_files([encoded("SKILL.md", content)]), {}, set())
    assert caught.value.code == "boundary_violation"
    assert message in caught.value.message
