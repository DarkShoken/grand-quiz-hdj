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

for f in \
  "$SCRIPT_DIR/quality_guard.py" \
  "$SCRIPT_DIR/research_provider.py" \
  "$SCRIPT_DIR/gemini_editor.py"; do
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

# Recherche Web gratuite locale.
ensure_env TAVILY_API_KEY ""
set_env SEARXNG_URL "http://127.0.0.1:8888"
set_env MIN_SOURCE_DOMAINS "2"
set_env SOURCE_FETCH_LIMIT "3"
set_env SEARCH_RESULT_LIMIT "8"
set_env PAGE_TEXT_LIMIT "3500"

# Gemini n'effectue AUCUNE recherche Web : rédaction puis précontrôle rapides.
ensure_env GEMINI_API_KEY ""
set_env GEMINI_EDITOR_ENABLED "1"
set_env GEMINI_EDITOR_MODEL "gemini-3.1-flash-lite"
set_env GEMINI_PRECHECK_MODEL "gemini-3.5-flash-lite"
set_env GEMINI_RESEARCH_MODEL "gemini-3.5-flash-lite"
set_env GEMINI_GOOGLE_SEARCH_ENABLED "0"

cp "$SCRIPT_DIR/quality_guard.py" "$INSTALL_DIR/quality_guard.py"
cp "$SCRIPT_DIR/research_provider.py" "$INSTALL_DIR/research_provider.py"
cp "$SCRIPT_DIR/gemini_editor.py" "$INSTALL_DIR/gemini_editor.py"

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

marker = "import requests\n"
if marker not in text:
    raise SystemExit("Import requests introuvable dans quiz_factory.py")

imports = (
    "from quality_guard import adversarial_review\n",
    "from research_provider import research_web, ResearchUnavailable\n",
    "from gemini_editor import finalize_with_gemini, GeminiEditorUnavailable\n",
)
for import_line in imports:
    if import_line not in text:
        text = text.replace(marker, marker + import_line, 1)

# L'identifiant interne est toujours généré localement.
text = text.replace(
    "q['id'] = q.get('id') or f'qwen-{int(time.time())}-{i}'",
    "q['id'] = f'qwen-{int(time.time())}-{i}'",
)

# Le chemin média/fallback local conserve lui aussi le garde adversarial.
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

# Chemin texte V4.2 : SearXNG -> Gemini 3.1 éditeur -> Gemini 3.5 précontrôle -> Gemma final seulement si prometteur.
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

    try:
        reviewed = finalize_with_gemini(
            category,
            candidates,
            evidence,
            review_schema,
            normalize_review,
            adversarial_review,
            OLLAMA_URL,
            LOCAL_REVIEW_MODEL,
            session,
        )
    except GeminiEditorUnavailable as exc:
        print(f'  Gemini rédacteur indisponible : {exc} · candidate rejetée', flush=True)
        return []

    print(
        f'  Vérification {evidence.get("provider", "Web")} + Gemini 3.1/3.5 + Gemma final : '
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
python3 -m py_compile "$INSTALL_DIR/gemini_editor.py"
python3 -m py_compile "$TARGET"

echo
echo "Runtime V4.2 gratuit installé :"
echo "- recherche : SearXNG local · 8 résultats max · 3 pages lues"
echo "- rédacteur rapide : Gemini 3.1 Flash-Lite · thinking=minimal · sans Google Search"
echo "- précontrôle rapide : Gemini 3.5 Flash-Lite · difficulté/validité/distracteurs"
echo "- Gemma local : lancé uniquement si les deux contrôles Gemini laissent passer la candidate"
echo "- contrôle final : Gemma 3 local adversarial, une seule passe"
echo "- minimum : 2 domaines Web distincts"
echo "- sécurité : éditeur Gemini indisponible = rejet ; précontrôle indisponible = Gemma final"
echo "- Groq absent du chemin texte normal"
echo
