from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountType,
    AllocationNode,
    Instrument,
    InstrumentType,
)


def _create_account(client, *, name: str = "账户A", account_type: str = "BROKERAGE") -> int:
    resp = client.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "type": account_type,
            "base_currency": "CNY",
            "is_active": True,
        },
    )
    assert resp.status_code == 200
    return resp.json()["id"]


def _create_root_node(client, *, name: str = "根节点") -> int:
    resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": None, "name": name, "target_weight": "100", "order_index": 0},
    )
    assert resp.status_code == 200
    return resp.json()["id"]


def test_allocation_create_delete_error_paths(client):
    # missing parent
    resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": 9999, "name": "invalid", "target_weight": "100", "order_index": 0},
    )
    assert resp.status_code == 404

    root_id = _create_root_node(client)

    # add child node
    resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_id, "name": "child", "target_weight": "100", "order_index": 0},
    )
    assert resp.status_code == 200
    child_id = resp.json()["id"]

    # delete root should cascade to children
    resp = client.delete(f"/api/v1/allocation/nodes/{root_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert resp.json()["deleted_nodes"] == 2

    # node not found
    resp = client.delete("/api/v1/allocation/nodes/9999")
    assert resp.status_code == 404


def test_allocation_node_create_auto_moves_instruments_and_delete_cascades(client):
    account_id = _create_account(client, name="迁移测试账户")
    root_id = _create_root_node(client, name="迁移根节点")

    create_inst_resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "MOVE-001",
            "market": "CN",
            "type": "FUND",
            "currency": "CNY",
            "name": "迁移测试标的",
            "default_account_id": account_id,
            "allocation_node_id": root_id,
        },
    )
    assert create_inst_resp.status_code == 200
    instrument_id = create_inst_resp.json()["id"]

    create_child_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_id, "name": "迁移子节点", "target_weight": "100", "order_index": 0},
    )
    assert create_child_resp.status_code == 200
    child_id = create_child_resp.json()["id"]

    list_inst_resp = client.get("/api/v1/instruments")
    assert list_inst_resp.status_code == 200
    moved = next(item for item in list_inst_resp.json() if item["id"] == instrument_id)
    assert moved["allocation_node_id"] == child_id

    delete_root_resp = client.delete(f"/api/v1/allocation/nodes/{root_id}")
    assert delete_root_resp.status_code == 200
    payload = delete_root_resp.json()
    assert payload["deleted"] is True
    assert payload["deleted_nodes"] == 2
    assert payload["unbound_instruments"] >= 1

    nodes_resp = client.get("/api/v1/allocation/nodes")
    assert nodes_resp.status_code == 200
    node_ids = {item["id"] for item in nodes_resp.json()}
    assert root_id not in node_ids
    assert child_id not in node_ids

    list_inst_resp = client.get("/api/v1/instruments")
    assert list_inst_resp.status_code == 200
    unbound = next(item for item in list_inst_resp.json() if item["id"] == instrument_id)
    assert unbound["allocation_node_id"] is None


def test_allocation_update_branches(client, db_session: Session):
    root = AllocationNode(owner_id=1, parent_id=None, name="Root", target_weight=Decimal("100"), order_index=0)
    db_session.add(root)
    db_session.flush()
    child = AllocationNode(owner_id=1, parent_id=root.id, name="Child", target_weight=Decimal("100"), order_index=0)
    db_session.add(child)
    db_session.flush()
    grandchild = AllocationNode(owner_id=1, parent_id=child.id, name="Grand", target_weight=Decimal("100"), order_index=0)
    db_session.add(grandchild)
    db_session.flush()

    target = AllocationNode(owner_id=1, parent_id=None, name="Target", target_weight=Decimal("100"), order_index=0)
    db_session.add(target)
    db_session.commit()

    # cannot set self as parent
    resp = client.patch(f"/api/v1/allocation/nodes/{child.id}", json={"parent_id": child.id})
    assert resp.status_code == 400

    # cannot move under descendant
    resp = client.patch(f"/api/v1/allocation/nodes/{child.id}", json={"parent_id": grandchild.id})
    assert resp.status_code == 400

    # move under another root is allowed
    resp = client.patch(f"/api/v1/allocation/nodes/{child.id}", json={"parent_id": target.id})
    assert resp.status_code == 200
    assert resp.json()["parent_id"] == target.id

    # node not found on update
    resp = client.patch("/api/v1/allocation/nodes/9999", json={"name": "x"})
    assert resp.status_code == 404


def test_allocation_batch_weight_updates(client):
    # root sibling group: start from 100/0 then rebalance to 55/45
    root_a_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": None, "name": "A", "target_weight": "100", "order_index": 0},
    )
    assert root_a_resp.status_code == 200
    root_a_id = root_a_resp.json()["id"]

    root_b_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": None, "name": "B", "target_weight": "0", "order_index": 1},
    )
    assert root_b_resp.status_code == 200
    root_b_id = root_b_resp.json()["id"]

    resp = client.patch(
        "/api/v1/allocation/nodes/weights/batch",
        json={
            "parent_id": None,
            "items": [
                {"id": root_a_id, "target_weight": "55"},
                {"id": root_b_id, "target_weight": "45"},
            ],
        },
    )
    assert resp.status_code == 200
    by_id = {item["id"]: item for item in resp.json()}
    assert by_id[root_a_id]["target_weight"] == "55.0000"
    assert by_id[root_b_id]["target_weight"] == "45.0000"

    # payload must include all siblings
    resp = client.patch(
        "/api/v1/allocation/nodes/weights/batch",
        json={"parent_id": None, "items": [{"id": root_a_id, "target_weight": "100"}]},
    )
    assert resp.status_code == 400

    # child sibling group: start from 100/0 then rebalance to 40/60
    child_a_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_a_id, "name": "ChildA", "target_weight": "100", "order_index": 0},
    )
    assert child_a_resp.status_code == 200
    child_a_id = child_a_resp.json()["id"]

    child_b_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_a_id, "name": "ChildB", "target_weight": "0", "order_index": 1},
    )
    assert child_b_resp.status_code == 200
    child_b_id = child_b_resp.json()["id"]

    resp = client.patch(
        "/api/v1/allocation/nodes/weights/batch",
        json={
            "parent_id": root_a_id,
            "items": [
                {"id": child_a_id, "target_weight": "40"},
                {"id": child_b_id, "target_weight": "60"},
            ],
        },
    )
    assert resp.status_code == 200
    child_by_id = {item["id"]: item for item in resp.json()}
    assert child_by_id[child_a_id]["target_weight"] == "40.0000"
    assert child_by_id[child_b_id]["target_weight"] == "60.0000"


def test_instrument_routes_and_reference_validation(client):
    # missing refs
    resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "X1",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "bad account",
            "default_account_id": 9999,
            "allocation_node_id": None,
        },
    )
    assert resp.status_code == 404

    account_id = _create_account(client, name="券商账户")
    root_id = _create_root_node(client, name="权益")
    root_no_child_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": None, "name": "现金直配", "target_weight": "0", "order_index": 1},
    )
    assert root_no_child_resp.status_code == 200
    root_no_child_id = root_no_child_resp.json()["id"]
    leaf_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_id, "name": "中国股票", "target_weight": "100", "order_index": 0},
    )
    assert leaf_resp.status_code == 200
    leaf_id = leaf_resp.json()["id"]

    # create instrument success
    resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "600000.SS",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "浦发银行",
            "default_account_id": account_id,
            "allocation_node_id": leaf_id,
        },
    )
    assert resp.status_code == 200
    instrument_id = resp.json()["id"]

    # update not found
    resp = client.patch("/api/v1/instruments/9999", json={"name": "x"})
    assert resp.status_code == 404

    # update with invalid allocation node
    resp = client.patch(f"/api/v1/instruments/{instrument_id}", json={"allocation_node_id": 9999})
    assert resp.status_code == 404

    # cannot attach instrument to non-leaf node
    resp = client.patch(f"/api/v1/instruments/{instrument_id}", json={"allocation_node_id": root_id})
    assert resp.status_code == 400

    # node without children can still attach instrument (even if it is top-level)
    resp = client.patch(f"/api/v1/instruments/{instrument_id}", json={"allocation_node_id": root_no_child_id})
    assert resp.status_code == 200
    assert resp.json()["allocation_node_id"] == root_no_child_id

    # update success
    resp = client.patch(f"/api/v1/instruments/{instrument_id}", json={"name": "浦发银行A"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "浦发银行A"

    # list
    resp = client.get("/api/v1/instruments")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_transactions_update_delete_and_reverse(client):
    account_id = _create_account(client, name="交易账户", account_type="BROKERAGE")
    root_id = _create_root_node(client, name="权益配置")
    leaf_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_id, "name": "股票", "target_weight": "100", "order_index": 0},
    )
    assert leaf_resp.status_code == 200
    leaf_id = leaf_resp.json()["id"]

    inst_resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "TST-001",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "测试股票",
            "default_account_id": account_id,
            "allocation_node_id": leaf_id,
        },
    )
    assert inst_resp.status_code == 200
    instrument_id = inst_resp.json()["id"]

    now = datetime.now(timezone.utc).isoformat()

    buy_resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "BUY",
            "account_id": account_id,
            "instrument_id": instrument_id,
            "quantity": "10",
            "price": "100",
            "amount": "1000",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "初始买入",
        },
    )
    assert buy_resp.status_code == 200
    buy_tx_id = buy_resp.json()["id"]

    update_resp = client.patch(
        f"/api/v1/transactions/{buy_tx_id}",
        json={"quantity": "12", "amount": "1200", "note": "修正买入"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["quantity"] == "12.00000000"
    assert update_resp.json()["amount"] == "1200.00000000"

    holdings_resp = client.get("/api/v1/holdings")
    assert holdings_resp.status_code == 200
    holdings = holdings_resp.json()
    assert len(holdings) == 1
    assert holdings[0]["quantity"] == "12.00000000"

    reverse_resp = client.post(f"/api/v1/transactions/{buy_tx_id}/reverse")
    assert reverse_resp.status_code == 200
    assert reverse_resp.json()["type"] == "SELL"
    assert reverse_resp.json()["quantity"] == "12.00000000"
    assert reverse_resp.json()["instrument_id"] == instrument_id

    holdings_resp = client.get("/api/v1/holdings")
    assert holdings_resp.status_code == 200
    assert holdings_resp.json() == []

    buy_resp_2 = client.post(
        "/api/v1/transactions",
        json={
            "type": "BUY",
            "account_id": account_id,
            "instrument_id": instrument_id,
            "quantity": "5",
            "price": "90",
            "amount": "450",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "第二次买入",
        },
    )
    assert buy_resp_2.status_code == 200
    buy_tx_2_id = buy_resp_2.json()["id"]

    holdings_resp = client.get("/api/v1/holdings")
    assert holdings_resp.status_code == 200
    holdings = holdings_resp.json()
    assert len(holdings) == 1
    assert holdings[0]["quantity"] == "5.00000000"

    delete_resp = client.delete(f"/api/v1/transactions/{buy_tx_2_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json() == {"deleted": True, "deleted_count": 1}

    holdings_resp = client.get("/api/v1/holdings")
    assert holdings_resp.status_code == 200
    assert holdings_resp.json() == []


def test_transactions_transfer_update_forbidden_and_group_delete(client):
    source_account_id = _create_account(client, name="转出账户", account_type="CASH")
    target_account_id = _create_account(client, name="转入账户", account_type="BROKERAGE")
    now = datetime.now(timezone.utc).isoformat()

    transfer_resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "INTERNAL_TRANSFER",
            "account_id": source_account_id,
            "counterparty_account_id": target_account_id,
            "amount": "500",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": now,
            "executed_tz": "Asia/Shanghai",
            "note": "内部划转",
        },
    )
    assert transfer_resp.status_code == 200
    source_tx_id = transfer_resp.json()["id"]
    transfer_group_id = transfer_resp.json()["transfer_group_id"]
    assert transfer_group_id is not None

    patch_resp = client.patch(f"/api/v1/transactions/{source_tx_id}", json={"amount": "700"})
    assert patch_resp.status_code == 400

    delete_resp = client.delete(f"/api/v1/transactions/{source_tx_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json() == {"deleted": True, "deleted_count": 2}

    list_resp = client.get("/api/v1/transactions")
    assert list_resp.status_code == 200
    remaining_group_ids = {item["transfer_group_id"] for item in list_resp.json() if item["transfer_group_id"]}
    assert transfer_group_id not in remaining_group_ids


def test_dashboard_returns_curve_endpoint(client):
    account_id = _create_account(client, name="收益账户", account_type="BROKERAGE")
    root_id = _create_root_node(client, name="收益节点")
    leaf_resp = client.post(
        "/api/v1/allocation/nodes",
        json={"parent_id": root_id, "name": "收益分类", "target_weight": "100", "order_index": 0},
    )
    assert leaf_resp.status_code == 200

    instrument_resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "CURVE-001",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "曲线测试股票",
            "default_account_id": account_id,
            "allocation_node_id": leaf_resp.json()["id"],
        },
    )
    assert instrument_resp.status_code == 200
    instrument_id = instrument_resp.json()["id"]

    t0 = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    t1 = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    t2 = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    cash_in_resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "CASH_IN",
            "account_id": account_id,
            "amount": "10000",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": t0,
            "executed_tz": "Asia/Shanghai",
            "note": "资金转入",
        },
    )
    assert cash_in_resp.status_code == 200

    buy_resp = client.post(
        "/api/v1/transactions",
        json={
            "type": "BUY",
            "account_id": account_id,
            "instrument_id": instrument_id,
            "quantity": "10",
            "price": "100",
            "amount": "1000",
            "fee": "0",
            "tax": "0",
            "currency": "CNY",
            "executed_at": t1,
            "executed_tz": "Asia/Shanghai",
            "note": "买入",
        },
    )
    assert buy_resp.status_code == 200

    override_resp = client.post(
        "/api/v1/quotes/manual-overrides",
        json={
            "instrument_id": instrument_id,
            "price": "120",
            "currency": "CNY",
            "overridden_at": t2,
            "reason": "收益曲线测试",
        },
    )
    assert override_resp.status_code == 200

    curve_resp = client.get("/api/v1/dashboard/returns-curve?days=30")
    assert curve_resp.status_code == 200
    curve = curve_resp.json()
    assert len(curve) >= 1

    last_point = curve[-1]
    assert float(last_point["net_contribution"]) > 0
    assert float(last_point["total_assets"]) > 0
    assert "total_return_rate" in last_point
    assert last_point["date"] is not None


@pytest.mark.asyncio
async def test_holdings_endpoint_does_not_trigger_auto_quote_refresh_by_default(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.holdings.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_auto_refresh_stale_minutes=5,
            quote_auto_refresh_on_read=False,
        ),
    )

    async def fail_auto_refresh(*args, **kwargs):
        raise AssertionError("auto refresh should not be called when quote_auto_refresh_on_read is disabled")

    monkeypatch.setattr("app.api.routes.holdings.auto_refresh_quotes_for_active_positions", fail_auto_refresh)

    resp = client.get("/api/v1/holdings")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_holdings_endpoint_triggers_auto_quote_refresh_when_enabled(client, monkeypatch):
    called: dict[str, int] = {}

    monkeypatch.setattr(
        "app.api.routes.holdings.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_auto_refresh_stale_minutes=5,
            quote_auto_refresh_on_read=True,
        ),
    )

    async def fake_auto_refresh(db, adapter, owner_id, stale_after_minutes):
        called["owner_id"] = owner_id
        called["stale_after_minutes"] = stale_after_minutes
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    monkeypatch.setattr("app.api.routes.holdings.auto_refresh_quotes_for_active_positions", fake_auto_refresh)

    resp = client.get("/api/v1/holdings")
    assert resp.status_code == 200
    assert called["owner_id"] == 1
    assert called["stale_after_minutes"] > 0


@pytest.mark.asyncio
async def test_dashboard_summary_endpoint_does_not_trigger_auto_quote_refresh_by_default(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.dashboard.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            drift_alert_threshold=0.05,
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_auto_refresh_stale_minutes=5,
            quote_auto_refresh_on_read=False,
        ),
    )

    async def fail_auto_refresh(*args, **kwargs):
        raise AssertionError("auto refresh should not be called when quote_auto_refresh_on_read is disabled")

    monkeypatch.setattr("app.api.routes.dashboard.auto_refresh_quotes_for_active_positions", fail_auto_refresh)

    resp = client.get("/api/v1/dashboard/summary")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_dashboard_summary_endpoint_triggers_auto_quote_refresh_when_enabled(client, monkeypatch):
    called: dict[str, int] = {}

    monkeypatch.setattr(
        "app.api.routes.dashboard.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            drift_alert_threshold=0.05,
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_auto_refresh_stale_minutes=5,
            quote_auto_refresh_on_read=True,
        ),
    )

    async def fake_auto_refresh(db, adapter, owner_id, stale_after_minutes):
        called["owner_id"] = owner_id
        called["stale_after_minutes"] = stale_after_minutes
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    monkeypatch.setattr("app.api.routes.dashboard.auto_refresh_quotes_for_active_positions", fake_auto_refresh)

    resp = client.get("/api/v1/dashboard/summary")
    assert resp.status_code == 200
    assert called["owner_id"] == 1
    assert called["stale_after_minutes"] > 0


@pytest.mark.asyncio
async def test_dashboard_returns_curve_endpoint_does_not_trigger_history_backfill_when_disabled(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.dashboard.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            quote_auto_refresh_on_read=False,
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_history_backfill_days=365,
            quote_history_backfill_min_points=2,
            quote_history_backfill_cooldown_minutes=60,
        ),
    )

    async def fail_backfill(*args, **kwargs):
        raise AssertionError("history backfill should not be called when quote_auto_refresh_on_read is disabled")

    monkeypatch.setattr("app.api.routes.dashboard.auto_backfill_history_for_active_positions", fail_backfill)

    resp = client.get("/api/v1/dashboard/returns-curve?days=30")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_dashboard_returns_curve_endpoint_triggers_history_backfill_when_enabled(client, monkeypatch):
    called: dict[str, int] = {}

    monkeypatch.setattr(
        "app.api.routes.dashboard.get_settings",
        lambda: SimpleNamespace(
            base_currency="CNY",
            quote_auto_refresh_on_read=True,
            yahoo_quote_url="https://query1.finance.yahoo.com/v7/finance/quote",
            quote_history_backfill_days=365,
            quote_history_backfill_min_points=2,
            quote_history_backfill_cooldown_minutes=60,
        ),
    )

    async def fake_backfill(
        db,
        adapter,
        *,
        owner_id,
        lookback_days,
        min_points_threshold,
        cooldown_minutes,
    ):
        called["owner_id"] = owner_id
        called["lookback_days"] = lookback_days
        called["min_points_threshold"] = min_points_threshold
        called["cooldown_minutes"] = cooldown_minutes
        return {"requested": 0, "updated": 0, "failed": 0, "details": []}

    monkeypatch.setattr("app.api.routes.dashboard.auto_backfill_history_for_active_positions", fake_backfill)

    resp = client.get("/api/v1/dashboard/returns-curve?days=30")
    assert resp.status_code == 200
    assert called["owner_id"] == 1
    assert called["lookback_days"] == 365
    assert called["min_points_threshold"] == 2
    assert called["cooldown_minutes"] == 60


@pytest.mark.asyncio
async def test_quotes_routes_refresh_and_override(client, db_session: Session, monkeypatch):
    now = datetime.now(timezone.utc).isoformat()

    async def fake_refresh_quotes(db, adapter, owner_id, instrument_ids=None):
        return {"requested": 1, "updated": 1, "failed": 0, "details": [{"symbol": "AAPL"}]}

    monkeypatch.setattr("app.api.routes.quotes.refresh_quotes", fake_refresh_quotes)

    resp = client.post("/api/v1/quotes/refresh", json={"instrument_ids": []})
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1

    # override for non-existing instrument
    resp = client.post(
        "/api/v1/quotes/manual-overrides",
        json={
            "instrument_id": 9999,
            "price": "100",
            "currency": "USD",
            "overridden_at": now,
            "reason": "missing",
        },
    )
    assert resp.status_code == 404

    # create needed refs directly
    account = Account(owner_id=1, name="Q-Account", type=AccountType.BROKERAGE, base_currency="USD", is_active=True)
    node = AllocationNode(owner_id=1, parent_id=None, name="Q-Node", target_weight=Decimal("100"), order_index=0)
    db_session.add_all([account, node])
    db_session.flush()
    instrument = Instrument(
        owner_id=1,
        symbol="AAPL",
        market="US",
        type=InstrumentType.STOCK,
        currency="USD",
        name="Apple",
        default_account_id=account.id,
        allocation_node_id=node.id,
    )
    db_session.add(instrument)
    db_session.commit()

    resp = client.post(
        "/api/v1/quotes/manual-overrides",
        json={
            "instrument_id": instrument.id,
            "price": "123.45",
            "currency": "usd",
            "overridden_at": now,
            "reason": "manual",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["instrument_id"] == instrument.id

    resp = client.get("/api/v1/quotes/manual-overrides")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = client.get("/api/v1/quotes/latest")
    assert resp.status_code == 200
    latest_rows = resp.json()
    assert len(latest_rows) == 1
    assert latest_rows[0]["instrument_id"] == instrument.id
    assert latest_rows[0]["source"] == "manual"

    resp = client.get(f"/api/v1/quotes/latest?instrument_ids={instrument.id}")
    assert resp.status_code == 200
    filtered_rows = resp.json()
    assert len(filtered_rows) == 1
    assert filtered_rows[0]["instrument_id"] == instrument.id


@pytest.mark.asyncio
async def test_quotes_lookup_route(client, monkeypatch):
    async def fake_lookup_quote_success(self, symbol):
        assert symbol == "AAPL"
        return {
            "price": Decimal("188.66"),
            "currency": "USD",
            "quoted_at_epoch": 1700000000,
            "name": "Apple Inc.",
            "market": "NASDAQ",
            "quote_type": "EQUITY",
        }

    monkeypatch.setattr("app.api.routes.quotes.YahooQuoteAdapter.lookup_quote", fake_lookup_quote_success)

    resp = client.get("/api/v1/quotes/lookup?symbol=aapl")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "AAPL"
    assert data["matched_symbol"] == "AAPL"
    assert data["found"] is True
    assert data["provider_status"] == "success"
    assert data["name"] == "Apple Inc."
    assert data["currency"] == "USD"
    assert data["price"] == "188.66"

    async def fake_lookup_quote_not_found(self, symbol):
        return None

    monkeypatch.setattr("app.api.routes.quotes.YahooQuoteAdapter.lookup_quote", fake_lookup_quote_not_found)
    resp = client.get("/api/v1/quotes/lookup?symbol=UNKNOWN")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "UNKNOWN"
    assert data["matched_symbol"] is None
    assert data["found"] is False
    assert data["provider_status"] == "not_found"

    async def fake_lookup_quote_error(self, symbol):
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr("app.api.routes.quotes.YahooQuoteAdapter.lookup_quote", fake_lookup_quote_error)
    resp = client.get("/api/v1/quotes/lookup?symbol=ERR")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "ERR"
    assert data["matched_symbol"] is None
    assert data["found"] is False
    assert data["provider_status"] == "failed"
    assert "upstream timeout" in data["message"]


@pytest.mark.asyncio
async def test_quotes_lookup_cn_symbol_candidate_mapping(client, monkeypatch):
    seen_symbols: list[str] = []

    async def fake_lookup_quote(self, symbol):
        seen_symbols.append(symbol)
        if symbol == "600519.SS":
            return {
                "price": Decimal("1700.55"),
                "currency": "CNY",
                "quoted_at_epoch": 1700000000,
                "name": "贵州茅台",
                "market": "Shanghai",
                "quote_type": "EQUITY",
            }
        return None

    monkeypatch.setattr("app.api.routes.quotes.YahooQuoteAdapter.lookup_quote", fake_lookup_quote)

    resp = client.get("/api/v1/quotes/lookup?symbol=600519")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "600519"
    assert data["matched_symbol"] == "600519.SS"
    assert data["found"] is True
    assert data["currency"] == "CNY"
    assert data["name"] == "贵州茅台"
    assert seen_symbols == ["600519", "600519.SS"]


@pytest.mark.asyncio
async def test_quotes_lookup_hk_symbol_candidate_mapping(client, monkeypatch):
    seen_symbols: list[str] = []

    async def fake_lookup_quote(self, symbol):
        seen_symbols.append(symbol)
        if symbol == "0700.HK":
            return {
                "price": Decimal("500.12"),
                "currency": "HKD",
                "quoted_at_epoch": 1700000000,
                "name": "Tencent Holdings Limited",
                "market": "Hong Kong",
                "quote_type": "EQUITY",
            }
        return None

    monkeypatch.setattr("app.api.routes.quotes.YahooQuoteAdapter.lookup_quote", fake_lookup_quote)

    resp = client.get("/api/v1/quotes/lookup?symbol=00700")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "00700"
    assert data["matched_symbol"] == "0700.HK"
    assert data["found"] is True
    assert data["currency"] == "HKD"
    assert data["name"] == "Tencent Holdings Limited"
    assert seen_symbols == ["00700", "0700.HK"]


def test_allocation_tag_group_tag_and_instrument_tag_selection_routes(client):
    account_id = _create_account(client, name="标签账户", account_type="BROKERAGE")

    inst_resp = client.post(
        "/api/v1/instruments",
        json={
            "symbol": "TAG-001",
            "market": "CN",
            "type": "STOCK",
            "currency": "CNY",
            "name": "标签测试标的",
            "default_account_id": account_id,
            "allocation_node_id": None,
        },
    )
    assert inst_resp.status_code == 200
    instrument_id = inst_resp.json()["id"]

    style_group_resp = client.post("/api/v1/allocation/tag-groups", json={"name": "风格", "order_index": 1})
    assert style_group_resp.status_code == 200
    style_group_id = style_group_resp.json()["id"]

    risk_group_resp = client.post("/api/v1/allocation/tag-groups", json={"name": "风险", "order_index": 2})
    assert risk_group_resp.status_code == 200
    risk_group_id = risk_group_resp.json()["id"]

    growth_tag_resp = client.post(
        "/api/v1/allocation/tags",
        json={"group_id": style_group_id, "name": "成长", "order_index": 1},
    )
    assert growth_tag_resp.status_code == 200
    growth_tag_id = growth_tag_resp.json()["id"]

    value_tag_resp = client.post(
        "/api/v1/allocation/tags",
        json={"group_id": style_group_id, "name": "价值", "order_index": 2},
    )
    assert value_tag_resp.status_code == 200
    value_tag_id = value_tag_resp.json()["id"]

    medium_risk_tag_resp = client.post(
        "/api/v1/allocation/tags",
        json={"group_id": risk_group_id, "name": "中风险", "order_index": 1},
    )
    assert medium_risk_tag_resp.status_code == 200
    medium_risk_tag_id = medium_risk_tag_resp.json()["id"]

    tags_resp = client.get(f"/api/v1/allocation/tags?group_id={style_group_id}")
    assert tags_resp.status_code == 200
    assert len(tags_resp.json()) == 2

    upsert_style_resp = client.put(
        "/api/v1/allocation/instrument-tags",
        json={"instrument_id": instrument_id, "group_id": style_group_id, "tag_id": growth_tag_id},
    )
    assert upsert_style_resp.status_code == 200
    assert upsert_style_resp.json()["tag_id"] == growth_tag_id

    # Same group upsert should update existing selection rather than creating a new row.
    upsert_style_resp = client.put(
        "/api/v1/allocation/instrument-tags",
        json={"instrument_id": instrument_id, "group_id": style_group_id, "tag_id": value_tag_id},
    )
    assert upsert_style_resp.status_code == 200
    assert upsert_style_resp.json()["tag_id"] == value_tag_id

    # Different group can coexist.
    upsert_risk_resp = client.put(
        "/api/v1/allocation/instrument-tags",
        json={"instrument_id": instrument_id, "group_id": risk_group_id, "tag_id": medium_risk_tag_id},
    )
    assert upsert_risk_resp.status_code == 200

    selection_list_resp = client.get("/api/v1/allocation/instrument-tags")
    assert selection_list_resp.status_code == 200
    selections = selection_list_resp.json()
    assert len(selections) == 2
    assert len([item for item in selections if item["group_id"] == style_group_id]) == 1

    # Tag/group mismatch should be rejected.
    mismatch_resp = client.put(
        "/api/v1/allocation/instrument-tags",
        json={"instrument_id": instrument_id, "group_id": style_group_id, "tag_id": medium_risk_tag_id},
    )
    assert mismatch_resp.status_code == 400

    delete_selection_resp = client.delete(f"/api/v1/allocation/instrument-tags/{instrument_id}/{style_group_id}")
    assert delete_selection_resp.status_code == 200

    # Deleting group should also clear its tags and related selections.
    delete_group_resp = client.delete(f"/api/v1/allocation/tag-groups/{risk_group_id}")
    assert delete_group_resp.status_code == 200
    remaining_tags_resp = client.get(f"/api/v1/allocation/tags?group_id={risk_group_id}")
    assert remaining_tags_resp.status_code == 200
    assert remaining_tags_resp.json() == []
