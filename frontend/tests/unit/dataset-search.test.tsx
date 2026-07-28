import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DatasetSearchFilters } from "../../src/api";
import { DatasetList } from "../../src/features/datasets";

function SearchHarness({ onFiltersChange }: { onFiltersChange: (filters: DatasetSearchFilters) => void }) {
  const [filters, setFilters] = useState<DatasetSearchFilters>({});
  const update = (next: DatasetSearchFilters) => {
    setFilters(next);
    onFiltersChange(next);
  };
  return <DatasetList items={[]} loading={false} filters={filters} facets={{ projects: [{ id: "project-1", name: "Klima", visibility: "project", approval_required: false }], keywords: ["Klima", "Messung"], suffixes: ["csv", "json"] }} onOpen={vi.fn()} onUpload={vi.fn()} onFiltersChange={update} />;
}

describe("dataset search filters", () => {
  it("adds and resets metadata filters", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(<SearchHarness onFiltersChange={onFiltersChange} />);

    await user.click(screen.getByRole("button", { name: "Filter anzeigen" }));
    await user.type(screen.getByLabelText("Titel"), "Messung");
    expect(onFiltersChange).toHaveBeenLastCalledWith({ title: "Messung" });

    await user.click(screen.getByRole("button", { name: "Dateiendungen: Alle auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: ".csv" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ title: "Messung", suffixes: ["csv"] });

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({});
  });
});
