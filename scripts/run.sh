#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="${ROOT}"
# Avoid mixing ~/Library/Python user site-packages with conda/venv (pydantic ABI mismatch).
export PYTHONNOUSERSITE=1

CONDA_ENV_NAME="${LLM_ROUTER_CONDA_ENV:-llm-router-demo}"

resolve_uvicorn() {
  if [[ -x "${ROOT}/.venv/bin/uvicorn" ]]; then
    echo "${ROOT}/.venv/bin/uvicorn"
    return 0
  fi

  if [[ "${CONDA_DEFAULT_ENV:-}" == "${CONDA_ENV_NAME}" && -n "${CONDA_PREFIX:-}" && -x "${CONDA_PREFIX}/bin/uvicorn" ]]; then
    echo "${CONDA_PREFIX}/bin/uvicorn"
    return 0
  fi

  local conda_base=""
  if command -v conda >/dev/null 2>&1; then
    conda_base="$(conda info --base 2>/dev/null || true)"
  elif [[ -n "${CONDA_EXE:-}" ]]; then
    conda_base="$(dirname "$(dirname "${CONDA_EXE}")")"
  elif [[ -n "${CONDA_PREFIX:-}" ]]; then
    if [[ -d "${CONDA_PREFIX}/envs/${CONDA_ENV_NAME}" ]]; then
      conda_base="${CONDA_PREFIX}"
    elif [[ -d "$(dirname "${CONDA_PREFIX}")/envs/${CONDA_ENV_NAME}" ]]; then
      conda_base="$(dirname "${CONDA_PREFIX}")"
    fi
  fi

  if [[ -n "${conda_base}" && -x "${conda_base}/envs/${CONDA_ENV_NAME}/bin/uvicorn" ]]; then
    echo "${conda_base}/envs/${CONDA_ENV_NAME}/bin/uvicorn"
    return 0
  fi

  return 1
}

UVICORN="$(resolve_uvicorn || true)"
if [[ -z "${UVICORN}" ]]; then
  echo "uvicorn not found. Activate conda env '${CONDA_ENV_NAME}' or create ${ROOT}/.venv." >&2
  echo "  conda env update -n ${CONDA_ENV_NAME} -f environment.yml" >&2
  echo "  conda activate ${CONDA_ENV_NAME}" >&2
  exit 1
fi

if [[ ! -d "${ROOT}/frontend/dist" ]]; then
  echo "Building frontend..."
  (cd frontend && npm ci && npm run build)
fi

exec "${UVICORN}" backend.app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
