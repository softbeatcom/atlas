#!/usr/bin/env bash
# Start the complete local SoftBeat Atlas stack.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

# Keep existing local configuration untouched; first-time users get the defaults.
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

exec docker compose up --build "$@"
