from collections.abc import AsyncIterator

import httpx2
import pytest
from anyio import to_thread
from fastapi import routing
from fastapi.dependencies import utils as dependency_utils
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.auth import CurrentUser, get_current_user
from app.database import Base, get_session
from app.demo import DEMO_SUBJECTS
from app.storage import storage


@pytest.mark.anyio
async def test_complete_approval_workflow_uses_canonical_subjects(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    active_user = {
        "value": CurrentUser(
            DEMO_SUBJECTS["admin"],
            "admin",
            frozenset({"user", "admin", "approver"}),
        )
    }

    async def session_dependency() -> AsyncIterator[Session]:
        with sessions() as session:
            yield session

    async def user_dependency() -> CurrentUser:
        return active_user["value"]

    async def run_direct(function, *args, **kwargs):
        kwargs.pop("abandon_on_cancel", None)
        kwargs.pop("cancellable", None)
        kwargs.pop("limiter", None)
        return function(*args, **kwargs)

    monkeypatch.setattr(main, "initialise", lambda: None)
    monkeypatch.setattr(storage, "root", tmp_path)
    monkeypatch.setattr(routing, "run_in_threadpool", run_direct)
    monkeypatch.setattr(dependency_utils, "run_in_threadpool", run_direct)
    monkeypatch.setattr(to_thread, "run_sync", run_direct)
    main.app.dependency_overrides[get_session] = session_dependency
    main.app.dependency_overrides[get_current_user] = user_dependency

    client = httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=main.app),
        base_url="http://test",
    )
    try:
        project_response = await client.post(
            "/api/v1/projects",
            json={
                "name": "Aster",
                "visibility": "project",
                "approval_required": True,
            },
        )
        assert project_response.status_code == 201
        project_id = project_response.json()["id"]

        for username, role in (("alice", "member"), ("bob", "approver")):
            subject = DEMO_SUBJECTS[username]
            response = await client.put(
                f"/api/v1/projects/{project_id}/members/{subject}",
                json={"subject": subject, "role": role},
            )
            assert response.status_code == 200

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["alice"],
            "alice",
            frozenset({"user"}),
        )
        create_response = await client.post(
            "/api/v1/resources",
            data={
                "title": "Prüfbericht",
                "description": "Freigabepflichtiger Bericht",
                "resource_type": "Bericht",
                "keywords": "Prüfung, Qualität",
                "version_label": "1.0",
                "project_id": project_id,
            },
            files={"file": ("bericht.txt", b"review me", "text/html")},
        )
        assert create_response.status_code == 201
        created = create_response.json()
        resource_id = created["id"]
        assert created["owner"] == DEMO_SUBJECTS["alice"]
        assert created["version"]["media_type"] == "text/plain"

        submit_response = await client.post(
            f"/api/v1/resources/{resource_id}/versions/1/submit"
        )
        assert submit_response.status_code == 200
        assert submit_response.json()["version"]["status"] == "pending"

        own_approval = await client.post(
            f"/api/v1/resources/{resource_id}/versions/1/approve",
            json={"comment": ""},
        )
        assert own_approval.status_code == 403

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["bob"],
            "bob",
            frozenset({"user", "approver"}),
        )
        approvals = await client.get("/api/v1/approvals")
        assert approvals.status_code == 200
        assert [item["id"] for item in approvals.json()] == [resource_id]

        pending_content = await client.get(
            f"/api/v1/resources/{resource_id}/versions/1/content?inline=true"
        )
        assert pending_content.status_code == 200
        assert pending_content.content == b"review me"
        assert pending_content.headers["content-type"].startswith("text/plain")

        rejection = await client.post(
            f"/api/v1/resources/{resource_id}/versions/1/reject",
            json={"comment": "Bitte Quellen ergänzen"},
        )
        assert rejection.status_code == 200
        assert rejection.json()["version"]["status"] == "rejected"

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["alice"],
            "alice",
            frozenset({"user"}),
        )
        notifications = await client.get("/api/v1/notifications")
        assert notifications.status_code == 200
        assert "Bitte Quellen ergänzen" in notifications.json()[0]["message"]

        new_version = await client.post(
            f"/api/v1/resources/{resource_id}/versions",
            data={
                "title": "Prüfbericht",
                "description": "Bericht mit Quellen",
                "resource_type": "Bericht",
                "keywords": "Prüfung, Qualität",
                "version_label": "1.1",
            },
            files={"file": ("bericht.txt", b"review me again", "text/plain")},
        )
        assert new_version.status_code == 201
        assert new_version.json()["version"]["number"] == 2

        resubmit = await client.post(
            f"/api/v1/resources/{resource_id}/versions/2/submit"
        )
        assert resubmit.status_code == 200

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["bob"],
            "bob",
            frozenset({"user", "approver"}),
        )
        approval = await client.post(
            f"/api/v1/resources/{resource_id}/versions/2/approve",
            json={"comment": "Quellen geprüft"},
        )
        assert approval.status_code == 200
        assert approval.json()["version"]["status"] == "published"
        assert approval.json()["current_published_number"] == 2

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["alice"],
            "alice",
            frozenset({"user"}),
        )
        old_version = await client.get(
            f"/api/v1/resources/{resource_id}/versions/1"
        )
        assert old_version.status_code == 200
        assert old_version.json()["version"]["status"] == "rejected"
        assert old_version.json()["newer_version"] == 2

        active_user["value"] = CurrentUser(
            DEMO_SUBJECTS["auditor"],
            "auditor",
            frozenset({"user", "auditor"}),
        )
        metadata = await client.get(f"/api/v1/resources/{resource_id}/versions/2")
        assert metadata.status_code == 200
        denied_content = await client.get(
            f"/api/v1/resources/{resource_id}/versions/2/content"
        )
        assert denied_content.status_code == 404
    finally:
        await client.aclose()
        main.app.dependency_overrides.clear()
