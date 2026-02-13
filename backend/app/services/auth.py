from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models import InviteCode, User, UserRole


def normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="username is required")
    return normalized


def get_user_by_username(db: Session, username: str) -> User | None:
    normalized = normalize_username(username)
    return db.scalar(select(User).where(User.username == normalized))


def create_user(
    db: Session,
    *,
    username: str,
    password: str,
    role: UserRole,
    is_active: bool,
) -> User:
    normalized = normalize_username(username)
    existing = db.scalar(select(User.id).where(User.username == normalized))
    if existing is not None:
        raise HTTPException(status_code=409, detail="username already exists")

    user = User(
        username=normalized,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def authenticate_user(db: Session, username: str, password: str) -> User:
    user = get_user_by_username(db, username)
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is disabled")
    return user


def issue_user_token(user: User) -> tuple[str, datetime]:
    return create_access_token(subject=str(user.id), extra_payload={"role": user.role.value})


def mark_user_login(user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)


def ensure_bootstrap_admin(db: Session) -> User:
    settings = get_settings()
    admin_username = normalize_username(settings.bootstrap_admin_username)
    admin = db.scalar(select(User).where(User.username == admin_username))
    if admin is None:
        admin = User(
            username=admin_username,
            password_hash=hash_password(settings.bootstrap_admin_password),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.flush()
    elif admin.role != UserRole.ADMIN:
        admin.role = UserRole.ADMIN
    if not admin.is_active:
        admin.is_active = True
    return admin


def ensure_bootstrap_invite_code(db: Session, *, created_by_id: int | None) -> InviteCode:
    settings = get_settings()
    normalized = settings.bootstrap_admin_invite_code.strip().upper()
    if not normalized:
        raise RuntimeError("BOOTSTRAP_ADMIN_INVITE_CODE cannot be empty")

    invite = db.scalar(select(InviteCode).where(InviteCode.code == normalized))
    if invite is None:
        invite = InviteCode(
            code=normalized,
            created_by_id=created_by_id,
            expires_at=None,
            max_uses=None,
            used_count=0,
            is_active=True,
            note="bootstrap invite code",
        )
        db.add(invite)
        db.flush()
    return invite


def validate_invite_code_for_registration(db: Session, code: str) -> InviteCode:
    normalized = code.strip().upper()
    invite = db.scalar(select(InviteCode).where(InviteCode.code == normalized))
    if invite is None:
        raise HTTPException(status_code=400, detail="Invite code not found")
    if not invite.is_active:
        raise HTTPException(status_code=400, detail="Invite code is disabled")
    now = datetime.now(timezone.utc)
    expires_at = invite.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at <= now:
        raise HTTPException(status_code=400, detail="Invite code expired")
    if invite.max_uses is not None and invite.used_count >= invite.max_uses:
        raise HTTPException(status_code=400, detail="Invite code exhausted")
    return invite


def consume_invite_code(invite: InviteCode) -> None:
    invite.used_count += 1


def generate_invite_code(length: int = 16) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
