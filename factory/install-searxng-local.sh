#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

ROOT=/opt/grand-quiz-searxng
CONFIG="$ROOT/config"
DATA="$ROOT/data"
CONTAINER=grand-quiz-searxng
IMAGE=ghcr.io/searxng/searxng:latest
ENV_FILE=/etc/grand-quiz-factory.env

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker absent : installation de docker.io..."
  apt-get update
  apt-get install -y docker.io
fi

systemctl enable --now docker

mkdir -p "$CONFIG" "$DATA"
chmod 755 "$ROOT" "$CONFIG" "$DATA"

SECRET="$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid | tr -d '-')"

cat > "$CONFIG/settings.yml" <<EOF
use_default_settings: true

general:
  debug: false
  instance_name: "Grand Quiz HDJ Research"

search:
  safe_search: 1
  default_lang: "fr"
  formats:
    - html
    - json

server:
  secret_key: "$SECRET"
  limiter: false
  image_proxy: false
  public_instance: false
EOF

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null
fi

echo "Téléchargement / mise à jour de SearXNG..."
docker pull "$IMAGE"

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p 127.0.0.1:8888:8080 \
  -v "$CONFIG:/etc/searxng" \
  -v "$DATA:/var/cache/searxng" \
  "$IMAGE" >/dev/null

echo "Attente du démarrage SearXNG..."
ok=0
for _ in $(seq 1 30); do
  if curl -fsS 'http://127.0.0.1:8888/search?q=Lune&format=json&language=fr-FR' \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("results"), list)' \
      >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "ERREUR : SearXNG ne répond pas correctement." >&2
  echo "Derniers logs :" >&2
  docker logs --tail 80 "$CONTAINER" >&2 || true
  exit 1
fi

touch "$ENV_FILE"
if grep -q '^SEARXNG_URL=' "$ENV_FILE"; then
  sed -i 's#^SEARXNG_URL=.*#SEARXNG_URL=http://127.0.0.1:8888#' "$ENV_FILE"
else
  echo 'SEARXNG_URL=http://127.0.0.1:8888' >> "$ENV_FILE"
fi

if grep -q '^GEMINI_RESEARCH_MODEL=' "$ENV_FILE"; then
  sed -i 's#^GEMINI_RESEARCH_MODEL=.*#GEMINI_RESEARCH_MODEL=gemini-3.5-flash-lite#' "$ENV_FILE"
else
  echo 'GEMINI_RESEARCH_MODEL=gemini-3.5-flash-lite' >> "$ENV_FILE"
fi

if grep -q '^GEMINI_GOOGLE_SEARCH_ENABLED=' "$ENV_FILE"; then
  sed -i 's#^GEMINI_GOOGLE_SEARCH_ENABLED=.*#GEMINI_GOOGLE_SEARCH_ENABLED=0#' "$ENV_FILE"
else
  echo 'GEMINI_GOOGLE_SEARCH_ENABLED=0' >> "$ENV_FILE"
fi

echo
echo "SearXNG local installé :"
echo "- URL : http://127.0.0.1:8888"
echo "- exposition réseau : localhost uniquement"
echo "- API JSON : activée"
echo "- redémarrage automatique : activé"
echo "- Google Gemini Search : désactivé en mode gratuit"
echo
