"""add auth tables and owner-based data isolation

Revision ID: 20260211_0004
Revises: 20260209_0003
Create Date: 2026-02-11 21:50:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from passlib.context import CryptContext
from sqlalchemy.dialects import postgresql


revision = "20260211_0004"
down_revision = "20260209_0003"
branch_labels = None
depends_on = None


password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _create_admin_user(bind) -> int:
    password_hash = password_context.hash("admin123")
    admin_id = bind.execute(
        sa.text(
            """
            INSERT INTO users (username, password_hash, role, is_active, last_login_at, created_at, updated_at)
            VALUES (:username, :password_hash, 'ADMIN', true, NULL, timezone('utc', now()), timezone('utc', now()))
            RETURNING id
            """
        ),
        {"username": "admin", "password_hash": password_hash},
    ).scalar_one()
    bind.execute(
        sa.text(
            """
            INSERT INTO invite_codes (code, created_by_id, expires_at, max_uses, used_count, is_active, note, created_at, updated_at)
            VALUES (:code, :created_by_id, NULL, NULL, 0, true, 'bootstrap invite code', timezone('utc', now()), timezone('utc', now()))
            """
        ),
        {"code": "PORTFOLIO-INVITE", "created_by_id": admin_id},
    )
    return int(admin_id)


def _add_owner_column(table_name: str) -> None:
    op.add_column(table_name, sa.Column("owner_id", sa.Integer(), nullable=True))
    op.create_index(f"ix_{table_name}_owner_id", table_name, ["owner_id"], unique=False)


def _drop_owner_column(table_name: str) -> None:
    op.drop_index(f"ix_{table_name}_owner_id", table_name=table_name)
    op.drop_column(table_name, "owner_id")


def upgrade() -> None:
    bind = op.get_bind()

    user_role = postgresql.ENUM("ADMIN", "MEMBER", name="user_role", create_type=False)
    user_role.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code", name="uq_invite_codes_code"),
    )
    op.create_index("ix_invite_codes_id", "invite_codes", ["id"], unique=False)
    op.create_index("ix_invite_codes_code", "invite_codes", ["code"], unique=True)
    op.create_index("ix_invite_codes_created_by_id", "invite_codes", ["created_by_id"], unique=False)

    admin_id = _create_admin_user(bind)

    for table_name in (
        "accounts",
        "allocation_nodes",
        "allocation_tag_groups",
        "allocation_tags",
        "instruments",
        "instrument_tag_selections",
        "transactions",
        "positions_snapshots",
        "quotes",
        "manual_price_overrides",
    ):
        _add_owner_column(table_name)
        bind.execute(sa.text(f"UPDATE {table_name} SET owner_id = :owner_id"), {"owner_id": admin_id})
        op.alter_column(table_name, "owner_id", nullable=False)

    op.add_column("audit_logs", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.add_column("audit_logs", sa.Column("actor_user_id", sa.Integer(), nullable=True))
    op.create_index("ix_audit_logs_owner_id", "audit_logs", ["owner_id"], unique=False)
    op.create_index("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"], unique=False)
    bind.execute(sa.text("UPDATE audit_logs SET owner_id = :owner_id"), {"owner_id": admin_id})

    op.create_foreign_key("fk_accounts_owner_id", "accounts", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_allocation_nodes_owner_id", "allocation_nodes", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_allocation_tag_groups_owner_id", "allocation_tag_groups", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_allocation_tags_owner_id", "allocation_tags", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_instruments_owner_id", "instruments", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key(
        "fk_instrument_tag_selections_owner_id",
        "instrument_tag_selections",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key("fk_transactions_owner_id", "transactions", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_positions_snapshots_owner_id", "positions_snapshots", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_quotes_owner_id", "quotes", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key(
        "fk_manual_price_overrides_owner_id",
        "manual_price_overrides",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key("fk_audit_logs_owner_id", "audit_logs", "users", ["owner_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_audit_logs_actor_user_id", "audit_logs", "users", ["actor_user_id"], ["id"], ondelete="SET NULL")

    op.execute("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_name_key")
    op.create_unique_constraint("uq_account_owner_name", "accounts", ["owner_id", "name"])

    op.drop_constraint("uq_allocation_node_parent_name", "allocation_nodes", type_="unique")
    op.create_unique_constraint("uq_allocation_node_owner_parent_name", "allocation_nodes", ["owner_id", "parent_id", "name"])

    op.drop_constraint("uq_allocation_tag_groups_name", "allocation_tag_groups", type_="unique")
    op.create_unique_constraint("uq_allocation_tag_group_owner_name", "allocation_tag_groups", ["owner_id", "name"])

    op.drop_constraint("uq_allocation_tag_group_name", "allocation_tags", type_="unique")
    op.create_unique_constraint("uq_allocation_tag_owner_group_name", "allocation_tags", ["owner_id", "group_id", "name"])

    op.drop_constraint("uq_instrument_group_tag_selection", "instrument_tag_selections", type_="unique")
    op.create_unique_constraint(
        "uq_instrument_owner_group_tag_selection",
        "instrument_tag_selections",
        ["owner_id", "instrument_id", "group_id"],
    )

    op.drop_constraint("uq_position_account_instrument", "positions_snapshots", type_="unique")
    op.create_unique_constraint(
        "uq_position_owner_account_instrument",
        "positions_snapshots",
        ["owner_id", "account_id", "instrument_id"],
    )

    op.drop_index("ix_instruments_symbol", table_name="instruments")
    op.create_index("ix_instruments_symbol", "instruments", ["symbol"], unique=False)
    op.create_unique_constraint("uq_instrument_owner_symbol", "instruments", ["owner_id", "symbol"])


def downgrade() -> None:
    op.drop_constraint("uq_instrument_owner_symbol", "instruments", type_="unique")
    op.drop_index("ix_instruments_symbol", table_name="instruments")
    op.create_index("ix_instruments_symbol", "instruments", ["symbol"], unique=True)

    op.drop_constraint("uq_position_owner_account_instrument", "positions_snapshots", type_="unique")
    op.create_unique_constraint("uq_position_account_instrument", "positions_snapshots", ["account_id", "instrument_id"])

    op.drop_constraint("uq_instrument_owner_group_tag_selection", "instrument_tag_selections", type_="unique")
    op.create_unique_constraint(
        "uq_instrument_group_tag_selection",
        "instrument_tag_selections",
        ["instrument_id", "group_id"],
    )

    op.drop_constraint("uq_allocation_tag_owner_group_name", "allocation_tags", type_="unique")
    op.create_unique_constraint("uq_allocation_tag_group_name", "allocation_tags", ["group_id", "name"])

    op.drop_constraint("uq_allocation_tag_group_owner_name", "allocation_tag_groups", type_="unique")
    op.create_unique_constraint("uq_allocation_tag_groups_name", "allocation_tag_groups", ["name"])

    op.drop_constraint("uq_allocation_node_owner_parent_name", "allocation_nodes", type_="unique")
    op.create_unique_constraint("uq_allocation_node_parent_name", "allocation_nodes", ["parent_id", "name"])

    op.drop_constraint("uq_account_owner_name", "accounts", type_="unique")
    op.create_unique_constraint("accounts_name_key", "accounts", ["name"])

    op.drop_constraint("fk_audit_logs_actor_user_id", "audit_logs", type_="foreignkey")
    op.drop_constraint("fk_audit_logs_owner_id", "audit_logs", type_="foreignkey")
    op.drop_index("ix_audit_logs_actor_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_owner_id", table_name="audit_logs")
    op.drop_column("audit_logs", "actor_user_id")
    op.drop_column("audit_logs", "owner_id")

    op.drop_constraint("fk_manual_price_overrides_owner_id", "manual_price_overrides", type_="foreignkey")
    op.drop_constraint("fk_quotes_owner_id", "quotes", type_="foreignkey")
    op.drop_constraint("fk_positions_snapshots_owner_id", "positions_snapshots", type_="foreignkey")
    op.drop_constraint("fk_transactions_owner_id", "transactions", type_="foreignkey")
    op.drop_constraint("fk_instrument_tag_selections_owner_id", "instrument_tag_selections", type_="foreignkey")
    op.drop_constraint("fk_instruments_owner_id", "instruments", type_="foreignkey")
    op.drop_constraint("fk_allocation_tags_owner_id", "allocation_tags", type_="foreignkey")
    op.drop_constraint("fk_allocation_tag_groups_owner_id", "allocation_tag_groups", type_="foreignkey")
    op.drop_constraint("fk_allocation_nodes_owner_id", "allocation_nodes", type_="foreignkey")
    op.drop_constraint("fk_accounts_owner_id", "accounts", type_="foreignkey")

    for table_name in (
        "manual_price_overrides",
        "quotes",
        "positions_snapshots",
        "transactions",
        "instrument_tag_selections",
        "instruments",
        "allocation_tags",
        "allocation_tag_groups",
        "allocation_nodes",
        "accounts",
    ):
        _drop_owner_column(table_name)

    op.drop_index("ix_invite_codes_created_by_id", table_name="invite_codes")
    op.drop_index("ix_invite_codes_code", table_name="invite_codes")
    op.drop_index("ix_invite_codes_id", table_name="invite_codes")
    op.drop_table("invite_codes")

    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    sa.Enum(name="user_role").drop(op.get_bind(), checkfirst=True)
