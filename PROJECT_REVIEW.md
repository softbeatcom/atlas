# Atlas MVP — Full-Stack Project Review

> **Historical snapshot:** This review describes the implementation before the
> 2026-07-26 remediation pass. See
> [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md) for completed fixes,
> verification results, and remaining work.

**Review date:** 2026-07-26  
**Reviewed scope:** product scope, architecture, backend, data model, API, authentication and authorization, storage, frontend, UI/UX, accessibility, testing, containers, Helm, operations, and coding style  
**Release recommendation:** **Do not deploy Atlas to a shared or production-like environment yet.** The project is a promising local prototype, but several core authorization, approval, preview, responsive-design, and deployment paths are not safe or complete enough for a pilot.

## 1. Executive summary

Atlas has a sensible MVP concept and a good high-level technology choice: a React client, a FastAPI modular monolith, PostgreSQL, Keycloak, and a replaceable file-storage boundary are appropriate for this problem. The domain vocabulary is understandable, the basic data model matches the intended workflows, the UI has a coherent visual direction, and the repository is small enough to improve without a rewrite.

The current implementation should nevertheless be treated as a **functional prototype**, not a production-ready MVP. The most important problems are:

1. Project memberships store usernames while authorization compares Keycloak's opaque `sub` claim. Demo users therefore do not match their seeded memberships, and the administration UI continues to create the wrong kind of identifier.
2. Project approvers can see pending metadata but cannot open the pending file they are expected to review.
3. JWT audience validation is disabled and the accepted signing algorithm is selected from the untrusted token header.
4. User-controlled `text/*` content is shown in an unsandboxed same-origin blob iframe, creating a stored active-content/XSS risk.
5. The Docker and Helm frontend runs Vite's development server. A current audit reports vulnerabilities in those deployed development dependencies.
6. The responsive stylesheet hides the only upload submit button and the project member-management panel on screens up to 800 px wide.
7. The UI displays a “stable URL” that does not correspond to an implemented frontend or metadata API route.
8. The storycards promise rights, approval, version, responsive, and delivery verification that the three existing unit tests do not cover.

The right strategy is **not a rewrite or a premature split into microservices**. Keep a modular monolith, first repair the identity and workflow contracts, add executable end-to-end acceptance tests, and then harden packaging and operations.

## 2. Overall assessment

| Area | Assessment | Summary |
|---|---|---|
| Product scope | Promising, partially delivered | The storycards are clear, but several promised workflows exist only in the API or only superficially in the UI. |
| Architecture | Appropriate foundation | Component choices are sound; application boundaries inside backend and frontend need definition. |
| Backend | Readable prototype | Core rules are visible, but one 475-line module owns routing, policy, orchestration, persistence, and serialization. |
| Security | Not ready for shared use | Identity mismatch, incomplete JWT validation, unsafe preview behavior, and a development server are blockers. |
| Data integrity | Needs hardening | No migrations, weak file/database atomicity, and unsafe concurrent version allocation. |
| Frontend | Visually coherent, structurally brittle | Strict TypeScript compiles, but most code is compressed into one component file with many `any` values. |
| UI/UX | Good visual start, incomplete workflows | Clear hierarchy and status chips; mobile actions, version navigation, notifications, and error/loading states need work. |
| Accessibility | Partial | Semantic buttons and labels are a start, but navigation, alerts, prompts, icon controls, and responsive access fall short. |
| Tests | Far below stated acceptance scope | Three policy-level tests pass; there are no HTTP integration, frontend, end-to-end, or deployment tests. |
| Deployment | Development-only | Compose is useful locally; Docker and Helm are not production artifacts yet. |
| Coding style | Mixed | Backend lint is clean, but both main application files are overly concentrated and frontend formatting is difficult to maintain. |

## 3. Review method and evidence

The review included:

- a line-by-line inspection of all application, test, Docker, Compose, Helm, Keycloak, README, and storycard files under `atlas/`;
- backend test execution;
- backend lint execution;
- a strict TypeScript and Vite production build;
- Compose configuration validation;
- inspection of the stopped Compose services and their recent logs;
- current npm production and full dependency audits;
- inspection of the generated OpenAPI contract.

### Checks executed

| Check | Result |
|---|---|
| `pytest -q` | 3 passed, with 17 deprecation warnings |
| `ruff check app tests` | Passed |
| `npm run build` | Passed; TypeScript and Vite build succeeded |
| `docker compose config` | Passed |
| `docker compose ps --all` | All four Atlas services were stopped; the review did not restart them |
| Recent Compose logs | Stack had started successfully; logs also show five API calls being repeated on each search keystroke |
| `npm audit --omit=dev` | No production dependency advisory reported |
| `npm audit` | 1 high and 1 moderate vulnerability reported through Vite/esbuild |
| Helm render/lint | Not run because Helm is not installed; templates were reviewed statically |
| Python advisory audit | Not run because `pip-audit` is not installed |

### Limitations

- No live browser, keyboard-only, screen-reader, or cross-browser pass was performed because the requested Docker deployment was stopped. UI/UX findings are based on the rendered component structure, CSS behavior, and prior runtime logs.
- The Helm chart was reviewed statically but not rendered by Helm.
- Dependency findings are a point-in-time result for 2026-07-26 and should be reproduced in CI.

## 4. Priorities

- **P0 — Release blocker:** fix before any shared demo, pilot, or production-like deployment.
- **P1 — MVP blocker:** fix before claiming the storycard-defined MVP is complete.
- **P2 — Hardening:** complete before production or meaningful scale.
- **P3 — Improvement:** valuable maintainability or experience refinement.

## 5. P0 release blockers

### ATLAS-001 — Canonical user identity is inconsistent

**Evidence**

- `backend/app/auth.py:42` sets `CurrentUser.subject` from the JWT `sub` claim.
- `backend/app/main.py:53-55` seeds project membership subjects as `"alice"` and `"bob"`.
- `infra/keycloak/atlas-realm.json` does not assign those strings as Keycloak user IDs. Keycloak generates UUID-like subjects; the runtime log shows such IDs.
- `frontend/src/main.tsx:32` labels the membership field “Benutzername” and sends that username as `subject`.
- Authorization and notification queries compare stored values against `user.subject`, for example `backend/app/main.py:81-83` and `455-458`.

**Impact**

- Alice and Bob do not match the memberships intended for them.
- A non-admin demo user can see an organization-wide project in the project list but cannot upload to it because upload authorization requires membership.
- Bob can have the global `approver` role but still fail the project-level approver check.
- Notifications addressed to `"bob"` are not returned when Bob's authenticated subject is a Keycloak UUID.
- The existing unit tests hide the defect by constructing users whose `subject` equals their username.

**Recommendation**

Choose one immutable canonical identity key and enforce it everywhere. The correct default is the OIDC `sub` claim:

1. Give demo Keycloak users explicit stable IDs in the realm import.
2. Seed memberships with those IDs.
3. Replace the free-text username field with an identity lookup/selection that stores the selected user's `sub` and separately displays their username.
4. Model display name/username as presentation data, never as the authorization key.
5. Add a database migration and a one-off data repair path for existing memberships and notification recipients.

**Acceptance criteria**

- Alice can list and upload to every project where her Keycloak `sub` is a member.
- Bob sees Aster approvals and receives their notifications.
- Changing a username does not change access.
- Tests use realistic UUID-like `sub` values distinct from usernames.

### ATLAS-002 — Approvers cannot read the content they must approve

**Evidence**

- `can_view_version_metadata()` permits a project approver to see a pending version (`backend/app/main.py:112-129`).
- The content endpoint permits unpublished content only to an admin or the resource owner (`backend/app/main.py:441-444`).
- A normal project approver is neither, so “Vorschau / Download” returns 404 for the pending file.

**Impact**

The four-eyes workflow is not meaningful: an approver can approve metadata but cannot inspect the primary artifact.

**Recommendation**

Create one explicit authorization policy for each resource/version action:

- view published metadata;
- view unpublished metadata;
- read published content;
- read pending content for approval;
- edit/create a version;
- submit;
- approve/reject.

The pending-content policy should permit an eligible project approver while still denying auditors and unrelated users. Use the same policy from the detail, content, and approvals endpoints.

**Acceptance criteria**

- An eligible approver can read a pending artifact.
- An unrelated global approver cannot.
- An auditor can read metadata but never file content.
- An owner cannot approve their own submission.
- Tests cover all roles, visibility modes, and version statuses as a policy matrix.

### ATLAS-003 — Access-token verification is incomplete

**Evidence**

- `backend/app/auth.py:37-38` passes `algorithms=[header["alg"]]`, taking the accepted algorithm from an unverified header.
- The same call explicitly sets `verify_aud` to `False`, despite `keycloak_audience` existing in `backend/app/config.py:13` and an API audience mapper existing in Keycloak.
- `jwks()` is cached forever, so signing-key rotation is not recovered automatically.
- `payload["sub"]` is read outside the exception block and can turn a malformed but otherwise valid token into a 500 response.

**Impact**

Atlas can accept tokens that were not intended for the Atlas API, weakens its trust boundary around signing algorithms, and can fail after Keycloak key rotation.

**Recommendation**

- Pin the expected algorithm, normally `RS256`, in configuration/code.
- Validate `issuer`, `audience`, signature, expiry, not-before, and required `sub`.
- On an unknown `kid`, refresh JWKS once and retry; apply a bounded cache lifetime.
- Convert all token-validation failures to a consistent 401 response with an appropriate `WWW-Authenticate` header.
- Consider using a maintained OIDC/JWT validation integration rather than hand-maintaining the complete validation lifecycle.
- Disable Keycloak direct access grants unless a documented client needs the password grant.

**Acceptance criteria**

- Wrong issuer, audience, signature, algorithm, expiry, missing `sub`, and unknown `kid` tests all fail closed with 401.
- A rotated signing key is accepted after JWKS refresh.
- A token issued for another same-realm client is rejected.

### ATLAS-004 — Inline preview trusts attacker-controlled active content

**Evidence**

- The backend stores `UploadFile.content_type`, which is client-controlled (`backend/app/main.py:274` and `298`).
- Any media type beginning with `text/` is considered previewable (`backend/app/main.py:449`).
- The frontend turns the response into a blob URL and embeds it in an iframe without a `sandbox` (`frontend/src/main.tsx:28`).

**Impact**

An uploader can provide active HTML or SVG-like content with a previewable media type. Rendering active content in an unsandboxed blob iframe can execute script in a dangerous browser context and is a stored-content attack against reviewers.

**Recommendation**

- Use a strict preview allowlist. Treat `text/plain` as escaped text, not as iframe HTML.
- Never inline `text/html`, SVG, or unknown text formats.
- Determine content type server-side using trusted detection; do not rely only on the multipart header or filename.
- Sandbox any remaining iframe preview and apply a restrictive Content Security Policy.
- Keep untrusted formats as attachment downloads.
- Add malware/content scanning as a production extension point, even if the local MVP uses a no-op implementation.

**Acceptance criteria**

- Uploaded HTML and SVG cannot execute script in Atlas.
- A spoofed MIME type does not bypass the allowlist.
- Plain text and PDF still have a usable, tested preview.
- Unsupported types download with `Content-Disposition: attachment`.

### ATLAS-005 — Deployment serves a vulnerable development server

**Evidence**

- `frontend/Dockerfile` starts `npm run dev`.
- Runtime logs confirm `vite --host 0.0.0.0`.
- The Helm frontend service exposes that process on port 5173.
- The Dockerfile runs `npm install` before the lockfile is copied and never builds or serves `dist`.
- The full npm audit reports a high-severity Vite advisory and a moderate esbuild advisory. These are relevant because development dependencies are part of the deployed server.

**Impact**

The deployment exposes development tooling and source-serving behavior, lacks a stable production asset server and caching/security headers, and unnecessarily makes development dependency vulnerabilities remotely relevant.

**Recommendation**

- Build the frontend in a multi-stage image with `npm ci` and `npm run build`.
- Serve immutable static assets from an unprivileged Nginx/Caddy container or an equivalent production server.
- Add security headers, sensible caching, SPA fallback, and a runtime configuration strategy.
- Pin reproducible dependency versions and run both production and full audits in CI.
- Keep Vite only in the local development profile.

**Acceptance criteria**

- The production image contains no Node package manager, source tree, Vite server, or development dependencies.
- Runtime logs identify a production static server.
- Security headers and cache behavior are integration-tested.
- Current high/critical audit findings fail CI.

### ATLAS-006 — Core workflows break on mobile widths

**Evidence**

- At `max-width: 800px`, `.workflow` is set to `display:none` in `frontend/src/styles.css`.
- The upload form's only submit button is inside `aside.workflow` (`frontend/src/main.tsx:26`).
- The admin membership form is also inside `aside.workflow` (`frontend/src/main.tsx:32`).
- At the same breakpoint, `.app > aside` hides the complete application navigation with no replacement.

**Impact**

Users on phones and smaller tablets cannot submit an upload, administer memberships, or navigate to approvals, administration, or audit. This directly violates SC-06.

**Recommendation**

- Keep primary actions inside the form's main content and optionally mirror them in a desktop summary panel.
- Replace the hidden sidebar with an accessible drawer, compact header menu, or bottom navigation.
- Reflow secondary workflow/status content below the main card rather than removing it.
- Test at 320, 375, 768, and 1024 px, including keyboard navigation.

**Acceptance criteria**

- Every desktop workflow remains reachable and completable at 320 px.
- Upload submission and member management are available on mobile.
- Navigation exposes every role-appropriate destination.
- Automated viewport tests cover the main workflows.

## 6. P1 MVP blockers

### ATLAS-007 — Rejection and resubmission lifecycle is internally inconsistent

`ApprovalRequest.version_id` is unique (`backend/app/models.py:86`), but `submit()` allows a `REJECTED` version and always inserts a new `ApprovalRequest` (`backend/app/main.py:348-352`). Resubmitting the same rejected version therefore risks a database integrity error. At the same time, the UI has no draft editing workflow and no “new version” workflow, so a user cannot practically address reviewer feedback.

**Recommendation:** define and implement one lifecycle:

- either reopen the same approval request and retain decision history in a separate decision/event table;
- or require a new immutable version after rejection and remove `REJECTED` from valid resubmission states.

Preserve all review decisions and comments as history. Add an explicit state-transition service so routes cannot create invalid transitions.

### ATLAS-008 — The advertised stable version URL does not exist

The detail screen displays `/resources/{id}/versions/{number}` (`frontend/src/main.tsx:28`), but there is no frontend router and no matching metadata endpoint. The actual metadata call is `/api/v1/resources/{id}?version={number}`. Refreshing the browser loses the selected page and version.

**Recommendation:** introduce a small route model, for example:

- `/resources`
- `/resources/new`
- `/resources/:resourceId/versions/:number`
- `/approvals`
- `/admin/projects`

Make the displayed stable URL real, deep-linkable, refresh-safe, and copyable. The backend can support either a canonical `/resources/{id}/versions/{number}` metadata endpoint or an intentional documented query form, but the client and API must agree.

### ATLAS-009 — Helm chart is incomplete and not installable as a self-contained release

`backend.yaml` references `<release>-secrets/database-url`, but no Secret template exists. `values.yaml` exposes `config.databaseUrl`, yet the template does not use it. There is no Ingress, TLS configuration, Keycloak/PostgreSQL dependency contract, readiness/liveness probes, resource requests/limits, security context, or service-account policy. The frontend is the development server described above.

**Recommendation:** decide whether PostgreSQL, Keycloak, and the database Secret are external prerequisites or chart-managed dependencies, then document and validate that contract. Prefer an externally supplied Secret reference rather than putting a database URL directly in values. Add `values.schema.json`, probes, resources, security contexts, and CI-based `helm lint`/render tests.

### ATLAS-010 — Database creation is not a migration strategy

`Base.metadata.create_all()` runs on application startup (`backend/app/main.py:43-45`). It cannot safely evolve existing schemas, coordinate deployments, or roll back. Startup also seeds demo projects whenever the project table is empty, mixing application boot with environment-specific fixture loading.

**Recommendation:** adopt Alembic migrations, make startup free of schema mutation, and move demo fixtures to an explicit development seed command. Use timezone-aware UTC columns and values; the current `datetime.utcnow()` calls generated the test warnings.

### ATLAS-011 — File storage and database updates are not failure-safe

Files are written before the database transaction commits. A failed commit leaves an orphan file. Concurrent version creation calculates `max(number) + 1`, can choose the same number twice, and writes both requests to the same storage key before the unique constraint resolves the conflict. Synchronous file writes also occur inside an async request handler, blocking the event loop.

**Recommendation:**

- allocate version numbers under a database lock or use a database-backed sequence/counter;
- give each stored object an independent random key rather than deriving it solely from the candidate version number;
- define cleanup/reconciliation for database/file failures;
- stage and atomically move local files where practical;
- run blocking storage and synchronous database work in an appropriate worker thread, or choose a consistently async stack;
- avoid holding a database transaction open throughout a potentially 100 MiB upload.

### ATLAS-012 — Input validation and error mapping are too weak

Multipart fields are plain strings without the constraints used on project schemas. Empty trimmed titles/types, overlong values, duplicate project names, and database integrity failures can become 500 responses. Keywords are encoded as a comma-separated string, making commas inside values impossible. Client-provided media type is trusted.

**Recommendation:** validate multipart metadata through a Pydantic model, define normalized limits, use a structured keyword representation, and map expected constraint conflicts to stable 409/422 problem responses. Publish response models for all resource and action endpoints.

### ATLAS-013 — The test suite does not satisfy SC-07

The three tests in `backend/tests/test_access.py` call policy/helper functions directly. They do not make HTTP requests, validate real JWT claims, exercise PostgreSQL, write/read storage, test approval decisions, test versions, or use the frontend. The publishing test does not assert the promised audit event despite its name.

**Recommendation:** build a test pyramid around domain policies, API integration tests, and a few Keycloak-backed end-to-end workflows. The minimum release suite is listed in section 13.

### ATLAS-014 — Several promised frontend workflows are missing

The backend exposes capabilities that the UI does not:

- create a next resource version;
- update project visibility/approval rules;
- mark notifications read.

Other required product behavior has no complete implementation:

- no version history or navigation to older versions;
- no edit/correct-rejected-draft workflow;
- no reviewer comment display;
- no member removal;
- no usable notification center;
- no direct access to a stable version URL.

These gaps make the UI a demo of isolated actions rather than the complete SC-06 workflow.

### ATLAS-015 — Search and list loading will not scale and already amplifies requests

The backend loads every resource, performs project/version/membership queries per item, and searches a Python string in memory (`backend/app/main.py:305-326`). There is no pagination. The frontend invokes the full `load()` function for every search keystroke, refetching user, projects, resources, notifications, and approvals. Runtime logs show these repeated request groups.

**Recommendation:** debounce and cancel resource searches, fetch only resources when the query changes, add pagination and stable ordering, eager-load required relations, and move filtering into PostgreSQL. PostgreSQL full-text search can wait until the data volume justifies it; indexed `ILIKE`/trigram search is sufficient for an early pilot.

### ATLAS-016 — Frontend async/error behavior is fragile

Authentication initialization has no rejection path. Several callbacks do not catch request failures. There are almost no loading states beyond the upload button, stale requests can overwrite newer search results, and object URLs used for previews are not revoked when previews change or the component unmounts.

**Recommendation:** add a small typed request/error layer, route-level loading/error states, abortable requests, and predictable cache invalidation. A query library is optional; the important change is explicit ownership of server state rather than one global `load()` function.

### ATLAS-017 — Accessibility and interaction semantics need an explicit pass

Important examples:

- the notification glyph is a non-interactive `div` and cannot open notifications;
- flash messages do not use `role="status"`/`alert`;
- the dismiss `×` button has no accessible name;
- active navigation has no `aria-current`;
- rejection uses `window.prompt`, which is a poor review form and an inconsistent modal experience;
- the “Version” field contains a nested `<label>`, producing invalid labeling structure;
- sidebar navigation disappears on mobile;
- raw English status values appear in detail/status panels despite a German interface;
- the generic `aside` rule gives all asides dark text context, while `.card` later changes their background, creating fragile/inconsistent color inheritance.

**Recommendation:** target WCAG 2.2 AA, use semantic landmarks and named controls, provide a real rejection dialog/form, retain visible focus indicators, and add automated axe checks plus keyboard/manual verification.

## 7. Architecture review

### Current shape

```text
Browser
  ├── OIDC Authorization Code + PKCE ──> Keycloak
  └── React/Vite client
        └── Bearer-token API calls ──> FastAPI
                                        ├── SQLAlchemy ──> PostgreSQL
                                        ├── local adapter ──> filesystem
                                        └── JWKS fetch ──> Keycloak
```

This is a good MVP topology. The problem is not the number of deployable services; it is the lack of boundaries inside the two application services.

### What is good

- Keycloak owns authentication rather than the application implementing passwords.
- Authorization rules are mostly centralized as functions rather than scattered through JSX.
- Binary files are outside PostgreSQL.
- `LocalDirectoryStorage` is already an abstraction point for future object storage.
- Immutable `ResourceVersion` rows and a stable `Resource` identity are the right domain direction.
- Audit and notification records participate in the same database transaction as most status changes.
- The frontend and backend have strict, small dependency sets.

### Backend boundary problems

`backend/app/main.py` currently owns:

- FastAPI setup;
- database creation and seeding;
- authorization policy;
- query construction;
- workflow/state transitions;
- file orchestration;
- response serialization;
- all HTTP routes.

That concentration makes it easy for slightly different authorization checks to drift, as happened between metadata and content. It also makes transaction and lifecycle rules hard to test without importing the web module.

### Recommended backend structure

Keep one deployable backend, but separate responsibilities:

```text
app/
  api/
    dependencies.py
    projects.py
    resources.py
    approvals.py
    notifications.py
    audit.py
  domain/
    identities.py
    policies.py
    version_state.py
  services/
    project_service.py
    resource_service.py
    approval_service.py
  persistence/
    models.py
    repositories.py
  storage/
    base.py
    local.py
  schemas/
    projects.py
    resources.py
    common.py
  auth/
    oidc.py
  config.py
  application.py
```

This does not require abstracting every database call. The valuable boundaries are:

1. one canonical policy layer;
2. one version state machine;
3. service-owned transaction boundaries;
4. typed API schemas;
5. infrastructure adapters for OIDC and storage.

### Frontend boundary problems

`frontend/src/main.tsx` contains application boot, navigation, all pages, all forms, all types, all request-triggering logic, dialogs, preview handling, and UI copy. It is compressed into 36 physical lines, with individual lines containing entire pages. This makes review, testing, merge conflict resolution, and accessible component reuse unnecessarily difficult.

### Recommended frontend structure

```text
src/
  app/
    App.tsx
    router.tsx
    layout/
  auth/
    keycloak.ts
    AuthProvider.tsx
  api/
    client.ts
    types.ts
  features/
    resources/
    approvals/
    projects/
    notifications/
    audit/
  components/
    Button.tsx
    StatusBadge.tsx
    ErrorBanner.tsx
    Dialog.tsx
  styles/
```

Prefer feature-oriented files and typed props. A global state framework is not currently necessary.

## 8. Product scope and storycard assessment

| Storycard | Status | Review |
|---|---|---|
| SC-00 Local foundation | Mostly met | Compose defines four services and local storage. Health is shallow and service readiness is incomplete. |
| SC-01 Auth/authorization | Not met | Login works, but canonical identity is broken and JWT audience validation is disabled. |
| SC-02 Project administration | Partially met | Create/update/upsert APIs exist; UI cannot update rules or remove members and stores the wrong identity. |
| SC-03 Drafts/storage | Partially met | Upload and metadata work; validation, consistency, editing, and safe MIME handling are incomplete. |
| SC-04 Approval/versioning | Not met | Own approval is denied correctly, but approvers cannot read pending content, rejected resubmission is inconsistent, and stable URLs are not real. |
| SC-05 Search/content/audit | Partially met | Authorization filtering is attempted; search is in-memory, preview is unsafe, and audit coverage/UX is limited. |
| SC-06 Frontend workflows | Not met | Visual foundation exists, but version workflows are absent and mobile core actions are hidden. |
| SC-07 Delivery/verification | Not met | Local containers build, but the production image/chart and claimed workflow test coverage are incomplete. |

### Recommended MVP scope boundary

Keep these in the first complete MVP:

- authentication and canonical identity;
- project membership and visibility;
- private/project draft creation;
- immutable versions;
- submit/reject/correct/approve/publish;
- metadata search with pagination;
- safe download and limited preview;
- version history and real stable URLs;
- actionable notifications;
- audit events for workflow and access-control changes;
- responsive, keyboard-usable versions of all core workflows;
- local Compose and one documented production deployment path.

Continue to defer these until after the MVP unless a business requirement changes:

- S3-compatible object storage implementation;
- resumable multipart uploads;
- sophisticated search ranking;
- collaborative editing;
- external notification channels;
- multi-region/high-availability deployment;
- microservices.

## 9. Backend and API detailed review

### Strengths

- Functions are short and naming is generally clear.
- Ruff passes with a reasonable line-length rule.
- Resource visibility, content access, and management are at least represented as explicit policies.
- Unauthorized resource detail/content usually returns 404, limiting existence disclosure.
- Uploads are streamed in chunks rather than buffered as one byte array.
- Filenames are reduced to their basename and storage keys are checked against directory traversal.
- File responses add `X-Content-Type-Options: nosniff`.
- Project create/update payloads use Pydantic constraints.

### Correctness and domain concerns

- The status model permits multiple drafts and pending versions per resource without an explicit invariant.
- An admin/owner resource list selects the latest version, while other readers select the current published version. This can be useful, but the UI does not explain that different users may see different versions of the same resource.
- Approval success records `resource.published` through `publish()` but does not add the `resource.approved` audit action assigned in `decide()`. Rejections do add `resource.rejected`. Audit semantics are therefore asymmetric.
- The publishing test name says it verifies an audit event but only asserts resource/version state.
- Audit rows are globally visible to auditors/admins and limited to the latest 500, without pagination or filters.
- Project membership can be added/updated but not removed.
- There is no resource/version history endpoint.
- The health endpoint does not verify database, storage, or Keycloak/JWKS readiness.

### API contract concerns

The OpenAPI document has 18 paths, but most resource/action operations have no response schema. That reduces generated-client usefulness and makes accidental response changes hard to catch.

Recommended API improvements:

- typed `ResourceSummary`, `ResourceDetail`, `ResourceVersion`, `ApprovalItem`, and problem-detail schemas;
- explicit request/response models and documented status codes for every operation;
- consistent stable version path;
- pagination metadata;
- structured error codes in addition to localized messages;
- idempotency or conflict semantics for state-changing operations where retries are plausible;
- an optimistic concurrency field or version when editing mutable project settings.

### Data-model concerns

- Use timezone-aware UTC timestamps.
- Add database indexes based on real queries, including approval/open-request and version lookup patterns.
- Add constraints for positive version numbers and content sizes.
- Consider storing normalized keywords in a separate table or a PostgreSQL array only when search requirements warrant it; JSON is acceptable for a small MVP but is not currently indexed.
- Model approval decisions as append-only history if rejected versions can be revised/resubmitted.
- Consider foreign keys for notification/audit resource references if retention rules allow them; otherwise document why they are intentionally denormalized.

### Performance

Performance is acceptable only for very small data sets. The main immediate fixes are pagination, query-side filtering, eager loading, and removing the frontend request fan-out. Do not add caching until query behavior is correct and measured.

## 10. Frontend and UI/UX detailed review

### Visual strengths

- The restrained green palette fits an internal knowledge repository.
- Page hierarchy, card grouping, whitespace, and metadata density are generally good.
- Visibility and publication status are separate chips, which directly supports SC-06.
- Resource rows expose title, author/version, size, project, visibility, status, and date without requiring a detail click.
- Empty states and a consistent top-level error banner exist.
- Native form controls preserve a useful baseline of browser behavior.

### UX gaps

- Notification count has no destination and notifications cannot be marked read.
- Search appears on every page but is active only on the resources page.
- Search results can race and revert because requests are neither debounced nor cancelled.
- There are no confirmation or review summaries before irreversible publish/approve actions.
- Rejection uses a browser prompt and the decision comment disappears from the subsequent user experience.
- Status values in the detail sidebar are raw English identifiers.
- The stable URL is neither a link nor copyable and is not real.
- Version creation/history is absent.
- Admin member entry asks for an internal identifier the administrator should not have to know.
- The upload file picker does not display an application-level selected-file summary or upload progress.
- Preview fetches the whole file into a browser blob before rendering, which is memory-heavy for large PDFs.
- The preview object URL is not revoked on replacement/unmount.
- The workflow side cards inherit styles through broad `aside` selectors, making text color and layout fragile.

### Responsive behavior

Hiding auxiliary information can be appropriate, but hiding actions and navigation is not. The responsive design should reflow in this order:

1. persistent compact navigation;
2. page title and primary action;
3. main workflow form/content;
4. status/workflow explanation;
5. secondary metadata.

### Accessibility

Adopt these baseline rules:

- one visible, keyboard-reachable primary action per workflow;
- semantic landmarks (`nav`, `main`, named complementary regions);
- programmatic labels and descriptions for every field;
- `aria-current` for navigation;
- `role="status"` for non-critical updates and `role="alert"` for blocking failures;
- accessible dialogs with focus management instead of `prompt`;
- meaningful accessible names for icon-only controls;
- visible focus styles;
- contrast verification for muted text, chips, and controls;
- reduced-motion support if animation is later added;
- keyboard, 200% zoom, and screen-reader smoke tests.

## 11. Coding style and maintainability

### Backend

Positive:

- consistent naming and type annotations;
- small helper functions;
- lint-clean code;
- minimal framework magic.

Needs improvement:

- split `main.py` by feature and layer;
- format multi-argument calls vertically rather than compressing them to fit;
- replace deprecated FastAPI startup events with lifespan handling;
- replace `datetime.utcnow()` with timezone-aware UTC;
- add return types to routes and generators;
- avoid `dict`/untyped ad-hoc API objects;
- name policy functions by action, not vague verbs such as `can_manage_project`;
- remove generated `atlas_api.egg-info` from source and ignore build metadata;
- add a dependency lock/constraints workflow for reproducible backend builds.

### Frontend

Positive:

- strict TypeScript is enabled;
- the production build succeeds;
- components use React state and props without unnecessary global state.

Needs improvement:

- apply normal multiline formatting; `main.tsx`, `package.json`, `tsconfig.json`, and `styles.css` are needlessly compressed;
- split pages and feature components into separate files;
- replace `any` with API/domain types;
- add ESLint and a formatter with CI checks;
- avoid a single string `page` state in favor of typed routes;
- separate server state from transient UI state;
- extract repeated status labels, badges, errors, and action handling;
- type the API client generically and distinguish network, authentication, validation, and conflict errors;
- add component tests before refactoring behavior.

## 12. Containers, Helm, and operations

### Compose

Compose is useful as a local demo environment. Improvements:

- label it explicitly as development-only;
- add health checks for Keycloak, backend, and frontend;
- wait for Keycloak readiness rather than process start;
- avoid fixed demo credentials outside the development profile;
- persist Keycloak data if administrators are expected to change it locally;
- add `.dockerignore` files so `.venv`, `node_modules`, build output, and local data are not sent as build context;
- document reset/backup behavior for both PostgreSQL and file storage.

### Docker images

- Use reproducible installs: `npm ci` with the lockfile copied first; a Python lock/constraints file for backend.
- Use multi-stage builds.
- Run as a non-root user.
- Add image metadata and a clear versioning scheme.
- Keep build tools and test dependencies out of runtime images.
- Configure graceful shutdown and appropriate worker/process settings.
- Pin base image versions deliberately and automate refreshes.

### Helm/Kubernetes

Before calling the chart deployable:

- document external dependencies and required Secrets;
- remove the dead `config.databaseUrl` value or wire a safe Secret reference;
- add probes and resource requests/limits;
- add pod/container security contexts and run as non-root;
- add configurable Ingress/TLS;
- define runtime frontend configuration;
- account for `ReadWriteOnce` storage when replicas exceed one;
- add rollout annotations/checksums for configuration changes;
- provide backup/restore and storage-retention guidance;
- render and lint the chart in CI against representative values.

### Observability and operations

Add before production:

- structured logs with request/correlation IDs;
- request latency/error metrics;
- authentication and authorization failure metrics without leaking tokens;
- readiness checks for database and writable storage;
- audit event retention/export policy;
- alerts for elevated 5xx, failed uploads, storage capacity, database health, and JWKS failures;
- a documented backup and restore test for database plus content storage;
- a reconciliation job/report for orphaned database rows or files.

## 13. Required test strategy

### Unit tests

- authorization matrix across admin, auditor, owner, member, project approver, global-only approver, and outsider;
- version state-transition matrix;
- storage path validation and upload size enforcement;
- token claim validation, including audience and key rotation behavior;
- normalization and validation of metadata.

### Backend integration tests

Use real HTTP requests and PostgreSQL for database-specific behavior:

1. admin creates a project and selects users by canonical subject;
2. Alice creates a project draft;
3. outsider cannot discover metadata or content;
4. Alice submits;
5. Bob receives a notification and can inspect content;
6. Alice cannot self-approve;
7. Bob rejects with a required comment;
8. Alice corrects the resource and resubmits;
9. Bob approves and publication is automatic;
10. version 1 remains reachable after version 2 is published and points to the current version;
11. auditor sees metadata/audit events but never content;
12. duplicate/concurrent version creation is safe;
13. oversized and failed uploads leave no file or database orphan.

### Frontend tests

- component tests for upload, detail actions, rejection form, project membership, notifications, and empty/error/loading states;
- route/deep-link tests for stable versions;
- accessibility checks using Testing Library and axe;
- responsive tests that assert primary controls remain visible;
- request-race tests for search;
- preview allowlist tests.

### End-to-end tests

Run a small Compose-based suite with Keycloak:

- Alice-to-Bob approval journey;
- admin project/member management;
- auditor restrictions;
- mobile upload and approval navigation;
- browser refresh on a stable version URL.

### Delivery tests

- build both production images;
- container smoke tests as non-root;
- dependency and image vulnerability scans;
- Compose config/start/health test;
- `helm lint` and rendered manifest assertions;
- migration upgrade from the previous released schema.

## 14. Recommended implementation sequence

### Phase 0 — Establish executable acceptance criteria

1. Convert the most important storycards into integration/E2E tests.
2. Add a realistic distinction between `sub` and username in all fixtures.
3. Add CI for backend tests/lint, frontend typecheck/build/lint, audits, image builds, and Helm rendering.

This phase prevents the following fixes from drifting apart.

### Phase 1 — Repair identity, authorization, and content safety

1. Canonicalize user identity and migrate membership data.
2. Implement one authorization policy matrix.
3. Harden JWT verification and JWKS rotation.
4. Make pending content readable only by eligible approvers.
5. Replace MIME trust and unsafe preview behavior.

### Phase 2 — Complete the domain workflow

1. Introduce a version state-transition service.
2. Resolve rejection/resubmission semantics.
3. Add draft correction/new version and version-history APIs.
4. Make approval history/comments visible.
5. Add member removal and identity selection.
6. Make notifications actionable.
7. Implement real stable version URLs.

### Phase 3 — Make the UI genuinely responsive and maintainable

1. Add routing and a responsive navigation replacement.
2. Move primary actions into mobile-visible form content.
3. Split `main.tsx` by feature and type the API client.
4. Add proper loading, error, confirmation, and rejection-dialog states.
5. Complete keyboard and accessibility remediation.

### Phase 4 — Make persistence and delivery production-capable

1. Add migrations and explicit demo seeding.
2. Fix upload/database consistency and concurrent version allocation.
3. Add pagination and database-side search.
4. Build a static production frontend image.
5. Harden backend image, Compose readiness, and Helm.
6. Add backups, reconciliation, observability, and operational documentation.

### Phase 5 — Optimize only from evidence

Measure query latency, upload behavior, storage growth, and user workflows before adding caching, asynchronous jobs, object storage, or service decomposition.

## 15. Suggested first implementation batches

To keep changes reviewable, use these batches:

1. **Identity contract:** stable Keycloak demo IDs, membership migration/model, user selection, identity integration tests.
2. **Authorization contract:** policy matrix, pending-content access, JWT validation, negative API tests.
3. **Safe content:** trusted type detection, preview allowlist/sandbox, cleanup tests.
4. **Version workflow:** state machine, rejection correction, history, stable routes, notification decisions.
5. **Responsive frontend:** navigation, visible mobile actions, dialogs, accessible status/error/loading behavior.
6. **Persistence:** Alembic, timezone-aware timestamps, transaction/storage reconciliation, concurrency.
7. **Production delivery:** static frontend image, locks, non-root images, chart contract/probes/security.
8. **Search and operations:** pagination/query optimization, structured logs, metrics, backups, runbooks.

## 16. Definition of “MVP ready”

Atlas is ready for an internal pilot when all of the following are true:

- every storycard has an executable acceptance test or an explicitly deferred item;
- no P0 finding in this review remains open;
- canonical user identity survives username changes;
- the complete submit/reject/correct/approve/publish flow works between distinct users;
- approvers can safely review content and auditors cannot;
- older versions have real, refresh-safe, immutable URLs;
- every core workflow works at 320 px and by keyboard;
- production does not expose Vite, demo Keycloak mode, or default credentials;
- database changes are migration-controlled;
- failed/concurrent uploads do not corrupt state or silently orphan files;
- production images and Helm manifests are reproducible and CI-validated;
- database and file content have a tested backup/restore procedure;
- high/critical dependency or image findings fail the release pipeline.

## 17. Final verdict

Atlas has a **good MVP concept and a salvageable implementation foundation**. The code demonstrates the intended product well enough to validate direction, and there is no architectural reason to start over. The strongest choices are the simple topology, explicit version entity, external identity provider, separated file storage, and restrained UI design.

The next development cycle should focus on contracts rather than features: identity, authorization, state transitions, stable URLs, and safe content handling. Once those are executable in tests, the UI and deployment can be completed with much lower risk. Until then, Atlas should remain a local development prototype.
