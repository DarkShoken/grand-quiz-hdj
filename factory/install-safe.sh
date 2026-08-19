#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_INSTALL="$SCRIPT_DIR/install.sh"
QUALITY_GUARD="$SCRIPT_DIR/quality_guard.py"
AUTHOR_MODEL=qwen3:4b-instruct-2507-q4_K_M
REVIEW_MODEL=gemma3:4b

if [ ! -f "$BASE_INSTALL" ]; then
  echo "install.sh introuvable dans $SCRIPT_DIR" >&2
  exit 1
fi
if [ ! -f "$QUALITY_GUARD" ]; then
  echo "quality_guard.py introuvable dans $SCRIPT_DIR" >&2
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama absent : install.sh va l'installer, puis les modèles seront téléchargés si nécessaire."
  exec bash "$BASE_INSTALL"
fi

systemctl enable --now ollama >/dev/null 2>&1 || true

model_present() {
  local model="$1"
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$model"
}

for model in "$AUTHOR_MODEL" "$REVIEW_MODEL"; do
  if model_present "$model"; then
    echo "✓ Modèle déjà présent : $model — aucun téléchargement"
  else
    echo "Modèle absent : $model — téléchargement nécessaire"
    if ! ollama pull "$model"; then
      echo "ERREUR : impossible de télécharger $model et il n'est pas disponible localement." >&2
      exit 1
    fi
  fi
done

# On exécute une copie temporaire de l'installateur dans le même dossier afin que
# SCRIPT_DIR reste correct. Cette copie ne retélécharge pas les modèles déjà présents
# et conserve le correctif d'échappement du séparateur CANDIDATE.
TMP="$(mktemp "$SCRIPT_DIR/.install-safe.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

python3 - "$BASE_INSTALL" "$TMP" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text(encoding='utf-8')
src = src.replace(
    '"\\nCANDIDATE :\\n"',
    '"\\\\nCANDIDATE :\\\\n"',
)

lines = []
for line in src.splitlines():
    if 'ollama pull "$AUTHOR_MODEL"' in line:
        continue
    if 'ollama pull "$REVIEW_MODEL"' in line:
        continue
    lines.append(line)

Path(sys.argv[2]).write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY

chmod +x "$TMP"
bash -n "$TMP"
bash "$TMP"

# Deuxième barrière locale, indépendante du rédacteur Gemma :
# - au moins deux domaines non sociaux pour les questions texte ;
# - cohérence réelle du type intrus ;
# - nouvelle résolution aveugle de la question finale ;
# - pour QCM/intrus, examen séparé des 4 options et une seule défendable.
cp "$QUALITY_GUARD" /opt/grand-quiz-factory/quality_guard.py

python3 - /opt/grand-quiz-factory/quiz_factory.py <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

import_line = 'from quality_guard import adversarial_review\n'
if import_line not in text:
    marker = 'import requests\n'
    if marker not in text:
        raise SystemExit('Import requests introuvable dans quiz_factory.py')
    text = text.replace(marker, marker + import_line, 1)

start = text.find('def local_finalize(')
end = text.find('\ndef review_text(', start)
if start < 0 or end <= start:
    raise SystemExit('Fonction local_finalize introuvable pour le quality gate')

segment = text[start:end]
old = "    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]\n"
new = """    preliminary = [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]
    accepted = []
    for q in preliminary:
        if adversarial_review(q, evidence, OLLAMA_URL, LOCAL_REVIEW_MODEL, session):
            accepted.append(q)
        else:
            print(f'  Quality gate adversarial : rejet de {q.get(\"id\", \"?\")}', flush=True)
    return accepted
"""
if old not in segment:
    if 'adversarial_review(q, evidence' not in segment:
        raise SystemExit('Retour local_finalize introuvable pour le quality gate')
else:
    segment = segment.replace(old, new, 1)
    text = text[:start] + segment + text[end:]

path.write_text(text, encoding='utf-8')
PY

python3 -m py_compile /opt/grand-quiz-factory/quality_guard.py
python3 -m py_compile /opt/grand-quiz-factory/quiz_factory.py

echo
echo "Quality gate adversarial installé :"
echo "- double validation Gemma locale"
echo "- résolution finale aveugle"
echo "- QCM/intrus : une seule option défendable"
echo "- questions texte : au moins 2 domaines non sociaux"
echo "- contrôle structurel du type intrus"
echo