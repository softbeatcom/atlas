import { expect, test, type Page } from "@playwright/test";
import { draftSecondVersion, publishedDataset } from "../fixtures/datasets";

async function mockDatasetApi(page: Page) {
  let uploaded = false;
  let multipart = "";
  await page.route("http://localhost:8000/api/v1/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/v1/me") return route.fulfill({ json: { subject: "subject-alice", username: "alice", roles: ["user"] } });
    if (request.method() === "GET" && ["/api/v1/projects", "/api/v1/notifications"].includes(path)) return route.fulfill({ json: [] });
    if (request.method() === "GET" && path === "/api/v1/datasets") return route.fulfill({ json: [uploaded ? draftSecondVersion : publishedDataset] });
    if (request.method() === "GET" && path === "/api/v1/datasets/ds_upload/versions/1") return route.fulfill({ json: publishedDataset });
    if (request.method() === "GET" && path === "/api/v1/datasets/ds_upload/versions") return route.fulfill({ json: uploaded ? [draftSecondVersion, publishedDataset] : [publishedDataset] });
    if (request.method() === "POST" && path === "/api/v1/datasets/ds_upload/versions") { multipart = request.postData() ?? ""; uploaded = true; return route.fulfill({ status: 201, json: draftSecondVersion }); }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Unmocked request" }) });
  });
  return () => multipart;
}

test("uploads a complete multi-file dataset version", async ({ page }) => {
  const uploadedBody = await mockDatasetApi(page);
  await page.goto("/datasets/ds_upload/versions/1");
  await expect(page.getByRole("heading", { name: "Messdaten" })).toBeVisible();
  await page.getByRole("button", { name: "Überarbeitete Version anlegen" }).click();
  await page.locator('input[name="files"]').setInputFiles([{ name: "data.csv", mimeType: "text/plain", buffer: Buffer.from("new") }, { name: "schema.json", mimeType: "application/json", buffer: Buffer.from("{}") }]);
  await page.locator('input[name="version_label"]').fill("1.1");
  await page.getByRole("button", { name: "Neue Version als Entwurf anlegen" }).click();
  await expect(page).toHaveURL(/\/datasets\/ds_upload\/versions\/2$/);
  expect(uploadedBody()).toContain('filename="data.csv"');
  expect(uploadedBody()).toContain('filename="schema.json"');
});
