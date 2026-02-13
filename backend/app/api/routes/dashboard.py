from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.adapters.yahoo import YahooQuoteAdapter
from app.api.deps import CurrentUser, get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.schemas import DashboardSummary, ReturnCurvePoint
from app.services.dashboard import build_dashboard_summary, build_returns_curve
from app.services.quotes import auto_backfill_history_for_active_positions, auto_refresh_quotes_for_active_positions

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    settings = get_settings()
    if settings.quote_auto_refresh_on_read:
        adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
        try:
            await auto_refresh_quotes_for_active_positions(
                db,
                adapter,
                owner_id=current_user.id,
                stale_after_minutes=settings.quote_auto_refresh_stale_minutes,
            )
        except Exception:  # noqa: BLE001
            pass
    return build_dashboard_summary(
        db,
        base_currency=settings.base_currency,
        drift_threshold=Decimal(str(settings.drift_alert_threshold * 100)),
        owner_id=current_user.id,
    )


@router.get("/returns-curve", response_model=list[ReturnCurvePoint])
async def get_returns_curve(
    days: int = Query(default=180, ge=7, le=3650),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    settings = get_settings()
    if settings.quote_auto_refresh_on_read:
        adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
        try:
            await auto_backfill_history_for_active_positions(
                db,
                adapter,
                owner_id=current_user.id,
                lookback_days=settings.quote_history_backfill_days,
                min_points_threshold=settings.quote_history_backfill_min_points,
                cooldown_minutes=settings.quote_history_backfill_cooldown_minutes,
            )
        except Exception:  # noqa: BLE001
            pass
    return build_returns_curve(db, base_currency=settings.base_currency, days=days, owner_id=current_user.id)
