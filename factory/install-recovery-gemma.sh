#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/grand-quiz-factory
ENV_FILE=/etc/grand-quiz-factory.env
UNIT_FILE=/etc/systemd/system/grand-quiz-recovery-factory.service
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/opt/grand-quiz-factory.backup-recovery-${STAMP}"

for f in recovery_factory.py category_profiles.py hdj_prefilter.py grand-quiz-recovery-factory.service; do
  if [ ! -f "$SCRIPT_DIR/$f" ]; then
    echo "Fichier requis introuvable : $SCRIPT_DIR/$f" >&2
    exit 1
  fi
done

if [ ! -d "$INSTALL_DIR" ]; then
  echo "$INSTALL_DIR introuvable : la factory existante doit rester en place." >&2
  exit 1
fi
if [ ! -f "$INSTALL_DIR/quiz_factory.py" ]; then
  echo "$INSTALL_DIR/quiz_factory.py introuvable : abandon pour ne rien casser." >&2
  exit 1
fi
if [ ! -x "$INSTALL_DIR/venv/bin/python" ]; then
  echo "$INSTALL_DIR/venv/bin/python introuvable : abandon." >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE introuvable : abandon." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
for f in recovery_factory.py category_profiles.py hdj_prefilter.py; do
  [ -f "$INSTALL_DIR/$f" ] && cp -a "$INSTALL_DIR/$f" "$BACKUP_DIR/$f"
done
[ -f "$UNIT_FILE" ] && cp -a "$UNIT_FILE" "$BACKUP_DIR/grand-quiz-recovery-factory.service"
cp -a "$ENV_FILE" "$BACKUP_DIR/grand-quiz-factory.env"

echo "Sauvegarde : $BACKUP_DIR"

install -m 0755 "$SCRIPT_DIR/recovery_factory.py" "$INSTALL_DIR/recovery_factory.py"
install -m 0644 "$SCRIPT_DIR/category_profiles.py" "$INSTALL_DIR/category_profiles.py"
install -m 0644 "$SCRIPT_DIR/hdj_prefilter.py" "$INSTALL_DIR/hdj_prefilter.py"
install -m 0644 "$SCRIPT_DIR/grand-quiz-recovery-factory.service" "$UNIT_FILE"

# Variables dédiées à Recovery uniquement. Les services existants ne sont pas redémarrés.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
set_env RECOVERY_MODEL "gemma4:12b"
set_env RECOVERY_NUM_CTX "8192"
set_env RECOVERY_KEEP_ALIVE "15m"
set_env RECOVERY_SLEEP_SECONDS "180"

"$INSTALL_DIR/venv/bin/python" -m py_compile \
  "$INSTALL_DIR/recovery_factory.py" \
  "$INSTALL_DIR/category_profiles.py" \
  "$INSTALL_DIR/hdj_prefilter.py"

systemctl daemon-reload

# Sécurité : le nouveau daemon est installé mais PAS activé ni démarré.
systemctl disable grand-quiz-recovery-factory.service >/dev/null 2>&1 || true

echo
echo "✓ Recovery Factory Gemma-only installée sans toucher aux services de production."
echo "✓ Aucun redémarrage de grand-quiz-fact-factory ni du quality-auditor."
echo "✓ Service Recovery laissé désactivé pour le premier test manuel."
echo
echo "Test statut :"
echo "  sudo bash -c 'set -a; source /etc/grand-quiz-factory.env; set +a; /opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/recovery_factory.py --status'"
echo
echo "Premier test sur UNE question (à faire après avoir stoppé temporairement la fact-factory) :"
echo "  sudo systemctl stop grand-quiz-fact-factory.service"
echo "  sudo bash -c 'set -a; source /etc/grand-quiz-factory.env; set +a; /opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/recovery_factory.py --once'"
echo "  sudo systemctl start grand-quiz-fact-factory.service"
