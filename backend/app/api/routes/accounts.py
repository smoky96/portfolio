from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models import Account, AllocationNode
from app.schemas import AccountCreate, AccountRead, AccountUpdate
from app.services.audit import write_audit_log

router = APIRouter()


def _validate_allocation_node(db: Session, owner_id: int, node_id: int | None) -> None:
    if node_id is None:
        return
    node = db.scalar(select(AllocationNode.id).where(AllocationNode.id == node_id, AllocationNode.owner_id == owner_id))
    if node is None:
        raise HTTPException(status_code=404, detail="Allocation node not found")


@router.get("", response_model=list[AccountRead])
def list_accounts(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Account]:
    return list(
        db.scalars(
            select(Account)
            .where(Account.owner_id == current_user.id)
            .order_by(Account.id)
        )
    )


@router.post("", response_model=AccountRead)
def create_account(
    payload: AccountCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Account:
    _validate_allocation_node(db, current_user.id, payload.allocation_node_id)
    account = Account(owner_id=current_user.id, **payload.model_dump())
    db.add(account)
    db.flush()

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
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
def update_account(
    account_id: int,
    payload: AccountUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Account:
    account = db.scalar(select(Account).where(Account.id == account_id, Account.owner_id == current_user.id))
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    before = {
        "name": account.name,
        "type": account.type.value,
        "base_currency": account.base_currency,
        "is_active": account.is_active,
        "allocation_node_id": account.allocation_node_id,
    }

    updates = payload.model_dump(exclude_unset=True)
    if "allocation_node_id" in updates:
        _validate_allocation_node(db, current_user.id, updates["allocation_node_id"])
    for key, value in updates.items():
        setattr(account, key, value)

    write_audit_log(
        db,
        owner_id=current_user.id,
        actor_user_id=current_user.id,
        entity="account",
        entity_id=str(account.id),
        action="UPDATE",
        before_state=before,
        after_state={
            "name": account.name,
            "type": account.type.value,
            "base_currency": account.base_currency,
            "is_active": account.is_active,
            "allocation_node_id": account.allocation_node_id,
        },
    )

    db.commit()
    db.refresh(account)
    return account
