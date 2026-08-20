#!/usr/bin/env python3
import json
import re
import unicodedata
from urllib.parse import urlparse

SOCIAL_HOSTS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "youtube.com", "www.youtube.com", "youtu.be",
    "tiktok.com", "www.tiktok.com", "instagram.com", "www.instagram.com",
    "pinterest.com", "www.pinterest.com",
}

DIFFICULTY_RANGES = {
    "Facile": (70, 95),
    "Moyen": (35, 69),
    "Difficile": (8, 34),
}


def _norm(value):
    text = str(value or "").replace("’", "'").replace("`", "'")
    text = unicodedata.normalize("NFD", text)
    text = text.encode("ascii", "ignore").decode().lower()
    text = text.replace("'", " ")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _answer_norm(value):
    text = _norm(value)
    return re.sub(r"^(?:l |le |la |les |un |une |des |du |de la |de l )", "", text).strip()


def _host(url):
    try:
        return (urlparse(str(url or "")).hostname or "").lower()
    except Exception:
        return ""


def _usable_hosts(evidence):
    hosts = set()
    for source in evidence.get("sources") or []:
        if not isinstance(source, dict):
            continue
        host = _host(source.get("url"))
        if host and host not in SOCIAL_HOSTS:
            hosts.add(host)
    return hosts


def _intruder_stem_ok(question):
    q = _norm(question)
    markers = (
        "intrus", "n est pas", "ne fait pas", "n appartient pas",
        "ne correspond pas", "est different", "sort de la liste",
        "lequel ne", "laquelle ne", "quel ne", "quelle ne",
    )
    return any(marker in q for marker in markers)


def _answers_match(qtype, independent, question):
    expected = str(question.get("answer") or "").strip()

    if qtype in {"numeric", "estimation"}:
        try:
            a = float(str(independent).replace(",", ".").strip())
            b = float(expected.replace(",", "."))
            return abs(a - b) <= max(1e-9, abs(b) * 1e-9)
        except Exception:
            return False

    if qtype == "truefalse":
        aliases = {
            "true": "true", "vrai": "true",
            "false": "false", "faux": "false",
        }
        return aliases.get(_norm(independent)) == aliases.get(_norm(expected))

    accepted = [expected] + list(question.get("accepted_answers") or [])
    ni = _answer_norm(independent)
    return bool(ni) and any(ni == _answer_norm(x) for x in accepted if _answer_norm(x))


def _qid(question):
    return str(question.get("id") or "?")


def _short(value, limit=320):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _reject(question, code, detail=""):
    suffix = f" · {_short(detail)}" if detail else ""
    print(f"  Quality gate détail [{_qid(question)}] : REJET {code}{suffix}", flush=True)
    return False


def _difficulty_ok(difficulty, pct):
    lo, hi = DIFFICULTY_RANGES.get(str(difficulty or ""), (8, 95))
    return lo <= pct <= hi, lo, hi


def adversarial_review(question, evidence, ollama_url, model, session):
    """Return True only if an independent adversarial pass confirms the final item."""
    qtype = str(question.get("type") or "")
    provider = str(evidence.get("provider") or "")
    difficulty = str(question.get("difficulty") or "")

    usable_hosts = _usable_hosts(evidence)
    if not provider.startswith("gemma3-vision") and len(usable_hosts) < 2:
        return _reject(
            question,
            "sources_insuffisantes",
            f"domaines fiables={len(usable_hosts)} ({', '.join(sorted(usable_hosts)) or 'aucun'})",
        )

    if qtype == "intruder" and not _intruder_stem_ok(question.get("question")):
        return _reject(question, "intrus_libelle_incoherent", question.get("question"))

    blind = {
        "category": question.get("category"),
        "type": qtype,
        "difficulty": difficulty,
        "question": question.get("question"),
        "options": question.get("options") or [],
        "unit": question.get("unit") or "",
        "clues": question.get("clues") or [],
    }

    if qtype == "truefalse":
        answer_protocol = 'Pour ce VRAI/FAUX uniquement, independent_answer doit être exactement "true" ou "false".'
    elif qtype in {"numeric", "estimation"}:
        answer_protocol = "Pour ce type numérique, independent_answer doit contenir uniquement la valeur numérique qui répond à la question."
    else:
        answer_protocol = (
            "Pour ce type NON vrai/faux, independent_answer doit contenir LA RÉPONSE ELLE-MÊME à la question "
            "(ex. un nom, un mot, un lieu). Ne réponds JAMAIS true/false/vrai/faux dans ce champ."
        )

    prompt = f"""Tu es le CONTRÔLEUR ADVERSARIAL final d'un quiz français pour adultes.
La réponse validée par le rédacteur t'est cachée. Résous la question indépendamment à partir du dossier factuel.

TYPE EXACT À CONTRÔLER : {qtype}
{answer_protocol}

Évalue DEUX choses séparément :
1) VALIDITÉ : factualité, précision du libellé, unicité réelle de la réponse, absence d'anachronisme.
2) DIFFICULTÉ RÉELLE pour un adulte moyen jouant à un quiz de culture générale, AVEC les options visibles lorsqu'il y en a.

IMPORTANT :
- N'invente pas d'interprétation non demandée.
- Un distracteur plausible n'est pas une seconde bonne réponse.
- Une ambiguïté existe seulement si au moins deux réponses satisfont réellement le libellé exact.
- Ne mets dans satisfying_options QUE les options qui répondent littéralement à la question.
- Pour un intrus, satisfying_options contient uniquement l'intrus.
- Les distracteurs doivent être homogènes et crédibles. S'ils rendent la bonne réponse évidente par simple élimination, distractors_plausible=false.
- Une question de niveau Moyen ne doit pas être une évidence de culture générale élémentaire. Estime honnêtement le taux de réussite, ne le force pas dans la tranche demandée.
- Une date/statistique mouvante doit avoir une période de référence claire.
- approved concerne la VALIDITÉ seulement. Ne rejette pas dans approved uniquement parce que le niveau de difficulté est mauvais : utilise estimated_success_pct.

ÉCHELLE estimated_success_pct :
- 90-95 : quasi évident
- 70-89 : facile
- 35-69 : moyen
- 8-34 : difficile
- <8 : trop obscur

RÈGLES PAR TYPE :
- QCM : exactement une option doit satisfaire le libellé.
- Intrus : exactement un élément ne doit pas partager la propriété commune.
- Vrai/faux : independent_answer doit être exactement \"true\" ou \"false\".
- Numérique/estimation : independent_answer contient uniquement la valeur numérique utile.
- Libre/buzzer/progressive : independent_answer contient la réponse courte elle-même, jamais un booléen.

Retourne uniquement le JSON conforme au schéma.
DOSSIER FACTUEL :
""" + str(evidence.get("text") or "") + "\nQUESTION FINALE SANS RÉPONSE :\n" + json.dumps(blind, ensure_ascii=False)

    independent_schema = {
        "type": "string",
        "description": "Réponse réelle à la question ; true/false uniquement pour un type truefalse.",
    }
    if qtype == "truefalse":
        independent_schema = {"type": "string", "enum": ["true", "false"]}

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "approved",
            "independent_answer",
            "satisfying_options",
            "distractors_plausible",
            "estimated_success_pct",
            "reason",
        ],
        "properties": {
            "approved": {"type": "boolean"},
            "independent_answer": independent_schema,
            "satisfying_options": {"type": "array", "items": {"type": "string"}},
            "distractors_plausible": {"type": "boolean"},
            "estimated_success_pct": {"type": "integer", "minimum": 0, "maximum": 100},
            "reason": {"type": "string"},
        },
    }

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": schema,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 650},
        "keep_alive": 0,
    }

    try:
        response = session.post(f"{ollama_url}/api/chat", json=payload, timeout=900)
        response.raise_for_status()
        reply = response.json()
        raw = json.loads(reply.get("message", {}).get("content", ""))
    except Exception as exc:
        return _reject(question, "erreur_controleur", f"{type(exc).__name__}: {exc}")

    reason = _short(raw.get("reason"))
    independent = _short(raw.get("independent_answer"))
    satisfying = [str(x).strip() for x in raw.get("satisfying_options") or [] if str(x).strip()]
    try:
        estimated_pct = int(raw.get("estimated_success_pct"))
    except Exception:
        return _reject(question, "difficulte_invalide", raw.get("estimated_success_pct"))

    if qtype != "truefalse" and _norm(independent) in {"true", "false", "vrai", "faux"}:
        return _reject(
            question,
            "protocole_reponse_invalide",
            f"type={qtype} · independent_answer={independent!r} · raison={reason}",
        )

    if raw.get("approved") is not True:
        return _reject(
            question,
            "controleur_refuse",
            f"raison={reason or 'non précisée'} · réponse_indépendante={independent or 'vide'} · "
            f"options_satisfaisantes={satisfying} · réussite_estimée={estimated_pct}%",
        )

    if qtype in {"mcq", "intruder"}:
        if len(satisfying) != 1:
            return _reject(
                question,
                "nombre_options_satisfaisantes",
                f"attendu=1 · obtenu={len(satisfying)} · {satisfying} · raison={reason}",
            )
        if raw.get("distractors_plausible") is not True:
            return _reject(
                question,
                "distracteurs_trop_faciles",
                f"réussite_estimée={estimated_pct}% · raison={reason}",
            )
        expected = str(question.get("answer") or "").strip()
        if _answer_norm(satisfying[0]) != _answer_norm(expected):
            return _reject(
                question,
                "reponse_independante_differe",
                f"rédacteur={expected!r} · contrôleur={satisfying[0]!r} · raison={reason}",
            )
    else:
        if not _answers_match(qtype, raw.get("independent_answer"), question):
            return _reject(
                question,
                "reponse_independante_differe",
                f"rédacteur={question.get('answer')!r} · contrôleur={independent!r} · raison={reason}",
            )

    diff_ok, lo, hi = _difficulty_ok(difficulty, estimated_pct)
    if not diff_ok:
        return _reject(
            question,
            "difficulte_estimee_hors_cible",
            f"cible={difficulty} {lo}-{hi}% · réussite_estimée={estimated_pct}% · raison={reason}",
        )

    if qtype in {"mcq", "intruder"}:
        print(
            f"  Quality gate détail [{_qid(question)}] : OK · option={satisfying[0]!r} · "
            f"réussite_estimée={estimated_pct}% · domaines={len(usable_hosts)}",
            flush=True,
        )
    else:
        print(
            f"  Quality gate détail [{_qid(question)}] : OK · réponse={independent!r} · "
            f"réussite_estimée={estimated_pct}% · domaines={len(usable_hosts)}",
            flush=True,
        )
    return True
