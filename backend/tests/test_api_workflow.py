import pytest

from app.auth import CurrentUser
from app.demo import DEMO_SUBJECTS

pytestmark = pytest.mark.anyio


async def test_dataset_approval_and_dcat_export(api_harness):
    client = api_harness.client
    api_harness.login("admin", "user", "admin", "approver")
    project = await client.post(
        "/api/v1/projects",
        json={"name": "Aster", "visibility": "project", "approval_required": True},
    )
    project_id = project.json()["id"]
    for username, role in (("alice", "member"), ("bob", "approver")):
        await client.put(
            f"/api/v1/projects/{project_id}/members/{DEMO_SUBJECTS[username]}",
            json={"subject": DEMO_SUBJECTS[username], "role": role},
        )
    api_harness.login("alice", "user")
    created = await client.post(
        "/api/v1/datasets",
        data={
            "title": "Messreihe",
            "description": "Freigabepflichtig",
            "dataset_type": "Datensatz",
            "version_label": "1.0",
            "project_id": project_id,
        },
        files=[
            ("files", ("data.csv", b"a,b", "text/plain")),
            ("files", ("schema.json", b"{}", "application/json")),
        ],
    )
    assert created.status_code == 201
    dataset_id = created.json()["id"]
    assert (
        await client.post(f"/api/v1/datasets/{dataset_id}/versions/1/submit")
    ).status_code == 200
    api_harness.login("bob", "user", "approver")
    assert (
        await client.post(
            f"/api/v1/datasets/{dataset_id}/versions/1/approve", json={"comment": "ok"}
        )
    ).status_code == 200
    exported = await client.get(f"/api/v1/datasets/{dataset_id}/versions/1/dcat.jsonld")
    assert exported.headers["content-type"].startswith("application/ld+json")
    assert len(exported.json()["dcat:distribution"]) == 2
    detail = await client.get(f"/api/v1/datasets/{dataset_id}/versions/1")
    assert detail.status_code == 200
    assert detail.json()["id"] == dataset_id
    assert detail.json()["version"]["number"] == 1

    api_harness.active_user["value"] = CurrentUser("outside-user", "outside", frozenset({"user"}))
    assert (
        await client.get(f"/api/v1/datasets/{dataset_id}/versions/1/dcat.jsonld")
    ).status_code == 404
    assert (await client.get(f"/api/v1/datasets/{dataset_id}/versions/1")).status_code == 404
