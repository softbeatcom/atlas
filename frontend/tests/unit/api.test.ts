import { describe, expect, it, vi } from "vitest";
import { api } from "../../src/api";

vi.mock("../../src/auth", () => ({ token: vi.fn().mockResolvedValue("test-token") }));

describe("dataset API", () => {
  it("posts repeated files to the dataset version endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds_upload" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData(); form.append("files", new File(["a"], "data.csv")); form.append("files", new File(["b"], "schema.json"));
    await api.createVersion("ds_upload", form);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/datasets/ds_upload/versions");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(form);
  });

  it("serializes advanced dataset search filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.datasets("climate", { title: "Messung", projectIds: ["private", "project-1"], tags: ["Klima", "Messung"], suffixes: ["csv", "json"] });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/datasets?query=climate&title=Messung&project_id=private&project_id=project-1&tag=Klima&tag=Messung&suffix=csv&suffix=json");
  });
});
