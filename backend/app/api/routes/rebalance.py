from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.schemas import DriftItem
from app.services.allocation import compute_drift_items
from app.services.positions import list_holdings
from app.services.transactions import calculate_account_cash_balances

router = APIRouter()


@router.get("/drift", response_model=list[DriftItem])
def get_drift(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    settings = get_settings()

    holdings = list_holdings(db, settings.base_currency, current_user.id)
    account_balances = calculate_account_cash_balances(db, settings.base_currency, current_user.id)

    total_market = sum((Decimal(h["market_value"]) for h in holdings), start=Decimal("0"))
    total_cash = sum((Decimal(a["base_cash_balance"]) for a in account_balances), start=Decimal("0"))
    total_assets = total_market + total_cash

    threshold_pct = Decimal(str(settings.drift_alert_threshold * 100))
    return compute_drift_items(
        db,
        base_currency=settings.base_currency,
        total_assets=total_assets,
        threshold=threshold_pct,
        owner_id=current_user.id,
    )
