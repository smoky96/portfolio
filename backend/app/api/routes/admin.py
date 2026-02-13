from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_admin
from app.db.session import get_db
from app.models import InviteCode, User, UserRole
from app.schemas import (
    AdminUserCreate,
    AdminUserUpdate,
    InviteCodeCreate,
    InviteCodeRead,
    InviteCodeUpdate,
    UserRead,
)
from app.services.audit import write_audit_log
from app.services.auth import create_user, generate_invite_code

router = APIRouter()


def _user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _invite_or_404(db: Session, invite_id: int) -> InviteCode:
    invite = db.get(InviteCode, invite_id)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    return invite


def _ensure_not_last_admin(db: Session, *, user: User, updates: AdminUserUpdate) -> None:
    role = updates.role if updates.role is not None else user.role
    is_active = updates.is_active if updates.is_active is not None else user.is_active
    if user.role == UserRole.ADMIN and (role != UserRole.ADMIN or not is_active):
        active_admin_count = db.scalar(
            select(func.count(User.id)).where(User.role == UserRole.ADMIN, User.is_active.is_(True))
        )
        if int(active_admin_count or 0) <= 1:
            raise HTTPException(status_code=400, detail="Cannot disable or demote the last active admin")


@router.get("/users", response_model=list[UserRead])
def list_users(_: CurrentUser = Depends(get_current_admin), db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.id)))


@router.post("/users", response_model=UserRead)
def create_user_by_admin(
    payload: AdminUserCreate,
    current_user: CurrentUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> User:
    user = create_user(
        db,
        username=payload.username,
        password=payload.password,
        role=payload.role,
        is_active=payload.is_active,
    )
    write_audit_log(
        db,
        owner_id=user.id,
        actor_user_id=current_user.id,
        entity="user",
        entity_id=str(user.id),
        action="ADMIN_CREATE_USER",
        before_state=None,
        after_state={"username": user.username, "role": user.role.value, "is_active": user.is_active},
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user_by_admin(
    user_id: int,
    payload: AdminUserUpdate,
    current_user: CurrentUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> User:
    user = _user_or_404(db, user_id)
    _ensure_not_last_admin(db, user=user, updates=payload)

    before = {"role": user.role.value, "is_active": user.is_active}
    if payload.password is not None:
        from app.core.security import hash_password

        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    write_audit_log(
        db,
        owner_id=user.id,
        actor_user_id=current_user.id,
        entity="user",
        entity_id=str(user.id),
        action="ADMIN_UPDATE_USER",
        before_state=before,
        after_state={"role": user.role.value, "is_active": user.is_active},
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/invite-codes", response_model=list[InviteCodeRead])
def list_invite_codes(_: CurrentUser = Depends(get_current_admin), db: Session = Depends(get_db)) -> list[InviteCode]:
    return list(db.scalars(select(InviteCode).order_by(InviteCode.id.desc())))


@router.post("/invite-codes", response_model=InviteCodeRead)
def create_invite_code(
    payload: InviteCodeCreate,
    current_user: CurrentUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> InviteCode:
    code = (payload.code or generate_invite_code()).strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Invite code cannot be empty")
    exists = db.scalar(select(InviteCode.id).where(InviteCode.code == code))
    if exists is not None:
        raise HTTPException(status_code=409, detail="Invite code already exists")

    invite = InviteCode(
        code=code,
        created_by_id=current_user.id,
        expires_at=payload.expires_at,
        max_uses=payload.max_uses,
        used_count=0,
        is_active=True,
        note=payload.note,
    )
    db.add(invite)
    db.flush()

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
        entity="invite_code",
        entity_id=str(invite.id),
        action="ADMIN_CREATE_INVITE_CODE",
        before_state=None,
        after_state={"code": invite.code, "max_uses": invite.max_uses, "expires_at": invite.expires_at.isoformat() if invite.expires_at else None},
    )
    db.commit()
    db.refresh(invite)
    return invite


@router.patch("/invite-codes/{invite_id}", response_model=InviteCodeRead)
def update_invite_code(
    invite_id: int,
    payload: InviteCodeUpdate,
    current_user: CurrentUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> InviteCode:
    invite = _invite_or_404(db, invite_id)
    before = {
        "is_active": invite.is_active,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "max_uses": invite.max_uses,
        "note": invite.note,
    }
    if payload.is_active is not None:
        invite.is_active = payload.is_active
    if payload.expires_at is not None:
        invite.expires_at = payload.expires_at
    if payload.max_uses is not None:
        invite.max_uses = payload.max_uses
    if payload.note is not None:
        invite.note = payload.note

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
        entity="invite_code",
        entity_id=str(invite.id),
        action="ADMIN_UPDATE_INVITE_CODE",
        before_state=before,
        after_state={
            "is_active": invite.is_active,
            "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
            "max_uses": invite.max_uses,
            "note": invite.note,
        },
    )
    db.commit()
    db.refresh(invite)
    return invite
