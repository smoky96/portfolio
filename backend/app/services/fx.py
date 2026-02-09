from __future__ import annotations

from decimal import Decimal

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import FxRate


def _fetch_latest_rate(db: Session, base_currency: str, quote_currency: str) -> Decimal | None:
    stmt = (
        select(FxRate)
        .where(
            FxRate.base_currency == base_currency.upper(),
            FxRate.quote_currency == quote_currency.upper(),
        )
        .order_by(desc(FxRate.as_of))
        .limit(1)
    )
    row = db.scalar(stmt)
    return row.rate if row else None


def get_fx_rate(db: Session, from_currency: str, to_currency: str) -> Decimal:
    from_ccy = from_currency.upper()
    to_ccy = to_currency.upper()
    if from_ccy == to_ccy:
        return Decimal("1")

    direct = _fetch_latest_rate(db, from_ccy, to_ccy)
    if direct is not None:
        return direct

    reverse = _fetch_latest_rate(db, to_ccy, from_ccy)
    if reverse is not None and reverse != 0:
        return Decimal("1") / reverse

    base = get_settings().base_currency.upper()
    if from_ccy != base and to_ccy != base:
        rate_to_base = get_fx_rate(db, from_ccy, base)
        base_to_target = get_fx_rate(db, base, to_ccy)
        return rate_to_base * base_to_target

    raise ValueError(f"FX rate missing for {from_ccy}/{to_ccy}")


def convert_amount(db: Session, amount: Decimal, from_currency: str, to_currency: str) -> Decimal:
    rate = get_fx_rate(db, from_currency, to_currency)
    return amount * rate
