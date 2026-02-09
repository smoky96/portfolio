from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.adapters.yahoo import YahooQuoteAdapter
from app.models import Instrument, ManualPriceOverride, Quote, QuoteProviderStatus
from app.services.audit import write_audit_log


def get_latest_price(db: Session, instrument_id: int) -> tuple[Decimal | None, str | None, str | None]:
    override_stmt = (
        select(ManualPriceOverride)
        .where(ManualPriceOverride.instrument_id == instrument_id)
        .order_by(desc(ManualPriceOverride.overridden_at))
        .limit(1)
    )
    override = db.scalar(override_stmt)
    if override:
        return override.price, override.currency, "manual"

    quote_stmt = (
        select(Quote)
        .where(
            Quote.instrument_id == instrument_id,
            Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
        )
        .order_by(desc(Quote.quoted_at))
        .limit(1)
    )
    quote = db.scalar(quote_stmt)
    if not quote:
        return None, None, None
    return quote.price, quote.currency, quote.source


async def refresh_quotes(
    db: Session,
    adapter: YahooQuoteAdapter,
    instrument_ids: list[int] | None = None,
) -> dict:
    stmt = select(Instrument)
    if instrument_ids:
        stmt = stmt.where(Instrument.id.in_(instrument_ids))
    instruments = list(db.scalars(stmt))

    symbols = [inst.symbol for inst in instruments]
    requested = len(symbols)
    if not symbols:
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    details: list[dict] = []
    updated = 0
    failed = 0

    try:
        payload = await adapter.fetch_quotes(symbols)
    except Exception as exc:  # noqa: BLE001
        for inst in instruments:
            db.add(
                Quote(
                    instrument_id=inst.id,
                    quoted_at=datetime.now(timezone.utc),
                    price=Decimal("0"),
                    currency=inst.currency,
                    source="yahoo",
                    provider_status=QuoteProviderStatus.FAILED,
                )
            )
            details.append({"instrument_id": inst.id, "symbol": inst.symbol, "status": "failed", "reason": str(exc)})
        db.commit()
        return {"requested": requested, "updated": 0, "failed": requested, "details": details}

    now = datetime.now(timezone.utc)
    for inst in instruments:
        quote_data = payload.get(inst.symbol)
        if not quote_data:
            failed += 1
            db.add(
                Quote(
                    instrument_id=inst.id,
                    quoted_at=now,
                    price=Decimal("0"),
                    currency=inst.currency,
                    source="yahoo",
                    provider_status=QuoteProviderStatus.FAILED,
                )
            )
            details.append({"instrument_id": inst.id, "symbol": inst.symbol, "status": "failed", "reason": "quote missing"})
            continue

        quoted_at = now
        epoch = quote_data.get("quoted_at_epoch")
        if isinstance(epoch, int):
            quoted_at = datetime.fromtimestamp(epoch, tz=timezone.utc)

        db.add(
            Quote(
                instrument_id=inst.id,
                quoted_at=quoted_at,
                price=quote_data["price"],
                currency=quote_data.get("currency") or inst.currency,
                source="yahoo",
                provider_status=QuoteProviderStatus.SUCCESS,
            )
        )
        updated += 1
        details.append({"instrument_id": inst.id, "symbol": inst.symbol, "status": "updated"})

    db.commit()
    return {"requested": requested, "updated": updated, "failed": failed, "details": details}


def create_manual_override(
    db: Session,
    *,
    instrument_id: int,
    price: Decimal,
    currency: str,
    overridden_at: datetime,
    reason: str | None,
) -> ManualPriceOverride:
    override = ManualPriceOverride(
        instrument_id=instrument_id,
        price=price,
        currency=currency.upper(),
        overridden_at=overridden_at,
        operator="single-user",
        reason=reason,
    )
    db.add(override)

    db.add(
        Quote(
            instrument_id=instrument_id,
            quoted_at=overridden_at,
            price=price,
            currency=currency.upper(),
            source="manual",
            provider_status=QuoteProviderStatus.MANUAL_OVERRIDE,
        )
    )

    write_audit_log(
        db,
        entity="manual_price_override",
        entity_id=str(instrument_id),
        action="CREATE",
        before_state=None,
        after_state={"price": str(price), "currency": currency.upper(), "reason": reason},
    )

    db.commit()
    db.refresh(override)
    return override
