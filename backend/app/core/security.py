from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

PASSWORD_CONTEXT = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return PASSWORD_CONTEXT.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return PASSWORD_CONTEXT.verify(plain_password, hashed_password)


def create_access_token(
    *,
    subject: str,
    expires_delta: timedelta | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire_at = now + (
        expires_delta if expires_delta is not None else timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(expire_at.timestamp()),
    }
    if extra_payload:
        payload.update(extra_payload)
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, expire_at


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
