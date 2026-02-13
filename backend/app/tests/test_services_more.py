from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.models import (
    Account,
    AccountType,
    FxRate,
    Instrument,
    InstrumentType,
    Quote,
    QuoteProviderStatus,
    Transaction,
    TransactionType,
)
from app.services.dashboard import build_returns_curve
from app.services.fx import convert_amount, get_fx_rate
from app.services.quotes import (
    auto_backfill_history_for_active_positions,
    create_manual_override,
    get_latest_price,
    get_stale_or_missing_quote_instrument_ids,
    refresh_quotes,
)


def test_fx_rate_paths(db_session):
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            FxRate(base_currency="USD", quote_currency="CNY", rate=Decimal("7"), as_of=now, source="manual"),
            FxRate(base_currency="EUR", quote_currency="USD", rate=Decimal("1.2"), as_of=now, source="manual"),
            FxRate(base_currency="HKD", quote_currency="CNY", rate=Decimal("0.9"), as_of=now, source="manual"),
            FxRate(base_currency="EUR", quote_currency="CNY", rate=Decimal("7.8"), as_of=now, source="manual"),
        ]
    )
    db_session.commit()

    assert get_fx_rate(db_session, "CNY", "CNY") == Decimal("1")
    assert get_fx_rate(db_session, "USD", "CNY") == Decimal("7")
    assert get_fx_rate(db_session, "CNY", "USD") == Decimal("1") / Decimal("7")
    assert get_fx_rate(db_session, "EUR", "CNY") == Decimal("7.8")
    assert get_fx_rate(db_session, "EUR", "HKD") == Decimal("7.8") * (Decimal("1") / Decimal("0.9"))
    assert convert_amount(db_session, Decimal("10"), "USD", "CNY") == Decimal("70")

    with pytest.raises(ValueError):
        get_fx_rate(db_session, "JPY", "CNY")


@pytest.mark.asyncio
async def test_refresh_quotes_paths(db_session):
    account = Account(owner_id=1, name="SVC-A", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()
    inst_ok = Instrument(
        owner_id=1,
        symbol="AAPL",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Apple",
        default_account_id=account.id,
    )
    inst_missing = Instrument(
        owner_id=1,
        symbol="MSFT",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Microsoft",
        default_account_id=account.id,
    )
    db_session.add_all([inst_ok, inst_missing])
    db_session.commit()

    class OkAdapter:
        async def fetch_quotes(self, symbols):
            assert symbols == ["AAPL", "MSFT"]
            return {"AAPL": {"price": Decimal("200"), "currency": "USD", "quoted_at_epoch": int(datetime.now().timestamp())}}

    result = await refresh_quotes(db_session, OkAdapter(), owner_id=1)
    assert result["requested"] == 2
    assert result["updated"] == 1
    assert result["failed"] == 1

    class FailingAdapter:
        async def fetch_quotes(self, symbols):
            raise RuntimeError("provider down")

    result = await refresh_quotes(db_session, FailingAdapter(), owner_id=1)
    assert result["requested"] == 2
    assert result["updated"] == 0
    assert result["failed"] == 2

    result = await refresh_quotes(db_session, OkAdapter(), owner_id=1, instrument_ids=[])
    assert result["requested"] == 2


@pytest.mark.asyncio
async def test_auto_backfill_history_for_active_positions(db_session):
    account = Account(owner_id=1, name="SVC-H", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()

    inst_need = Instrument(
        owner_id=1,
        symbol="NEED",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Need Backfill",
        default_account_id=account.id,
    )
    inst_skip = Instrument(
        owner_id=1,
        symbol="SKIP",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Already Has History",
        default_account_id=account.id,
    )
    inst_custom = Instrument(
        owner_id=1,
        symbol="CUST-001",
        market="CUSTOM",
        type=InstrumentType.FUND,
        currency="USD",
        name="Custom Instrument",
        default_account_id=account.id,
    )
    db_session.add_all([inst_need, inst_skip, inst_custom])
    db_session.flush()

    # Active positions: only symbols with quantity > 0 should be considered.
    db_session.add_all(
        [
            Transaction(
                owner_id=1,
                type=TransactionType.BUY,
                account_id=account.id,
                instrument_id=inst_need.id,
                quantity=Decimal("2"),
                price=Decimal("100"),
                amount=Decimal("200"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="USD",
                executed_at=datetime.now(timezone.utc),
                executed_tz="Asia/Shanghai",
                note="active need",
            ),
            Transaction(
                owner_id=1,
                type=TransactionType.BUY,
                account_id=account.id,
                instrument_id=inst_skip.id,
                quantity=Decimal("3"),
                price=Decimal("50"),
                amount=Decimal("150"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="USD",
                executed_at=datetime.now(timezone.utc),
                executed_tz="Asia/Shanghai",
                note="active skip",
            ),
            Transaction(
                owner_id=1,
                type=TransactionType.BUY,
                account_id=account.id,
                instrument_id=inst_custom.id,
                quantity=Decimal("1"),
                price=Decimal("10"),
                amount=Decimal("10"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="USD",
                executed_at=datetime.now(timezone.utc),
                executed_tz="Asia/Shanghai",
                note="active custom",
            ),
        ]
    )
    db_session.flush()
    from app.services.positions import rebuild_position_snapshot

    rebuild_position_snapshot(db_session, owner_id=1, account_id=account.id, instrument_id=inst_need.id)
    rebuild_position_snapshot(db_session, owner_id=1, account_id=account.id, instrument_id=inst_skip.id)
    rebuild_position_snapshot(db_session, owner_id=1, account_id=account.id, instrument_id=inst_custom.id)

    # Existing history for inst_skip: already covers near one-year window -> should be skipped.
    base = datetime.now(timezone.utc) - timedelta(days=364)
    for i in range(4):
        db_session.add(
            Quote(
                owner_id=1,
                instrument_id=inst_skip.id,
                quoted_at=base + timedelta(days=i),
                price=Decimal("50") + Decimal(i),
                currency="USD",
                source="seed",
                provider_status=QuoteProviderStatus.SUCCESS,
            )
        )
    # Existing one-day quote for inst_need: still considered "new" and requires backfill.
    db_session.add(
        Quote(
            owner_id=1,
            instrument_id=inst_need.id,
            quoted_at=datetime.now(timezone.utc),
            price=Decimal("101"),
            currency="USD",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        )
    )
    db_session.commit()

    class HistoryAdapter:
        async def fetch_daily_history(self, symbol, days):
            assert days == 365
            if symbol == "NEED":
                now_epoch = int(datetime.now(timezone.utc).timestamp())
                return [
                    {"price": Decimal("90"), "currency": "USD", "quoted_at_epoch": now_epoch - 2 * 86400},
                    {"price": Decimal("91"), "currency": "USD", "quoted_at_epoch": now_epoch - 86400},
                ]
            if symbol == "SKIP":
                raise AssertionError("SKIP should not trigger history fetch")
            if symbol == "CUST-001":
                raise AssertionError("CUSTOM instrument should not trigger history fetch")
            return []

    result = await auto_backfill_history_for_active_positions(
        db_session,
        HistoryAdapter(),
        owner_id=1,
        lookback_days=365,
        min_points_threshold=2,
    )
    assert result["requested"] == 1
    assert result["updated"] == 2
    assert result["failed"] == 0

    rows_need = list(
        db_session.scalars(
            select(Quote)
            .where(Quote.owner_id == 1, Quote.instrument_id == inst_need.id, Quote.provider_status == QuoteProviderStatus.SUCCESS)
            .order_by(Quote.quoted_at)
        )
    )
    assert len(rows_need) >= 3


def test_get_latest_price_and_manual_override(db_session):
    account = Account(owner_id=1, name="SVC-B", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()
    instrument = Instrument(
        owner_id=1,
        symbol="BND",
        market="US",
        type=InstrumentType.FUND,
        currency="USD",
        name="BND",
        default_account_id=account.id,
    )
    db_session.add(instrument)
    db_session.flush()

    # no quote
    assert get_latest_price(db_session, 1, instrument.id) == (None, None, None)

    db_session.add(
        Quote(
            owner_id=1,
            instrument_id=instrument.id,
            quoted_at=datetime.now(timezone.utc),
            price=Decimal("72"),
            currency="USD",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        )
    )
    db_session.commit()

    price, currency, source = get_latest_price(db_session, 1, instrument.id)
    assert price == Decimal("72")
    assert currency == "USD"
    assert source == "seed"

    override = create_manual_override(
        db_session,
        owner_id=1,
        instrument_id=instrument.id,
        price=Decimal("73.5"),
        currency="usd",
        overridden_at=datetime.now(timezone.utc) + timedelta(minutes=1),
        reason="test override",
    )
    assert override.instrument_id == instrument.id

    price, currency, source = get_latest_price(db_session, 1, instrument.id)
    assert price == Decimal("73.5")
    assert currency == "USD"
    assert source == "manual"


def test_get_stale_or_missing_quote_instrument_ids(db_session):
    account = Account(owner_id=1, name="SVC-C", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()

    inst_fresh = Instrument(
        owner_id=1,
        symbol="FRESH",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Fresh Quote",
        default_account_id=account.id,
    )
    inst_stale = Instrument(
        owner_id=1,
        symbol="STALE",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Stale Quote",
        default_account_id=account.id,
    )
    inst_missing = Instrument(
        owner_id=1,
        symbol="MISS",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Missing Quote",
        default_account_id=account.id,
    )
    inst_failed_recent = Instrument(
        owner_id=1,
        symbol="FAILR",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Failed Recent",
        default_account_id=account.id,
    )
    inst_failed_stale = Instrument(
        owner_id=1,
        symbol="FAILS",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Failed Stale",
        default_account_id=account.id,
    )
    db_session.add_all([inst_fresh, inst_stale, inst_missing, inst_failed_recent, inst_failed_stale])
    db_session.flush()

    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            Quote(
                owner_id=1,
                instrument_id=inst_fresh.id,
                quoted_at=now - timedelta(minutes=3),
                price=Decimal("100"),
                currency="USD",
                source="yahoo",
                provider_status=QuoteProviderStatus.SUCCESS,
            ),
            Quote(
                owner_id=1,
                instrument_id=inst_stale.id,
                quoted_at=now - timedelta(minutes=90),
                price=Decimal("88"),
                currency="USD",
                source="yahoo",
                provider_status=QuoteProviderStatus.SUCCESS,
            ),
            Quote(
                owner_id=1,
                instrument_id=inst_failed_recent.id,
                quoted_at=now - timedelta(minutes=5),
                price=Decimal("0"),
                currency="USD",
                source="yahoo",
                provider_status=QuoteProviderStatus.FAILED,
            ),
            Quote(
                owner_id=1,
                instrument_id=inst_failed_stale.id,
                quoted_at=now - timedelta(minutes=80),
                price=Decimal("0"),
                currency="USD",
                source="yahoo",
                provider_status=QuoteProviderStatus.FAILED,
            ),
        ]
    )
    db_session.commit()

    stale_or_missing = get_stale_or_missing_quote_instrument_ids(
        db_session,
        owner_id=1,
        instrument_ids=[inst_fresh.id, inst_stale.id, inst_missing.id, inst_failed_recent.id, inst_failed_stale.id],
        stale_after_minutes=30,
    )

    assert stale_or_missing == [inst_stale.id, inst_missing.id, inst_failed_stale.id]


def test_transactions_helpers_and_filters(client, db_session):
    account = Account(owner_id=1, name="TX-ACC", type=AccountType.BROKERAGE, base_currency="CNY", is_active=True)
    db_session.add(account)
    db_session.flush()
    instrument = Instrument(
        owner_id=1,
        symbol="TX1",
        market="CN",
        type=InstrumentType.STOCK,
        currency="CNY",
        name="TX1",
        default_account_id=account.id,
    )
    db_session.add(instrument)
    db_session.flush()

    # create via DB to focus on listing/filter branches
    db_session.add_all(
        [
            Transaction(
                owner_id=1,
                type=TransactionType.CASH_IN,
                account_id=account.id,
                instrument_id=None,
                quantity=None,
                price=None,
                amount=Decimal("1000"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="CNY",
                executed_at=datetime.now(timezone.utc),
                executed_tz="Asia/Shanghai",
                note="in",
            ),
            Transaction(
                owner_id=1,
                type=TransactionType.BUY,
                account_id=account.id,
                instrument_id=instrument.id,
                quantity=Decimal("10"),
                price=Decimal("10"),
                amount=Decimal("100"),
                fee=Decimal("1"),
                tax=Decimal("0"),
                currency="CNY",
                executed_at=datetime.now(timezone.utc),
                executed_tz="Asia/Shanghai",
                note="buy",
            ),
        ]
    )
    db_session.commit()

    resp = client.get("/api/v1/transactions")
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    resp = client.get(f"/api/v1/transactions?account_id={account.id}")
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    resp = client.get(f"/api/v1/transactions?instrument_id={instrument.id}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_yahoo_adapter_and_main_lifecycle(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter
    import app.main as main_mod

    # adapter parsing
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "quoteResponse": {
                    "result": [
                        {"symbol": "AAPL", "regularMarketPrice": 200.12, "currency": "USD", "regularMarketTime": 1700000000}
                    ]
                }
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params):
            assert "symbols" in params
            return FakeResponse()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    payload = await adapter.fetch_quotes(["AAPL"])
    assert payload["AAPL"]["currency"] == "USD"

    # run_daily_quote_refresh closes session
    closed = {"value": False, "called": False, "interval_called": False, "backfill_called": False}

    class FakeSession:
        def __init__(self):
            self._scalars_calls = 0

        def scalar(self, stmt):
            self._scalars_calls += 1
            # first query for bootstrap admin, second for bootstrap invite code
            return None

        def scalars(self, stmt):
            return [1]

        def add(self, obj):
            return None

        def flush(self):
            return None

        def commit(self):
            return None

        def close(self):
            closed["value"] = True

    async def fake_refresh(db, adapter, owner_id, instrument_ids=None):
        closed["called"] = True
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    monkeypatch.setattr(main_mod, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(main_mod, "refresh_quotes", fake_refresh)
    await main_mod.run_daily_quote_refresh()
    assert closed["called"] is True
    assert closed["value"] is True

    async def fake_auto_refresh(db, adapter, owner_id, stale_after_minutes):
        closed["interval_called"] = True
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    async def fake_auto_backfill(db, adapter, owner_id, lookback_days, min_points_threshold, cooldown_minutes):
        closed["backfill_called"] = True
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    closed["value"] = False
    monkeypatch.setattr(main_mod, "auto_refresh_quotes_for_active_positions", fake_auto_refresh)
    monkeypatch.setattr(main_mod, "auto_backfill_history_for_active_positions", fake_auto_backfill)
    await main_mod.run_interval_quote_refresh()
    assert closed["interval_called"] is True
    assert closed["backfill_called"] is True
    assert closed["value"] is True

    # lifespan hooks
    state = {"create": False, "job": False, "start": False, "shutdown": False}

    monkeypatch.setattr(main_mod.Base.metadata, "create_all", lambda bind=None: state.__setitem__("create", True))
    monkeypatch.setattr(main_mod.scheduler, "add_job", lambda *args, **kwargs: state.__setitem__("job", True))
    monkeypatch.setattr(main_mod.scheduler, "start", lambda: state.__setitem__("start", True))
    monkeypatch.setattr(main_mod.scheduler, "shutdown", lambda wait=False: state.__setitem__("shutdown", True))

    async with main_mod.lifespan(FastAPI()):
        assert state["create"] is True
        assert state["job"] is True
        assert state["start"] is True

    assert state["shutdown"] is True
    assert main_mod.health()["status"] == "ok"


@pytest.mark.asyncio
async def test_yahoo_adapter_fallback_to_html_when_rate_limited(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class Api429Response:
        status_code = 429
        text = "Too Many Requests"

        def raise_for_status(self):
            request = httpx.Request("GET", "http://fake")
            raise httpx.HTTPStatusError("429", request=request, response=self)

    class HtmlResponse:
        status_code = 200
        text = (
            "<html><head><title>Apple Inc. (AAPL) Stock Price</title></head>"
            "<body><span data-testid=\"qsp-price\">278.12 </span></body></html>"
        )

        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            if "finance.yahoo.com/quote/AAPL" in url:
                return HtmlResponse()
            return Api429Response()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    payload = await adapter.fetch_quotes(["AAPL"])
    assert payload["AAPL"]["price"] == Decimal("278.12")
    assert payload["AAPL"]["currency"] == "USD"
    assert payload["AAPL"]["name"] == "Apple Inc."


@pytest.mark.asyncio
async def test_yahoo_adapter_fallback_to_chart_when_html_missing(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class Api401Response:
        status_code = 401
        text = "Unauthorized"

        def raise_for_status(self):
            request = httpx.Request("GET", "http://fake")
            raise httpx.HTTPStatusError("401", request=request, response=self)

    class Html404Response:
        status_code = 404
        text = "Not Found"

        def raise_for_status(self):
            request = httpx.Request("GET", "https://finance.yahoo.com/quote/601318.SS")
            raise httpx.HTTPStatusError("404", request=request, response=self)

    class ChartResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {
                                "symbol": "601318.SS",
                                "currency": "CNY",
                                "regularMarketPrice": 66.9,
                                "regularMarketTime": 1700000000,
                                "longName": "Ping An Insurance",
                                "exchangeName": "SHH",
                                "instrumentType": "EQUITY",
                            },
                            "timestamp": [1700000000],
                            "indicators": {"quote": [{"close": [66.9]}]},
                        }
                    ],
                    "error": None,
                }
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            if "finance/chart/601318.SS" in url:
                return ChartResponse()
            if "finance.yahoo.com/quote/601318.SS" in url:
                return Html404Response()
            return Api401Response()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    payload = await adapter.fetch_quotes(["601318.SS"])
    assert payload["601318.SS"]["price"] == Decimal("66.9")
    assert payload["601318.SS"]["currency"] == "CNY"
    assert payload["601318.SS"]["name"] == "Ping An Insurance"


@pytest.mark.asyncio
async def test_yahoo_adapter_fallback_to_cn_fund_provider(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class NotFoundResponse:
        status_code = 404
        text = "Not Found"

        def raise_for_status(self):
            request = httpx.Request("GET", "http://fake")
            raise httpx.HTTPStatusError("404", request=request, response=self)

    class FundResponse:
        status_code = 200
        text = (
            'jsonpgz({"fundcode":"110011","name":"易方达优质精选混合(QDII)",'
            '"jzrq":"2026-02-05","dwjz":"5.4613","gsz":"5.3941","gszzl":"-1.23","gztime":"2026-02-06 15:00"});'
        )

        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            if "fundgz.1234567.com.cn/js/110011.js" in url:
                return FundResponse()
            return NotFoundResponse()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    payload = await adapter.lookup_quote("110011")
    assert payload is not None
    assert payload["price"] == Decimal("5.3941")
    assert payload["currency"] == "CNY"
    assert payload["name"] == "易方达优质精选混合(QDII)"
    assert payload["quote_type"] == "MUTUAL_FUND"


@pytest.mark.asyncio
async def test_yahoo_adapter_fetch_daily_history(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class ChartResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            now_epoch = int(datetime.now(timezone.utc).timestamp())
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {"symbol": "AAPL", "currency": "USD"},
                            "timestamp": [now_epoch - 2 * 86400, now_epoch - 86400, now_epoch],
                            "indicators": {"quote": [{"close": [189.1, None, 190.5]}]},
                        }
                    ],
                    "error": None,
                }
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            assert "finance/chart/AAPL" in url
            assert params["interval"] == "1d"
            assert params["range"] == "1y"
            return ChartResponse()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    rows = await adapter.fetch_daily_history("AAPL", 365)
    assert len(rows) == 2
    assert rows[0]["price"] == Decimal("189.1")
    assert rows[1]["price"] == Decimal("190.5")


@pytest.mark.asyncio
async def test_yahoo_adapter_fetch_daily_history_with_symbol_candidates(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class NotFoundResponse:
        status_code = 404

        def raise_for_status(self):
            request = httpx.Request("GET", "https://query1.finance.yahoo.com/v8/finance/chart/001512")
            raise httpx.HTTPStatusError("404", request=request, response=self)

    class ChartResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            now_epoch = int(datetime.now(timezone.utc).timestamp())
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {"symbol": "001512.OF", "currency": "CNY"},
                            "timestamp": [now_epoch - 86400],
                            "indicators": {"quote": [{"close": [1.2345]}]},
                        }
                    ],
                    "error": None,
                }
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            if "finance/chart/001512.OF" in url:
                return ChartResponse()
            if "finance/chart/001512" in url:
                return NotFoundResponse()
            return NotFoundResponse()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    rows = await adapter.fetch_daily_history("001512", 365)
    assert len(rows) == 1
    assert rows[0]["price"] == Decimal("1.2345")
    assert rows[0]["currency"] == "CNY"


@pytest.mark.asyncio
async def test_yahoo_adapter_fetch_daily_history_fallback_to_cn_fund_history(monkeypatch):
    from app.adapters.yahoo import YahooQuoteAdapter

    class NotFoundResponse:
        status_code = 404
        text = "Not Found"

        def raise_for_status(self):
            request = httpx.Request("GET", "https://query1.finance.yahoo.com/v8/finance/chart/001512")
            raise httpx.HTTPStatusError("404", request=request, response=self)

    class EastmoneyResponse:
        status_code = 200
        text = (
            "var apidata={ content:\"<table><tbody>"
            "<tr><td>2026-02-12</td><td class='tor bold'>1.3804</td></tr>"
            "<tr><td>2026-02-11</td><td class='tor bold'>1.3801</td></tr>"
            "</tbody></table>\",records:2,pages:1,curpage:1};"
        )

        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            if "fundf10.eastmoney.com/F10DataApi.aspx" in url:
                assert params["code"] == "001512"
                return EastmoneyResponse()
            return NotFoundResponse()

    monkeypatch.setattr("app.adapters.yahoo.httpx.AsyncClient", FakeAsyncClient)
    adapter = YahooQuoteAdapter("http://fake")
    rows = await adapter.fetch_daily_history("001512", 365)
    assert len(rows) == 2
    assert rows[0]["price"] == Decimal("1.3804")
    assert rows[0]["currency"] == "CNY"


def test_returns_curve_ignores_failed_quotes(db_session):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    base_time = now - timedelta(days=2)

    account = Account(owner_id=1, name="CURVE-ACC", type=AccountType.BROKERAGE, base_currency="CNY", is_active=True)
    db_session.add(account)
    db_session.flush()

    instrument = Instrument(
        owner_id=1,
        symbol="CURVE1",
        market="CN",
        type=InstrumentType.STOCK,
        currency="CNY",
        name="Curve Instrument",
        default_account_id=account.id,
    )
    db_session.add(instrument)
    db_session.flush()

    db_session.add_all(
        [
            Transaction(
                owner_id=1,
                type=TransactionType.CASH_IN,
                account_id=account.id,
                instrument_id=None,
                quantity=None,
                price=None,
                amount=Decimal("1000"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="CNY",
                executed_at=base_time,
                executed_tz="Asia/Shanghai",
                note="funding",
            ),
            Transaction(
                owner_id=1,
                type=TransactionType.BUY,
                account_id=account.id,
                instrument_id=instrument.id,
                quantity=Decimal("10"),
                price=Decimal("100"),
                amount=Decimal("1000"),
                fee=Decimal("0"),
                tax=Decimal("0"),
                currency="CNY",
                executed_at=base_time + timedelta(hours=1),
                executed_tz="Asia/Shanghai",
                note="buy",
            ),
        ]
    )

    db_session.add(
        Quote(
            owner_id=1,
            instrument_id=instrument.id,
            quoted_at=base_time + timedelta(hours=2),
            price=Decimal("120"),
            currency="CNY",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        )
    )
    db_session.add(
        Quote(
            owner_id=1,
            instrument_id=instrument.id,
            quoted_at=base_time + timedelta(hours=3),
            price=Decimal("0"),
            currency="CNY",
            source="yahoo",
            provider_status=QuoteProviderStatus.FAILED,
        )
    )
    db_session.commit()

    points = build_returns_curve(db_session, base_currency="CNY", days=30, owner_id=1)
    assert points
    last = points[-1]

    assert last["total_assets"] == Decimal("1200.0000")
    assert last["net_contribution"] == Decimal("1000.0000")
    assert last["total_return"] == Decimal("200.0000")
    assert last["total_return_rate"] == Decimal("20.0000")
