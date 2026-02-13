from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.adapters.yahoo import YahooQuoteAdapter
from app.api.deps import CurrentUser, get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.schemas import HoldingItem
from app.services.positions import list_holdings
from app.services.quotes import auto_refresh_quotes_for_active_positions

router = APIRouter()


@router.get("", response_model=list[HoldingItem])
async def get_holdings(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
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
    return list_holdings(db, settings.base_currency, current_user.id)
