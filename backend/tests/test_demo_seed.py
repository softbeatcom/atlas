import hashlib
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

import app.seed_demo as seed_module
from app.database import Base
from app.demo import DEMO_SUBJECTS
from app.models import (
    ApprovalRequest,
    Dataset,
    DatasetVersion,
    Distribution,
    Notification,
    Project,
    VersionStatus,
)
from app.seed_demo import DemoSeedError, seed_demo

ANCHOR_DATE = datetime(2026, 8, 1, 12, tzinfo=UTC)


def sqlite_engine_with_foreign_keys():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def test_seed_demo_creates_complete_deterministic_corpus(tmp_path):
    engine = sqlite_engine_with_foreign_keys()
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        summary = seed_demo(session, tmp_path, ANCHOR_DATE)

        assert summary.datasets == 100
        assert summary.versions == 120
        assert summary.files == 180
        assert session.scalar(select(func.count()).select_from(Project)) == 6
        assert session.scalar(select(func.count()).select_from(Dataset)) == 100
        assert session.scalar(select(func.count()).select_from(DatasetVersion)) == 120
        assert session.scalar(select(func.count()).select_from(Distribution)) == 180
        assert session.scalar(
            select(func.count())
            .select_from(Dataset)
            .where(Dataset.current_published_number.is_not(None))
        ) == 90

        statuses = dict(
            session.execute(
                select(DatasetVersion.status, func.count()).group_by(DatasetVersion.status)
            ).all()
        )
        assert statuses == {
            VersionStatus.DRAFT: 8,
            VersionStatus.PENDING: 6,
            VersionStatus.PUBLISHED: 100,
            VersionStatus.REJECTED: 6,
        }

        projects = {
            name: count
            for name, count in session.execute(
                select(Project.name, func.count(Dataset.id))
                .join(Dataset, Dataset.project_id == Project.id)
                .group_by(Project.name)
            ).all()
        }
        assert projects == {
            "Aster": 20,
            "Platform": 20,
            "Finanzplanung": 15,
            "Nachhaltigkeit": 15,
            "Kundenservice": 15,
            "People & Culture": 10,
        }
        assert session.scalar(
            select(func.count()).select_from(Dataset).where(Dataset.project_id.is_(None))
        ) == 5

        pending_version_ids = set(
            session.scalars(
                select(DatasetVersion.id).where(DatasetVersion.status == VersionStatus.PENDING)
            )
        )
        open_request_ids = set(
            session.scalars(
                select(ApprovalRequest.version_id).where(ApprovalRequest.decided_at.is_(None))
            )
        )
        assert open_request_ids == pending_version_ids
        assert session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.kind == "approval_requested")
        ) >= 6
        assert session.scalar(
            select(func.count()).select_from(Notification).where(Notification.read.is_(True))
        ) > 0
        assert session.scalar(
            select(func.count()).select_from(Notification).where(Notification.read.is_(False))
        ) > 0

        for distribution in session.scalars(select(Distribution)):
            path = tmp_path / distribution.storage_key
            content = path.read_bytes()
            assert content
            assert len(content) == distribution.content_size
            assert hashlib.sha256(content).hexdigest() == distribution.sha256

        with pytest.raises(DemoSeedError, match="already contains datasets"):
            seed_demo(session, tmp_path, ANCHOR_DATE)

    engine.dispose()


def test_seed_demo_rolls_back_metadata_and_created_files_on_failure(tmp_path, monkeypatch):
    engine = sqlite_engine_with_foreign_keys()
    Base.metadata.create_all(engine)
    original_write = seed_module._write_file
    write_count = 0

    def fail_after_some_files(storage_root, storage_key, content):
        nonlocal write_count
        write_count += 1
        if write_count == 6:
            raise OSError("simulated storage failure")
        return original_write(storage_root, storage_key, content)

    monkeypatch.setattr(seed_module, "_write_file", fail_after_some_files)
    with Session(engine) as session:
        with pytest.raises(OSError, match="simulated storage failure"):
            seed_demo(session, tmp_path, ANCHOR_DATE)
        assert session.scalar(select(func.count()).select_from(Dataset)) == 0
        assert list(tmp_path.rglob("content")) == []

    engine.dispose()


@pytest.mark.anyio
async def test_seeded_corpus_exercises_search_and_permissions(api_harness):
    with api_harness.sessions() as session:
        seed_demo(session, api_harness.storage_root, ANCHOR_DATE)
        finance_id = session.scalar(
            select(Project.id).where(Project.name == "Finanzplanung")
        )

    api_harness.login("alice", "user")
    response = await api_harness.client.get("/api/v1/datasets", params={"query": "CO2"})
    assert response.status_code == 200
    assert len(response.json()) == 10
    assert all("CO2" in item["version"]["keywords"] for item in response.json())

    private = await api_harness.client.get(
        "/api/v1/datasets", params={"project_id": "private"}
    )
    assert [item["owner"] for item in private.json()] == [
        DEMO_SUBJECTS["alice"],
        DEMO_SUBJECTS["alice"],
        DEMO_SUBJECTS["alice"],
    ]
    hidden_finance = await api_harness.client.get(
        "/api/v1/datasets", params={"project_id": finance_id}
    )
    assert hidden_finance.json() == []

    facets = await api_harness.client.get("/api/v1/datasets/search-facets")
    assert "CO2" in facets.json()["keywords"]
    assert set(facets.json()["suffixes"]) == {"csv", "json", "md", "pdf", "png", "txt", "xml", "zip"}
    assert "Finanzplanung" not in {item["name"] for item in facets.json()["projects"]}

    api_harness.login("admin", "user", "admin", "approver")
    visible_finance = await api_harness.client.get(
        "/api/v1/datasets", params={"project_id": finance_id}
    )
    assert len(visible_finance.json()) == 15

    private = await api_harness.client.get(
        "/api/v1/datasets", params={"project_id": "private"}
    )
    assert len(private.json()) == 5
