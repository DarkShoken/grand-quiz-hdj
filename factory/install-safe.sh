#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_INSTALL="$SCRIPT_DIR/install.sh"
RUNTIME_DEPLOY="$SCRIPT_DIR/deploy-runtime-v4.sh"
AUTHOR_MODEL=qwen3:4b-instruct-2507-q4_K_M
REVIEW_MODEL=gemma3:4b

for f in "$BASE_INSTALL" "$RUNTIME_DEPLOY" "$SCRIPT_DIR/quality_guard.py" "$SCRIPT_DIR/research_provider.py"; do
  if [ ! -f "$f" ]; then
    echo "Fichier requis introuvable : $f" >&2
    exit 1
  fi
done

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama absent : install.sh va l'installer."
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
    ollama pull "$model"
  fi
done

# install.sh reste la source de la V3. On en exécute une copie temporaire
# uniquement pour neutraliser les re-pulls et préserver le correctif d'échappement.
TMP="$(mktemp "$SCRIPT_DIR/.install-safe.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

python3 - "$BASE_INSTALL" "$TMP" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text(encoding="utf-8")
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

Path(sys.argv[2]).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

chmod +x "$TMP"
bash -n "$TMP"
bash "$TMP"

# Une seule étape runtime centralisée pour qualité + recherche V4.
bash "$RUNTIME_DEPLOY"
