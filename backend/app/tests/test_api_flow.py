from datetime import datetime, timezone


def test_core_api_flow(client):
    # Accounts
    resp = client.post("/api/v1/accounts", json={"name": "现金账户", "type": "CASH", "base_currency": "CNY", "is_active": True})
    assert resp.status_code == 200
    cash_account_id = resp.json()["id"]

    resp = client.post("/api/v1/accounts", json={"name": "券商账户", "type": "BROKERAGE", "base_currency": "CNY", "is_active": True})
    assert resp.status_code == 200
    brokerage_account_id = resp.json()["id"]

    # Allocation
    resp = client.post("/api/v1/allocation/nodes", json={"parent_id": None, "name": "权益", "target_weight": "100", "order_index": 0})
    assert resp.status_code == 200
    node_id = resp.json()["id"]

    # Instrument
    resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "600519.SS",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "贵州茅台",
            "default_account_id": brokerage_account_id,
            "allocation_node_id": node_id,
        },
    )
    assert resp.status_code == 200
    instrument_id = resp.json()["id"]

    # Funding and buy
    now = datetime.now(timezone.utc).isoformat()
    resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "CASH_IN",
            "account_id": brokerage_account_id,
            "amount": "10000",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "deposit",
        },
    )
    assert resp.status_code == 200

    resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "BUY",
            "account_id": brokerage_account_id,
            "instrument_id": instrument_id,
            "quantity": "10",
            "price": "100",
            "amount": "1000",
            "fee": "1",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "buy",
        },
    )
    assert resp.status_code == 200

    # Manual quote
    resp = client.post(
        "/api/v1/quotes/manual-overrides",
        json={
            "instrument_id": instrument_id,
            "price": "120",
            "currency": "CNY",
            "overridden_at": now,
            "reason": "test",
        },
    )
    assert resp.status_code == 200

    # Holdings and drift
    resp = client.get("/api/v1/holdings")
    assert resp.status_code == 200
    holdings = resp.json()
    assert len(holdings) == 1
    assert holdings[0]["quantity"] == "10.00000000"

    resp = client.get("/api/v1/rebalance/drift")
    assert resp.status_code == 200
    drift = resp.json()
    assert len(drift) >= 1

    # Dashboard
    resp = client.get("/api/v1/dashboard/summary")
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["base_currency"] == "CNY"
    assert float(summary["total_assets"]) > 0

    # Internal transfer
    resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "INTERNAL_TRANSFER",
            "account_id": cash_account_id,
            "counterparty_account_id": brokerage_account_id,
            "amount": "500",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "move cash",
        },
    )
    assert resp.status_code == 200
