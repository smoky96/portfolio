from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.adapters.yahoo import YahooQuoteAdapter
from app.models import Instrument, ManualPriceOverride, PositionSnapshot, Quote, QuoteProviderStatus
from app.services.audit import write_audit_log


def get_latest_price(db: Session, owner_id: int, instrument_id: int) -> tuple[Decimal | None, str | None, str | None]:
    override_stmt = (
        select(ManualPriceOverride)
        .where(ManualPriceOverride.owner_id == owner_id, ManualPriceOverride.instrument_id == instrument_id)
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
            Quote.owner_id == owner_id,
            Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
        )
        .order_by(desc(Quote.quoted_at))
        .limit(1)
    )
    quote = db.scalar(quote_stmt)
    if not quote:
        return None, None, None
    return quote.price, quote.currency, quote.source


def get_stale_or_missing_quote_instrument_ids(
    db: Session,
    *,
    owner_id: int,
    instrument_ids: list[int],
    stale_after_minutes: int,
) -> list[int]:
    if not instrument_ids:
        return []

    unique_ids = sorted(set(instrument_ids))
    if stale_after_minutes <= 0:
        return unique_ids

    latest_success_rows = db.execute(
        select(Quote.instrument_id, func.max(Quote.quoted_at))
        .where(
            Quote.owner_id == owner_id,
            Quote.instrument_id.in_(unique_ids),
            Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
        )
        .group_by(Quote.instrument_id)
    ).all()

    latest_attempt_rows = db.execute(
        select(Quote.instrument_id, func.max(Quote.quoted_at))
        .where(
            Quote.owner_id == owner_id,
            Quote.instrument_id.in_(unique_ids),
        )
        .group_by(Quote.instrument_id)
    ).all()

    latest_success_by_instrument: dict[int, datetime] = {}
    for instrument_id, quoted_at in latest_success_rows:
        if quoted_at is None:
            continue
        if quoted_at.tzinfo is None:
            latest_success_by_instrument[instrument_id] = quoted_at.replace(tzinfo=timezone.utc)
        else:
            latest_success_by_instrument[instrument_id] = quoted_at.astimezone(timezone.utc)

    latest_attempt_by_instrument: dict[int, datetime] = {}
    for instrument_id, quoted_at in latest_attempt_rows:
        if quoted_at is None:
            continue
        if quoted_at.tzinfo is None:
            latest_attempt_by_instrument[instrument_id] = quoted_at.replace(tzinfo=timezone.utc)
        else:
            latest_attempt_by_instrument[instrument_id] = quoted_at.astimezone(timezone.utc)

    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_after_minutes)
    stale_or_missing: list[int] = []
    for instrument_id in unique_ids:
        success_at = latest_success_by_instrument.get(instrument_id)
        if success_at is not None:
            if success_at < stale_cutoff:
                stale_or_missing.append(instrument_id)
            continue

        # No successful quote yet: throttle retries if a recent failed attempt exists.
        last_attempt_at = latest_attempt_by_instrument.get(instrument_id)
        if last_attempt_at is None or last_attempt_at < stale_cutoff:
            stale_or_missing.append(instrument_id)

    return stale_or_missing


def _normalize_quote_day(quoted_at: datetime) -> date:
    if quoted_at.tzinfo is None:
        return quoted_at.replace(tzinfo=timezone.utc).date()
    return quoted_at.astimezone(timezone.utc).date()


def _list_active_quoteable_instrument_ids(db: Session, *, owner_id: int) -> list[int]:
    return list(
        db.scalars(
            select(Instrument.id)
            .join(PositionSnapshot, PositionSnapshot.instrument_id == Instrument.id)
            .where(
                Instrument.owner_id == owner_id,
                PositionSnapshot.owner_id == owner_id,
                PositionSnapshot.quantity > Decimal("0"),
                Instrument.market != "CUSTOM",
            )
            .group_by(Instrument.id)
        )
    )


def _pick_history_backfill_instrument_ids(
    db: Session,
    *,
    owner_id: int,
    active_instrument_ids: list[int],
    lookback_days: int,
    min_points_threshold: int,
    cooldown_minutes: int,
) -> list[int]:
    if not active_instrument_ids:
        return []

    unique_ids = sorted(set(active_instrument_ids))
    lookback_days = max(1, min(lookback_days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    stats_rows = db.execute(
        select(Quote.instrument_id, func.count(Quote.id), func.min(Quote.quoted_at))
        .where(
            Quote.owner_id == owner_id,
            Quote.instrument_id.in_(unique_ids),
            Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
            Quote.quoted_at >= cutoff,
        )
        .group_by(Quote.instrument_id)
    ).all()
    points_by_instrument: dict[int, int] = {}
    oldest_quote_by_instrument: dict[int, datetime] = {}
    for instrument_id, count, oldest_quoted_at in stats_rows:
        instrument_id = int(instrument_id)
        points_by_instrument[instrument_id] = int(count)
        if oldest_quoted_at is None:
            continue
        if oldest_quoted_at.tzinfo is None:
            oldest_quote_by_instrument[instrument_id] = oldest_quoted_at.replace(tzinfo=timezone.utc)
        else:
            oldest_quote_by_instrument[instrument_id] = oldest_quoted_at.astimezone(timezone.utc)

    coverage_cutoff = cutoff + timedelta(days=5)
    candidates: list[int] = []
    for instrument_id in unique_ids:
        points = points_by_instrument.get(instrument_id, 0)
        oldest_quote = oldest_quote_by_instrument.get(instrument_id)
        lacks_coverage = oldest_quote is None or oldest_quote > coverage_cutoff
        if lacks_coverage or points <= min_points_threshold:
            candidates.append(instrument_id)
    if not candidates:
        return []

    if cooldown_minutes <= 0:
        return candidates

    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(minutes=cooldown_minutes)
    recent_attempt_ids = set(
        int(item)
        for item in db.scalars(
            select(Quote.instrument_id)
            .where(
                Quote.owner_id == owner_id,
                Quote.instrument_id.in_(candidates),
                Quote.source == "yahoo_history_backfill_attempt",
                Quote.quoted_at >= cooldown_cutoff,
            )
            .group_by(Quote.instrument_id)
        )
    )
    return [instrument_id for instrument_id in candidates if instrument_id not in recent_attempt_ids]


def _record_history_backfill_attempt(db: Session, *, owner_id: int, instrument: Instrument) -> None:
    db.add(
        Quote(
            owner_id=owner_id,
            instrument_id=instrument.id,
            quoted_at=datetime.now(timezone.utc),
            price=Decimal("0"),
            currency=instrument.currency,
            source="yahoo_history_backfill_attempt",
            provider_status=QuoteProviderStatus.FAILED,
        )
    )


async def auto_backfill_history_for_active_positions(
    db: Session,
    adapter: YahooQuoteAdapter,
    *,
    owner_id: int,
    lookback_days: int = 365,
    min_points_threshold: int = 2,
    cooldown_minutes: int = 24 * 60,
) -> dict:
    active_instrument_ids = _list_active_quoteable_instrument_ids(db, owner_id=owner_id)

    target_ids = _pick_history_backfill_instrument_ids(
        db,
        owner_id=owner_id,
        active_instrument_ids=active_instrument_ids,
        lookback_days=lookback_days,
        min_points_threshold=min_points_threshold,
        cooldown_minutes=cooldown_minutes,
    )
    if not target_ids:
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    instruments = list(
        db.scalars(
            select(Instrument)
            .where(Instrument.owner_id == owner_id, Instrument.id.in_(target_ids))
            .order_by(Instrument.id)
        )
    )

    lookback_days = max(1, min(lookback_days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    details: list[dict] = []
    inserted_count = 0
    failed = 0

    for instrument in instruments:
        try:
            rows = await adapter.fetch_daily_history(instrument.symbol, lookback_days)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            _record_history_backfill_attempt(db, owner_id=owner_id, instrument=instrument)
            details.append(
                {
                    "instrument_id": instrument.id,
                    "symbol": instrument.symbol,
                    "status": "failed",
                    "reason": str(exc),
                }
            )
            continue

        existing_days = {
            _normalize_quote_day(quoted_at)
            for quoted_at in db.scalars(
                select(Quote.quoted_at).where(
                    Quote.owner_id == owner_id,
                    Quote.instrument_id == instrument.id,
                    Quote.provider_status.in_([QuoteProviderStatus.SUCCESS, QuoteProviderStatus.MANUAL_OVERRIDE]),
                    Quote.quoted_at >= cutoff,
                )
            )
        }

        current_inserted = 0
        for row in rows:
            epoch = row.get("quoted_at_epoch")
            price = row.get("price")
            if not isinstance(epoch, int) or price is None:
                continue
            quoted_at = datetime.fromtimestamp(epoch, tz=timezone.utc)
            if quoted_at < cutoff:
                continue
            quote_day = quoted_at.date()
            if quote_day in existing_days:
                continue
            db.add(
                Quote(
                    owner_id=owner_id,
                    instrument_id=instrument.id,
                    quoted_at=quoted_at,
                    price=Decimal(price),
                    currency=(row.get("currency") or instrument.currency).upper(),
                    source="yahoo_history",
                    provider_status=QuoteProviderStatus.SUCCESS,
                )
            )
            existing_days.add(quote_day)
            current_inserted += 1

        if current_inserted == 0:
            _record_history_backfill_attempt(db, owner_id=owner_id, instrument=instrument)
        inserted_count += current_inserted
        details.append(
            {
                "instrument_id": instrument.id,
                "symbol": instrument.symbol,
                "status": "updated" if current_inserted > 0 else "no_change",
                "inserted": current_inserted,
            }
        )

    db.commit()
    return {"requested": len(instruments), "updated": inserted_count, "failed": failed, "details": details}


async def auto_refresh_quotes_for_active_positions(
    db: Session,
    adapter: YahooQuoteAdapter,
    *,
    owner_id: int,
    stale_after_minutes: int,
) -> dict:
    active_instrument_ids = _list_active_quoteable_instrument_ids(db, owner_id=owner_id)

    stale_or_missing_ids = get_stale_or_missing_quote_instrument_ids(
        db,
        owner_id=owner_id,
        instrument_ids=active_instrument_ids,
        stale_after_minutes=stale_after_minutes,
    )
    if not stale_or_missing_ids:
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    return await refresh_quotes(db, adapter, owner_id=owner_id, instrument_ids=stale_or_missing_ids)


async def refresh_quotes(
    db: Session,
    adapter: YahooQuoteAdapter,
    owner_id: int,
    instrument_ids: list[int] | None = None,
) -> dict:
    stmt = select(Instrument).where(Instrument.owner_id == owner_id)
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
                    owner_id=owner_id,
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
                    owner_id=owner_id,
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
                owner_id=owner_id,
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
    owner_id: int,
    instrument_id: int,
    price: Decimal,
    currency: str,
    overridden_at: datetime,
    reason: str | None,
) -> ManualPriceOverride:
    override = ManualPriceOverride(
        owner_id=owner_id,
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
            owner_id=owner_id,
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
        owner_id=owner_id,
        entity="manual_price_override",
        entity_id=str(instrument_id),
        action="CREATE",
        before_state=None,
        after_state={"price": str(price), "currency": currency.upper(), "reason": reason},
    )

    db.commit()
    db.refresh(override)
    return override
