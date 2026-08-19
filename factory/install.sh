#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/grand-quiz-factory
ENV_FILE=/etc/grand-quiz-factory.env
SERVICE_FILE=/etc/systemd/system/grand-quiz-factory.service
MODEL=qwen3:4b-instruct-2507-q4_K_M

apt-get update
apt-get install -y curl ca-certificates python3 python3-venv python3-pip

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama

sudo -u "${SUDO_USER:-root}" ollama pull "$MODEL" || ollama pull "$MODEL"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/quiz_factory.py" "$INSTALL_DIR/quiz_factory.py"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/grand-quiz-factory.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Grand Quiz HDJ question factory
After=network-online.target ollama.service
Wants=network-online.target
Requires=ollama.service

[Service]
Type=simple
EnvironmentFile=/etc/grand-quiz-factory.env
ExecStart=/opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/quiz_factory.py --daemon
Restart=on-failure
RestartSec=20
Nice=10
WorkingDirectory=/opt/grand-quiz-factory

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo
echo "Installation terminée."
echo "1) Édite $ENV_FILE et remplace FACTORY_TOKEN=CHANGE_ME."
echo "2) Teste : sudo systemctl start grand-quiz-factory"
echo "3) Logs : journalctl -u grand-quiz-factory -f"
echo "4) Puis active au démarrage : sudo systemctl enable grand-quiz-factory"
echo
