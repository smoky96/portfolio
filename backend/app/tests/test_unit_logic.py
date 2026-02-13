from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException

from app.models import Transaction, TransactionType
from app.services.allocation import _validate_sum_to_hundred
from app.services.positions import _compute_position_from_transactions


def make_tx(tx_type: TransactionType, amount: str, quantity: str | None = None, fee: str = "0", tax: str = "0") -> Transaction:
    return Transaction(
        owner_id=1,
        type=tx_type,
        account_id=1,
        instrument_id=1,
        quantity=Decimal(quantity) if quantity else None,
        price=None,
        amount=Decimal(amount),
        fee=Decimal(fee),
        tax=Decimal(tax),
        currency="CNY",
        executed_at=datetime.now(timezone.utc),
        executed_tz="Asia/Shanghai",
    )


def test_weight_sum_validation() -> None:
    _validate_sum_to_hundred([Decimal("60"), Decimal("40")], "ok")


def test_weight_sum_validation_fail() -> None:
    try:
        _validate_sum_to_hundred([Decimal("80"), Decimal("19")], "bad")
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected HTTPException")


def test_moving_average_cost() -> None:
    txs = [
        make_tx(TransactionType.BUY, amount="1000", quantity="10", fee="10"),
        make_tx(TransactionType.BUY, amount="600", quantity="5", fee="0"),
        make_tx(TransactionType.SELL, amount="350", quantity="3", fee="1"),
    ]
    qty, avg = _compute_position_from_transactions(txs)
    assert qty == Decimal("12")
    assert avg.quantize(Decimal("0.0001")) == Decimal("107.3333")
