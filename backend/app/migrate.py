from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from .database import engine

LEGACY_TABLES = {
    "approval_requests",
    "audit_events",
    "notifications",
    "project_memberships",
    "projects",
    "resource_versions",
    "resources",
}


def migrate() -> None:
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        is_postgres = connection.dialect.name == "postgresql"
        if is_postgres:
            connection.execute(text("SELECT pg_advisory_lock(hashtext('atlas_migrations'))"))
        try:
            config.attributes["connection"] = connection
            tables = set(inspect(connection).get_table_names())
            has_version = (
                "alembic_version" in tables
                and connection.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                ).scalar()
                is not None
            )
            if "projects" in tables and not has_version:
                missing_tables = LEGACY_TABLES - tables
                if missing_tables:
                    raise RuntimeError(
                        "Unvollständiges Legacy-Schema; fehlende Tabellen: "
                        + ", ".join(sorted(missing_tables))
                    )
                command.stamp(config, "0001")
            command.upgrade(config, "head")
        finally:
            if is_postgres:
                connection.execute(
                    text("SELECT pg_advisory_unlock(hashtext('atlas_migrations'))")
                )


if __name__ == "__main__":
    migrate()
