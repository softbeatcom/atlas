import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/api";

vi.mock("../../src/auth", () => ({
  token: vi.fn().mockResolvedValue("test-token"),
}));

describe("version upload API", () => {
  beforeEach(() => {
    window.__ATLAS_CONFIG__ = {
      VITE_API_URL: "http://localhost:8000/api/v1",
    };
  });

  it("posts multipart data to the selected resource's versions endpoint", async () => {
    const responseBody = { id: "res_upload", version: { number: 2 } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("version_label", "1.1");

    await expect(api.createVersion("res_upload", form)).resolves.toEqual(
      responseBody,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8000/api/v1/resources/res_upload/versions",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("keeps the backend's actionable storage error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "Storage ist nicht schreibbar" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      api.createVersion("res_upload", new FormData()),
    ).rejects.toEqual(
      new ApiError("Storage ist nicht schreibbar", 503),
    );
  });
});
