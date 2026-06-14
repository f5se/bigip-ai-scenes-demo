#!/usr/bin/env bash
# Install F5 LLM Router Demo + Adapter as systemd services (user myf5).
# Run on Ubuntu as root: sudo bash deploy/ubuntu/install-systemd.sh
#
# Optional env before running:
#   REPO_URL=https://github.com/YOUR_ORG/llm_router_demo_App.git
#   INSTALL_DIR=/home/myf5/llm_router_demo_App
#   BUILD_FRONTEND=1   (default 1; set 0 if frontend/dist already in clone)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/f5se/bigip-ai-scenes-demo}"
INSTALL_DIR="${INSTALL_DIR:-/home/myf5/bigip-ai-scenes-demo}"
APP_USER="${APP_USER:-myf5}"
BUILD_FRONTEND="${BUILD_FRONTEND:-1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if ! id "${APP_USER}" &>/dev/null; then
  echo "User ${APP_USER} does not exist. Create it first: adduser ${APP_USER}" >&2
  exit 1
fi

echo "==> Installing OS packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  git curl ca-certificates \
  python3 python3-venv python3-pip \
  nodejs npm

# Prefer Node 18+ via NodeSource when stock node is too old
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [[ "${NODE_MAJOR}" -lt 18 ]]; then
  echo "==> Node $(node -v) is old; installing Node 20 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Preparing install directory ${INSTALL_DIR}..."
install -d -o "${APP_USER}" -g "${APP_USER}" "$(dirname "${INSTALL_DIR}")"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  echo "    Git repo exists; pulling latest..."
  sudo -u "${APP_USER}" git -C "${INSTALL_DIR}" pull --ff-only
elif [[ -n "${REPO_URL}" ]]; then
  echo "    Cloning ${REPO_URL} ..."
  if [[ -d "${INSTALL_DIR}" ]]; then
    echo "Directory ${INSTALL_DIR} exists but is not a git repo." >&2
    exit 1
  fi
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${INSTALL_DIR}"
else
  echo "Set REPO_URL or copy project to ${INSTALL_DIR} before running." >&2
  exit 1
fi

echo "==> Python venv (demo backend)..."
sudo -u "${APP_USER}" python3 -m venv "${INSTALL_DIR}/.venv"
sudo -u "${APP_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -U pip
sudo -u "${APP_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/backend/requirements.txt"

echo "==> Python venv (adapter service)..."
sudo -u "${APP_USER}" python3 -m venv "${INSTALL_DIR}/adapter_service/.venv"
sudo -u "${APP_USER}" "${INSTALL_DIR}/adapter_service/.venv/bin/pip" install -U pip
sudo -u "${APP_USER}" "${INSTALL_DIR}/adapter_service/.venv/bin/pip" install \
  -r "${INSTALL_DIR}/adapter_service/requirements.txt"

if [[ ! -f "${INSTALL_DIR}/backend/app/config.py" ]]; then
  echo "==> Creating backend/app/config.py from config_example.py ..."
  cp "${INSTALL_DIR}/backend/app/config_example.py" "${INSTALL_DIR}/backend/app/config.py"
  chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/backend/app/config.py"
  echo "    Edit ${INSTALL_DIR}/backend/app/config.py or /etc/llm-router-demo/env for your lab."
fi

if [[ "${BUILD_FRONTEND}" == "1" ]] && [[ ! -d "${INSTALL_DIR}/frontend/dist" ]]; then
  echo "==> Building frontend..."
  sudo -u "${APP_USER}" bash -c "cd '${INSTALL_DIR}/frontend' && npm ci && npm run build"
elif [[ ! -d "${INSTALL_DIR}/frontend/dist" ]]; then
  echo "WARN: frontend/dist missing. Set BUILD_FRONTEND=1 or commit dist in git." >&2
fi

chmod +x "${INSTALL_DIR}/scripts/run.sh" "${INSTALL_DIR}/scripts/run-adapter.sh"

echo "==> Installing environment files..."
install -d -m 0755 /etc/llm-router-demo /etc/llm-router-adapter
if [[ ! -f /etc/llm-router-demo/env ]]; then
  cp "${INSTALL_DIR}/deploy/systemd/llm-router-demo.env.example" /etc/llm-router-demo/env
  chmod 0640 /etc/llm-router-demo/env
  chown root:"${APP_USER}" /etc/llm-router-demo/env
fi
if [[ ! -f /etc/llm-router-adapter/env ]]; then
  cp "${INSTALL_DIR}/deploy/systemd/llm-router-adapter.env.example" /etc/llm-router-adapter/env
  chmod 0640 /etc/llm-router-adapter/env
  chown root:"${APP_USER}" /etc/llm-router-adapter/env
fi

echo "==> Installing systemd units..."
sed "s|/home/myf5/llm_router_demo_App|${INSTALL_DIR}|g; s|User=myf5|User=${APP_USER}|g; s|Group=myf5|Group=${APP_USER}|g" \
  "${INSTALL_DIR}/deploy/systemd/llm-router-demo.service" \
  > /etc/systemd/system/llm-router-demo.service
sed "s|/home/myf5/llm_router_demo_App|${INSTALL_DIR}|g; s|User=myf5|User=${APP_USER}|g; s|Group=myf5|Group=${APP_USER}|g" \
  "${INSTALL_DIR}/deploy/systemd/llm-router-adapter.service" \
  > /etc/systemd/system/llm-router-adapter.service

systemctl daemon-reload
systemctl enable llm-router-demo.service llm-router-adapter.service
systemctl restart llm-router-demo.service llm-router-adapter.service

echo ""
echo "============================================================"
echo " Install complete."
echo " Demo UI:    http://$(hostname -I | awk '{print $1}'):8080"
echo " Adapter:    http://127.0.0.1:8090/metrics  (BIG-IP posts to :8090/events)"
echo ""
echo " Edit secrets:  sudo nano /etc/llm-router-demo/env"
echo " Status:        systemctl status llm-router-demo llm-router-adapter"
echo " Logs:          journalctl -u llm-router-demo -f"
echo " Update:        sudo -u ${APP_USER} git -C ${INSTALL_DIR} pull && sudo bash ${INSTALL_DIR}/deploy/ubuntu/install-systemd.sh"
echo "============================================================"
