# Atlas implementation improvements

**Implementation pass:** 2026-07-26  
**Source review:** [`PROJECT_REVIEW.md`](PROJECT_REVIEW.md)

This document records what was changed after the review and what deliberately remains for later work. The original review remains a point-in-time record of the pre-improvement implementation.

## Completed in this pass

### Identity and authorization

- Demo Keycloak users now have stable UUID subjects.
- Seeded memberships use the same immutable subjects as authenticated JWTs.
- Existing local demo memberships using usernames are repaired during demo seeding.
- The admin UI selects known demo identities and stores subjects, not usernames.
- Project policy functions were moved into a dedicated `policies.py` module.
- Eligible project approvers can read pending content; auditors and unrelated approvers cannot.
- The frontend hides self-approval actions and the backend continues to enforce the rule.

### Token and content security

- JWT validation now pins `RS256` and checks issuer, audience, expiry, and subject.
- JWKS uses a bounded cache and refreshes once for an unknown signing key.
- Authentication failures consistently return 401 with `WWW-Authenticate: Bearer`.
- Direct password grants are disabled for the browser client.
- Upload MIME types are derived from filename/content instead of trusting the multipart header.
- HTML, XHTML, and SVG are forced to download-safe binary handling.
- Inline preview is limited to PDF and plain text.
- Plain text is rendered as escaped text and PDF uses a sandboxed iframe.
- Content responses add nosniff, sandbox CSP, and same-origin resource policy headers.

### Resource and approval workflow

- Canonical `/resources/{id}/versions/{number}` API and frontend routes were added.
- Version history is exposed and displayed.
- Rejected versions lead to a new immutable correction version, avoiding duplicate approval-request failures.
- New-version allocation uses a random storage key and maps concurrent number conflicts to 409.
- Upload failures roll back the database transaction and remove the staged file.
- Blocking filesystem work is moved off the async request event loop.
- Rejection reasons are included in the submitter notification.
- Approval now records both publication and explicit approval audit events.
- Notifications are actionable and can be marked read.
- Project settings can be edited and memberships can be removed.

### API and persistence

- Resource, identity, action, and version responses now have Pydantic schemas.
- Every JSON operation in the generated OpenAPI document has a response schema.
- Multipart metadata is normalized and length/count constrained.
- Expected duplicate-project and concurrent-version conflicts return stable 409 responses.
- Alembic replaces application-start `create_all`.
- A baseline migration recognizes existing Compose schemas and a second migration moves timestamps to timezone-aware UTC on PostgreSQL.
- Migration execution is serialized with a PostgreSQL advisory lock.
- Demo seeding is explicitly controlled by `SEED_DEMO_DATA`.

### Frontend and UX

- The former single-file UI was split into typed app, API, feature, type, and UI modules.
- Stable browser routes survive refresh and browser back/forward navigation.
- Search is debounced, abortable, and refreshes only resources.
- Authentication initialization has a visible failure state.
- Mobile navigation replaces the hidden sidebar.
- Upload, membership, and workflow actions remain present on small screens.
- The upload form shows the selected file and keeps its submit action in the main form.
- Rejection uses an inline accessible form instead of `window.prompt`.
- Status and visibility labels are consistently localized.
- Alerts, navigation state, icon buttons, focus indicators, and field labels have improved semantics.
- Preview object URLs are released after use.

### Delivery and dependencies

- Vite was upgraded from 5.4.21 to 8.1.5.
- The current npm audit reports zero vulnerabilities.
- Direct frontend dependency versions are pinned.
- The runtime frontend is a dependency-free static server rather than Vite's development server.
- Runtime frontend configuration is generated dynamically at `/runtime-config.js`.
- The static server provides SPA fallback, health checking, cache policy, CSP, and security headers.
- Backend runtime dependencies have a constraints file.
- Both Docker build contexts exclude local environments and generated artifacts.
- Runtime containers use non-root users.
- Compose has backend/frontend/Keycloak health checks and health-based dependencies.
- Helm has runtime config, probes, resource settings, non-root security contexts, optional Ingress/TLS, external Secret configuration, and a values schema.
- Generated `egg-info` metadata was removed from source and ignored.

## Verification completed

- Backend lint: passed.
- Backend tests: 12 passed, including a full HTTP approval/rejection/correction/publication workflow.
- JWT audience and algorithm tests: passed.
- Safe media detection tests: passed.
- Fresh migration and adoption of an existing schema were tested against SQLite; PostgreSQL-specific timezone SQL is generated by Alembic.
- Frontend strict TypeScript and production build: passed.
- Frontend static-server smoke test: passed, including health, runtime config, CSP, and stable-route fallback.
- npm audit: zero findings.
- Compose YAML parses successfully.
- OpenAPI: 22 paths, with no missing JSON response schemas.

## Remaining work

These items remain valuable but were not required to resolve the immediate release blockers:

- Replace the demo-only user directory with a production identity-directory integration.
- Add database-side search, pagination, eager loading, and measured query indexes.
- Add frontend component tests, automated accessibility checks, and browser-based end-to-end tests with Keycloak.
- Perform a live keyboard, screen-reader, responsive, and cross-browser UI pass.
- Add structured logging, metrics, correlation IDs, alerts, backup/restore automation, and file/database reconciliation.
- Add malware scanning and a production object-storage adapter.
- Render/lint the Helm chart in CI and test it against a real cluster.
- Run migrations against PostgreSQL in CI, including an upgrade from a previous release database.
- Add a Python dependency vulnerability scanner to CI.

## Environment verification limitation

The local Docker daemon/CLI developed an external `SIGBUS`/input-output failure while downloading image layers. Consequently, the updated Dockerfiles could not be built to completion in this session. The frontend runtime itself was executed and smoke-tested directly, backend dependencies and migrations were verified locally, and Compose YAML was parsed, but the final container build should be rerun after Docker is repaired or restarted.
