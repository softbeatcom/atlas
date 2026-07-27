import type { Resource } from "../../src/types";

export const publishedResource: Resource = {
  id: "res_upload",
  project: null,
  owner: "subject-alice",
  current_published_number: 1,
  latest_number: 1,
  is_current: true,
  newer_version: null,
  version: {
    number: 1,
    status: "published",
    title: "Prüfbericht",
    description: "Erste freigegebene Fassung",
    resource_type: "Bericht",
    keywords: ["Prüfung"],
    creator: "alice",
    version_label: "1.0",
    filename: "bericht-v1.txt",
    content_size: 11,
    media_type: "text/plain",
    sha256: "v1-checksum",
    created_at: "2026-07-27T12:00:00Z",
    modified_at: "2026-07-27T12:00:00Z",
    published_at: "2026-07-27T12:05:00Z",
  },
};

export const draftSecondVersion: Resource = {
  ...publishedResource,
  current_published_number: 1,
  latest_number: 2,
  is_current: false,
  version: {
    ...publishedResource.version,
    number: 2,
    status: "draft",
    description: "Überarbeitete Fassung",
    version_label: "1.1",
    filename: "bericht-v2.txt",
    content_size: 11,
    sha256: "v2-checksum",
    created_at: "2026-07-27T13:00:00Z",
    modified_at: "2026-07-27T13:00:00Z",
    published_at: null,
  },
};
