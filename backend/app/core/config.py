from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Portfolio Manager"
    env: str = Field(default="dev", alias="APP_ENV")
    api_v1_prefix: str = "/api/v1"

    database_url: str = Field(
        default="postgresql+psycopg2://portfolio:portfolio@db:5432/portfolio",
        alias="DATABASE_URL",
    )

    base_currency: str = Field(default="CNY", alias="BASE_CURRENCY")
    default_timezone: str = Field(default="Asia/Shanghai", alias="DEFAULT_TIMEZONE")
    drift_alert_threshold: float = Field(default=0.05, alias="DRIFT_ALERT_THRESHOLD")

    quote_provider: str = Field(default="yahoo", alias="QUOTE_PROVIDER")
    yahoo_quote_url: str = Field(
        default="https://query1.finance.yahoo.com/v7/finance/quote",
        alias="YAHOO_QUOTE_URL",
    )
    quote_refresh_hour: int = Field(default=18, alias="QUOTE_REFRESH_HOUR")
    quote_refresh_minute: int = Field(default=0, alias="QUOTE_REFRESH_MINUTE")
    quote_refresh_interval_minutes: int = Field(default=5, alias="QUOTE_REFRESH_INTERVAL_MINUTES")
    quote_auto_refresh_stale_minutes: int = Field(default=5, alias="QUOTE_AUTO_REFRESH_STALE_MINUTES")
    quote_auto_refresh_on_read: bool = Field(default=False, alias="QUOTE_AUTO_REFRESH_ON_READ")
    quote_history_backfill_days: int = Field(default=365, alias="QUOTE_HISTORY_BACKFILL_DAYS")
    quote_history_backfill_min_points: int = Field(default=2, alias="QUOTE_HISTORY_BACKFILL_MIN_POINTS")
    quote_history_backfill_cooldown_minutes: int = Field(default=60, alias="QUOTE_HISTORY_BACKFILL_COOLDOWN_MINUTES")

    jwt_secret_key: str = Field(default="change-me-in-production", alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=720, alias="ACCESS_TOKEN_EXPIRE_MINUTES")

    bootstrap_admin_username: str = Field(default="admin", alias="BOOTSTRAP_ADMIN_USERNAME")
    bootstrap_admin_password: str = Field(default="admin123", alias="BOOTSTRAP_ADMIN_PASSWORD")
    bootstrap_admin_invite_code: str = Field(default="PORTFOLIO-INVITE", alias="BOOTSTRAP_ADMIN_INVITE_CODE")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
