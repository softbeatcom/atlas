"""Normalize keywords and file extensions for dataset search facets.

Revision ID: 0004
Revises: 0003
"""

import json
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _suffix(filename: str) -> str | None:
    if "." not in filename or filename.endswith("."):
        return None
    value = filename.rsplit(".", 1)[-1].strip().lower()
    return value or None


def upgrade() -> None:
    op.create_table(
        "keywords",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("normalized", sa.String(80), nullable=False, unique=True),
        sa.Column("label", sa.String(80), nullable=False),
    )
    op.create_index("ix_keywords_normalized", "keywords", ["normalized"])
    op.create_table(
        "dataset_version_keywords",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "keyword_id",
            sa.String(36),
            sa.ForeignKey("keywords.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_dataset_version_keywords_keyword_id", "dataset_version_keywords", ["keyword_id"])
    op.create_table(
        "file_extensions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("value", sa.String(80), nullable=False, unique=True),
    )
    op.create_index("ix_file_extensions_value", "file_extensions", ["value"])
    with op.batch_alter_table("distributions") as batch:
        batch.add_column(sa.Column("file_extension_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_distributions_file_extension_id", "file_extensions", ["file_extension_id"], ["id"]
        )
        batch.create_index("ix_distributions_file_extension_id", ["file_extension_id"])

    bind = op.get_bind()
    keyword_ids: dict[str, str] = {}
    for version_id, raw_keywords in bind.execute(sa.text("SELECT id, keywords FROM dataset_versions")):
        values = json.loads(raw_keywords) if isinstance(raw_keywords, str) else raw_keywords
        seen: set[str] = set()
        for raw_label in values or []:
            label = str(raw_label).strip()
            normalized = label.lower()
            if not label or normalized in seen:
                continue
            seen.add(normalized)
            keyword_id = keyword_ids.get(normalized)
            if keyword_id is None:
                keyword_id = str(uuid4())
                keyword_ids[normalized] = keyword_id
                bind.execute(
                    sa.text("INSERT INTO keywords (id, normalized, label) VALUES (:id, :normalized, :label)"),
                    {"id": keyword_id, "normalized": normalized, "label": label},
                )
            bind.execute(
                sa.text(
                    "INSERT INTO dataset_version_keywords (version_id, keyword_id) "
                    "VALUES (:version_id, :keyword_id)"
                ),
                {"version_id": version_id, "keyword_id": keyword_id},
            )

    extension_ids: dict[str, str] = {}
    for distribution_id, filename in bind.execute(
        sa.text("SELECT id, original_filename FROM distributions")
    ):
        suffix = _suffix(filename)
        if suffix is None:
            continue
        extension_id = extension_ids.get(suffix)
        if extension_id is None:
            extension_id = str(uuid4())
            extension_ids[suffix] = extension_id
            bind.execute(
                sa.text("INSERT INTO file_extensions (id, value) VALUES (:id, :value)"),
                {"id": extension_id, "value": suffix},
            )
        bind.execute(
            sa.text("UPDATE distributions SET file_extension_id = :extension_id WHERE id = :id"),
            {"extension_id": extension_id, "id": distribution_id},
        )

    with op.batch_alter_table("dataset_versions") as batch:
        batch.drop_column("keywords")


def downgrade() -> None:
    raise RuntimeError("Die Suchfacetten werden nur vorwärts migriert.")
