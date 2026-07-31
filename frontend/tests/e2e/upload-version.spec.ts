import { expect, test, type Page } from "@playwright/test";
import { draftSecondVersion, publishedDataset } from "../fixtures/datasets";

async function mockDatasetApi(page: Page) {
  let uploaded = false;
  let multipart = "";
  const datasetRequests: URL[] = [];
  await page.route("http://localhost:8000/api/v1/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/v1/me") return route.fulfill({ json: { subject: "subject-alice", username: "alice", roles: ["user"] } });
    if (request.method() === "GET" && ["/api/v1/projects", "/api/v1/notifications"].includes(path)) return route.fulfill({ json: [] });
    if (request.method() === "GET" && path === "/api/v1/datasets/search-facets") return route.fulfill({ json: { projects: [], keywords: ["Messung"], suffixes: ["csv", "json"] } });
    if (request.method() === "GET" && path === "/api/v1/datasets") {
      datasetRequests.push(new URL(request.url()));
      return route.fulfill({ json: [uploaded ? draftSecondVersion : publishedDataset] });
    }
    if (request.method() === "GET" && path === "/api/v1/datasets/ds_upload/versions/1") return route.fulfill({ json: publishedDataset });
    if (request.method() === "GET" && path === "/api/v1/datasets/ds_upload/versions") return route.fulfill({ json: uploaded ? [draftSecondVersion, publishedDataset] : [publishedDataset] });
    if (request.method() === "POST" && path === "/api/v1/datasets/ds_upload/versions") { multipart = request.postData() ?? ""; uploaded = true; return route.fulfill({ status: 201, json: draftSecondVersion }); }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Unmocked request" }) });
  });
  return { uploadedBody: () => multipart, datasetRequests: () => datasetRequests };
}

test("uploads a complete multi-file dataset version", async ({ page }) => {
  const api = await mockDatasetApi(page);
  await page.goto("/datasets/ds_upload/versions/1");
  await expect(page.getByRole("heading", { name: "Messdaten" })).toBeVisible();
  await page.screenshot({ path: "/tmp/atlas-detail.png", fullPage: true });
  await page.getByRole("button", { name: "Überarbeitete Version anlegen" }).click();
  await page.locator('input[name="files"]').setInputFiles([{ name: "data.csv", mimeType: "text/plain", buffer: Buffer.from("new") }, { name: "schema.json", mimeType: "application/json", buffer: Buffer.from("{}") }]);
  await page.locator('input[name="version_label"]').fill("1.1");
  await page.getByRole("button", { name: "Neue Version als Entwurf anlegen" }).click();
  await expect(page).toHaveURL(/\/datasets\/ds_upload\/versions\/2$/);
  expect(api.uploadedBody()).toContain('filename="data.csv"');
  expect(api.uploadedBody()).toContain('filename="schema.json"');
});

test("opens the create-resource form through a stable route", async ({ page }) => {
  await mockDatasetApi(page);
  await page.goto("/datasets");
  await page.getByRole("button", { name: "Ressource anlegen" }).click();
  await expect(page).toHaveURL(/\/datasets\/new$/);
  await expect(
    page.getByRole("heading", { name: "Ressource anlegen" }),
  ).toBeVisible();
  await expect(page.getByText("1. Dateien")).toBeVisible();
});

test("filters datasets with a searchable suffix facet", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const api = await mockDatasetApi(page);
  await page.goto("/datasets");
  await page.getByRole("button", { name: "Dateiendungen: Alle" }).click();
  await page.getByRole("checkbox", { name: ".csv" }).check();
  await expect.poll(() => api.datasetRequests().some(
    (request) => request.searchParams.getAll("suffix").includes("csv"),
  )).toBe(true);
  await expect(page.getByRole("button", { name: "Dateiendungen: 1 ausgewählt" })).toBeVisible();
  await page.screenshot({ path: "/tmp/atlas-search-facets.png" });
  expect(browserErrors).toEqual([]);
});

test("keeps the resource catalog usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDatasetApi(page);
  await page.goto("/datasets");

  await expect(page.getByRole("heading", { name: "Ressourcen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Navigation öffnen" })).toBeVisible();
  await expect(page.getByText("Messdaten", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".sidebar").evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({ path: "/tmp/atlas-mobile.png", fullPage: true });
});
