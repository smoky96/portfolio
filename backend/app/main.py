from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.adapters.yahoo import YahooQuoteAdapter
from app.api.router import api_router
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import User
from app.services.auth import ensure_bootstrap_admin, ensure_bootstrap_invite_code
from app.services.quotes import auto_backfill_history_for_active_positions, auto_refresh_quotes_for_active_positions, refresh_quotes

settings = get_settings()

scheduler = AsyncIOScheduler(timezone=ZoneInfo(settings.default_timezone))


async def run_daily_quote_refresh() -> None:
    db = SessionLocal()
    try:
        adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
        owner_ids = list(db.scalars(select(User.id).where(User.is_active.is_(True))))
        for owner_id in owner_ids:
            await refresh_quotes(db, adapter, owner_id=owner_id, instrument_ids=None)
    finally:
        db.close()


async def run_interval_quote_refresh() -> None:
    db = SessionLocal()
    try:
        adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
        owner_ids = list(db.scalars(select(User.id).where(User.is_active.is_(True))))
        for owner_id in owner_ids:
            try:
                await auto_refresh_quotes_for_active_positions(
                    db,
                    adapter,
                    owner_id=owner_id,
                    stale_after_minutes=settings.quote_auto_refresh_stale_minutes,
                )
                await auto_backfill_history_for_active_positions(
                    db,
                    adapter,
                    owner_id=owner_id,
                    lookback_days=settings.quote_history_backfill_days,
                    min_points_threshold=settings.quote_history_backfill_min_points,
                    cooldown_minutes=settings.quote_history_backfill_cooldown_minutes,
                )
            except Exception:  # noqa: BLE001
                continue
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    bootstrap_db = SessionLocal()
    try:
        admin = ensure_bootstrap_admin(bootstrap_db)
        ensure_bootstrap_invite_code(bootstrap_db, created_by_id=admin.id)
        bootstrap_db.commit()
    finally:
        bootstrap_db.close()

    scheduler.add_job(
        run_daily_quote_refresh,
        trigger=CronTrigger(
            hour=settings.quote_refresh_hour,
            minute=settings.quote_refresh_minute,
            timezone=ZoneInfo(settings.default_timezone),
        ),
        id="daily_quote_refresh",
        replace_existing=True,
    )
    scheduler.add_job(
        run_interval_quote_refresh,
        trigger=IntervalTrigger(
            minutes=settings.quote_refresh_interval_minutes,
            timezone=ZoneInfo(settings.default_timezone),
        ),
        id="interval_quote_refresh",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "tz": settings.default_timezone, "base_currency": settings.base_currency, "utc": str(timezone.utc)}


app.include_router(api_router, prefix=settings.api_v1_prefix)
