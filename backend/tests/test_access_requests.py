"""The public form: open to strangers, so it is the one surface written to
assume bad faith."""

from fastapi.testclient import TestClient

from app.api.routes_access_requests import PER_WINDOW, _ip_hash
from app.main import create_app


class FakePool:
    """Records what the endpoint would write, and answers the rate-limit read."""

    def __init__(self, recent: int = 0):
        self.recent = recent
        self.writes: list[tuple] = []

    async def fetchval(self, *args):
        return self.recent

    async def execute(self, _sql: str, *args):
        self.writes.append(args)


def post(pool: FakePool, body: dict):
    with TestClient(create_app(pool=pool)) as client:
        return client.post("/v1/access-requests", json=body)


def test_a_request_is_accepted_and_stored_without_signing_in():
    pool = FakePool()
    response = post(pool, {"email": "ada@example.com", "name": "Ada", "company": "Example"})
    assert response.status_code == 202
    assert response.json() == {"status": "received"}
    email, name, company, *_ = pool.writes[0]
    assert (email, name, company) == ("ada@example.com", "Ada", "Example")


def test_a_bad_address_is_refused():
    pool = FakePool()
    assert post(pool, {"email": "not-an-address"}).status_code == 422
    assert pool.writes == []


def test_the_honeypot_is_accepted_and_dropped():
    """A bot that fills the hidden field gets the same answer as everyone else
    and leaves no row — telling it otherwise would only help it."""
    pool = FakePool()
    response = post(pool, {"email": "bot@example.com", "company_website": "http://spam"})
    assert response.status_code == 202
    assert response.json() == {"status": "received"}
    assert pool.writes == []


def test_one_source_is_limited():
    pool = FakePool(recent=PER_WINDOW)
    response = post(pool, {"email": "ada@example.com"})
    assert response.status_code == 429
    assert pool.writes == []


def test_the_address_of_a_caller_is_never_stored_raw():
    digest = _ip_hash("203.0.113.9")
    assert digest and "203.0.113.9" not in digest
    assert digest != _ip_hash("203.0.113.10")
