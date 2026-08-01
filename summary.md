# SoftBeat Atlas: Design Purpose and Architecture

## Design purpose

SoftBeat Atlas is a self-hosted, FAIR-oriented repository for organizational knowledge—not a document editor. It turns groups of files into controlled, searchable, versioned resources with:

- business metadata and stable dataset/version URLs;
- project-based visibility and private resources;
- optional four-eyes approval before publication;
- permission-filtered discovery, download, and PDF/text preview;
- audit history and in-app approval notifications.

A dataset is the stable concept; each version is a complete snapshot containing up to 100 equal-ranked files.

## Current architecture

```text
React + TypeScript SPA
        │ REST / JSON
FastAPI modular monolith
        ├── PostgreSQL: metadata, versions, projects, rights,
        │               search, approvals, notifications, audit
        ├── Local filesystem: uploaded file bytes
        └── Keycloak/OIDC: authentication and global roles
```

- **Frontend:** React, Vite, and Wouter; screens for catalog/search, upload, version details, approvals, notifications, project administration, and audit.
- **Backend:** FastAPI with SQLAlchemy and Alembic; versioned `/api/v1` API and generated OpenAPI contract.
- **Authorization:** Keycloak roles (`user`, `approver`, `auditor`, `admin`) combined with PostgreSQL project memberships. The same policy checks protect search, metadata, previews, and downloads. Auditors can inspect metadata and logs but not raw files.
- **Domain model:** `Project → Dataset → DatasetVersion → Distribution`, plus memberships, approval requests, notifications, keywords, and audit events.
- **Workflow:** `draft → pending → published`, with rejection returning the resource for revision. Approval publishes the exact reviewed version.
- **Search:** PostgreSQL metadata search with project, keyword, and file-extension facets; no extracted document-content search yet.
- **Deployment:** Docker Compose locally and Helm for Kubernetes.

The design documents anticipate interchangeable S3, search, identity, preview, RDF, and AI adapters. In the current source, however, storage is concretely local, search is implemented directly in PostgreSQL, uploads are ordinary multipart requests limited to 100 MiB per file and 1 GiB per version, and AI/content extraction are not present. The documented RDF/Oxigraph module is also not present as source in this checkout.
