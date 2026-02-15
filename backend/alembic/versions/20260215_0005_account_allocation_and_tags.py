"""add account allocation node binding and account tag selections

Revision ID: 20260215_0005
Revises: 20260211_0004
Create Date: 2026-02-15 22:40:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260215_0005"
down_revision = "20260211_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("allocation_node_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_allocation_node_id",
        "accounts",
        "allocation_nodes",
        ["allocation_node_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_accounts_allocation_node_id", "accounts", ["allocation_node_id"], unique=False)

    op.create_table(
        "account_tag_selections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("allocation_tag_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("allocation_tags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "account_id", "group_id", name="uq_account_owner_group_tag_selection"),
    )
    op.create_index("ix_account_tag_selections_id", "account_tag_selections", ["id"], unique=False)
    op.create_index("ix_account_tag_selections_owner_id", "account_tag_selections", ["owner_id"], unique=False)
    op.create_index("ix_account_tag_selections_account_id", "account_tag_selections", ["account_id"], unique=False)
    op.create_index("ix_account_tag_selections_group_id", "account_tag_selections", ["group_id"], unique=False)
    op.create_index("ix_account_tag_selections_tag_id", "account_tag_selections", ["tag_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_account_tag_selections_tag_id", table_name="account_tag_selections")
    op.drop_index("ix_account_tag_selections_group_id", table_name="account_tag_selections")
    op.drop_index("ix_account_tag_selections_account_id", table_name="account_tag_selections")
    op.drop_index("ix_account_tag_selections_owner_id", table_name="account_tag_selections")
    op.drop_index("ix_account_tag_selections_id", table_name="account_tag_selections")
    op.drop_table("account_tag_selections")

    op.drop_index("ix_accounts_allocation_node_id", table_name="accounts")
    op.drop_constraint("fk_accounts_allocation_node_id", "accounts", type_="foreignkey")
    op.drop_column("accounts", "allocation_node_id")
