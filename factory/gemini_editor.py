#!/usr/bin/env python3
import json
import os

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_EDITOR_MODEL = os.getenv("GEMINI_EDITOR_MODEL", "gemini-3.1-flash-lite").strip()
GEMINI_EDITOR_ENABLED = os.getenv("GEMINI_EDITOR_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}

DIFFICULTY_RANGES = {
    "Facile": (70, 95),
    "Moyen": (35, 69),
    "Difficile": (8, 34),
}


class GeminiEditorUnavailable(RuntimeError):
    pass


def _sanitize_schema_for_gemini(value):
    """Convert our Ollama JSON schema to the subset accepted by Gemini responseSchema."""
    if isinstance(value, dict):
        return {
            key: _sanitize_schema_for_gemini(item)
            for key, item in value.items()
            if key != "additionalProperties"
        }
    if isinstance(value, list):
        return [_sanitize_schema_for_gemini(item) for item in value]
    return value


def _prompt(category, candidates, evidence, requested):
    lo, hi = DIFFICULTY_RANGES.get(requested, (8, 95))
    blind = []
    for candidate in candidates:
        blind.append({
            "id": candidate.get("id"),
            "category": category,
            "type": candidate.get("type"),
            "difficulty_target": requested,
            "question": candidate.get("question"),
            "options": candidate.get("options") or [],
            "unit": candidate.get("unit") or "",
            "clues": candidate.get("clues") or [],
        })

    return f"""Tu es le RÉDACTEUR EN CHEF FINAL d'un quiz français pour adultes.
Les réponses de l'auteur sont volontairement cachées. Utilise UNIQUEMENT le dossier factuel Web fourni pour établir les faits et la réponse.

DIFFICULTÉ OBLIGATOIRE : {requested or 'non précisée'}.
Échelle de réussite : Facile=70-95, Moyen=35-69, Difficile=8-34. Pour cette candidate, expected_success_pct doit donc être entre {lo} et {hi} si approved=true.
expected_success_pct est TOUJOURS un entier 0-100, jamais une fraction 0-1.
quality_score est TOUJOURS un entier 0-100 : 90-100 excellent, 80-89 bon, 76-79 acceptable, <76 rejet.

Tu peux reformuler la question et améliorer les distracteurs pour atteindre le niveau demandé, mais uniquement avec des faits explicitement démontrés dans le dossier. Si ce n'est pas possible sans inventer ou si la question reste trop facile/trop difficile, approved=false.

RÈGLES :
- exactement UNE review par candidate ; conserve exactement le type demandé ;
- question naturelle à l'oral, précise, non anachronique, <=130 caractères ;
- explication joueur <=220 caractères, sans mention de dossier, sources, recherche Web ou processus ;
- QCM : exactement 4 options homogènes, plausibles et une seule correcte ;
- intrus : quatre éléments comparables, propriété commune explicite, un seul intrus non trivial ;
- vrai/faux : answer doit être true ou false ;
- numérique/estimation : valeur stable et unité si nécessaire ;
- libre/buzzer : réponse courte unique ; accepted_answers seulement variantes strictement équivalentes ;
- progressive : 4 ou 5 indices vrais du plus difficile au plus évident, sans contenir la réponse ;
- image_mystery/location : conserve le type et une réponse courte unique ;
- n'invente aucune information absente du dossier.

approved=true uniquement si la version finale est factuellement démontrée, univoque, bien formulée ET réellement dans la difficulté demandée.
Retourne uniquement le JSON conforme au schéma.

DOSSIER FACTUEL WEB :
{str(evidence.get('text') or '')}

CANDIDATES SANS RÉPONSE :
{json.dumps(blind, ensure_ascii=False)}"""


def finalize_with_gemini(
    category,
    candidates,
    evidence,
    review_schema,
    normalize_review,
    adversarial_review,
    ollama_url,
    local_review_model,
    session,
):
    if not GEMINI_EDITOR_ENABLED:
        raise GeminiEditorUnavailable("éditeur Gemini désactivé")
    if not GEMINI_API_KEY:
        raise GeminiEditorUnavailable("GEMINI_API_KEY absente")
    if not candidates:
        return []

    requested = str(candidates[0].get("_requested_difficulty") or "").strip()
    evidence = dict(evidence)
    evidence["requested_difficulty"] = requested

    schema = review_schema()
    try:
        reviews_schema = schema["properties"]["reviews"]
        reviews_schema["minItems"] = len(candidates)
        reviews_schema["maxItems"] = len(candidates)
        item_props = reviews_schema["items"]["properties"]
        item_props["expected_success_pct"] = {
            "type": "integer", "minimum": 0, "maximum": 100
        }
        item_props["quality_score"] = {
            "type": "integer", "minimum": 0, "maximum": 100
        }
    except Exception:
        pass

    # Ollama accepts a broader JSON-Schema vocabulary than Gemini responseSchema.
    # In particular Gemini rejects `additionalProperties`, so strip it recursively
    # while keeping our own deterministic validation after the model response.
    schema = _sanitize_schema_for_gemini(schema)

    payload = {
        "contents": [{
            "role": "user",
            "parts": [{"text": _prompt(category, candidates, evidence, requested)}],
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 1400,
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_EDITOR_MODEL}:generateContent"
    )
    response = session.post(
        url,
        headers={
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=90,
    )
    if response.status_code >= 400:
        try:
            detail = json.dumps(response.json(), ensure_ascii=False)[:1000]
        except Exception:
            detail = (response.text or "")[:1000]
        raise GeminiEditorUnavailable(
            f"Gemini editor HTTP {response.status_code}: {detail}"
        )

    data = response.json()
    try:
        content = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(content)
    except Exception as exc:
        raise GeminiEditorUnavailable(
            f"réponse Gemini editor inexploitable: {type(exc).__name__}: {exc}"
        ) from exc

    raw_reviews = parsed.get("reviews") or []
    if len(raw_reviews) != len(candidates):
        print(
            f"  Gemini rédaction détail [?] : REJET cardinalite_reviews · "
            f"attendu={len(candidates)} · obtenu={len(raw_reviews)}",
            flush=True,
        )
        return []

    accepted = []
    for idx, raw_item in enumerate(raw_reviews):
        candidate = candidates[idx]
        candidate_id = str(candidate.get("id") or "?")
        if not isinstance(raw_item, dict):
            print(
                f"  Gemini rédaction détail [{candidate_id}] : REJET sortie_non_objet",
                flush=True,
            )
            continue

        if str(raw_item.get("type") or "") != str(candidate.get("type") or ""):
            print(
                f"  Gemini rédaction détail [{candidate_id}] : REJET type_modifie · "
                f"attendu={candidate.get('type')} · obtenu={raw_item.get('type')}",
                flush=True,
            )
            continue

        if raw_item.get("approved") is not True:
            print(
                f"  Gemini rédaction détail [{candidate_id}] : REJET redacteur_refuse · "
                f"pct={raw_item.get('expected_success_pct')} · "
                f"qualité={raw_item.get('quality_score')} · "
                f"question={str(raw_item.get('question') or '')[:220]}",
                flush=True,
            )
            continue

        q = normalize_review(raw_item, category, evidence)
        if q is None:
            print(
                f"  Gemini rédaction détail [{candidate_id}] : REJET normalisation · "
                f"pct={raw_item.get('expected_success_pct')} · "
                f"qualité={raw_item.get('quality_score')} · "
                f"type={raw_item.get('type')} · "
                f"question={str(raw_item.get('question') or '')[:220]}",
                flush=True,
            )
            continue

        q["id"] = candidate_id
        if adversarial_review(
            q,
            evidence,
            ollama_url,
            local_review_model,
            session,
        ):
            accepted.append(q)
        else:
            print(
                f"  Quality gate adversarial : rejet de {candidate_id}",
                flush=True,
            )

    return accepted
