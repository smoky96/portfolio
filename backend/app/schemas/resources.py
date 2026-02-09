from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AccountType, InstrumentType, TransactionType


class AccountBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: AccountType
    base_currency: str = Field(min_length=3, max_length=8, default="CNY")
    is_active: bool = True


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    type: AccountType | None = None
    base_currency: str | None = Field(default=None, min_length=3, max_length=8)
    is_active: bool | None = None


class AccountRead(AccountBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AllocationNodeBase(BaseModel):
    parent_id: int | None = None
    name: str = Field(min_length=1, max_length=120)
    target_weight: Decimal = Field(ge=0, le=100)
    order_index: int = 0


class AllocationNodeCreate(AllocationNodeBase):
    pass


class AllocationNodeUpdate(BaseModel):
    parent_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_weight: Decimal | None = Field(default=None, ge=0, le=100)
    order_index: int | None = None


class WeightUpdateItem(BaseModel):
    id: int
    target_weight: Decimal = Field(ge=0, le=100)


class AllocationNodeBatchWeightsUpdate(BaseModel):
    parent_id: int | None = None
    items: list[WeightUpdateItem] = Field(min_length=1)


class AllocationNodeRead(AllocationNodeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AllocationTagGroupBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    order_index: int = 0


class AllocationTagGroupCreate(AllocationTagGroupBase):
    pass


class AllocationTagGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    order_index: int | None = None


class AllocationTagGroupRead(AllocationTagGroupBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AllocationTagBase(BaseModel):
    group_id: int
    name: str = Field(min_length=1, max_length=120)
    order_index: int = 0


class AllocationTagCreate(AllocationTagBase):
    pass


class AllocationTagUpdate(BaseModel):
    group_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    order_index: int | None = None


class AllocationTagRead(AllocationTagBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InstrumentTagSelectionUpsert(BaseModel):
    instrument_id: int
    group_id: int
    tag_id: int


class InstrumentTagSelectionRead(BaseModel):
    id: int
    instrument_id: int
    group_id: int
    tag_id: int
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InstrumentBase(BaseModel):
    symbol: str = Field(min_length=1, max_length=64)
    market: str = Field(min_length=1, max_length=32)
    type: InstrumentType
    currency: str = Field(min_length=3, max_length=8)
    name: str = Field(min_length=1, max_length=255)
    default_account_id: int | None = None
    allocation_node_id: int | None = None


class InstrumentCreate(InstrumentBase):
    pass


class InstrumentUpdate(BaseModel):
    symbol: str | None = Field(default=None, min_length=1, max_length=64)
    market: str | None = Field(default=None, min_length=1, max_length=32)
    type: InstrumentType | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    default_account_id: int | None = None
    allocation_node_id: int | None = None


class InstrumentRead(InstrumentBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    type: TransactionType
    account_id: int
    instrument_id: int | None = None
    counterparty_account_id: int | None = None
    quantity: Decimal | None = Field(default=None, ge=0)
    price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal = Field(gt=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    tax: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(min_length=3, max_length=8)
    executed_at: datetime
    executed_tz: str = Field(min_length=1, max_length=64)
    note: str | None = None


class TransactionUpdate(BaseModel):
    type: TransactionType | None = None
    account_id: int | None = None
    instrument_id: int | None = None
    quantity: Decimal | None = Field(default=None, ge=0)
    price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = Field(default=None, gt=0)
    fee: Decimal | None = Field(default=None, ge=0)
    tax: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    executed_at: datetime | None = None
    executed_tz: str | None = Field(default=None, min_length=1, max_length=64)
    note: str | None = None


class TransactionRead(BaseModel):
    id: int
    type: TransactionType
    account_id: int
    instrument_id: int | None
    quantity: Decimal | None
    price: Decimal | None
    amount: Decimal
    fee: Decimal
    tax: Decimal
    currency: str
    executed_at: datetime
    executed_tz: str
    transfer_group_id: str | None
    note: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TransactionImportResult(BaseModel):
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: list[dict]


class HoldingItem(BaseModel):
    account_id: int
    instrument_id: int
    symbol: str
    instrument_name: str
    quantity: Decimal
    avg_cost: Decimal
    market_price: Decimal
    market_value: Decimal
    cost_value: Decimal
    unrealized_pnl: Decimal
    currency: str


class DriftItem(BaseModel):
    node_id: int
    name: str
    target_weight: Decimal
    actual_weight: Decimal
    drift_pct: Decimal
    is_alerted: bool


class DashboardSummary(BaseModel):
    base_currency: str
    total_assets: Decimal
    total_cash: Decimal
    total_market_value: Decimal
    account_balances: list[dict]
    drift_alerts: list[DriftItem]


class ReturnCurvePoint(BaseModel):
    date: datetime
    net_contribution: Decimal
    total_assets: Decimal
    total_return: Decimal
    total_return_rate: Decimal | None


class QuoteRefreshRequest(BaseModel):
    instrument_ids: list[int] | None = None


class QuoteRefreshResponse(BaseModel):
    requested: int
    updated: int
    failed: int
    details: list[dict]


class LatestQuoteRead(BaseModel):
    instrument_id: int
    price: Decimal | None
    currency: str | None
    source: str | None


class YahooLookupQuoteRead(BaseModel):
    symbol: str
    matched_symbol: str | None = None
    found: bool
    provider_status: str
    name: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    market: str | None = None
    quote_type: str | None = None
    quoted_at: datetime | None = None
    message: str | None = None


class ManualPriceOverrideCreate(BaseModel):
    instrument_id: int
    price: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=8)
    overridden_at: datetime
    reason: str | None = None


class ManualPriceOverrideRead(BaseModel):
    id: int
    instrument_id: int
    price: Decimal
    currency: str
    overridden_at: datetime
    operator: str
    reason: str | None

    model_config = ConfigDict(from_attributes=True)
