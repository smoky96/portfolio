from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models import Instrument, PositionSnapshot, Transaction, TransactionType
from app.services.fx import convert_amount
from app.services.quotes import get_latest_price

ZERO = Decimal("0")


def _compute_position_from_transactions(transactions: list[Transaction]) -> tuple[Decimal, Decimal]:
    quantity = ZERO
    total_cost = ZERO

    for tx in transactions:
        tx_type = tx.type
        tx_qty = Decimal(tx.quantity) if tx.quantity is not None else ZERO
        tx_amount = Decimal(tx.amount)
        tx_fee = Decimal(tx.fee)
        tx_tax = Decimal(tx.tax)

        if tx_type == TransactionType.BUY:
            quantity += tx_qty
            total_cost += tx_amount + tx_fee + tx_tax
        elif tx_type == TransactionType.SELL:
            if quantity <= ZERO:
                quantity = ZERO
                total_cost = ZERO
                continue
            sell_qty = min(tx_qty, quantity)
            avg_cost = total_cost / quantity if quantity else ZERO
            total_cost -= avg_cost * sell_qty
            quantity -= sell_qty
            if quantity <= ZERO:
                quantity = ZERO
                total_cost = ZERO
        elif tx_type == TransactionType.FEE and tx.instrument_id is not None and quantity > ZERO:
            total_cost += tx_amount

    avg_cost = total_cost / quantity if quantity > ZERO else ZERO
    return quantity, avg_cost


def rebuild_position_snapshot(db: Session, account_id: int, instrument_id: int) -> PositionSnapshot:
    tx_stmt: Select[tuple[Transaction]] = (
        select(Transaction)
        .where(Transaction.account_id == account_id, Transaction.instrument_id == instrument_id)
        .order_by(Transaction.executed_at, Transaction.id)
    )
    txs = list(db.scalars(tx_stmt))
    quantity, avg_cost = _compute_position_from_transactions(txs)

    snapshot = db.scalar(
        select(PositionSnapshot).where(
            PositionSnapshot.account_id == account_id,
            PositionSnapshot.instrument_id == instrument_id,
        )
    )

    if snapshot is None:
        snapshot = PositionSnapshot(
            account_id=account_id,
            instrument_id=instrument_id,
            quantity=quantity,
            avg_cost=avg_cost,
        )
        db.add(snapshot)
    else:
        snapshot.quantity = quantity
        snapshot.avg_cost = avg_cost

    db.flush()
    return snapshot


def list_holdings(db: Session, base_currency: str) -> list[dict]:
    stmt = (
        select(PositionSnapshot, Instrument)
        .join(Instrument, Instrument.id == PositionSnapshot.instrument_id)
        .where(PositionSnapshot.quantity > ZERO)
    )
    holdings: list[dict] = []
    for snapshot, instrument in db.execute(stmt).all():
        market_price, quote_currency, _ = get_latest_price(db, instrument.id)
        if market_price is None:
            market_price = Decimal("0")
            quote_currency = instrument.currency

        qty = Decimal(snapshot.quantity)
        avg_cost = Decimal(snapshot.avg_cost)

        raw_market_value = qty * Decimal(market_price)
        raw_cost_value = qty * avg_cost

        from_currency = quote_currency or instrument.currency
        try:
            market_value = convert_amount(db, raw_market_value, from_currency, base_currency)
        except Exception:  # noqa: BLE001
            market_value = raw_market_value

        try:
            cost_value = convert_amount(db, raw_cost_value, instrument.currency, base_currency)
        except Exception:  # noqa: BLE001
            cost_value = raw_cost_value

        unrealized = market_value - cost_value

        holdings.append(
            {
                "account_id": snapshot.account_id,
                "instrument_id": instrument.id,
                "symbol": instrument.symbol,
                "instrument_name": instrument.name,
                "quantity": qty,
                "avg_cost": avg_cost,
                "market_price": Decimal(market_price),
                "market_value": market_value,
                "cost_value": cost_value,
                "unrealized_pnl": unrealized,
                "currency": base_currency,
            }
        )

    return holdings
