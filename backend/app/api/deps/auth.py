from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: int
    username: str
    role: UserRole
    is_active: bool

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


def _auth_error(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _auth_error()

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise _auth_error("Invalid token") from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise _auth_error("Invalid token payload")

    try:
        user_id = int(subject)
    except ValueError as exc:
        raise _auth_error("Invalid token subject") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _auth_error("User inactive or not found")

    return CurrentUser(
        id=user.id,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
    )


def get_current_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
