from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:54322/postgres"
    harness_master_key: str = Field(default="")
    supabase_jwt_secret: str | None = None
    supabase_jwks_url: str | None = None
    harness_env: str = "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
