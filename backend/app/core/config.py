from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, regardless of the directory uvicorn is started from
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    supabase_url: str
    supabase_jwt_secret: str = ""
    cors_origins: str = ""

    # Reward timing, in seconds (see app/rewards/settle.py). Shorten for demos.
    reward_skip_lock_seconds: int = 7 * 24 * 3600   # skip acorns pay out after this
    reward_save_bonus_seconds: int = 48 * 3600      # saved item bought after this earns a bonus

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
