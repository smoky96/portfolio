from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
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

    allow_self_registration: bool = Field(default=True, alias="ALLOW_SELF_REGISTRATION")
    cors_allowed_origins: str = Field(
        default="http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ALLOWED_ORIGINS",
    )
    expose_api_docs: bool = Field(default=True, alias="EXPOSE_API_DOCS")

    cookie_name: str = Field(default="portfolio_session", alias="COOKIE_NAME")
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")
    cookie_domain: str | None = Field(default=None, alias="COOKIE_DOMAIN")
    cookie_samesite: Literal["lax", "strict", "none"] = Field(default="lax", alias="COOKIE_SAMESITE")

    login_rate_limit_per_min: int = Field(default=5, alias="LOGIN_RATE_LIMIT_PER_MIN", ge=1)

    bootstrap_admin_username: str = Field(default="admin", alias="BOOTSTRAP_ADMIN_USERNAME")
    bootstrap_admin_password: str = Field(default="admin123", alias="BOOTSTRAP_ADMIN_PASSWORD")
    bootstrap_admin_invite_code: str = Field(default="PORTFOLIO-INVITE", alias="BOOTSTRAP_ADMIN_INVITE_CODE")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("cookie_samesite", mode="before")
    @classmethod
    def normalize_samesite(cls, value: str) -> str:
        return str(value).strip().lower()

    @property
    def is_production(self) -> bool:
        return self.env.strip().lower() in {"prod", "production"}

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [item.strip() for item in self.cors_allowed_origins.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if not self.is_production:
            return self

        issues: list[str] = []
        if self.jwt_secret_key.strip() == "change-me-in-production" or len(self.jwt_secret_key.strip()) < 32:
            issues.append("JWT_SECRET_KEY must be a non-default secret with at least 32 characters")
        if self.bootstrap_admin_password.strip() == "admin123":
            issues.append("BOOTSTRAP_ADMIN_PASSWORD must not use default admin123 in production")
        if self.bootstrap_admin_invite_code.strip().upper() == "PORTFOLIO-INVITE":
            issues.append("BOOTSTRAP_ADMIN_INVITE_CODE must not use the default value in production")
        if not self.cookie_secure:
            issues.append("COOKIE_SECURE must be true in production")
        if self.allow_self_registration:
            issues.append("ALLOW_SELF_REGISTRATION must be false in production")
        if self.expose_api_docs:
            issues.append("EXPOSE_API_DOCS must be false in production")
        if not self.cors_allowed_origins_list:
            issues.append("CORS_ALLOWED_ORIGINS must include at least one trusted origin in production")

        if issues:
            raise ValueError(" | ".join(issues))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
