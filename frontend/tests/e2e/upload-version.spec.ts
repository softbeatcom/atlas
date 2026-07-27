import { expect, test, type Page } from "@playwright/test";
import {
  draftSecondVersion,
  publishedResource,
} from "../fixtures/resources";

type ApiState = {
  browserErrors: string[];
  failUpload: boolean;
  multipartBody: string;
  unexpectedRequests: string[];
  uploaded: boolean;
};

async function mockAtlasApi(page: Page, failUpload = false): Promise<ApiState> {
  const state: ApiState = {
    browserErrors: [],
    failUpload,
    multipartBody: "",
    unexpectedRequests: [],
    uploaded: false,
  };
  page.on("console", (message) => {
    if (message.type() === "error") state.browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => state.browserErrors.push(error.message));

  await page.route("http://localhost:8000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/v1/me") {
      await route.fulfill({
        json: {
          subject: "subject-alice",
          username: "alice",
          roles: ["user"],
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/v1/projects") {
      await route.fulfill({ json: [] });
      return;
    }
    if (method === "GET" && path === "/api/v1/notifications") {
      await route.fulfill({ json: [] });
      return;
    }
    if (method === "GET" && path === "/api/v1/resources") {
      await route.fulfill({
        json: [state.uploaded ? draftSecondVersion : publishedResource],
      });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/v1/resources/res_upload/versions/1"
    ) {
      await route.fulfill({ json: publishedResource });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/v1/resources/res_upload/versions"
    ) {
      await route.fulfill({
        json: state.uploaded
          ? [draftSecondVersion, publishedResource]
          : [publishedResource],
      });
      return;
    }
    if (
      method === "POST" &&
      path === "/api/v1/resources/res_upload/versions"
    ) {
      state.multipartBody = request.postData() ?? "";
      if (state.failUpload) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Storage ist nicht schreibbar" }),
        });
      } else {
        state.uploaded = true;
        await route.fulfill({ status: 201, json: draftSecondVersion });
      }
      return;
    }

    state.unexpectedRequests.push(`${method} ${path}`);
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Unmocked request" }),
    });
  });

  return state;
}

async function openVersionForm(page: Page): Promise<void> {
  await page.goto("/resources/res_upload/versions/1");
  await expect(page).toHaveTitle("Softbeat Atlas");
  await expect(
    page.getByRole("heading", { name: "Prüfbericht", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Überarbeitete Version anlegen" })
    .click();
  await expect(page).toHaveURL(/\/resources\/res_upload\/versions\/new$/);
}

async function fillVersionForm(page: Page): Promise<void> {
  await page.locator('input[name="file"]').setInputFiles({
    name: "bericht-v2.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("version two"),
  });
  await page.locator('input[name="version_label"]').fill("1.1");
}

test("uploads a second version and opens its draft detail", async ({ page }) => {
  const state = await mockAtlasApi(page);
  await openVersionForm(page);
  await fillVersionForm(page);

  await page
    .getByRole("button", { name: "Neue Version als Entwurf anlegen" })
    .click();

  await expect(page).toHaveURL(
    /\/resources\/res_upload\/versions\/2$/,
  );
  await expect(
    page.getByRole("heading", { name: "Prüfbericht", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Entwurf", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/bericht-v2\.txt/)).toBeVisible();
  expect(state.multipartBody).toContain('name="version_label"');
  expect(state.multipartBody).toContain("1.1");
  expect(state.multipartBody).toContain('filename="bericht-v2.txt"');
  expect(state.multipartBody).toContain("version two");
  expect(state.browserErrors).toEqual([]);
  expect(state.unexpectedRequests).toEqual([]);
});

test("keeps the form usable and displays a storage failure", async ({ page }) => {
  const state = await mockAtlasApi(page, true);
  await openVersionForm(page);
  await fillVersionForm(page);

  const submit = page.getByRole("button", {
    name: "Neue Version als Entwurf anlegen",
  });
  await submit.click();

  await expect(page.getByRole("alert")).toContainText(
    "Storage ist nicht schreibbar",
  );
  await expect(page).toHaveURL(/\/resources\/res_upload\/versions\/new$/);
  await expect(submit).toBeEnabled();
  expect(state.multipartBody).toContain('filename="bericht-v2.txt"');
  expect(state.browserErrors).toEqual([
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
  ]);
  expect(state.unexpectedRequests).toEqual([]);
});
