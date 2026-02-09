"""remove asset categories and bind instruments directly to allocation leaf nodes

Revision ID: 20260209_0003
Revises: 20260208_0002
Create Date: 2026-02-09 02:30:00
"""

import sqlalchemy as sa
from alembic import op


revision = "20260209_0003"
down_revision = "20260208_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("instruments", sa.Column("allocation_node_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_instruments_allocation_node_id",
        "instruments",
        "allocation_nodes",
        ["allocation_node_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_instruments_allocation_node_id", "instruments", ["allocation_node_id"], unique=False)

    op.execute(
        """
        UPDATE instruments AS i
        SET allocation_node_id = c.node_id
        FROM asset_categories AS c
        WHERE i.category_id = c.id
        """
    )

    op.execute("ALTER TABLE instruments DROP CONSTRAINT IF EXISTS instruments_category_id_fkey")
    op.drop_column("instruments", "category_id")
    op.drop_table("asset_categories")


def downgrade() -> None:
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

    op.add_column("instruments", sa.Column("category_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_instruments_category_id",
        "instruments",
        "asset_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        INSERT INTO asset_categories (node_id, name, target_weight, created_at, updated_at)
        SELECT DISTINCT
            i.allocation_node_id,
            'Auto',
            100,
            timezone('utc', now()),
            timezone('utc', now())
        FROM instruments AS i
        WHERE i.allocation_node_id IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE instruments AS i
        SET category_id = c.id
        FROM asset_categories AS c
        WHERE i.allocation_node_id = c.node_id
          AND c.name = 'Auto'
        """
    )

    op.drop_constraint("fk_instruments_allocation_node_id", "instruments", type_="foreignkey")
    op.drop_index("ix_instruments_allocation_node_id", table_name="instruments")
    op.drop_column("instruments", "allocation_node_id")
