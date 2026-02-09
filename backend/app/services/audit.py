from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AuditLog


def write_audit_log(
    db: Session,
    *,
    entity: str,
    entity_id: str,
    action: str,
    before_state: dict | None,
    after_state: dict | None,
) -> None:
    log = AuditLog(
        entity=entity,
        entity_id=entity_id,
        action=action,
        before_state=before_state,
        after_state=after_state,
    )
    db.add(log)
