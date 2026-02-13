from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Quote, QuoteProviderStatus, Transaction, TransactionType
from app.services.allocation import compute_drift_items
from app.services.fx import convert_amount
from app.services.positions import list_holdings
from app.services.transactions import calculate_account_cash_balances


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _safe_convert(db: Session, amount: Decimal, from_currency: str, to_currency: str) -> Decimal:
    if from_currency.upper() == to_currency.upper():
        return amount
    try:
        return convert_amount(db, amount, from_currency, to_currency)
    except Exception:  # noqa: BLE001
        return Decimal("0")


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


def build_returns_curve(db: Session, *, base_currency: str, days: int = 180, owner_id: int) -> list[dict]:
    txs = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.owner_id == owner_id)
            .order_by(Transaction.executed_at, Transaction.id)
        )
    )
    if not txs:
        return []

    instrument_ids = sorted({tx.instrument_id for tx in txs if tx.instrument_id is not None})
    quotes_by_instrument: dict[int, list[Quote]] = defaultdict(list)
    if instrument_ids:
        quotes = list(
            db.scalars(
                select(Quote)
                .where(
                    Quote.instrument_id.in_(instrument_ids),
                    Quote.owner_id == owner_id,
                    Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
                )
                .order_by(Quote.instrument_id, Quote.quoted_at)
            )
        )
        for quote in quotes:
            quotes_by_instrument[quote.instrument_id].append(quote)

    first_date = _as_utc(txs[0].executed_at).date()
    end_date = datetime.now(UTC).date()
    display_start_date = max(first_date, end_date - timedelta(days=max(1, days) - 1))

    tx_idx = 0
    total_tx_count = len(txs)
    quantity_by_instrument: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    quote_idx_by_instrument: dict[int, int] = defaultdict(int)
    current_quote_by_instrument: dict[int, Quote] = {}
    cash_balance_base = Decimal("0")
    net_contribution_base = Decimal("0")
    points: list[dict] = []

    cursor_date = first_date
    while cursor_date <= end_date:
        day_end = datetime.combine(cursor_date, time.max, tzinfo=UTC)
        while tx_idx < total_tx_count and _as_utc(txs[tx_idx].executed_at) <= day_end:
            tx = txs[tx_idx]
            tx_idx += 1

            cash_balance_base += _safe_convert(db, _cash_delta(tx), tx.currency, base_currency)

            if tx.transfer_group_id is None and tx.type in {TransactionType.CASH_IN, TransactionType.CASH_OUT}:
                contribution_sign = Decimal("1") if tx.type == TransactionType.CASH_IN else Decimal("-1")
                net_contribution_base += contribution_sign * _safe_convert(db, Decimal(tx.amount), tx.currency, base_currency)

            if tx.instrument_id is not None:
                if tx.type == TransactionType.BUY and tx.quantity is not None:
                    quantity_by_instrument[tx.instrument_id] += Decimal(tx.quantity)
                elif tx.type == TransactionType.SELL and tx.quantity is not None:
                    quantity_by_instrument[tx.instrument_id] = max(
                        Decimal("0"),
                        quantity_by_instrument[tx.instrument_id] - Decimal(tx.quantity),
                    )

        for instrument_id in instrument_ids:
            quote_list = quotes_by_instrument.get(instrument_id, [])
            q_idx = quote_idx_by_instrument[instrument_id]
            while q_idx < len(quote_list) and _as_utc(quote_list[q_idx].quoted_at) <= day_end:
                current_quote_by_instrument[instrument_id] = quote_list[q_idx]
                q_idx += 1
            quote_idx_by_instrument[instrument_id] = q_idx

        market_value_base = Decimal("0")
        for instrument_id, qty in quantity_by_instrument.items():
            if qty <= Decimal("0"):
                continue

            quote = current_quote_by_instrument.get(instrument_id)
            if quote is None:
                continue

            market_native = qty * Decimal(quote.price)
            market_value_base += _safe_convert(db, market_native, quote.currency, base_currency)

        total_assets = cash_balance_base + market_value_base
        total_return = total_assets - net_contribution_base
        total_return_rate = None
        if net_contribution_base > Decimal("0"):
            total_return_rate = (total_return / net_contribution_base) * Decimal("100")

        if cursor_date >= display_start_date:
            points.append(
                {
                    "date": datetime.combine(cursor_date, time.min, tzinfo=UTC),
                    "net_contribution": net_contribution_base.quantize(Decimal("0.0001")),
                    "total_assets": total_assets.quantize(Decimal("0.0001")),
                    "total_return": total_return.quantize(Decimal("0.0001")),
                    "total_return_rate": total_return_rate.quantize(Decimal("0.0001"))
                    if total_return_rate is not None
                    else None,
                }
            )

        cursor_date += timedelta(days=1)

    return points


def build_dashboard_summary(db: Session, *, base_currency: str, drift_threshold: Decimal, owner_id: int) -> dict:
    holdings = list_holdings(db, base_currency, owner_id)
    total_market_value = sum((Decimal(h["market_value"]) for h in holdings), start=Decimal("0"))

    account_balances = calculate_account_cash_balances(db, base_currency, owner_id)
    total_cash = sum((Decimal(a["base_cash_balance"]) for a in account_balances), start=Decimal("0"))

    total_assets = total_market_value + total_cash
    drift_items = compute_drift_items(
        db,
        base_currency=base_currency,
        total_assets=total_assets,
        threshold=drift_threshold,
        owner_id=owner_id,
    )
    drift_alerts = [item for item in drift_items if item["is_alerted"]]

    return {
        "base_currency": base_currency,
        "total_assets": total_assets.quantize(Decimal("0.0001")),
        "total_cash": total_cash.quantize(Decimal("0.0001")),
        "total_market_value": total_market_value.quantize(Decimal("0.0001")),
        "account_balances": account_balances,
        "drift_alerts": drift_alerts,
    }
