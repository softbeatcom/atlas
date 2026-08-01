"""Use timezone-aware UTC timestamps.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TIMESTAMP_COLUMNS = {
    "projects": ("created_at",),
    "resources": ("created_at",),
    "resource_versions": (
        "created_at",
        "modified_at",
        "published_at",
    ),
    "approval_requests": ("submitted_at", "decided_at"),
    "notifications": ("created_at",),
    "audit_events": ("created_at",),
}


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, columns in TIMESTAMP_COLUMNS.items():
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(timezone=True),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
            )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, columns in TIMESTAMP_COLUMNS.items():
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(timezone=False),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
            )
