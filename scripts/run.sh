#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="${ROOT}"

if [[ -f "${ROOT}/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "${ROOT}/.venv/bin/activate"
fi

if [[ ! -d "${ROOT}/frontend/dist" ]]; then
  echo "Building frontend..."
  (cd frontend && npm ci && npm run build)
fi

exec uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
