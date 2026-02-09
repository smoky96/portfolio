from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas import HoldingItem
from app.services.positions import list_holdings

router = APIRouter()


@router.get("", response_model=list[HoldingItem])
def get_holdings(db: Session = Depends(get_db)) -> list[dict]:
    settings = get_settings()
    return list_holdings(db, settings.base_currency)
