from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.router import api_router
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import InviteCode, User, UserRole
from app.services.auth import (
    authenticate_user,
    consume_invite_code,
    create_user,
    ensure_bootstrap_admin,
    ensure_bootstrap_invite_code,
    generate_invite_code,
    issue_user_token,
    mark_user_login,
    validate_invite_code_for_registration,
)


@pytest.fixture()
def raw_client(db_session: Session):
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client


def _login_token(client: TestClient, username: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_security_helpers_and_auth_service(db_session: Session):
    password = "pass-123456"
    password_hash = hash_password(password)
    assert verify_password(password, password_hash)
    assert not verify_password("wrong", password_hash)

    token, expires_at = create_access_token(subject="1", extra_payload={"role": "ADMIN"})
    payload = decode_access_token(token)
    assert payload["sub"] == "1"
    assert payload["role"] == "ADMIN"
    assert expires_at > datetime.now(timezone.utc)

    admin = db_session.query(User).filter(User.username == "admin").one()
    admin.role = UserRole.MEMBER
    admin.is_active = False
    db_session.commit()

    ensured_admin = ensure_bootstrap_admin(db_session)
    assert ensured_admin.role == UserRole.ADMIN
    assert ensured_admin.is_active is True

    invite = ensure_bootstrap_invite_code(db_session, created_by_id=ensured_admin.id)
    assert invite.code

    issued_token, token_expires_at = issue_user_token(ensured_admin)
    assert issued_token
    assert token_expires_at > datetime.now(timezone.utc)
    mark_user_login(ensured_admin)
    assert ensured_admin.last_login_at is not None

    created = create_user(
        db_session,
        username="member-a",
        password="member-pass-123",
        role=UserRole.MEMBER,
        is_active=True,
    )
    assert created.username == "member-a"
    with pytest.raises(HTTPException) as duplicate_user_error:
        create_user(
            db_session,
            username="member-a",
            password="member-pass-123",
            role=UserRole.MEMBER,
            is_active=True,
        )
    assert duplicate_user_error.value.status_code == 409

    authenticated = authenticate_user(db_session, "member-a", "member-pass-123")
    assert authenticated.id == created.id
    with pytest.raises(HTTPException) as wrong_password_error:
        authenticate_user(db_session, "member-a", "wrong-pass")
    assert wrong_password_error.value.status_code == 401

    disabled = create_user(
        db_session,
        username="member-disabled",
        password="member-pass-123",
        role=UserRole.MEMBER,
        is_active=False,
    )
    with pytest.raises(HTTPException) as disabled_user_error:
        authenticate_user(db_session, disabled.username, "member-pass-123")
    assert disabled_user_error.value.status_code == 403

    custom_invite = InviteCode(
        code="INVITE-EDGE-001",
        created_by_id=ensured_admin.id,
        expires_at=None,
        max_uses=2,
        used_count=0,
        is_active=True,
        note="edge invite",
    )
    db_session.add(custom_invite)
    db_session.commit()

    valid = validate_invite_code_for_registration(db_session, custom_invite.code)
    consume_invite_code(valid)
    assert valid.used_count == 1

    expired = InviteCode(
        code="INVITE-EXPIRED",
        created_by_id=ensured_admin.id,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        max_uses=None,
        used_count=0,
        is_active=True,
        note=None,
    )
    exhausted = InviteCode(
        code="INVITE-EXHAUSTED",
        created_by_id=ensured_admin.id,
        expires_at=None,
        max_uses=1,
        used_count=1,
        is_active=True,
        note=None,
    )
    disabled_invite = InviteCode(
        code="INVITE-DISABLED",
        created_by_id=ensured_admin.id,
        expires_at=None,
        max_uses=None,
        used_count=0,
        is_active=False,
        note=None,
    )
    db_session.add_all([expired, exhausted, disabled_invite])
    db_session.commit()
    with pytest.raises(HTTPException) as expired_error:
        validate_invite_code_for_registration(db_session, "INVITE-EXPIRED")
    assert expired_error.value.status_code == 400
    with pytest.raises(HTTPException) as exhausted_error:
        validate_invite_code_for_registration(db_session, "INVITE-EXHAUSTED")
    assert exhausted_error.value.status_code == 400
    with pytest.raises(HTTPException) as disabled_error:
        validate_invite_code_for_registration(db_session, "INVITE-DISABLED")
    assert disabled_error.value.status_code == 400

    generated = generate_invite_code(20)
    assert len(generated) == 20
    assert generated.isupper()


def test_auth_routes_and_dependency_guards(raw_client: TestClient, db_session: Session):
    invite = InviteCode(
        code="REG-CODE-001",
        created_by_id=1,
        expires_at=None,
        max_uses=10,
        used_count=0,
        is_active=True,
        note="register",
    )
    db_session.add(invite)
    db_session.commit()

    register_response = raw_client.post(
        "/api/v1/auth/register",
        json={
            "invite_code": "REG-CODE-001",
            "username": "member-1",
            "password": "member-pass-123",
        },
    )
    assert register_response.status_code == 200

    login_response = raw_client.post(
        "/api/v1/auth/login",
        json={"username": "member-1", "password": "member-pass-123"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_response = raw_client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["username"] == "member-1"

    missing_auth_response = raw_client.get("/api/v1/accounts")
    assert missing_auth_response.status_code == 401

    invalid_auth_response = raw_client.get(
        "/api/v1/accounts",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert invalid_auth_response.status_code == 401

    create_account_response = raw_client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "name": "成员现金账户",
            "type": "CASH",
            "base_currency": "CNY",
            "is_active": True,
        },
    )
    assert create_account_response.status_code == 200

    admin_forbidden_response = raw_client.get("/api/v1/admin/users", headers=headers)
    assert admin_forbidden_response.status_code == 403

    duplicate_register_response = raw_client.post(
        "/api/v1/auth/register",
        json={
            "invite_code": "REG-CODE-001",
            "username": "member-1",
            "password": "member-pass-123",
        },
    )
    assert duplicate_register_response.status_code == 409


def test_admin_routes_with_admin_token(raw_client: TestClient):
    admin_token = _login_token(raw_client, "admin", "admin123")
    headers = {"Authorization": f"Bearer {admin_token}"}

    list_users_response = raw_client.get("/api/v1/admin/users", headers=headers)
    assert list_users_response.status_code == 200
    assert any(item["username"] == "admin" for item in list_users_response.json())

    create_user_response = raw_client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "username": "created-by-admin",
            "password": "member-pass-123",
            "role": "MEMBER",
            "is_active": True,
        },
    )
    assert create_user_response.status_code == 200
    created_user_id = create_user_response.json()["id"]

    update_user_response = raw_client.patch(
        f"/api/v1/admin/users/{created_user_id}",
        headers=headers,
        json={"is_active": False, "role": "MEMBER"},
    )
    assert update_user_response.status_code == 200
    assert update_user_response.json()["is_active"] is False

    last_admin_guard = raw_client.patch(
        "/api/v1/admin/users/1",
        headers=headers,
        json={"role": "MEMBER"},
    )
    assert last_admin_guard.status_code == 400

    create_invite_response = raw_client.post(
        "/api/v1/admin/invite-codes",
        headers=headers,
        json={
            "code": "ADMIN-INVITE-001",
            "max_uses": 5,
            "expires_at": None,
            "note": "admin invite",
        },
    )
    assert create_invite_response.status_code == 200
    invite_id = create_invite_response.json()["id"]

    list_invites_response = raw_client.get("/api/v1/admin/invite-codes", headers=headers)
    assert list_invites_response.status_code == 200
    assert any(item["id"] == invite_id for item in list_invites_response.json())

    update_invite_response = raw_client.patch(
        f"/api/v1/admin/invite-codes/{invite_id}",
        headers=headers,
        json={"is_active": False, "note": "disabled"},
    )
    assert update_invite_response.status_code == 200
    assert update_invite_response.json()["is_active"] is False
