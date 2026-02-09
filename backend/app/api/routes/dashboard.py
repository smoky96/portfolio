from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas import DashboardSummary, ReturnCurvePoint
from app.services.dashboard import build_dashboard_summary, build_returns_curve

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    return build_dashboard_summary(
        db,
        base_currency=settings.base_currency,
        drift_threshold=Decimal(str(settings.drift_alert_threshold * 100)),
    )


@router.get("/returns-curve", response_model=list[ReturnCurvePoint])
def get_returns_curve(
    days: int = Query(default=180, ge=7, le=3650),
    db: Session = Depends(get_db),
) -> list[dict]:
    settings = get_settings()
    return build_returns_curve(db, base_currency=settings.base_currency, days=days)
