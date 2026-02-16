from __future__ import annotations

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.auth import ensure_bootstrap_admin, ensure_bootstrap_invite_code


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        admin = ensure_bootstrap_admin(db)
        invite = ensure_bootstrap_invite_code(db, created_by_id=admin.id)
        db.commit()
        print(
            f"Bootstrap admin ensured: username={admin.username}, "
            f"invite_code={invite.code}, env={settings.env}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
