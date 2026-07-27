import pytest
from fastapi import HTTPException, status

from app.storage import storage

pytestmark = pytest.mark.anyio


async def create_published_resource(client) -> str:
    response = await client.post(
        "/api/v1/resources",
        data={
            "title": "Prüfbericht",
            "description": "Erste freigegebene Fassung",
            "resource_type": "Bericht",
            "keywords": "Prüfung",
            "version_label": "1.0",
        },
        files={"file": ("bericht-v1.txt", b"version one", "text/plain")},
    )
    assert response.status_code == 201
    resource_id = response.json()["id"]

    publish = await client.post(f"/api/v1/resources/{resource_id}/versions/1/publish")
    assert publish.status_code == 200
    return resource_id


async def upload_second_version(client, resource_id: str):
    return await client.post(
        f"/api/v1/resources/{resource_id}/versions",
        data={
            "title": "Prüfbericht",
            "description": "Überarbeitete Fassung",
            "resource_type": "Bericht",
            "keywords": "Prüfung, Quellen",
            "version_label": "1.1",
        },
        files={"file": ("bericht-v2.txt", b"version two", "text/plain")},
    )


async def test_second_version_upload_preserves_both_files(api_harness):
    client = api_harness.client
    resource_id = await create_published_resource(client)

    response = await upload_second_version(client, resource_id)

    assert response.status_code == 201
    assert response.json()["version"]["number"] == 2
    assert response.json()["version"]["filename"] == "bericht-v2.txt"

    first = await client.get(f"/api/v1/resources/{resource_id}/versions/1/content")
    second = await client.get(f"/api/v1/resources/{resource_id}/versions/2/content")
    assert first.status_code == 200
    assert first.content == b"version one"
    assert second.status_code == 200
    assert second.content == b"version two"


async def test_second_version_storage_failure_returns_503_and_rolls_back(
    api_harness,
    monkeypatch,
):
    client = api_harness.client
    resource_id = await create_published_resource(client)
    removed_keys: list[str] = []

    async def deny_store(*_args, **_kwargs):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Storage ist nicht schreibbar",
        )

    monkeypatch.setattr(storage, "store", deny_store)
    monkeypatch.setattr(storage, "remove", removed_keys.append)

    response = await upload_second_version(client, resource_id)

    assert response.status_code == 503
    assert response.json() == {"detail": "Storage ist nicht schreibbar"}
    assert len(removed_keys) == 1

    versions = await client.get(f"/api/v1/resources/{resource_id}/versions")
    assert versions.status_code == 200
    assert [item["version"]["number"] for item in versions.json()] == [1]
