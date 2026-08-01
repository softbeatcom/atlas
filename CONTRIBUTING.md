# Contributing to SoftBeat Atlas

Thank you for helping improve SoftBeat Atlas. The project is community-driven
and the core software is released under the Apache License 2.0.

## Before contributing

- Open an issue for substantial changes so the direction can be discussed.
- Keep pull requests focused and explain the user-visible behavior.
- Do not include credentials, uploaded files, generated content, or customer data.
- Preserve the authorization, content-type, and storage protections documented by the project.

## Contributions

By submitting a contribution, you certify that you have the right to submit it
under the Apache License 2.0 and agree to the Developer Certificate of Origin.
Add this sign-off to each commit:

```text
Signed-off-by: Your Name <your.email@example.com>
```

The project follows the [Developer Certificate of Origin](https://developercertificate.org/).

## Validation

Run the relevant checks before opening a pull request:

```bash
cd atlas/backend
.venv/bin/ruff check app tests migrations
.venv/bin/pytest -q

cd ../frontend
npm run check
npm test
```

Pull requests should include tests for behavior changes and screenshots for UI
changes. Please report security issues privately according to `SECURITY.md`.
