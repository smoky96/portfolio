from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models import Transaction
from app.schemas import TransactionCreate, TransactionImportResult, TransactionRead, TransactionUpdate
from app.services.transactions import (
    create_transaction,
    delete_transaction,
    import_transactions_from_csv,
    reverse_transaction,
    update_transaction,
)

router = APIRouter()


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    account_id: int | None = Query(default=None),
    instrument_id: int | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Transaction]:
    stmt = (
        select(Transaction)
        .where(Transaction.owner_id == current_user.id)
        .order_by(Transaction.executed_at.desc(), Transaction.id.desc())
    )
    if account_id is not None:
        stmt = stmt.where(Transaction.account_id == account_id)
    if instrument_id is not None:
        stmt = stmt.where(Transaction.instrument_id == instrument_id)
    return list(db.scalars(stmt))


@router.post("", response_model=TransactionRead)
def create_transaction_endpoint(
    payload: TransactionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Transaction:
    return create_transaction(db, payload, owner_id=current_user.id)


@router.post("/import-csv", response_model=TransactionImportResult)
async def import_transactions_csv(
    file: UploadFile = File(...),
    rollback_on_error: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    content = (await file.read()).decode("utf-8")
    return import_transactions_from_csv(db, content, owner_id=current_user.id, rollback_on_error=rollback_on_error)


@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction_endpoint(
    transaction_id: int,
    payload: TransactionUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Transaction:
    return update_transaction(db, transaction_id, payload, owner_id=current_user.id)


@router.delete("/{transaction_id}")
def delete_transaction_endpoint(
    transaction_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return delete_transaction(db, transaction_id, owner_id=current_user.id)


@router.post("/{transaction_id}/reverse", response_model=TransactionRead)
def reverse_transaction_endpoint(
    transaction_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Transaction:
    return reverse_transaction(db, transaction_id, owner_id=current_user.id)
