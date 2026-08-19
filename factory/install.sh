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
# Une question par requête : Compound Mini n'effectue qu'un appel d'outil,
# ce qui évite les cascades de recherches de Compound complet sur le Free Plan.
# 1500 tokens suffisent pour un dossier factuel et la validation d'une question.
sed -i "s/'max_completion_tokens': 12000/'max_completion_tokens': 1500/g" "$INSTALL_DIR/quiz_factory.py"
# Pour la recherche documentaire, un seul web_search est voulu. Compound Mini
# est volontairement empêché de lancer une visite de site supplémentaire.
sed -i "s/\['web_search','visit_website'\]/['web_search']/g" "$INSTALL_DIR/quiz_factory.py"

# Groq renvoie search_results sous la forme {"results": [...]}. Certaines
# versions/SDK peuvent aussi exposer directement une liste. Le parseur initial
# traitait le dictionnaire comme une liste et finissait par appeler .get() sur
# la chaîne "results". On accepte les deux formats et on ignore proprement les
# valeurs inattendues.
python3 - "$INSTALL_DIR/quiz_factory.py" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
old = """    sources = []
    for tool in msg.get('executed_tools') or []:
        for sr in tool.get('search_results') or []:
            url = sr.get('url') or sr.get('link')
            if url and not any(x.get('url') == url for x in sources):
                sources.append({'source':'Groq web search','title':str(sr.get('title') or '')[:180], 'url':url})
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound'}
"""
new = """    sources = []
    for tool in msg.get('executed_tools') or []:
        if not isinstance(tool, dict):
            continue
        raw_results = tool.get('search_results')
        if isinstance(raw_results, dict):
            results = raw_results.get('results') or []
        elif isinstance(raw_results, list):
            results = raw_results
        else:
            results = []
        for sr in results:
            if not isinstance(sr, dict):
                continue
            url = sr.get('url') or sr.get('link')
            if url and not any(x.get('url') == url for x in sources):
                sources.append({'source':'Groq web search','title':str(sr.get('title') or '')[:180], 'url':url})
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound-mini'}
"""
if old not in text:
    raise SystemExit('Bloc Groq à corriger introuvable dans quiz_factory.py')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
PY

cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/grand-quiz-factory.env.example" "$ENV_FILE"
else
  grep -q '^LOCAL_REVIEW_MODEL=' "$ENV_FILE" || echo 'LOCAL_REVIEW_MODEL=gemma3:4b' >> "$ENV_FILE"
  grep -q '^GROQ_API_KEY=' "$ENV_FILE" || echo 'GROQ_API_KEY=' >> "$ENV_FILE"
  grep -q '^GROQ_RESEARCH_MODEL=' "$ENV_FILE" || echo 'GROQ_RESEARCH_MODEL=groq/compound-mini' >> "$ENV_FILE"
  grep -q '^GROQ_REVIEW_MODEL=' "$ENV_FILE" || echo 'GROQ_REVIEW_MODEL=openai/gpt-oss-120b' >> "$ENV_FILE"
  grep -q '^GROQ_COOLDOWN_SECONDS=' "$ENV_FILE" || echo 'GROQ_COOLDOWN_SECONDS=60' >> "$ENV_FILE"
fi
# Valeurs imposées pour une production stable sur le Free Plan. Les secrets
# FACTORY_TOKEN et GROQ_API_KEY existants ne sont jamais remplacés.
if grep -q '^BATCH_SIZE=' "$ENV_FILE"; then
  sed -i 's/^BATCH_SIZE=.*/BATCH_SIZE=1/' "$ENV_FILE"
else
  echo 'BATCH_SIZE=1' >> "$ENV_FILE"
fi
if grep -q '^GROQ_RESEARCH_MODEL=' "$ENV_FILE"; then
  sed -i 's#^GROQ_RESEARCH_MODEL=.*#GROQ_RESEARCH_MODEL=groq/compound-mini#' "$ENV_FILE"
else
  echo 'GROQ_RESEARCH_MODEL=groq/compound-mini' >> "$ENV_FILE"
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
echo "Groq recherche : groq/compound-mini · 1 question · web_search uniquement · sortie max 1500 tokens"
echo "Groq validation : openai/gpt-oss-120b · 1 question · sortie max 1500 tokens"
echo "Parseur des sources Groq : compatible search_results.results"
echo "Cooldown Groq transitoire : 60 s minimum"
echo "Les clés FACTORY_TOKEN et GROQ_API_KEY existantes sont conservées."
echo "Test : charge l'environnement puis lance /opt/grand-quiz-factory/quiz_factory.py --once"
echo "Logs : journalctl -u grand-quiz-factory -f"
echo
