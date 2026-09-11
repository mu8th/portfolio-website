#!/usr/bin/env bash
# Bootstrap the portfolio site on a fresh Oracle Cloud Always Free Ubuntu VM.
#
# Run as root (or with sudo). Idempotent: re-running it pulls the latest code,
# refreshes dependencies and restarts the services.
#
# Prerequisite: all five repositories must be PUBLIC on GitHub before this
# script runs (it clones them without authentication).
set -euo pipefail

if [ "$(id -u)" != 0 ]; then
  echo "ERROR: run as root (sudo $0)" >&2
  exit 1
fi

GH_USER="mu8th"
BASE="/opt/portfolio"
REPOS=(portfolio-website api-contract-tester performance-profiler vulnerability-scanner code-rag)

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg python3 >/dev/null

echo "==> Installing uv (Python package manager)"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv || echo /root/.local/bin/uv)"

echo "==> Installing Caddy (reverse proxy + TLS)"
if ! command -v caddy >/dev/null 2>&1; then
  if apt-get install -y -qq caddy >/dev/null 2>&1; then
    echo "    installed from Ubuntu repositories"
  else
    # Fallback: official static binary (any release, any arch)
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" -o /usr/local/bin/caddy
    chmod 0755 /usr/local/bin/caddy
    install -m 0755 -d /etc/caddy
    cat > /etc/systemd/system/caddy.service <<'CADDYUNIT'
[Unit]
Description=Caddy Web Server
After=network.target network-online.target
Wants=network-online.target

[Service]
User=root
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
Restart=on-failure
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
CADDYUNIT
    echo "    installed official binary (apt package unavailable)"
  fi
fi

echo "==> Cloning repositories (must be public)"
mkdir -p "$BASE"
for r in "${REPOS[@]}"; do
  d="$BASE/$r"
  if [ -d "$d/.git" ]; then
    echo "    $r: exists, pulling latest"
    git -C "$d" pull --ff-only || echo "    WARNING: pull failed for $r, keeping existing checkout"
  else
    echo "    $r: cloning"
    git clone --quiet "https://github.com/${GH_USER}/${r}.git" "$d" \
      || { echo "ERROR: could not clone ${GH_USER}/${r}. Is the repository public?" >&2; exit 1; }
  fi
done

echo "==> Creating virtual environments and installing dependencies"
"$UV" venv --allow-existing "$BASE/venvs/portfolio" >/dev/null
"$UV" pip install --quiet --python "$BASE/venvs/portfolio/bin/python" \
  fastapi "uvicorn[standard]" pyyaml
"$UV" venv --allow-existing "$BASE/venvs/coderag" >/dev/null
"$UV" pip install --quiet --python "$BASE/venvs/coderag/bin/python" \
  fastapi "uvicorn[standard]" numpy

echo "==> Writing systemd units"
cat > /etc/systemd/system/portfolio.service <<'UNIT'
[Unit]
Description=Portfolio website backend (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/portfolio/portfolio-website
Environment=PORTFOLIO_SERVER_DIR=/opt/portfolio
ExecStart=/opt/portfolio/venvs/portfolio/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8085
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/coderag.service <<'UNIT'
[Unit]
Description=Code-RAG demo server (simulation mode, no models)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/portfolio/code-rag
Environment=RAG_SIMULATE=1
Environment=RAG_ROOT=/opt/portfolio
ExecStart=/opt/portfolio/venvs/coderag/bin/python -m uvicorn coderag.main:app --host 127.0.0.1 --port 8090
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

echo "==> Writing Caddyfile (HTTP on :80 -> backend on 127.0.0.1:8085)"
cat > /etc/caddy/Caddyfile <<'CADDY'
:80 {
	reverse_proxy 127.0.0.1:8085
}
CADDY

echo "==> Starting services"
systemctl daemon-reload
systemctl enable --now caddy portfolio coderag

sleep 3
echo ""
echo "==> Service status"
for s in caddy portfolio coderag; do
  printf "    %-10s %s\n" "$s:" "$(systemctl is-active "$s")"
done

echo ""
echo "==> Smoke test through Caddy"
curl -fsS http://127.0.0.1/api/health && echo "" || echo "WARNING: /api/health failed, check 'journalctl -u portfolio'"

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
echo ""
echo "============================================================"
echo " Done. Open the site at:  http://${PUBLIC_IP:-<your VM public IP>}/"
echo " Logs:  journalctl -u portfolio -f   |   journalctl -u coderag -f"
echo " Update later: re-run this script (it is idempotent)."
echo "============================================================"
