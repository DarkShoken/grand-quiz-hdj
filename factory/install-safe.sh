#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_INSTALL="$SCRIPT_DIR/install.sh"
AUTHOR_MODEL=qwen3:4b-instruct-2507-q4_K_M
REVIEW_MODEL=gemma3:4b

if [ ! -f "$BASE_INSTALL" ]; then
  echo "install.sh introuvable dans $SCRIPT_DIR" >&2
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

missing=0
for model in "$AUTHOR_MODEL" "$REVIEW_MODEL"; do
  if model_present "$model"; then
    echo "✓ Modèle déjà présent : $model — aucun téléchargement"
  else
    echo "Modèle absent : $model — téléchargement nécessaire"
    if ! ollama pull "$model"; then
      echo "ERREUR : impossible de télécharger $model et il n'est pas disponible localement." >&2
      exit 1
    fi
    missing=1
  fi
done

# install.sh historique force encore deux `ollama pull` à chaque exécution.
# On exécute une copie temporaire dans LE MÊME DOSSIER afin que SCRIPT_DIR reste correct,
# en retirant uniquement ces deux lignes. Tout le reste (py_compile, venv, service, env) est inchangé.
TMP="$(mktemp "$SCRIPT_DIR/.install-safe.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

python3 - "$BASE_INSTALL" "$TMP" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text(encoding='utf-8')
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
bash "$TMP"
