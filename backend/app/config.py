from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    harness_master_key: str = Field(default="")
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str | None = None
    supabase_jwks_url: str | None = None
    # W7-D1: the one access code the sign-up door asks for. The alias is the
    # whole reason it is here — every other field's env name is its own name,
    # and this one is `HARNESS_SIGNUP_CODE`, not `SIGNUP_CODE`. Unset is
    # closed, not open: `create_org` refuses every code with nothing to
    # compare against.
    signup_code: str = Field(default="", validation_alias="HARNESS_SIGNUP_CODE")


@lru_cache
def get_settings() -> Settings:
    return Settings()
