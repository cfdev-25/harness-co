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


@lru_cache
def get_settings() -> Settings:
    return Settings()
