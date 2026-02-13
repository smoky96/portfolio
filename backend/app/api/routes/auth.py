from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models import User, UserRole
from app.schemas import AuthTokenRead, LoginRequest, RegisterRequest, UserRead
from app.services.audit import write_audit_log
from app.services.auth import (
    authenticate_user,
    consume_invite_code,
    create_user,
    issue_user_token,
    mark_user_login,
    validate_invite_code_for_registration,
)

router = APIRouter()


@router.post("/login", response_model=AuthTokenRead)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    user = authenticate_user(db, payload.username, payload.password)
    token, expires_at = issue_user_token(user)
    mark_user_login(user)

    write_audit_log(
        db,
        owner_id=user.id,
        actor_user_id=user.id,
        entity="auth",
        entity_id=str(user.id),
        action="LOGIN",
        before_state=None,
        after_state={"username": user.username},
    )

    db.commit()
    db.refresh(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "user": user,
    }


@router.post("/register", response_model=UserRead)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> UserRead:
    invite = validate_invite_code_for_registration(db, payload.invite_code)
    user = create_user(
        db,
        username=payload.username,
        password=payload.password,
        role=UserRole.MEMBER,
        is_active=True,
    )
    consume_invite_code(invite)

    write_audit_log(
        db,
        owner_id=user.id,
        actor_user_id=user.id,
        entity="user",
        entity_id=str(user.id),
        action="REGISTER",
        before_state=None,
        after_state={"username": user.username, "invite_code": invite.code},
    )

    db.commit()
    db.refresh(user)
    return user


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> UserRead:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
