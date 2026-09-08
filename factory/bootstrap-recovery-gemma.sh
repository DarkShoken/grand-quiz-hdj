#!/usr/bin/env bash
set -euo pipefail

BASE="https://raw.githubusercontent.com/DarkShoken/grand-quiz-hdj/main/factory"
TMP="$(mktemp -d /tmp/grand-quiz-recovery.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

for f in recovery_factory.py category_profiles.py hdj_prefilter.py grand-quiz-recovery-factory.service install-recovery-gemma.sh; do
  echo "Téléchargement : $f"
  curl -fsSL "$BASE/$f" -o "$TMP/$f"
done

chmod +x "$TMP/install-recovery-gemma.sh"
exec "$TMP/install-recovery-gemma.sh"
