import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatasetForm } from "../../src/features/datasets";
import { draftSecondVersion, publishedDataset } from "../fixtures/datasets";

const apiMocks = vi.hoisted(() => ({ createDataset: vi.fn(), createVersion: vi.fn() }));
vi.mock("../../src/api", () => ({ api: apiMocks }));

describe("dataset form", () => {
  it("submits all selected files as a complete next version", async () => {
    const user = userEvent.setup(); const onDone = vi.fn(); const { container } = render(<DatasetForm projects={[]} base={publishedDataset} onDone={onDone} onError={vi.fn()} />);
    apiMocks.createVersion.mockResolvedValue(draftSecondVersion);
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, [new File(["a"], "data.csv"), new File(["b"], "schema.json")]);
    await user.type(container.querySelector('input[name="version_label"]') as HTMLInputElement, "1.1");
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(apiMocks.createVersion).toHaveBeenCalledOnce());
    const [id, form] = apiMocks.createVersion.mock.calls[0] as [string, FormData];
    expect(id).toBe("ds_upload");
    expect(form.getAll("files")).toHaveLength(2);
    expect(onDone).toHaveBeenCalledWith(draftSecondVersion);
  });

  it("allows removing a selected file before submission", async () => {
    const user = userEvent.setup(); const { container } = render(<DatasetForm projects={[]} onDone={vi.fn()} onError={vi.fn()} />);
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, [new File(["a"], "data.csv"), new File(["b"], "readme.txt")]);
    await user.click(screen.getAllByRole("button", { name: "Entfernen" })[0]);
    expect(screen.getByText(/1 Dateien ausgewählt/)).toBeTruthy();
  });
});
