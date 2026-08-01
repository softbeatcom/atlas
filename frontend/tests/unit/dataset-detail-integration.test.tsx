import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatasetDetail } from "../../src/features/datasets";
import { publishedDataset } from "../fixtures/datasets";

const apiMocks = vi.hoisted(() => ({
  datasetVersions: vi.fn(),
  datasetVersionUrl: vi.fn(),
  dcat: vi.fn(),
}));

vi.mock("../../src/api", () => ({ api: apiMocks }));

describe("dataset detail integration", () => {
  it("provides version-pinned API and DCAT export actions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const createObjectURL = vi.fn().mockReturnValue("blob:atlas-dcat");
    const revokeObjectURL = vi.fn();
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    apiMocks.datasetVersions.mockResolvedValue([publishedDataset]);
    apiMocks.datasetVersionUrl.mockReturnValue(
      "https://atlas.example/api/v1/datasets/ds_upload/versions/1",
    );
    apiMocks.dcat.mockResolvedValue(new Blob(["{}"], { type: "application/ld+json" }));

    render(
      <DatasetDetail
        item={publishedDataset}
        user={{ subject: "subject-alice", username: "alice", roles: ["user"] }}
        onBack={vi.fn()}
        onOpenVersion={vi.fn()}
        onNewVersion={vi.fn()}
        onReload={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(screen.getByText("https://atlas.example/api/v1/datasets/ds_upload/versions/1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "API-URL kopieren" }));
    expect(writeText).toHaveBeenLastCalledWith(
      "https://atlas.example/api/v1/datasets/ds_upload/versions/1",
    );

    await user.click(screen.getByRole("button", { name: "curl-Beispiel kopieren" }));
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("Authorization: Bearer $ATLAS_ACCESS_TOKEN"),
    );

    await user.click(screen.getByRole("button", { name: "DCAT JSON-LD herunterladen" }));
    await waitFor(() => expect(apiMocks.dcat).toHaveBeenCalledWith("ds_upload", 1));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:atlas-dcat");
    expect(downloadClick).toHaveBeenCalledOnce();
  });
});
