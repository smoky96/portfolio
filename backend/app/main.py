from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.adapters.yahoo import YahooQuoteAdapter
from app.api.router import api_router
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.services.quotes import refresh_quotes

settings = get_settings()

scheduler = AsyncIOScheduler(timezone=ZoneInfo(settings.default_timezone))


async def run_daily_quote_refresh() -> None:
    db = SessionLocal()
    try:
        adapter = YahooQuoteAdapter(settings.yahoo_quote_url)
        await refresh_quotes(db, adapter, instrument_ids=None)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

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
