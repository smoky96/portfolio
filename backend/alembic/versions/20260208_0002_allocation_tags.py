"""add allocation tag groups and instrument tag selections

Revision ID: 20260208_0002
Revises: 20260207_0001
Create Date: 2026-02-08 23:50:00
"""

import sqlalchemy as sa
from alembic import op


revision = "20260208_0002"
down_revision = "20260207_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "allocation_tag_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_allocation_tag_groups_name"),
    )
    op.create_index("ix_allocation_tag_groups_id", "allocation_tag_groups", ["id"], unique=False)

    op.create_table(
        "allocation_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("allocation_tag_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("group_id", "name", name="uq_allocation_tag_group_name"),
    )
    op.create_index("ix_allocation_tags_id", "allocation_tags", ["id"], unique=False)
    op.create_index("ix_allocation_tags_group_id", "allocation_tags", ["group_id"], unique=False)

    op.create_table(
        "instrument_tag_selections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("allocation_tag_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("allocation_tags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("instrument_id", "group_id", name="uq_instrument_group_tag_selection"),
    )
    op.create_index("ix_instrument_tag_selections_id", "instrument_tag_selections", ["id"], unique=False)
    op.create_index("ix_instrument_tag_selections_instrument_id", "instrument_tag_selections", ["instrument_id"], unique=False)
    op.create_index("ix_instrument_tag_selections_group_id", "instrument_tag_selections", ["group_id"], unique=False)
    op.create_index("ix_instrument_tag_selections_tag_id", "instrument_tag_selections", ["tag_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_instrument_tag_selections_tag_id", table_name="instrument_tag_selections")
    op.drop_index("ix_instrument_tag_selections_group_id", table_name="instrument_tag_selections")
    op.drop_index("ix_instrument_tag_selections_instrument_id", table_name="instrument_tag_selections")
    op.drop_index("ix_instrument_tag_selections_id", table_name="instrument_tag_selections")
    op.drop_table("instrument_tag_selections")

    op.drop_index("ix_allocation_tags_group_id", table_name="allocation_tags")
    op.drop_index("ix_allocation_tags_id", table_name="allocation_tags")
    op.drop_table("allocation_tags")

    op.drop_index("ix_allocation_tag_groups_id", table_name="allocation_tag_groups")
    op.drop_table("allocation_tag_groups")
