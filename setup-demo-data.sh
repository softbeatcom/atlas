#!/usr/bin/env bash
# Reset the local Atlas stack and populate it with the deterministic demo corpus.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

usage() {
  echo "Usage: ./setup-demo-data.sh [--yes]"
  echo
  echo "Resets all local Atlas metadata and uploaded files, starts Docker Compose,"
  echo "and creates 100 demo datasets. Pass --yes to skip the confirmation prompt."
}

confirmed=false
while (($#)); do
  case "$1" in
    --yes)
      confirmed=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker with Compose support is required." >&2
  exit 1
fi

if [[ "$confirmed" != true ]]; then
  if [[ ! -t 0 ]]; then
    echo "Refusing a non-interactive reset without --yes." >&2
    exit 1
  fi
  echo "WARNING: This deletes all local Atlas metadata, Compose volumes, and files"
  echo "under data/storage. This cannot be undone."
  read -r -p "Type RESET to continue: " answer
  if [[ "$answer" != "RESET" ]]; then
    echo "Demo setup cancelled."
    exit 0
  fi
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

echo "Stopping Atlas and removing local Compose volumes ..."
docker compose down --volumes

echo "Clearing local file storage ..."
docker compose run --rm --no-deps --build --user 0 backend \
  find /data/storage -mindepth 1 -delete

echo "Building and starting the local Atlas stack ..."
docker compose up --build --detach --wait --wait-timeout 180

echo "Creating the demo corpus ..."
docker compose exec -T backend python -m app.seed_demo

echo
echo "Atlas is ready at http://localhost:5173"
echo "Sign in as alice, bob, admin, or auditor with password: password"
