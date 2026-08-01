from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

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


@dataclass
class ApiHarness:
    client: httpx2.AsyncClient
    active_user: dict[str, CurrentUser]
    sessions: sessionmaker[Session]
    storage_root: Path

    def login(self, username: str, *roles: str) -> None:
        self.active_user["value"] = CurrentUser(
            DEMO_SUBJECTS[username],
            username,
            frozenset(roles or ("user",)),
        )


@pytest.fixture
async def api_harness(monkeypatch, tmp_path) -> AsyncIterator[ApiHarness]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    active_user = {
        "value": CurrentUser(
            DEMO_SUBJECTS["alice"],
            "alice",
            frozenset({"user"}),
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

    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=main.app),
        base_url="http://test",
    ) as client:
        yield ApiHarness(client, active_user, sessions, tmp_path)

    main.app.dependency_overrides.clear()
    engine.dispose()
