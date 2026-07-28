import pytest
from fastapi import HTTPException, status

from app.storage import storage

pytestmark = pytest.mark.anyio


async def create_dataset(client):
    response = await client.post(
        "/api/v1/datasets",
        data={
            "title": "Messdaten",
            "description": "Erste Fassung",
            "dataset_type": "Datensatz",
            "version_label": "1.0",
        },
        files=[
            ("files", ("data.csv", b"a,b", "text/plain")),
            ("files", ("readme.txt", b"notes", "text/plain")),
        ],
    )
    assert response.status_code == 201
    dataset_id = response.json()["id"]
    assert response.json()["version"]["distribution_count"] == 2
    assert (
        await client.post(f"/api/v1/datasets/{dataset_id}/versions/1/publish")
    ).status_code == 200
    return dataset_id


async def test_full_second_version_preserves_distribution_sets(api_harness):
    client = api_harness.client
    dataset_id = await create_dataset(client)
    response = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        data={
            "title": "Messdaten",
            "description": "Zweite Fassung",
            "dataset_type": "Datensatz",
            "version_label": "1.1",
        },
        files=[
            ("files", ("data.csv", b"new", "text/plain")),
            ("files", ("schema.json", b"{}", "application/json")),
        ],
    )
    assert response.status_code == 201
    assert [item["filename"] for item in response.json()["version"]["distributions"]] == [
        "data.csv",
        "schema.json",
    ]
    old = await client.get(f"/api/v1/datasets/{dataset_id}/versions/1")
    assert [item["filename"] for item in old.json()["version"]["distributions"]] == [
        "data.csv",
        "readme.txt",
    ]


async def test_storage_failure_rolls_back_all_uploaded_distributions(api_harness, monkeypatch):
    client = api_harness.client
    dataset_id = await create_dataset(client)

    async def deny_store(*_args, **_kwargs):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Storage ist nicht schreibbar")

    monkeypatch.setattr(storage, "store", deny_store)
    response = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        data={
            "title": "Messdaten",
            "description": "Zweite Fassung",
            "dataset_type": "Datensatz",
            "version_label": "1.1",
        },
        files=[("files", ("data.csv", b"new", "text/plain"))],
    )
    assert response.status_code == 503
    assert [
        item["version"]["number"]
        for item in (await client.get(f"/api/v1/datasets/{dataset_id}/versions")).json()
    ] == [1]
