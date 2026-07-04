#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="${ROOT}"

if [[ -f "${ROOT}/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "${ROOT}/.venv/bin/activate"
else
  echo "Demo venv missing. Run deploy/ubuntu/install-systemd.sh first." >&2
  exit 1
fi

exec uvicorn backend.app.mcp_server.main:app --host 0.0.0.0 --port "${PORT:-9001}"
