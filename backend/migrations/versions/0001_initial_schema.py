"""Initial Atlas schema.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    visibility = sa.Enum("PROJECT", "ORGANIZATION", name="visibility")
    membership_role = sa.Enum("MEMBER", "APPROVER", name="membershiprole")
    version_status = sa.Enum(
        "DRAFT",
        "PENDING",
        "PUBLISHED",
        "REJECTED",
        name="versionstatus",
    )

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("visibility", visibility, nullable=False),
        sa.Column("approval_required", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_projects_name", "projects", ["name"])

    op.create_table(
        "project_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("role", membership_role, nullable=False),
        sa.UniqueConstraint("project_id", "subject", name="uq_membership"),
    )
    op.create_index(
        "ix_project_memberships_project_id",
        "project_memberships",
        ["project_id"],
    )
    op.create_index(
        "ix_project_memberships_subject",
        "project_memberships",
        ["subject"],
    )

    op.create_table(
        "resources",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id"),
            nullable=True,
        ),
        sa.Column("current_published_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_resources_owner_subject", "resources", ["owner_subject"])
    op.create_index("ix_resources_project_id", "resources", ["project_id"])

    op.create_table(
        "resource_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "resource_id",
            sa.String(40),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("status", version_status, nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=False),
        sa.Column("keywords", sa.JSON(), nullable=False),
        sa.Column("creator", sa.String(255), nullable=False),
        sa.Column("version_label", sa.String(100), nullable=False),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("storage_key", sa.String(600), nullable=False, unique=True),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("media_type", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("modified_at", sa.DateTime(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("resource_id", "number", name="uq_resource_version"),
    )
    op.create_index(
        "ix_resource_versions_resource_id",
        "resource_versions",
        ["resource_id"],
    )
    op.create_index("ix_resource_versions_title", "resource_versions", ["title"])
    op.create_index(
        "ix_resource_versions_resource_type",
        "resource_versions",
        ["resource_type"],
    )

    op.create_table(
        "approval_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("resource_versions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("submitter_subject", sa.String(255), nullable=False),
        sa.Column("decision_subject", sa.String(255), nullable=True),
        sa.Column("decision_comment", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recipient_subject", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("resource_id", sa.String(40), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_notifications_recipient_subject",
        "notifications",
        ["recipient_subject"],
    )
    op.create_index("ix_notifications_resource_id", "notifications", ["resource_id"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_subject", sa.String(255), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_id", sa.String(40), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_events_actor_subject", "audit_events", ["actor_subject"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_resource_id", "audit_events", ["resource_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("notifications")
    op.drop_table("approval_requests")
    op.drop_table("resource_versions")
    op.drop_table("resources")
    op.drop_table("project_memberships")
    op.drop_table("projects")
    sa.Enum(name="versionstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="membershiprole").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="visibility").drop(op.get_bind(), checkfirst=True)
