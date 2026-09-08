#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/grand-quiz-factory
ENV=/etc/grand-quiz-factory.env

echo '===== SERVICES ====='
for unit in grand-quiz-fact-factory.service grand-quiz-quality-auditor.service ollama-tunnel.service local-ai-router.service; do
  echo
  echo "--- $unit ---"
  systemctl cat "$unit" 2>/dev/null || true
  systemctl is-active "$unit" 2>/dev/null || true
done

echo
echo '===== ENV MODELES / ROUTAGE (aucun secret) ====='
if [ -f "$ENV" ]; then
  grep -E '^(OLLAMA_URL|OLLAMA_MODEL|FAST_MODEL|QUALITY_MODEL|LOCAL_REVIEW_MODEL|AUTHOR_MODEL|REVIEW_MODEL|RECOVERY_MODEL|BATCH_SIZE|SLEEP_SECONDS|TARGET_[A-Z0-9_]+|FACT_[A-Z0-9_]+|QCM_[A-Z0-9_]+|GEMMA_[A-Z0-9_]+|ROUTER_[A-Z0-9_]+|SEARXNG_URL)=' "$ENV" 2>/dev/null || true
else
  echo "$ENV absent"
fi

echo
echo '===== FICHIERS ====='
for f in quiz_factory.py fact_factory_v5.py quiz_quality_auditor.py; do
  if [ -f "$BASE/$f" ]; then
    stat -c '%n | %s octets | %y' "$BASE/$f"
    sha256sum "$BASE/$f"
  else
    echo "$BASE/$f : absent"
  fi
done

echo
echo '===== APPELS MODELES / PIPELINE ====='
for f in quiz_factory.py fact_factory_v5.py quiz_quality_auditor.py; do
  [ -f "$BASE/$f" ] || continue
  echo
  echo "--- $f ---"
  grep -nEi -C 3 'qwen|gemma|ollama|FAST_MODEL|QUALITY_MODEL|AUTHOR_MODEL|REVIEW_MODEL|generate|fact.card|fact_card|audit|rpc\(|/api/chat|router|model' "$BASE/$f" | head -n 900 || true
done
