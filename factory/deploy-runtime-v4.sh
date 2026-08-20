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
set_env SOURCE_FETCH_LIMIT "3"
set_env SEARCH_RESULT_LIMIT "8"
set_env PAGE_TEXT_LIMIT "3500"
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

# L'identifiant interne est toujours généré par notre code.
text = text.replace(
    "q['id'] = q.get('id') or f'qwen-{int(time.time())}-{i}'",
    "q['id'] = f'qwen-{int(time.time())}-{i}'",
)

start = text.find("def local_finalize(")
end = text.find("\ndef review_text(", start)
if start < 0 or end <= start:
    raise SystemExit("Fonction local_finalize introuvable")

segment = text[start:end]

# Une candidate en entrée = exactement une review en sortie. On contraint aussi le
# pourcentage à un entier 0-100 pour empêcher les sorties 0.75/0.95 ambiguës.
if "final_schema = review_schema()" not in segment:
    schema_anchor = "    evidence['requested_difficulty'] = requested\n"
    schema_block = '''    final_schema = review_schema()
    try:
        reviews_schema = final_schema['properties']['reviews']
        reviews_schema['minItems'] = len(candidates)
        reviews_schema['maxItems'] = len(candidates)
        pct_schema = reviews_schema['items']['properties']['expected_success_pct']
        pct_schema['type'] = 'integer'
        pct_schema['minimum'] = 0
        pct_schema['maximum'] = 100
    except Exception:
        pass
'''
    if schema_anchor not in segment:
        raise SystemExit("Ancre schéma Gemma introuvable")
    segment = segment.replace(schema_anchor, schema_anchor + schema_block, 1)
segment = segment.replace("'format':review_schema(),", "'format':final_schema,", 1)

# Sortie compacte. Avec une seule review, 1500 tokens suffisent normalement ;
# un retry à 2200 reste disponible seulement en cas de troncature.
segment = segment.replace(
    "Retourne uniquement le JSON conforme au schéma.",
    "Retourne uniquement un JSON COMPACT conforme au schéma. EXACTEMENT une review par candidate. "
    "Question <=130 caractères, explication <=220 caractères, topic_key <=80 caractères, "
    "accepted_answers <=4 et clues <=5. Ne recopie jamais le dossier factuel.",
)
segment = segment.replace(
    "'options':{'temperature':0,'num_ctx':8192,'num_predict':1400},",
    "'options':{'temperature':0,'num_ctx':8192,'num_predict':1500},",
)
segment = segment.replace(
    "'options':{'temperature':0,'num_ctx':8192,'num_predict':2200},",
    "'options':{'temperature':0,'num_ctx':8192,'num_predict':1500},",
)
segment = segment.replace("'keep_alive':0,", "'keep_alive':'5m',", 1)
segment = segment.replace("retry_payload['options']['num_predict'] = 3000", "retry_payload['options']['num_predict'] = 2200")

# Si Gemma atteint malgré tout la limite, une seule seconde tentative plus large est faite.
old_parse = '''    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=900)
    r.raise_for_status()
    reply = r.json()
    content = reply.get('message',{}).get('content','')
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        reason = reply.get('done_reason','inconnu')
        raise RuntimeError(f'Gemma JSON incomplet/invalide (done_reason={reason}, chars={len(content)}): {exc}') from exc
'''
new_parse = '''    def _run_finalizer(call_payload):
        r = session.post(f'{OLLAMA_URL}/api/chat', json=call_payload, timeout=900)
        r.raise_for_status()
        reply = r.json()
        return reply, reply.get('message',{}).get('content','')

    reply, content = _run_finalizer(payload)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        reason = reply.get('done_reason','inconnu')
        if reason == 'length':
            print(f'  Gemma rédacteur : sortie tronquée à {len(content)} caractères → nouvelle tentative compacte', flush=True)
            retry_payload = dict(payload)
            retry_payload['options'] = dict(payload.get('options') or {})
            retry_payload['options']['num_predict'] = 2200
            retry_payload['messages'] = [{
                'role':'user',
                'content': prompt + "\\n\\nATTENTION : la réponse précédente a été tronquée. Réponds beaucoup plus brièvement. JSON uniquement, aucune prose hors JSON, explication maximum 160 caractères."
            }]
            reply, content = _run_finalizer(retry_payload)
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as retry_exc:
                retry_reason = reply.get('done_reason','inconnu')
                raise RuntimeError(f'Gemma JSON encore incomplet/invalide après retry (done_reason={retry_reason}, chars={len(content)}): {retry_exc}') from retry_exc
        else:
            raise RuntimeError(f'Gemma JSON incomplet/invalide (done_reason={reason}, chars={len(content)}): {exc}') from exc
'''
if old_parse in segment:
    segment = segment.replace(old_parse, new_parse, 1)
elif "def _run_finalizer(call_payload):" not in segment:
    raise SystemExit("Bloc parsing Gemma introuvable pour le retry V4")

# Injection du quality gate si elle n'existe pas encore.
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

# Diagnostics du premier Gemma.
old_preliminary = "    preliminary = [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]\n"
new_preliminary = '''    raw_reviews = parsed.get('reviews', []) or []
    if len(raw_reviews) != len(candidates):
        print(
            f'  Gemma rédaction détail [?] : REJET cardinalite_reviews · '
            f'attendu={len(candidates)} · obtenu={len(raw_reviews)}',
            flush=True,
        )
        return []
    preliminary = []
    for idx, raw_item in enumerate(raw_reviews):
        if not isinstance(raw_item, dict):
            print(f'  Gemma rédaction détail [?] : REJET sortie_non_objet', flush=True)
            continue
        candidate_id = str((candidates[idx] if idx < len(candidates) else {}).get('id') or raw_item.get('id') or '?')
        if raw_item.get('approved') is not True:
            print(
                f'  Gemma rédaction détail [{candidate_id}] : REJET redacteur_refuse · '
                f'pct={raw_item.get("expected_success_pct")} · qualité={raw_item.get("quality_score")} · '
                f'question={str(raw_item.get("question") or "")[:220]}',
                flush=True,
            )
            continue
        q = normalize_review(raw_item, category, evidence)
        if q is None:
            print(
                f'  Gemma rédaction détail [{candidate_id}] : REJET normalisation · '
                f'pct={raw_item.get("expected_success_pct")} · qualité={raw_item.get("quality_score")} · '
                f'type={raw_item.get("type")} · question={str(raw_item.get("question") or "")[:220]}',
                flush=True,
            )
            continue
        q['id'] = candidate_id
        preliminary.append(q)
'''
if old_preliminary in segment:
    segment = segment.replace(old_preliminary, new_preliminary, 1)
elif "Gemma rédaction détail" in segment:
    if "REJET cardinalite_reviews" not in segment:
        anchor = "    raw_reviews = parsed.get('reviews', []) or []\n"
        cardinality = '''    if len(raw_reviews) != len(candidates):
        print(
            f'  Gemma rédaction détail [?] : REJET cardinalite_reviews · '
            f'attendu={len(candidates)} · obtenu={len(raw_reviews)}',
            flush=True,
        )
        return []
'''
        if anchor not in segment:
            raise SystemExit("Ancre raw_reviews introuvable")
        segment = segment.replace(anchor, anchor + cardinality, 1)
else:
    raise SystemExit("Bloc preliminary introuvable pour les diagnostics V4")

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
echo "- contexte Web : 8 résultats max · 3 pages lues · 3500 caractères/page"
echo "- secours : Tavily Basic si une clé gratuite est configurée"
echo "- minimum : 2 domaines Web distincts"
echo "- rédaction finale : Gemma 3 local · exactement 1 review/candidate · pct entier 0-100"
echo "- performance : Gemma conservé en mémoire entre rédaction et contrôle adversarial"
echo "- retry : 2200 tokens uniquement si JSON tronqué"
echo "- diagnostics : rejets du rédacteur ET quality gate visibles"
echo "- identifiants : générés localement, jamais acceptés depuis le modèle"
echo "- Groq/Gemini Search absents du chemin texte gratuit normal"
echo
