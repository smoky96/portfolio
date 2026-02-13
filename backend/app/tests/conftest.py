from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import CurrentUser, get_current_admin, get_current_user
from app.api.router import api_router
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
from app.models import User, UserRole


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    admin = User(
        username="admin",
        password_hash=hash_password("admin123"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=1,
        username="admin",
        role=UserRole.ADMIN,
        is_active=True,
    )
    app.dependency_overrides[get_current_admin] = lambda: CurrentUser(
        id=1,
        username="admin",
        role=UserRole.ADMIN,
        is_active=True,
    )

    with TestClient(app) as c:
        yield c
