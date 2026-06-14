#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADAPTER="${ROOT}/adapter_service"
cd "${ADAPTER}"

if [[ ! -d "${ADAPTER}/.venv" ]]; then
  echo "Adapter venv missing. Run deploy/ubuntu/install-systemd.sh first." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${ADAPTER}/.venv/bin/activate"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8090}"
