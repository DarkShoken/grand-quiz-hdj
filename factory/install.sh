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
AUTHOR_MODEL=qwen3:4b-instruct-2507-q4_K_M
REVIEW_MODEL=gemma3:4b

apt-get update
apt-get install -y curl ca-certificates python3 python3-venv python3-pip

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama

sudo -u "${SUDO_USER:-root}" ollama pull "$AUTHOR_MODEL" || ollama pull "$AUTHOR_MODEL"
sudo -u "${SUDO_USER:-root}" ollama pull "$REVIEW_MODEL" || ollama pull "$REVIEW_MODEL"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/quiz_factory_v2.py" "$INSTALL_DIR/quiz_factory.py"
# Le Free Plan Groq est bien plus stable avec de petits lots : Compound peut
# orchestrer plusieurs appels internes, et GPT-OSS 120B est limité à 8K TPM.
# 2500 tokens de sortie suffisent largement pour rechercher/finaliser 3 questions.
sed -i "s/'max_completion_tokens': 12000/'max_completion_tokens': 2500/g" "$INSTALL_DIR/quiz_factory.py"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/grand-quiz-factory.env.example" "$ENV_FILE"
else
  grep -q '^LOCAL_REVIEW_MODEL=' "$ENV_FILE" || echo 'LOCAL_REVIEW_MODEL=gemma3:4b' >> "$ENV_FILE"
  grep -q '^GROQ_API_KEY=' "$ENV_FILE" || echo 'GROQ_API_KEY=' >> "$ENV_FILE"
  grep -q '^GROQ_RESEARCH_MODEL=' "$ENV_FILE" || echo 'GROQ_RESEARCH_MODEL=groq/compound' >> "$ENV_FILE"
  grep -q '^GROQ_REVIEW_MODEL=' "$ENV_FILE" || echo 'GROQ_REVIEW_MODEL=openai/gpt-oss-120b' >> "$ENV_FILE"
  grep -q '^GROQ_COOLDOWN_SECONDS=' "$ENV_FILE" || echo 'GROQ_COOLDOWN_SECONDS=60' >> "$ENV_FILE"
fi
# Valeurs volontairement imposées pour rester confortablement dans les limites
# gratuites. Les secrets et autres réglages existants sont conservés.
if grep -q '^BATCH_SIZE=' "$ENV_FILE"; then
  sed -i 's/^BATCH_SIZE=.*/BATCH_SIZE=3/' "$ENV_FILE"
else
  echo 'BATCH_SIZE=3' >> "$ENV_FILE"
fi
if grep -q '^GROQ_COOLDOWN_SECONDS=' "$ENV_FILE"; then
  sed -i 's/^GROQ_COOLDOWN_SECONDS=.*/GROQ_COOLDOWN_SECONDS=60/' "$ENV_FILE"
else
  echo 'GROQ_COOLDOWN_SECONDS=60' >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Grand Quiz HDJ question factory v2
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
echo "Installation / mise à jour terminée."
echo "Auteur local : $AUTHOR_MODEL"
echo "Secours local : $REVIEW_MODEL"
echo "Groq recherche : groq/compound · lots de 3 · sortie max 2500 tokens"
echo "Groq validation : openai/gpt-oss-120b · sortie max 2500 tokens"
echo "Cooldown Groq transitoire : 60 s minimum"
echo "Les clés FACTORY_TOKEN et GROQ_API_KEY existantes sont conservées."
echo "Test : charge l'environnement puis lance /opt/grand-quiz-factory/quiz_factory.py --once"
echo "Logs : journalctl -u grand-quiz-factory -f"
echo
