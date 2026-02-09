"""initial schema

Revision ID: 20260207_0001
Revises: 
Create Date: 2026-02-07 11:00:00
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "20260207_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    account_type = postgresql.ENUM("CASH", "BROKERAGE", name="account_type", create_type=False)
    instrument_type = postgresql.ENUM("STOCK", "FUND", name="instrument_type", create_type=False)
    transaction_type = postgresql.ENUM(
        "BUY",
        "SELL",
        "DIVIDEND",
        "FEE",
        "CASH_IN",
        "CASH_OUT",
        "INTERNAL_TRANSFER",
        name="transaction_type",
        create_type=False,
    )
    quote_provider_status = postgresql.ENUM(
        "SUCCESS",
        "FAILED",
        "MANUAL_OVERRIDE",
        name="quote_provider_status",
        create_type=False,
    )

    account_type.create(op.get_bind(), checkfirst=True)
    instrument_type.create(op.get_bind(), checkfirst=True)
    transaction_type.create(op.get_bind(), checkfirst=True)
    quote_provider_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("type", account_type, nullable=False),
        sa.Column("base_currency", sa.String(length=8), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "allocation_nodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("allocation_nodes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("target_weight", sa.Numeric(10, 4), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("parent_id", "name", name="uq_allocation_node_parent_name"),
    )

    op.create_table(
        "asset_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("allocation_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("target_weight", sa.Numeric(10, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("node_id", "name", name="uq_asset_category_node_name"),
    )

    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("symbol", sa.String(length=64), nullable=False),
        sa.Column("market", sa.String(length=32), nullable=False),
        sa.Column("type", instrument_type, nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("default_account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("asset_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_instruments_symbol", "instruments", ["symbol"], unique=True)

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", transaction_type, nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("quantity", sa.Numeric(20, 8), nullable=True),
        sa.Column("price", sa.Numeric(20, 8), nullable=True),
        sa.Column("amount", sa.Numeric(20, 8), nullable=False),
        sa.Column("fee", sa.Numeric(20, 8), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(20, 8), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("executed_tz", sa.String(length=64), nullable=False),
        sa.Column("transfer_group_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_transactions_type", "transactions", ["type"], unique=False)
    op.create_index("ix_transactions_transfer_group_id", "transactions", ["transfer_group_id"], unique=False)

    op.create_table(
        "positions_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 8), nullable=False, server_default="0"),
        sa.Column("avg_cost", sa.Numeric(20, 8), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("account_id", "instrument_id", name="uq_position_account_instrument"),
    )

    op.create_table(
        "quotes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quoted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("price", sa.Numeric(20, 8), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("provider_status", quote_provider_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_quotes_instrument_id", "quotes", ["instrument_id"], unique=False)

    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("base_currency", sa.String(length=8), nullable=False),
        sa.Column("quote_currency", sa.String(length=8), nullable=False),
        sa.Column("rate", sa.Numeric(20, 10), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.UniqueConstraint("base_currency", "quote_currency", "as_of", name="uq_fx_rate_pair_asof"),
    )

    op.create_table(
        "manual_price_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price", sa.Numeric(20, 8), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("overridden_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("operator", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_manual_price_overrides_instrument_id", "manual_price_overrides", ["instrument_id"], unique=False)

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("before_state", sa.JSON(), nullable=True),
        sa.Column("after_state", sa.JSON(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_index("ix_manual_price_overrides_instrument_id", table_name="manual_price_overrides")
    op.drop_table("manual_price_overrides")
    op.drop_table("fx_rates")
    op.drop_index("ix_quotes_instrument_id", table_name="quotes")
    op.drop_table("quotes")
    op.drop_table("positions_snapshots")
    op.drop_index("ix_transactions_transfer_group_id", table_name="transactions")
    op.drop_index("ix_transactions_type", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index("ix_instruments_symbol", table_name="instruments")
    op.drop_table("instruments")
    op.drop_table("asset_categories")
    op.drop_table("allocation_nodes")
    op.drop_table("accounts")

    sa.Enum(name="quote_provider_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="transaction_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="instrument_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="account_type").drop(op.get_bind(), checkfirst=True)
