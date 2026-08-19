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

# Consolidation V3 : on corrige le script installé en un seul passage Python.
# - BATCH_SIZE=1 est réellement respecté (le code V2 imposait encore un minimum de 2)
# - Compound Mini fait uniquement le web_search, 1500 tokens max
# - parsing robuste de search_results.results
# - GPT-OSS 120B sort du chemin bloquant : Gemma local juge le dossier Groq
# - un 429 affiche désormais les compteurs/réinitialisations utiles
python3 - "$INSTALL_DIR/quiz_factory.py" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "GROQ_RESEARCH_MODEL = os.getenv('GROQ_RESEARCH_MODEL', 'groq/compound')",
        "GROQ_RESEARCH_MODEL = os.getenv('GROQ_RESEARCH_MODEL', 'groq/compound-mini')"
    ),
    (
        "BATCH_SIZE = max(2, min(8, int(os.getenv('BATCH_SIZE', '6'))))",
        "BATCH_SIZE = max(1, min(8, int(os.getenv('BATCH_SIZE', '1'))))"
    ),
    (
        "'compound_custom': {'tools': {'enabled_tools': ['web_search','visit_website']}},",
        "'compound_custom': {'tools': {'enabled_tools': ['web_search']}},"
    ),
    (
        "'max_completion_tokens': 12000,",
        "'max_completion_tokens': 1500,"
    ),
]
for old, new in replacements:
    text = text.replace(old, new)

old_cooldown = '''def mark_groq_cooldown(response=None):
    global groq_disabled_until
    wait = GROQ_COOLDOWN_SECONDS
    if response is not None:
        try:
            wait = max(wait, int(response.headers.get('retry-after','0') or 0))
        except Exception:
            pass
    groq_disabled_until = time.time() + wait
    print(f'  Groq indisponible/quota atteint → secours local pendant ~{wait//60} min', flush=True)
'''
new_cooldown = '''def mark_groq_cooldown(response=None):
    global groq_disabled_until
    wait = GROQ_COOLDOWN_SECONDS
    details = []
    if response is not None:
        try:
            retry = response.headers.get('retry-after','')
            if retry:
                wait = max(wait, int(float(retry)))
        except Exception:
            pass
        for key, label in [
            ('x-ratelimit-remaining-requests','req restantes'),
            ('x-ratelimit-remaining-tokens','tokens restants'),
            ('x-ratelimit-reset-requests','reset req'),
            ('x-ratelimit-reset-tokens','reset tokens'),
        ]:
            value = response.headers.get(key)
            if value:
                details.append(f'{label}={value}')
        try:
            body = response.json()
            message = str((body.get('error') or {}).get('message') or '')[:300]
            if message:
                details.append(f'message={message}')
        except Exception:
            pass
    groq_disabled_until = time.time() + wait
    suffix = (' · ' + ' · '.join(details)) if details else ''
    print(f'  Groq 429 → secours local ~{wait}s{suffix}', flush=True)
'''
if old_cooldown not in text:
    raise SystemExit('Fonction mark_groq_cooldown introuvable')
text = text.replace(old_cooldown, new_cooldown, 1)

old_sources = '''    sources = []
    for tool in msg.get('executed_tools') or []:
        for sr in tool.get('search_results') or []:
            url = sr.get('url') or sr.get('link')
            if url and not any(x.get('url') == url for x in sources):
                sources.append({'source':'Groq web search','title':str(sr.get('title') or '')[:180], 'url':url})
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound'}
'''
new_sources = '''    sources = []
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
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound-mini+gemma3'}
'''
if old_sources not in text:
    raise SystemExit('Bloc de parsing Groq introuvable')
text = text.replace(old_sources, new_sources, 1)

# Le dossier Web est déjà indépendant de Qwen. Gemma le juge localement :
# une seule requête cloud par question, pas de deuxième quota GPT-OSS bloquant.
old_review = '''            evidence = groq_research(candidates)
            reviewed = groq_finalize(category, candidates, evidence)
            print(f'  Vérification Groq : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
            return reviewed
'''
new_review = '''            evidence = groq_research(candidates)
            reviewed = local_finalize(category, candidates, evidence)
            print(f'  Vérification Groq Web + Gemma local : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
            return reviewed
'''
if old_review not in text:
    raise SystemExit('Bloc review_text Groq introuvable')
text = text.replace(old_review, new_review, 1)

old_media = '''    if groq_available():
        try:
            reviewed = groq_finalize(candidate['category'], [candidate], evidence)
        except Exception:
            reviewed = []
    else:
        reviewed = local_finalize(candidate['category'], [candidate], evidence)
'''
new_media = '''    reviewed = local_finalize(candidate['category'], [candidate], evidence)
'''
if old_media not in text:
    raise SystemExit('Bloc review_media introuvable')
text = text.replace(old_media, new_media, 1)

path.write_text(text, encoding='utf-8')
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
  grep -q '^GROQ_COOLDOWN_SECONDS=' "$ENV_FILE" || echo 'GROQ_COOLDOWN_SECONDS=60' >> "$ENV_FILE"
fi

# Réglages de production stables ; les secrets existants ne sont jamais remplacés.
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
Description=Grand Quiz HDJ question factory v3
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
echo "Installation / mise à jour V3 terminée."
echo "Auteur : Qwen3 4B local"
echo "Recherche factuelle : Groq Compound Mini · 1 question · 1 web_search · 1500 tokens max"
echo "Validation finale : Gemma 3 4B local sur le dossier Groq"
echo "Secours sans Groq : Wikipédia + Gemma 3 local"
echo "BATCH_SIZE réellement appliqué : 1"
echo "Les 429 affichent désormais leur cause et les compteurs Groq."
echo "Les clés FACTORY_TOKEN et GROQ_API_KEY existantes sont conservées."
echo
