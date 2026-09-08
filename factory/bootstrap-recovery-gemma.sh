#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"
BASE="https://raw.githubusercontent.com/DarkShoken/grand-quiz-hdj/main/factory"
TMP="$(mktemp -d /tmp/grand-quiz-recovery.XXXXXX)"
FACT_SERVICE=grand-quiz-fact-factory.service
AUDIT_SERVICE=grand-quiz-quality-auditor.service
FACT_WAS_ACTIVE=0
AUDIT_WAS_ACTIVE=0

cleanup() {
  if [ "$FACT_WAS_ACTIVE" -eq 1 ]; then
    systemctl start "$FACT_SERVICE" >/dev/null 2>&1 || true
  fi
  if [ "$AUDIT_WAS_ACTIVE" -eq 1 ]; then
    systemctl start "$AUDIT_SERVICE" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

for f in recovery_factory.py category_profiles.py hdj_prefilter.py grand-quiz-recovery-factory.service install-recovery-gemma.sh inspect-current-factory.sh; do
  echo "Téléchargement : $f"
  curl -fsSL "$BASE/$f" -o "$TMP/$f"
done

chmod +x "$TMP/install-recovery-gemma.sh" "$TMP/inspect-current-factory.sh"
"$TMP/install-recovery-gemma.sh"

if [ "$MODE" != "--test-once" ]; then
  exit 0
fi

echo
echo "===== TEST RECOVERY SUR UNE QUESTION ====="
if systemctl is-active --quiet "$FACT_SERVICE"; then FACT_WAS_ACTIVE=1; fi
if systemctl is-active --quiet "$AUDIT_SERVICE"; then AUDIT_WAS_ACTIVE=1; fi

# On libère Gemma pendant le test, puis le trap remet exactement les services qui étaient actifs.
[ "$FACT_WAS_ACTIVE" -eq 1 ] && systemctl stop "$FACT_SERVICE"
[ "$AUDIT_WAS_ACTIVE" -eq 1 ] && systemctl stop "$AUDIT_SERVICE"

set -a
# shellcheck disable=SC1091
source /etc/grand-quiz-factory.env
set +a
export OLLAMA_URL=http://127.0.0.1:11435
export RECOVERY_MODEL=gemma4:12b

/opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/recovery_factory.py --status
/opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/recovery_factory.py --once

echo
echo "===== INSPECTION SANITISÉE DE LA FACTORY ACTUELLE ====="
"$TMP/inspect-current-factory.sh"

echo
echo "Le test est terminé. Les services de production qui étaient actifs vont être redémarrés automatiquement."
