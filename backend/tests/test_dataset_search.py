import pytest


async def create_dataset(client, *, title, keywords, filename, project_id=None):
    data = {
        "title": title,
        "description": "Suchbarer Testdatensatz",
        "dataset_type": "Datensatz",
        "version_label": "1.0",
        "keywords": ", ".join(keywords),
    }
    if project_id:
        data["project_id"] = project_id
    response = await client.post(
        "/api/v1/datasets",
        data=data,
        files=[("files", (filename, b"test", "application/octet-stream"))],
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.anyio
async def test_dataset_search_filters_metadata_and_file_suffix(api_harness):
    client = api_harness.client
    api_harness.login("alice", "admin")
    project = await client.post(
        "/api/v1/projects",
        json={"name": "Klima", "visibility": "project", "approval_required": False},
    )
    project_id = project.json()["id"]
    matching = await create_dataset(
        client,
        title="Klimamessung 2026",
        keywords=["Klima", "Messung"],
        filename="readings.CSV",
        project_id=project_id,
    )
    report = await create_dataset(
        client,
        title="Klimabericht",
        keywords=["Klima"],
        filename="report.pdf",
        project_id=project_id,
    )
    private = await create_dataset(
        client,
        title="Messung privat",
        keywords=["Messung"],
        filename="private.csv",
    )

    response = await client.get(
        "/api/v1/datasets",
        params=[
            ("title", "messung"),
            ("tag", "klima"),
            ("tag", "other"),
            ("suffix", ".csv"),
            ("project_id", project_id),
        ],
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [matching["id"]]

    facets = await client.get("/api/v1/datasets/search-facets")
    assert facets.status_code == 200
    assert facets.json()["keywords"] == ["Klima", "Messung"]
    assert facets.json()["suffixes"] == ["csv", "pdf"]
    assert [item["name"] for item in facets.json()["projects"]] == ["Klima"]

    response = await client.get(
        "/api/v1/datasets",
        params=[("project_id", project_id), ("project_id", "private")],
    )
    assert {item["id"] for item in response.json()} == {
        matching["id"], report["id"], private["id"]
    }


@pytest.mark.anyio
async def test_dataset_search_filters_private_datasets(api_harness):
    client = api_harness.client
    api_harness.login("alice", "admin")
    private = await create_dataset(
        client,
        title="Privat",
        keywords=["intern"],
        filename="notes.txt",
    )
    project = await client.post(
        "/api/v1/projects",
        json={"name": "Ablage", "visibility": "project", "approval_required": False},
    )
    await create_dataset(
        client,
        title="Projekt",
        keywords=["intern"],
        filename="notes.txt",
        project_id=project.json()["id"],
    )

    response = await client.get("/api/v1/datasets", params={"project_id": "private"})

    assert [item["id"] for item in response.json()] == [private["id"]]
