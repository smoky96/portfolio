from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account
from app.schemas import AccountCreate, AccountRead, AccountUpdate
from app.services.audit import write_audit_log

router = APIRouter()


@router.get("", response_model=list[AccountRead])
def list_accounts(db: Session = Depends(get_db)) -> list[Account]:
    return list(db.scalars(select(Account).order_by(Account.id)))


@router.post("", response_model=AccountRead)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)) -> Account:
    account = Account(**payload.model_dump())
    db.add(account)
    db.flush()

    write_audit_log(
        db,
        entity="account",
        entity_id=str(account.id),
        action="CREATE",
        before_state=None,
        after_state=payload.model_dump(),
    )

    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(account_id: int, payload: AccountUpdate, db: Session = Depends(get_db)) -> Account:
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    before = {
        "name": account.name,
        "type": account.type.value,
        "base_currency": account.base_currency,
        "is_active": account.is_active,
    }

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(account, key, value)

    write_audit_log(
        db,
        entity="account",
        entity_id=str(account.id),
        action="UPDATE",
        before_state=before,
        after_state={
            "name": account.name,
            "type": account.type.value,
            "base_currency": account.base_currency,
            "is_active": account.is_active,
        },
    )

    db.commit()
    db.refresh(account)
    return account
