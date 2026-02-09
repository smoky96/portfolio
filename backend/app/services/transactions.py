from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from dateutil import parser as dt_parser
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Instrument, Transaction, TransactionType
from app.schemas import TransactionCreate, TransactionUpdate
from app.services.audit import write_audit_log
from app.services.fx import convert_amount
from app.services.positions import rebuild_position_snapshot

POSITION_AFFECTING_TYPES = {
    TransactionType.BUY,
    TransactionType.SELL,
    TransactionType.FEE,
}

REVERSAL_TYPE_MAP: dict[TransactionType, TransactionType] = {
    TransactionType.BUY: TransactionType.SELL,
    TransactionType.SELL: TransactionType.BUY,
    TransactionType.DIVIDEND: TransactionType.CASH_OUT,
    TransactionType.FEE: TransactionType.CASH_IN,
    TransactionType.CASH_IN: TransactionType.CASH_OUT,
    TransactionType.CASH_OUT: TransactionType.CASH_IN,
}


def _ensure_account(db: Session, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
    return account


def _ensure_instrument(db: Session, instrument_id: int | None) -> Instrument | None:
    if instrument_id is None:
        return None
    instrument = db.get(Instrument, instrument_id)
    if not instrument:
        raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
    return instrument


def _validate_transaction_payload(payload: TransactionCreate) -> None:
    if payload.type in {TransactionType.BUY, TransactionType.SELL}:
        if payload.instrument_id is None:
            raise HTTPException(status_code=400, detail="instrument_id is required for BUY/SELL")
        if payload.quantity is None or payload.quantity <= 0:
            raise HTTPException(status_code=400, detail="quantity must be > 0 for BUY/SELL")

    if payload.type == TransactionType.INTERNAL_TRANSFER:
        if payload.counterparty_account_id is None:
            raise HTTPException(status_code=400, detail="counterparty_account_id is required for INTERNAL_TRANSFER")
        if payload.counterparty_account_id == payload.account_id:
            raise HTTPException(status_code=400, detail="counterparty account must be different")



def _tx_to_audit_state(tx: Transaction) -> dict:
    return {
        "id": tx.id,
        "type": tx.type.value,
        "account_id": tx.account_id,
        "instrument_id": tx.instrument_id,
        "quantity": str(tx.quantity) if tx.quantity is not None else None,
        "price": str(tx.price) if tx.price is not None else None,
        "amount": str(tx.amount),
        "fee": str(tx.fee),
        "tax": str(tx.tax),
        "currency": tx.currency,
        "executed_at": tx.executed_at.isoformat(),
        "executed_tz": tx.executed_tz,
        "transfer_group_id": tx.transfer_group_id,
        "note": tx.note,
    }


def _rebuild_snapshots(db: Session, pairs: set[tuple[int, int]]) -> None:
    for account_id, instrument_id in pairs:
        rebuild_position_snapshot(db, account_id, instrument_id)


def _position_pair_if_needed(account_id: int, instrument_id: int | None, tx_type: TransactionType) -> set[tuple[int, int]]:
    if instrument_id is not None and tx_type in POSITION_AFFECTING_TYPES:
        return {(account_id, instrument_id)}
    return set()


def _get_transaction_or_404(db: Session, transaction_id: int) -> Transaction:
    tx = db.get(Transaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail=f"Transaction {transaction_id} not found")
    return tx


def _build_create_payload_from_update(tx: Transaction, payload: TransactionUpdate) -> TransactionCreate:
    data = payload.model_dump(exclude_unset=True)
    next_type = data.get("type", tx.type)
    if next_type == TransactionType.INTERNAL_TRANSFER:
        raise HTTPException(status_code=400, detail="INTERNAL_TRANSFER can only be created, not patched")

    return TransactionCreate(
        type=next_type,
        account_id=data.get("account_id", tx.account_id),
        instrument_id=data.get("instrument_id", tx.instrument_id),
        counterparty_account_id=None,
        quantity=data.get("quantity", tx.quantity),
        price=data.get("price", tx.price),
        amount=data.get("amount", tx.amount),
        fee=data.get("fee", tx.fee),
        tax=data.get("tax", tx.tax),
        currency=data.get("currency", tx.currency),
        executed_at=data.get("executed_at", tx.executed_at),
        executed_tz=data.get("executed_tz", tx.executed_tz),
        note=data.get("note", tx.note),
    )


def _apply_transaction_payload(tx: Transaction, payload: TransactionCreate) -> None:
    tx.type = payload.type
    tx.account_id = payload.account_id
    tx.instrument_id = payload.instrument_id
    tx.quantity = payload.quantity
    tx.price = payload.price
    tx.amount = payload.amount
    tx.fee = payload.fee
    tx.tax = payload.tax
    tx.currency = payload.currency.upper()
    tx.executed_at = payload.executed_at
    tx.executed_tz = payload.executed_tz
    tx.note = payload.note


def update_transaction(
    db: Session,
    transaction_id: int,
    payload: TransactionUpdate,
    *,
    autocommit: bool = True,
) -> Transaction:
    tx = _get_transaction_or_404(db, transaction_id)
    if tx.transfer_group_id:
        raise HTTPException(status_code=400, detail="internal transfer records cannot be edited directly")

    if not payload.model_dump(exclude_unset=True):
        return tx

    before = _tx_to_audit_state(tx)
    before_pairs = _position_pair_if_needed(tx.account_id, tx.instrument_id, tx.type)

    merged_payload = _build_create_payload_from_update(tx, payload)
    _ensure_account(db, merged_payload.account_id)
    _ensure_instrument(db, merged_payload.instrument_id)
    _validate_transaction_payload(merged_payload)

    _apply_transaction_payload(tx, merged_payload)
    db.flush()

    after_pairs = _position_pair_if_needed(tx.account_id, tx.instrument_id, tx.type)
    _rebuild_snapshots(db, before_pairs | after_pairs)

    write_audit_log(
        db,
        entity="transaction",
        entity_id=str(tx.id),
        action="UPDATE",
        before_state=before,
        after_state=_tx_to_audit_state(tx),
    )

    if autocommit:
        db.commit()
        db.refresh(tx)
    return tx


def delete_transaction(db: Session, transaction_id: int, *, autocommit: bool = True) -> dict:
    tx = _get_transaction_or_404(db, transaction_id)

    if tx.transfer_group_id:
        transfer_group_id = tx.transfer_group_id
        transfer_rows = list(
            db.scalars(
                select(Transaction)
                .where(Transaction.transfer_group_id == transfer_group_id)
                .order_by(Transaction.id)
            )
        )
        if not transfer_rows:
            raise HTTPException(status_code=404, detail=f"Transfer group {transfer_group_id} not found")

        before_state = [_tx_to_audit_state(item) for item in transfer_rows]
        for item in transfer_rows:
            db.delete(item)
        db.flush()

        write_audit_log(
            db,
            entity="transaction",
            entity_id=str(transaction_id),
            action="DELETE_INTERNAL_TRANSFER",
            before_state={"transfer_group_id": transfer_group_id, "rows": before_state},
            after_state=None,
        )

        if autocommit:
            db.commit()
        return {"deleted": True, "deleted_count": len(transfer_rows)}

    before = _tx_to_audit_state(tx)
    rebuild_pairs = _position_pair_if_needed(tx.account_id, tx.instrument_id, tx.type)

    db.delete(tx)
    db.flush()
    _rebuild_snapshots(db, rebuild_pairs)

    write_audit_log(
        db,
        entity="transaction",
        entity_id=str(transaction_id),
        action="DELETE",
        before_state=before,
        after_state=None,
    )

    if autocommit:
        db.commit()
    return {"deleted": True, "deleted_count": 1}


def reverse_transaction(db: Session, transaction_id: int, *, autocommit: bool = True) -> Transaction:
    tx = _get_transaction_or_404(db, transaction_id)

    if tx.transfer_group_id:
        raise HTTPException(status_code=400, detail="internal transfer records cannot be reversed directly")

    reverse_type = REVERSAL_TYPE_MAP.get(tx.type)
    if reverse_type is None:
        raise HTTPException(status_code=400, detail=f"transaction type {tx.type.value} cannot be reversed")

    requires_instrument = reverse_type in {TransactionType.BUY, TransactionType.SELL}
    instrument_id = tx.instrument_id if requires_instrument else None
    quantity = tx.quantity if requires_instrument else None
    price = tx.price if requires_instrument else None

    if requires_instrument and (instrument_id is None or quantity is None or quantity <= 0):
        raise HTTPException(status_code=400, detail="original transaction lacks instrument/quantity for reversal")

    payload = TransactionCreate(
        type=reverse_type,
        account_id=tx.account_id,
        instrument_id=instrument_id,
        counterparty_account_id=None,
        quantity=quantity,
        price=price,
        amount=tx.amount,
        fee=Decimal("0"),
        tax=Decimal("0"),
        currency=tx.currency,
        executed_at=datetime.now(timezone.utc),
        executed_tz=tx.executed_tz,
        note=f"冲销原流水#{tx.id}",
    )
    reversed_tx = create_transaction(db, payload, autocommit=False)

    write_audit_log(
        db,
        entity="transaction",
        entity_id=str(tx.id),
        action="REVERSE",
        before_state=_tx_to_audit_state(tx),
        after_state={
            "reversed_transaction_id": reversed_tx.id,
            "reverse_type": reverse_type.value,
        },
    )

    if autocommit:
        db.commit()
        db.refresh(reversed_tx)
    return reversed_tx


def create_transaction(db: Session, payload: TransactionCreate, *, autocommit: bool = True) -> Transaction:
    _validate_transaction_payload(payload)
    _ensure_account(db, payload.account_id)
    _ensure_instrument(db, payload.instrument_id)

    transfer_group_id: str | None = None

    if payload.type == TransactionType.INTERNAL_TRANSFER:
        _ensure_account(db, payload.counterparty_account_id)
        transfer_group_id = str(uuid.uuid4())

        out_tx = Transaction(
            type=TransactionType.CASH_OUT,
            account_id=payload.account_id,
            instrument_id=None,
            quantity=None,
            price=None,
            amount=payload.amount,
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency=payload.currency.upper(),
            executed_at=payload.executed_at,
            executed_tz=payload.executed_tz,
            transfer_group_id=transfer_group_id,
            note=payload.note,
        )
        in_tx = Transaction(
            type=TransactionType.CASH_IN,
            account_id=payload.counterparty_account_id,
            instrument_id=None,
            quantity=None,
            price=None,
            amount=payload.amount,
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency=payload.currency.upper(),
            executed_at=payload.executed_at,
            executed_tz=payload.executed_tz,
            transfer_group_id=transfer_group_id,
            note=payload.note,
        )
        db.add(out_tx)
        db.add(in_tx)
        db.flush()

        write_audit_log(
            db,
            entity="transaction",
            entity_id=str(out_tx.id),
            action="CREATE_INTERNAL_TRANSFER",
            before_state=None,
            after_state={
                "from_account_id": payload.account_id,
                "to_account_id": payload.counterparty_account_id,
                "amount": str(payload.amount),
                "currency": payload.currency.upper(),
                "transfer_group_id": transfer_group_id,
            },
        )

        if autocommit:
            db.commit()
            db.refresh(out_tx)
        return out_tx

    tx = Transaction(
        type=payload.type,
        account_id=payload.account_id,
        instrument_id=payload.instrument_id,
        quantity=payload.quantity,
        price=payload.price,
        amount=payload.amount,
        fee=payload.fee,
        tax=payload.tax,
        currency=payload.currency.upper(),
        executed_at=payload.executed_at,
        executed_tz=payload.executed_tz,
        note=payload.note,
        transfer_group_id=transfer_group_id,
    )
    db.add(tx)
    db.flush()

    if payload.instrument_id is not None and payload.type in POSITION_AFFECTING_TYPES:
        rebuild_position_snapshot(db, payload.account_id, payload.instrument_id)

    write_audit_log(
        db,
        entity="transaction",
        entity_id=str(tx.id),
        action="CREATE",
        before_state=None,
        after_state={
            "type": payload.type.value,
            "account_id": payload.account_id,
            "instrument_id": payload.instrument_id,
            "amount": str(payload.amount),
            "currency": payload.currency.upper(),
        },
    )

    if autocommit:
        db.commit()
        db.refresh(tx)
    return tx


def _parse_decimal(value: str | None, default: Decimal = Decimal("0")) -> Decimal:
    if value is None or value == "":
        return default
    return Decimal(value)


def _parse_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def import_transactions_from_csv(
    db: Session,
    csv_content: str,
    *,
    rollback_on_error: bool,
) -> dict:
    reader = csv.DictReader(io.StringIO(csv_content))
    errors: list[dict] = []
    total = 0
    success = 0

    for idx, row in enumerate(reader, start=2):
        total += 1
        try:
            payload = TransactionCreate(
                type=TransactionType[row["type"].strip().upper()],
                account_id=int(row["account_id"]),
                instrument_id=_parse_int(row.get("instrument_id")),
                counterparty_account_id=_parse_int(row.get("counterparty_account_id")),
                quantity=_parse_decimal(row.get("quantity"), Decimal("0")) if row.get("quantity") else None,
                price=_parse_decimal(row.get("price"), Decimal("0")) if row.get("price") else None,
                amount=_parse_decimal(row.get("amount")),
                fee=_parse_decimal(row.get("fee")),
                tax=_parse_decimal(row.get("tax")),
                currency=(row.get("currency") or "CNY").upper(),
                executed_at=dt_parser.isoparse(row["executed_at"]),
                executed_tz=row.get("executed_tz") or "Asia/Shanghai",
                note=row.get("note"),
            )

            with db.begin_nested():
                create_transaction(db, payload, autocommit=False)
            success += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"line": idx, "error": str(exc)})

    if rollback_on_error and errors:
        db.rollback()
        success = 0
    else:
        db.commit()

    return {
        "total_rows": total,
        "success_rows": success,
        "failed_rows": len(errors),
        "errors": errors,
    }


def _cash_delta(tx: Transaction) -> Decimal:
    amount = Decimal(tx.amount)
    fee = Decimal(tx.fee)
    tax = Decimal(tx.tax)

    if tx.type == TransactionType.BUY:
        return -(amount + fee + tax)
    if tx.type == TransactionType.SELL:
        return amount - fee - tax
    if tx.type == TransactionType.DIVIDEND:
        return amount
    if tx.type == TransactionType.FEE:
        return -amount
    if tx.type == TransactionType.CASH_IN:
        return amount
    if tx.type == TransactionType.CASH_OUT:
        return -amount
    return Decimal("0")


def calculate_account_cash_balances(db: Session, base_currency: str) -> list[dict]:
    accounts = list(db.scalars(select(Account).where(Account.is_active.is_(True)).order_by(Account.id)))
    txs = list(db.scalars(select(Transaction).order_by(Transaction.executed_at, Transaction.id)))

    txs_by_account: dict[int, list[Transaction]] = {}
    for tx in txs:
        txs_by_account.setdefault(tx.account_id, []).append(tx)

    balances: list[dict] = []
    for account in accounts:
        native_balance = Decimal("0")
        base_balance = Decimal("0")

        for tx in txs_by_account.get(account.id, []):
            delta = _cash_delta(tx)
            native_balance += delta if tx.currency.upper() == account.base_currency.upper() else Decimal("0")
            try:
                base_balance += convert_amount(db, delta, tx.currency, base_currency)
            except Exception:  # noqa: BLE001
                if tx.currency.upper() == base_currency.upper():
                    base_balance += delta

        balances.append(
            {
                "account_id": account.id,
                "account_name": account.name,
                "account_currency": account.base_currency,
                "native_cash_balance": native_balance.quantize(Decimal("0.0001")),
                "base_cash_balance": base_balance.quantize(Decimal("0.0001")),
            }
        )

    return balances
