import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.adapters.yahoo import YahooQuoteAdapter
from app.core.config import get_settings
from app.db.session import get_db
from app.models import Instrument, ManualPriceOverride
from app.schemas import (
    LatestQuoteRead,
    ManualPriceOverrideCreate,
    ManualPriceOverrideRead,
    QuoteRefreshRequest,
    QuoteRefreshResponse,
    YahooLookupQuoteRead,
)
from app.services.quotes import create_manual_override, get_latest_price, refresh_quotes

router = APIRouter()


def _build_symbol_candidates(raw_symbol: str) -> list[str]:
    normalized = raw_symbol.strip().upper()
    if not normalized:
        return []

    candidates: list[str] = [normalized]

    matched = re.fullmatch(r"(SH|SZ|OF)(\d{6})", normalized)
    if matched:
        prefix, digits = matched.groups()
        if prefix == "SH":
            candidates.append(f"{digits}.SS")
        elif prefix == "SZ":
            candidates.append(f"{digits}.SZ")
        elif prefix == "OF":
            candidates.append(f"{digits}.OF")

    matched_hk = re.fullmatch(r"HK(\d{1,5})", normalized)
    if matched_hk:
        digits = matched_hk.group(1)
        if len(digits) == 5 and digits.startswith("0"):
            candidates.append(f"{digits[1:]}.HK")
        if len(digits) <= 4:
            candidates.append(f"{digits.zfill(4)}.HK")
        candidates.append(f"{digits}.HK")

    matched_suffix = re.fullmatch(r"(\d{1,6})\.(SH|SS|SZ|OF|HK)", normalized)
    if matched_suffix:
        digits, suffix = matched_suffix.groups()
        if suffix == "SH":
            candidates.append(f"{digits}.SS")
        elif suffix == "SS":
            candidates.append(f"{digits}.SH")
        elif suffix in {"SZ", "OF"}:
            candidates.append(f"{digits}.{suffix}")
        elif suffix == "HK":
            if len(digits) == 5 and digits.startswith("0"):
                candidates.append(f"{digits[1:]}.HK")
            elif len(digits) <= 4:
                candidates.append(f"{digits.zfill(4)}.HK")

    if re.fullmatch(r"\d{6}", normalized):
        digits = normalized
        if digits.startswith(("6", "5", "9")):
            candidates.append(f"{digits}.SS")
            candidates.append(f"{digits}.SZ")
        elif digits.startswith(("0", "1", "2", "3")):
            candidates.append(f"{digits}.SZ")
            candidates.append(f"{digits}.SS")
        else:
            candidates.append(f"{digits}.SS")
            candidates.append(f"{digits}.SZ")
        # Chinese mutual funds on Yahoo often use .OF
        candidates.append(f"{digits}.OF")

    if re.fullmatch(r"\d{1,5}", normalized):
        if len(normalized) == 5 and normalized.startswith("0"):
            candidates.append(f"{normalized[1:]}.HK")
        if len(normalized) <= 4:
            candidates.append(f"{normalized.zfill(4)}.HK")
        candidates.append(f"{normalized}.HK")

    # Deduplicate while preserving priority
    ordered: list[str] = []
    for item in candidates:
        if item not in ordered:
            ordered.append(item)
    return ordered


@router.post("/refresh", response_model=QuoteRefreshResponse)
async def refresh_quotes_endpoint(payload: QuoteRefreshRequest, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
    return await refresh_quotes(db, adapter, instrument_ids=payload.instrument_ids)


@router.get("/lookup", response_model=YahooLookupQuoteRead)
async def lookup_quote_by_symbol(symbol: str = Query(..., min_length=1, max_length=64)) -> dict:
    settings = get_settings()
    adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
    normalized_symbol = symbol.strip().upper()

    if not normalized_symbol:
        return {
            "symbol": normalized_symbol,
            "found": False,
            "provider_status": "failed",
            "message": "symbol is empty",
        }

    candidates = _build_symbol_candidates(normalized_symbol)
    if not candidates:
        return {
            "symbol": normalized_symbol,
            "matched_symbol": None,
            "found": False,
            "provider_status": "failed",
            "message": "symbol is empty",
        }

    matched_symbol: str | None = None
    quote_data: dict | None = None
    last_error: str | None = None
    for candidate in candidates:
        try:
            quote_data = await adapter.lookup_quote(candidate)
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            continue
        if quote_data:
            matched_symbol = candidate.upper()
            break

    if not quote_data and last_error:
        provider_status = "rate_limited" if "429" in last_error else "failed"
        return {
            "symbol": normalized_symbol,
            "matched_symbol": None,
            "found": False,
            "provider_status": provider_status,
            "message": last_error,
        }

    if not quote_data:
        return {
            "symbol": normalized_symbol,
            "matched_symbol": None,
            "found": False,
            "provider_status": "not_found",
            "message": f"quote not found for candidates: {', '.join(candidates)}",
        }

    quoted_at: datetime | None = None
    epoch = quote_data.get("quoted_at_epoch")
    if isinstance(epoch, int):
        quoted_at = datetime.fromtimestamp(epoch, tz=timezone.utc)

    return {
        "symbol": normalized_symbol,
        "matched_symbol": matched_symbol,
        "found": True,
        "provider_status": "success",
        "name": quote_data.get("name"),
        "price": quote_data.get("price"),
        "currency": quote_data.get("currency"),
        "market": quote_data.get("market"),
        "quote_type": quote_data.get("quote_type"),
        "quoted_at": quoted_at,
    }


@router.get("/latest", response_model=list[LatestQuoteRead])
def list_latest_quotes(
    instrument_ids: list[int] | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(Instrument.id).order_by(Instrument.id)
    if instrument_ids:
        stmt = stmt.where(Instrument.id.in_(instrument_ids))

    rows = []
    for instrument_id in db.scalars(stmt):
        price, currency, source = get_latest_price(db, instrument_id)
        rows.append(
            {
                "instrument_id": instrument_id,
                "price": price,
                "currency": currency,
                "source": source,
            }
        )
    return rows


@router.get("/manual-overrides", response_model=list[ManualPriceOverrideRead])
def list_manual_overrides(db: Session = Depends(get_db)) -> list[ManualPriceOverride]:
    stmt = select(ManualPriceOverride).order_by(desc(ManualPriceOverride.overridden_at), desc(ManualPriceOverride.id))
    return list(db.scalars(stmt))


@router.post("/manual-overrides", response_model=ManualPriceOverrideRead)
def create_manual_override_endpoint(payload: ManualPriceOverrideCreate, db: Session = Depends(get_db)) -> ManualPriceOverride:
    if db.get(Instrument, payload.instrument_id) is None:
        raise HTTPException(status_code=404, detail="Instrument not found")

    return create_manual_override(
        db,
        instrument_id=payload.instrument_id,
        price=payload.price,
        currency=payload.currency,
        overridden_at=payload.overridden_at,
        reason=payload.reason,
    )
