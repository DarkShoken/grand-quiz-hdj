#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/grand-quiz-factory
TARGET="$INSTALL_DIR/quiz_factory.py"
ENV_FILE=/etc/grand-quiz-factory.env

for f in "$SCRIPT_DIR/quality_guard.py" "$SCRIPT_DIR/research_provider.py"; do
  if [ ! -f "$f" ]; then
    echo "Fichier requis introuvable : $f" >&2
    exit 1
  fi
done

if [ ! -f "$TARGET" ]; then
  echo "$TARGET introuvable. Lance d'abord factory/install-safe.sh." >&2
  exit 1
fi

touch "$ENV_FILE"
ensure_env() {
  local key="$1" value="$2"
  grep -q "^${key}=" "$ENV_FILE" || printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_env TAVILY_API_KEY ""
set_env SEARXNG_URL "http://127.0.0.1:8888"
set_env MIN_SOURCE_DOMAINS "2"
set_env SOURCE_FETCH_LIMIT "4"
ensure_env GEMINI_API_KEY ""
set_env GEMINI_RESEARCH_MODEL "gemini-3.5-flash-lite"
set_env GEMINI_GOOGLE_SEARCH_ENABLED "0"

cp "$SCRIPT_DIR/quality_guard.py" "$INSTALL_DIR/quality_guard.py"
cp "$SCRIPT_DIR/research_provider.py" "$INSTALL_DIR/research_provider.py"

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

marker = "import requests\n"
if marker not in text:
    raise SystemExit("Import requests introuvable dans quiz_factory.py")

for import_line in (
    "from quality_guard import adversarial_review\n",
    "from research_provider import research_web, ResearchUnavailable\n",
):
    if import_line not in text:
        text = text.replace(marker, marker + import_line, 1)

start = text.find("def local_finalize(")
end = text.find("\ndef review_text(", start)
if start < 0 or end <= start:
    raise SystemExit("Fonction local_finalize introuvable")

segment = text[start:end]
if "adversarial_review(q, evidence" not in segment:
    marker_return = "    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]"
    pos = segment.rfind(marker_return)
    if pos < 0:
        raise SystemExit("Retour local_finalize introuvable pour le quality gate")

    replacement = '''    preliminary = [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]
    accepted = []
    for q in preliminary:
        if adversarial_review(q, evidence, OLLAMA_URL, LOCAL_REVIEW_MODEL, session):
            accepted.append(q)
        else:
            print(f'  Quality gate adversarial : rejet de {q.get("id", "?")}', flush=True)
    return accepted'''
    segment = segment[:pos] + replacement + segment[pos + len(marker_return):]
    text = text[:start] + segment + text[end:]

start = text.find("def review_text(")
end = text.find("\ndef commons_image(", start)
if start < 0 or end <= start:
    raise SystemExit("Fonction review_text introuvable")

new_review = '''def review_text(category, candidates):
    try:
        evidence = research_web(blind_candidates(candidates), session)
    except ResearchUnavailable as exc:
        print(f'  Recherche Web indisponible : {exc}', flush=True)
        return []

    reviewed = local_finalize(category, candidates, evidence)
    print(
        f'  Vérification {evidence.get("provider", "Web")} + Gemma local : '
        f'{len(reviewed)}/{len(candidates)} retenues · '
        f'{len(evidence.get("sources") or [])} sources',
        flush=True,
    )
    return reviewed
'''

text = text[:start] + new_review.rstrip() + "\n" + text[end + 1:]
path.write_text(text, encoding="utf-8")
PY

python3 -m py_compile "$INSTALL_DIR/quality_guard.py"
python3 -m py_compile "$INSTALL_DIR/research_provider.py"
python3 -m py_compile "$TARGET"

echo
echo "Runtime V4 gratuit installé :"
echo "- recherche principale : SearXNG local"
echo "- lecture directe : jusqu'à 4 pages sources par candidate"
echo "- secours : Tavily Basic si une clé gratuite est configurée"
echo "- Gemini 3.5 Flash-Lite conservé optionnel ; Google Search désactivé en Free Tier"
echo "- minimum : 2 domaines Web distincts"
echo "- rédaction finale : Gemma 3 local"
echo "- contrôle adversarial + difficulté : Gemma 3 local"
echo "- Groq n'est plus utilisé dans le chemin texte normal"
echo
