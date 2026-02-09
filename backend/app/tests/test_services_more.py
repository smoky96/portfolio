from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI

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
from app.services.quotes import create_manual_override, get_latest_price, refresh_quotes


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
    account = Account(name="SVC-A", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()
    inst_ok = Instrument(
        symbol="AAPL",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Apple",
        default_account_id=account.id,
    )
    inst_missing = Instrument(
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

    result = await refresh_quotes(db_session, OkAdapter())
    assert result["requested"] == 2
    assert result["updated"] == 1
    assert result["failed"] == 1

    class FailingAdapter:
        async def fetch_quotes(self, symbols):
            raise RuntimeError("provider down")

    result = await refresh_quotes(db_session, FailingAdapter())
    assert result["requested"] == 2
    assert result["updated"] == 0
    assert result["failed"] == 2

    result = await refresh_quotes(db_session, OkAdapter(), instrument_ids=[])
    assert result["requested"] == 2


def test_get_latest_price_and_manual_override(db_session):
    account = Account(name="SVC-B", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    db_session.add(account)
    db_session.flush()
    instrument = Instrument(
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
    assert get_latest_price(db_session, instrument.id) == (None, None, None)

    db_session.add(
        Quote(
            instrument_id=instrument.id,
            quoted_at=datetime.now(timezone.utc),
            price=Decimal("72"),
            currency="USD",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        )
    )
    db_session.commit()

    price, currency, source = get_latest_price(db_session, instrument.id)
    assert price == Decimal("72")
    assert currency == "USD"
    assert source == "seed"

    override = create_manual_override(
        db_session,
        instrument_id=instrument.id,
        price=Decimal("73.5"),
        currency="usd",
        overridden_at=datetime.now(timezone.utc) + timedelta(minutes=1),
        reason="test override",
    )
    assert override.instrument_id == instrument.id

    price, currency, source = get_latest_price(db_session, instrument.id)
    assert price == Decimal("73.5")
    assert currency == "USD"
    assert source == "manual"


def test_transactions_helpers_and_filters(client, db_session):
    account = Account(name="TX-ACC", type=AccountType.BROKERAGE, base_currency="CNY", is_active=True)
    db_session.add(account)
    db_session.flush()
    instrument = Instrument(
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
    closed = {"value": False, "called": False}

    class FakeSession:
        def close(self):
            closed["value"] = True

    async def fake_refresh(db, adapter, instrument_ids=None):
        closed["called"] = True
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    monkeypatch.setattr(main_mod, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(main_mod, "refresh_quotes", fake_refresh)
    await main_mod.run_daily_quote_refresh()
    assert closed["called"] is True
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


def test_returns_curve_ignores_failed_quotes(db_session):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    base_time = now - timedelta(days=2)

    account = Account(name="CURVE-ACC", type=AccountType.BROKERAGE, base_currency="CNY", is_active=True)
    db_session.add(account)
    db_session.flush()

    instrument = Instrument(
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
            instrument_id=instrument.id,
            quoted_at=base_time + timedelta(hours=3),
            price=Decimal("0"),
            currency="CNY",
            source="yahoo",
            provider_status=QuoteProviderStatus.FAILED,
        )
    )
    db_session.commit()

    points = build_returns_curve(db_session, base_currency="CNY", days=30)
    assert points
    last = points[-1]

    assert last["total_assets"] == Decimal("1200.0000")
    assert last["net_contribution"] == Decimal("1000.0000")
    assert last["total_return"] == Decimal("200.0000")
    assert last["total_return_rate"] == Decimal("20.0000")
