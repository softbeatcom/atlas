import type { Dataset } from "../../src/types";

export const publishedDataset: Dataset = {
  id: "ds_upload", project: null, owner: "subject-alice", current_published_number: 1, latest_number: 1, is_current: true, newer_version: null,
  version: { number: 1, status: "published", title: "Messdaten", description: "Erste Fassung", dataset_type: "Datensatz", keywords: ["Messung"], creator: "alice", version_label: "1.0", distribution_count: 2, total_size: 16, distributions: [
    { id: "file-1", position: 1, filename: "data.csv", content_size: 8, media_type: "text/plain", sha256: "a" },
    { id: "file-2", position: 2, filename: "readme.txt", content_size: 8, media_type: "text/plain", sha256: "b" },
  ], created_at: "2026-07-27T12:00:00Z", modified_at: "2026-07-27T12:00:00Z", published_at: "2026-07-27T12:05:00Z" },
};

export const draftSecondVersion: Dataset = { ...publishedDataset, latest_number: 2, is_current: false, version: { ...publishedDataset.version, number: 2, status: "draft", version_label: "1.1", published_at: null } };
