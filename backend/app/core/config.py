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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
