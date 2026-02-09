from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select, text

from app.db.session import SessionLocal
from app.models import (
    Account,
    AccountType,
    AllocationNode,
    FxRate,
    Instrument,
    InstrumentType,
    PositionSnapshot,
    Quote,
    QuoteProviderStatus,
    Transaction,
    TransactionType,
)
from app.schemas import TransactionCreate
from app.services.quotes import create_manual_override
from app.services.transactions import create_transaction


def reset_database(db) -> None:
    db.execute(
        text(
            """
            TRUNCATE TABLE
                audit_logs,
                manual_price_overrides,
                quotes,
                positions_snapshots,
                transactions,
                instruments,
                allocation_nodes,
                accounts,
                fx_rates
            RESTART IDENTITY CASCADE
            """
        )
    )
    db.commit()


def seed_accounts(db) -> dict[str, Account]:
    accounts = [
        Account(name="现金管理账户", type=AccountType.CASH, base_currency="CNY", is_active=True),
        Account(name="A股券商账户", type=AccountType.BROKERAGE, base_currency="CNY", is_active=True),
        Account(name="美股券商账户", type=AccountType.BROKERAGE, base_currency="USD", is_active=True),
    ]
    db.add_all(accounts)
    db.flush()
    return {item.name: item for item in accounts}


def seed_allocation(db) -> dict[str, AllocationNode]:
    root_equity = AllocationNode(parent_id=None, name="权益", target_weight=Decimal("70"), order_index=1)
    root_bond = AllocationNode(parent_id=None, name="固收", target_weight=Decimal("20"), order_index=2)
    root_cash = AllocationNode(parent_id=None, name="现金", target_weight=Decimal("10"), order_index=3)
    db.add_all([root_equity, root_bond, root_cash])
    db.flush()

    cn_equity = AllocationNode(parent_id=root_equity.id, name="中国权益", target_weight=Decimal("60"), order_index=1)
    us_equity = AllocationNode(parent_id=root_equity.id, name="海外权益", target_weight=Decimal("40"), order_index=2)
    db.add_all([cn_equity, us_equity])
    db.flush()

    return {
        "中国股票": cn_equity,
        "海外股票": us_equity,
        "债券基金": root_bond,
        "货币现金": root_cash,
    }


def seed_instruments(db, accounts: dict[str, Account], allocation_nodes: dict[str, AllocationNode]) -> dict[str, Instrument]:
    instruments = [
        Instrument(
            symbol="600519.SS",
            market="CN",
            type=InstrumentType.STOCK,
            currency="CNY",
            name="贵州茅台",
            default_account_id=accounts["A股券商账户"].id,
            allocation_node_id=allocation_nodes["中国股票"].id,
        ),
        Instrument(
            symbol="511010.SS",
            market="CN",
            type=InstrumentType.FUND,
            currency="CNY",
            name="国债ETF",
            default_account_id=accounts["A股券商账户"].id,
            allocation_node_id=allocation_nodes["债券基金"].id,
        ),
        Instrument(
            symbol="AAPL",
            market="US",
            type=InstrumentType.STOCK,
            currency="USD",
            name="Apple Inc.",
            default_account_id=accounts["美股券商账户"].id,
            allocation_node_id=allocation_nodes["海外股票"].id,
        ),
        Instrument(
            symbol="BND",
            market="US",
            type=InstrumentType.FUND,
            currency="USD",
            name="Vanguard Total Bond Market ETF",
            default_account_id=accounts["美股券商账户"].id,
            allocation_node_id=allocation_nodes["债券基金"].id,
        ),
    ]
    db.add_all(instruments)
    db.flush()
    return {item.symbol: item for item in instruments}


def seed_fx_rates(db, now: datetime) -> None:
    rates = [
        FxRate(base_currency="USD", quote_currency="CNY", rate=Decimal("7.1000000000"), as_of=now, source="manual"),
        FxRate(base_currency="HKD", quote_currency="CNY", rate=Decimal("0.9100000000"), as_of=now, source="manual"),
    ]
    db.add_all(rates)


def seed_transactions(db, accounts: dict[str, Account], instruments: dict[str, Instrument], base_time: datetime) -> None:
    payloads = [
        TransactionCreate(
            type=TransactionType.CASH_IN,
            account_id=accounts["A股券商账户"].id,
            amount=Decimal("200000"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time,
            executed_tz="Asia/Shanghai",
            note="A股初始入金",
        ),
        TransactionCreate(
            type=TransactionType.CASH_IN,
            account_id=accounts["美股券商账户"].id,
            amount=Decimal("30000"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="USD",
            executed_at=base_time + timedelta(minutes=10),
            executed_tz="America/New_York",
            note="美股初始入金",
        ),
        TransactionCreate(
            type=TransactionType.CASH_IN,
            account_id=accounts["现金管理账户"].id,
            amount=Decimal("50000"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(minutes=20),
            executed_tz="Asia/Shanghai",
            note="现金账户入金",
        ),
        TransactionCreate(
            type=TransactionType.BUY,
            account_id=accounts["A股券商账户"].id,
            instrument_id=instruments["600519.SS"].id,
            quantity=Decimal("50"),
            price=Decimal("1600"),
            amount=Decimal("80000"),
            fee=Decimal("10"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(hours=1),
            executed_tz="Asia/Shanghai",
            note="买入贵州茅台",
        ),
        TransactionCreate(
            type=TransactionType.BUY,
            account_id=accounts["A股券商账户"].id,
            instrument_id=instruments["511010.SS"].id,
            quantity=Decimal("10000"),
            price=Decimal("1.05"),
            amount=Decimal("10500"),
            fee=Decimal("2"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(hours=2),
            executed_tz="Asia/Shanghai",
            note="买入国债ETF",
        ),
        TransactionCreate(
            type=TransactionType.DIVIDEND,
            account_id=accounts["A股券商账户"].id,
            instrument_id=instruments["600519.SS"].id,
            amount=Decimal("1500"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(days=1),
            executed_tz="Asia/Shanghai",
            note="分红入账",
        ),
        TransactionCreate(
            type=TransactionType.FEE,
            account_id=accounts["A股券商账户"].id,
            instrument_id=instruments["600519.SS"].id,
            amount=Decimal("20"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(days=1, minutes=15),
            executed_tz="Asia/Shanghai",
            note="账户管理费",
        ),
        TransactionCreate(
            type=TransactionType.BUY,
            account_id=accounts["美股券商账户"].id,
            instrument_id=instruments["AAPL"].id,
            quantity=Decimal("30"),
            price=Decimal("190"),
            amount=Decimal("5700"),
            fee=Decimal("1"),
            tax=Decimal("0"),
            currency="USD",
            executed_at=base_time + timedelta(days=1, hours=6),
            executed_tz="America/New_York",
            note="买入AAPL",
        ),
        TransactionCreate(
            type=TransactionType.SELL,
            account_id=accounts["美股券商账户"].id,
            instrument_id=instruments["AAPL"].id,
            quantity=Decimal("5"),
            price=Decimal("205"),
            amount=Decimal("1025"),
            fee=Decimal("1"),
            tax=Decimal("0"),
            currency="USD",
            executed_at=base_time + timedelta(days=2, hours=6),
            executed_tz="America/New_York",
            note="卖出部分AAPL",
        ),
        TransactionCreate(
            type=TransactionType.BUY,
            account_id=accounts["美股券商账户"].id,
            instrument_id=instruments["BND"].id,
            quantity=Decimal("80"),
            price=Decimal("72"),
            amount=Decimal("5760"),
            fee=Decimal("1"),
            tax=Decimal("0"),
            currency="USD",
            executed_at=base_time + timedelta(days=2, hours=7),
            executed_tz="America/New_York",
            note="买入BND",
        ),
        TransactionCreate(
            type=TransactionType.INTERNAL_TRANSFER,
            account_id=accounts["现金管理账户"].id,
            counterparty_account_id=accounts["A股券商账户"].id,
            amount=Decimal("10000"),
            fee=Decimal("0"),
            tax=Decimal("0"),
            currency="CNY",
            executed_at=base_time + timedelta(days=3),
            executed_tz="Asia/Shanghai",
            note="现金调拨至A股账户",
        ),
    ]

    for payload in payloads:
        create_transaction(db, payload, autocommit=False)
    db.commit()


def seed_quotes(db, instruments: dict[str, Instrument], now: datetime) -> None:
    rows = [
        Quote(
            instrument_id=instruments["600519.SS"].id,
            quoted_at=now,
            price=Decimal("1688"),
            currency="CNY",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        ),
        Quote(
            instrument_id=instruments["511010.SS"].id,
            quoted_at=now,
            price=Decimal("1.061"),
            currency="CNY",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        ),
        Quote(
            instrument_id=instruments["AAPL"].id,
            quoted_at=now,
            price=Decimal("212"),
            currency="USD",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        ),
        Quote(
            instrument_id=instruments["BND"].id,
            quoted_at=now,
            price=Decimal("73.2"),
            currency="USD",
            source="seed",
            provider_status=QuoteProviderStatus.SUCCESS,
        ),
    ]
    db.add_all(rows)
    db.commit()

    create_manual_override(
        db,
        instrument_id=instruments["AAPL"].id,
        price=Decimal("213.5"),
        currency="USD",
        overridden_at=now + timedelta(minutes=5),
        reason="mock override for testing",
    )


def print_summary(db) -> None:
    account_count = db.scalar(select(func.count(Account.id)))
    instrument_count = db.scalar(select(func.count(Instrument.id)))
    transaction_count = db.scalar(select(func.count(Transaction.id)))
    position_count = db.scalar(select(func.count(PositionSnapshot.id)))
    quote_count = db.scalar(select(func.count(Quote.id)))

    print("Mock data seeded successfully.")
    print(f"accounts={account_count}, instruments={instrument_count}, transactions={transaction_count}, positions={position_count}, quotes={quote_count}")


def main() -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    base_time = now - timedelta(days=5)

    db = SessionLocal()
    try:
        reset_database(db)
        accounts = seed_accounts(db)
        allocation_nodes = seed_allocation(db)
        instruments = seed_instruments(db, accounts, allocation_nodes)
        seed_fx_rates(db, now)
        db.commit()

        seed_transactions(db, accounts, instruments, base_time)
        seed_quotes(db, instruments, now)
        print_summary(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
