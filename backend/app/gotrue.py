import httpx

from app.config import Settings
from app.errors import ApiError


def _headers(settings: Settings) -> dict[str, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ApiError(503, "auth_not_configured", "Supabase Auth is not configured.")
    key = settings.supabase_service_role_key
    return {"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json"}


async def invite_email(settings: Settings, email: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/invite",
            headers=_headers(settings),
            json={"email": email},
        )
    if response.status_code >= 400:
        raise ApiError(
            502,
            "invite_email_failed",
            "The invite was saved, but the email could not be sent.",
        )


async def admin_create_user(settings: Settings, email: str, password: str) -> str:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
            headers=_headers(settings),
            json={"email": email, "password": password, "email_confirm": True},
        )
        if response.status_code == 422:
            listed = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
                headers=_headers(settings),
                params={"page": 1, "per_page": 1000},
            )
            listed.raise_for_status()
            for user in listed.json().get("users", []):
                if str(user.get("email", "")).lower() == email.lower():
                    return str(user["id"])
            raise ApiError(409, "auth_user_exists", f"A login for {email} already exists.")
        response.raise_for_status()
        return str(response.json()["id"])
