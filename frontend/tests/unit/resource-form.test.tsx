import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api";
import { ResourceForm } from "../../src/features/resources";
import {
  draftSecondVersion,
  publishedResource,
} from "../fixtures/resources";

const apiMocks = vi.hoisted(() => ({
  createResource: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock("../../src/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      createResource: apiMocks.createResource,
      createVersion: apiMocks.createVersion,
    },
  };
});

describe("ResourceForm second-version upload", () => {
  beforeEach(() => {
    apiMocks.createResource.mockReset();
    apiMocks.createVersion.mockReset();
  });

  it("submits the replacement file and inherited metadata to the version endpoint", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onError = vi.fn();
    apiMocks.createVersion.mockResolvedValue(draftSecondVersion);
    const { container } = render(
      <ResourceForm
        projects={[]}
        base={publishedResource}
        onDone={onDone}
        onError={onError}
      />,
    );
    const file = new File(["version two"], "bericht-v2.txt", {
      type: "text/plain",
    });

    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      file,
    );
    await user.type(
      container.querySelector('input[name="version_label"]') as HTMLInputElement,
      "1.1",
    );
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(apiMocks.createVersion).toHaveBeenCalledOnce());
    const [resourceId, form] = apiMocks.createVersion.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(resourceId).toBe("res_upload");
    expect((form.get("file") as File).name).toBe("bericht-v2.txt");
    expect((form.get("file") as File).size).toBe(file.size);
    expect(form.get("title")).toBe("Prüfbericht");
    expect(form.get("description")).toBe("Erste freigegebene Fassung");
    expect(form.get("version_label")).toBe("1.1");
    expect(onDone).toHaveBeenCalledWith(draftSecondVersion);
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows the storage error and restores the submit action", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onError = vi.fn();
    apiMocks.createVersion.mockRejectedValue(
      new ApiError("Storage ist nicht schreibbar", 503),
    );
    const { container } = render(
      <ResourceForm
        projects={[]}
        base={publishedResource}
        onDone={onDone}
        onError={onError}
      />,
    );

    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["version two"], "bericht-v2.txt", { type: "text/plain" }),
    );
    await user.type(
      container.querySelector('input[name="version_label"]') as HTMLInputElement,
      "1.1",
    );
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Storage ist nicht schreibbar"),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Neue Version als Entwurf anlegen",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("rejects an empty file before calling the API", () => {
    const onError = vi.fn();
    const { container } = render(
      <ResourceForm
        projects={[]}
        base={publishedResource}
        onDone={vi.fn()}
        onError={onError}
      />,
    );

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(onError).toHaveBeenCalledWith("Bitte wähle eine Datei.");
    expect(apiMocks.createVersion).not.toHaveBeenCalled();
  });
});
