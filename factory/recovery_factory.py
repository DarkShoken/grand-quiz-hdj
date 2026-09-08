#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import time
from typing import Any

import requests

from quiz_factory import rpc
from category_profiles import guidance
from hdj_prefilter import prefilter, norm

FACTORY_TOKEN = os.getenv("FACTORY_TOKEN", "").strip()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11435").rstrip("/")
MODEL = os.getenv("RECOVERY_MODEL", os.getenv("QUALITY_MODEL", "gemma4:12b")).strip() or "gemma4:12b"
SLEEP_SECONDS = max(30, int(os.getenv("RECOVERY_SLEEP_SECONDS", "180")))
NUM_CTX = max(4096, min(16384, int(os.getenv("RECOVERY_NUM_CTX", "8192"))))
KEEP_ALIVE = os.getenv("RECOVERY_KEEP_ALIVE", "15m")

CATEGORIES = [
    'Animaux','Années 80, 90 & 2000','Arts & peinture','Cinéma & TV','Corps humain','Cuisine',
    'Culture générale','Dessins animés','France','Géographie','Histoire','Insolite',
    'Inventions & découvertes','Jeux vidéo','Langue française','Littérature','Logique & devinettes',
    'Monde & cultures','Musique','Mythologie','Nature & environnement','Numérique','Provence','Sciences',
    'Sport','Records du monde','Arbres','Plantes','Fruits','Astronomie','Arbre généalogique','Anglais',
    'Automobile','Agriculture','Expressions françaises des régions','Architecture','BTP & travaux',
    'Jeux olympiques','Célébrités'
]

session = requests.Session()
session.headers.update({"User-Agent": "GrandQuizHDJ-Recovery/1.0"})


def _answer_text(answer: Any) -> str:
    if isinstance(answer, dict):
        if "text" in answer:
            return str(answer.get("text") or "").strip()
        if "value" in answer:
            value = answer.get("value")
            if isinstance(value, bool):
                return "Vrai" if value else "Faux"
            unit = str(answer.get("unit") or "").strip()
            return f"{value} {unit}".strip()
    return str(answer or "").strip()


def _answer_matches(qtype: str, expected: Any, proposed: Any) -> bool:
    expected_text = _answer_text(expected)
    proposed_text = _answer_text(proposed)
    if qtype == "truefalse":
        aliases = {"true":"true","vrai":"true","false":"false","faux":"false"}
        return aliases.get(norm(expected_text)) == aliases.get(norm(proposed_text))
    if qtype in {"numeric", "estimation"}:
        def number(value):
            match = re.search(r"-?\d+(?:[.,]\d+)?", str(value or ""))
            return None if not match else float(match.group(0).replace(",", "."))
        a, b = number(expected_text), number(proposed_text)
        return a is not None and b is not None and abs(a-b) <= max(1e-9, abs(a)*1e-9)
    return bool(norm(expected_text)) and norm(expected_text) == norm(proposed_text)


def _evidence_payload(parent: dict) -> list[dict]:
    out = []
    for item in parent.get("source_evidence") or []:
        if not isinstance(item, dict):
            continue
        out.append({
            "title": item.get("title") or "",
            "url": item.get("url") or "",
            "fact_statement": item.get("fact_statement") or "",
            "evidence_quote": item.get("evidence_quote") or "",
        })
    return out


def _ollama_json(prompt: str, schema: dict, *, temperature: float, num_predict: int, timeout: int = 900) -> dict:
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": schema,
        "options": {
            "temperature": temperature,
            "top_p": 0.85,
            "num_ctx": NUM_CTX,
            "num_predict": num_predict,
        },
        "keep_alive": KEEP_ALIVE,
    }
    response = session.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=timeout)
    response.raise_for_status()
    content = response.json().get("message", {}).get("content", "")
    return json.loads(content)


def check_model() -> None:
    response = session.get(f"{OLLAMA_URL}/api/tags", timeout=15)
    response.raise_for_status()
    names = {str(x.get("name") or "") for x in response.json().get("models") or [] if isinstance(x, dict)}
    if MODEL not in names and not any(name.split(":")[0] == MODEL.split(":")[0] for name in names):
        raise RuntimeError(f"Modèle {MODEL!r} absent de {OLLAMA_URL}; disponibles: {', '.join(sorted(names)) or 'aucun'}")


def rewrite_schema() -> dict:
    variant = {
        "type": "object",
        "additionalProperties": False,
        "required": ["category","type","question","options","answer","accepted_answers","explanation","topic_key","clues"],
        "properties": {
            "category": {"type":"string"},
            "type": {"type":"string"},
            "question": {"type":"string"},
            "options": {"type":"array","items":{"type":"string"}},
            "answer": {"type":"string"},
            "accepted_answers": {"type":"array","items":{"type":"string"}},
            "explanation": {"type":"string"},
            "topic_key": {"type":"string"},
            "clues": {"type":"array","items":{"type":"string"}},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["recoverable","reason","variants"],
        "properties": {
            "recoverable": {"type":"boolean"},
            "reason": {"type":"string"},
            "variants": {"type":"array","minItems":0,"maxItems":2,"items":variant},
        },
    }


def rewrite(parent: dict) -> dict:
    original_answer = _answer_text(parent.get("answer"))
    reason = parent.get("recovery_reason") or ""
    profile = guidance(parent.get("category"))
    evidence = _evidence_payload(parent)
    allow_category_change = reason in {"category", "category_or_writing"}

    prompt = f"""Tu es le RÉDACTEUR DE RÉCUPÉRATION du Grand Quiz de l'Hôpital de Jour adulte de Manosque.
Tu utilises UNIQUEMENT Gemma et tu dois réparer une question déjà fact-checkée, sans inventer de nouveau fait.

PUBLIC : adultes en hôpital de jour, niveaux de culture générale hétérogènes. Le jeu doit rester valorisant et accessible.
CIBLE DE RÉUSSITE : Facile 80-95 %, Moyen 65-79 %, Difficile 50-64 %. En dessous de 50 %, la question n'est pas récupérable telle quelle.

MOTIF DU REJET : {reason}
CATÉGORIE D'ORIGINE : {parent.get('category')}
TYPE À CONSERVER : {parent.get('type')}
QUESTION D'ORIGINE : {parent.get('question')}
RÉPONSE DE RÉFÉRENCE DÉJÀ VÉRIFIÉE : {original_answer}
OPTIONS D'ORIGINE : {json.dumps(parent.get('options') or [], ensure_ascii=False)}
EXPLICATION D'ORIGINE : {parent.get('explanation') or ''}

DOSSIER FACTUEL DÉJÀ VÉRIFIÉ :
{json.dumps(evidence, ensure_ascii=False)}

PROFIL DE CATÉGORIE : {profile}

RÈGLES ABSOLUES :
- Le fait testé et la réponse de référence doivent rester les mêmes. N'ajoute aucun fait absent de fact_statement/evidence_quote.
- Ne mentionne jamais « source », « document », « article » ou « texte » dans la question.
- Formulation simple, naturelle, <= 130 caractères, sans jargon inutile.
- Le type reste exactement {parent.get('type')}.
- {'Tu peux changer la catégorie uniquement si le fait appartient clairement à une autre catégorie de la liste autorisée.' if allow_category_change else 'La catégorie doit rester exactement identique.'}
- Pour QCM/intrus : exactement 4 options, une seule correcte, distracteurs crédibles mais pas piégeux ni absurdes.
- Pour vrai/faux : options=[] et réponse Vrai/Faux.
- Pour progressive : 4 ou 5 indices, aucun ne contient la réponse.
- Si le fait lui-même est trop obscur pour atteindre honnêtement 50 % même après reformulation, recoverable=false. Ne triche pas avec des distracteurs ridiculement faux.
- Si récupérable, propose exactement 2 variantes distinctes.

Catégories autorisées : {json.dumps(CATEGORIES, ensure_ascii=False)}
Retourne uniquement le JSON conforme au schéma."""
    return _ollama_json(prompt, rewrite_schema(), temperature=0.35, num_predict=1800)


def _to_db_candidate(parent: dict, variant: dict) -> dict:
    qtype = str(parent.get("type") or "")
    answer_text = str(variant.get("answer") or "").strip()
    options = [str(x).strip() for x in variant.get("options") or [] if str(x).strip()]

    if qtype in {"mcq", "intruder"}:
        idx = next((i for i, x in enumerate(options) if norm(x) == norm(answer_text)), -1)
        answer = {"text": answer_text, "index": idx}
    elif qtype == "truefalse":
        answer = {"value": norm(answer_text) in {"vrai", "true"}}
    elif qtype in {"numeric", "estimation"}:
        match = re.search(r"-?\d+(?:[.,]\d+)?", answer_text)
        if not match:
            answer = {"value": answer_text}
        else:
            value = float(match.group(0).replace(",", "."))
            if value.is_integer(): value = int(value)
            parent_answer = parent.get("answer") if isinstance(parent.get("answer"), dict) else {}
            answer = {"value": value, "unit": str(parent_answer.get("unit") or "")}
    else:
        answer = {"text": answer_text}

    return {
        "category": str(variant.get("category") or parent.get("category") or "").strip(),
        "type": qtype,
        "question": str(variant.get("question") or "").strip(),
        "options": options,
        "answer": answer,
        "accepted_answers": [str(x).strip() for x in variant.get("accepted_answers") or [] if str(x).strip()],
        "explanation": str(variant.get("explanation") or "").strip(),
        "topic_key": str(variant.get("topic_key") or parent.get("topic_key") or "").strip(),
        "clues": [str(x).strip() for x in variant.get("clues") or [] if str(x).strip()],
        "quality_score": parent.get("quality_score") or 95,
    }


def audit_schema() -> dict:
    return {
        "type":"object",
        "additionalProperties":False,
        "required":["approved","independent_answer","category_fit","quality_fit","estimated_success_pct","reason"],
        "properties":{
            "approved":{"type":"boolean"},
            "independent_answer":{"type":"string"},
            "category_fit":{"type":"boolean"},
            "quality_fit":{"type":"boolean"},
            "estimated_success_pct":{"type":"integer","minimum":0,"maximum":100},
            "reason":{"type":"string"},
        },
    }


def audit(parent: dict, candidate: dict) -> dict:
    blind = {k:v for k,v in candidate.items() if k not in {"answer","accepted_answers","quality_score"}}
    evidence = _evidence_payload(parent)
    prompt = f"""Tu es le CONTRÔLEUR INDÉPENDANT final du Grand Quiz HDJ. Tu utilises le même modèle Gemma mais un rôle séparé du rédacteur.
La réponse choisie par le rédacteur t'est cachée. Résous la question UNIQUEMENT à partir du dossier factuel déjà vérifié ci-dessous.

DOSSIER FACTUEL :
{json.dumps(evidence, ensure_ascii=False)}

QUESTION CANDIDATE SANS RÉPONSE :
{json.dumps(blind, ensure_ascii=False)}

Vérifie séparément :
1. factualité et unicité de la réponse ;
2. adéquation à la catégorie ;
3. qualité de rédaction et distracteurs ;
4. accessibilité pour des adultes en HDJ.

Échelle de réussite :
- 80-95 : Facile
- 65-79 : Moyen
- 50-64 : Difficile mais acceptable
- <50 : trop difficile pour cette banque

Pour QCM/intrus, independent_answer doit être le texte exact de l'unique option correcte.
Pour vrai/faux, independent_answer doit être exactement Vrai ou Faux.
Pour numérique/estimation, donne seulement la valeur utile.
Ne force jamais le pourcentage dans une tranche. Si le fait est obscur, dis-le.
approved=true concerne la validité factuelle ; category_fit et quality_fit sont séparés.
Retourne uniquement le JSON conforme au schéma."""
    return _ollama_json(prompt, audit_schema(), temperature=0.0, num_predict=700)


def _audit_passes(parent: dict, candidate: dict, result: dict) -> tuple[bool, str]:
    if result.get("approved") is not True:
        return False, "audit_factuel_refuse"
    if result.get("category_fit") is not True:
        return False, "audit_categorie_refuse"
    if result.get("quality_fit") is not True:
        return False, "audit_redaction_refuse"
    try:
        pct = int(result.get("estimated_success_pct"))
    except Exception:
        return False, "audit_pourcentage_invalide"
    if pct < 50:
        return False, f"audit_trop_difficile_{pct}"
    if not _answer_matches(str(parent.get("type") or ""), candidate.get("answer"), result.get("independent_answer")):
        return False, "audit_reponse_independante_differe"
    return True, "ok"


def process_parent(parent: dict) -> bool:
    qid = parent.get("id")
    reason = parent.get("recovery_reason") or "?"
    print(f"\n→ Recovery {qid} · {parent.get('category')} · {reason} · tentative {parent.get('recovery_attempt')}/2", flush=True)

    rewritten = rewrite(parent)
    if rewritten.get("recoverable") is not True:
        why = str(rewritten.get("reason") or "fait_non_recuperable")
        rpc("quiz_recovery_fail", {"p_token":FACTORY_TOKEN,"p_id":qid,"p_reason":why,"p_details":{"stage":"rewrite"}})
        print(f"  ✗ Gemma juge le fait non récupérable : {why}", flush=True)
        return False

    variants = rewritten.get("variants") or []
    failures = []
    expected = parent.get("answer")
    for index, variant in enumerate(variants[:2], 1):
        if not isinstance(variant, dict):
            continue
        if str(variant.get("type") or "") != str(parent.get("type") or ""):
            failures.append(f"v{index}:type_modifie")
            continue
        if str(parent.get("recovery_reason") or "") not in {"category","category_or_writing"} and str(variant.get("category") or "") != str(parent.get("category") or ""):
            failures.append(f"v{index}:categorie_modifiee")
            continue
        if str(variant.get("category") or "") not in CATEGORIES:
            failures.append(f"v{index}:categorie_inconnue")
            continue
        if not _answer_matches(str(parent.get("type") or ""), expected, variant.get("answer")):
            failures.append(f"v{index}:reponse_modifiee")
            continue

        candidate = _to_db_candidate(parent, variant)
        local_errors = prefilter(candidate)
        if local_errors:
            failures.append(f"v{index}:prefiltre=" + ",".join(local_errors))
            continue

        result = audit(parent, candidate)
        ok, audit_reason = _audit_passes(parent, candidate, result)
        if not ok:
            failures.append(f"v{index}:{audit_reason}")
            continue

        candidate["expected_success_pct"] = int(result.get("estimated_success_pct"))
        candidate["audit_reason"] = str(result.get("reason") or "")[:800]
        committed = rpc("quiz_recovery_commit", {
            "p_token": FACTORY_TOKEN,
            "p_parent_id": qid,
            "p_candidate": candidate,
        })
        if isinstance(committed, dict) and committed.get("ok"):
            print(
                f"  ✓ récupérée → {committed.get('child_id')} · {committed.get('difficulty')} · "
                f"réussite estimée {committed.get('expected_success_pct')}%",
                flush=True,
            )
            return True
        failures.append(f"v{index}:commit={committed}")

    details = {"stage":"variants","failures":failures[:8]}
    rpc("quiz_recovery_fail", {
        "p_token": FACTORY_TOKEN,
        "p_id": qid,
        "p_reason": "aucune_variante_validee",
        "p_details": details,
    })
    print("  ✗ aucune variante validée · " + " | ".join(failures[:4]), flush=True)
    return False


def one() -> int:
    batch = rpc("quiz_recovery_pick", {"p_token":FACTORY_TOKEN,"p_limit":1})
    if not batch:
        print("Aucune question récupérable disponible.", flush=True)
        return 0
    return 1 if process_parent(batch[0]) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Grand Quiz HDJ - Recovery Factory Gemma-only")
    parser.add_argument("--once", action="store_true", help="Traite un seul candidat")
    parser.add_argument("--limit", type=int, default=0, help="Traite au maximum N candidats")
    parser.add_argument("--daemon", action="store_true", help="Boucle en continu")
    parser.add_argument("--status", action="store_true", help="Affiche l'état Recovery puis quitte")
    args = parser.parse_args()

    if not FACTORY_TOKEN:
        print("FACTORY_TOKEN absent", file=sys.stderr)
        return 2

    if args.status:
        print(json.dumps(rpc("quiz_recovery_status", {"p_token":FACTORY_TOKEN}), ensure_ascii=False, indent=2))
        return 0

    check_model()
    print(f"===== RECOVERY FACTORY GEMMA-ONLY =====\nModèle : {MODEL}\nOllama : {OLLAMA_URL}", flush=True)

    if args.once:
        one()
        return 0

    if args.limit > 0:
        kept = 0
        for _ in range(max(1, min(args.limit, 1000))):
            picked = rpc("quiz_recovery_pick", {"p_token":FACTORY_TOKEN,"p_limit":1})
            if not picked:
                break
            kept += 1 if process_parent(picked[0]) else 0
        print(f"\nBilan Recovery : {kept}/{args.limit} récupérées", flush=True)
        return 0

    if not args.daemon:
        parser.error("utilise --once, --limit N, --status ou --daemon")

    while True:
        try:
            check_model()
            picked = rpc("quiz_recovery_pick", {"p_token":FACTORY_TOKEN,"p_limit":1})
            if not picked:
                time.sleep(SLEEP_SECONDS)
                continue
            process_parent(picked[0])
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            # Une panne réseau/Ollama ne consomme pas une tentative : le lease Supabase expirera.
            print(f"Recovery erreur transitoire : {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            time.sleep(min(SLEEP_SECONDS, 120))


if __name__ == "__main__":
    raise SystemExit(main())
