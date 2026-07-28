"""Replace single-file resources with versioned multi-file datasets.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import context, op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not context.is_offline_mode():
        bind = op.get_bind()
        legacy_rows = bind.execute(
            sa.text("SELECT count(*) FROM resource_versions")
        ).scalar_one()
        if legacy_rows:
            raise RuntimeError(
                "Die Umstellung auf Datensätze benötigt einen Entwicklungsreset; "
                "bestehende Ressourcen werden nicht automatisch gelöscht."
            )

    op.rename_table("resources", "datasets")
    op.rename_table("resource_versions", "dataset_versions")
    op.alter_column("dataset_versions", "resource_id", new_column_name="dataset_id")
    op.alter_column("dataset_versions", "resource_type", new_column_name="dataset_type")
    for column in ("original_filename", "storage_key", "content_size", "media_type", "sha256"):
        op.drop_column("dataset_versions", column)
    op.alter_column("notifications", "resource_id", new_column_name="dataset_id")
    op.alter_column("audit_events", "resource_id", new_column_name="dataset_id")
    op.create_table(
        "distributions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("storage_key", sa.String(600), nullable=False, unique=True),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("media_type", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("version_id", "position", name="uq_distribution_position"),
    )
    op.create_index("ix_distributions_version_id", "distributions", ["version_id"])


def downgrade() -> None:
    raise RuntimeError(
        "Die Datensatz-Umstellung wird nur über einen Entwicklungsreset zurückgesetzt."
    )
