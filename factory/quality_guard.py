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


def _norm(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = text.encode("ascii", "ignore").decode().lower().replace("œ", "oe")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


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
        a = _norm(independent)
        b = _norm(expected)
        aliases = {"true": "true", "vrai": "true", "false": "false", "faux": "false"}
        return aliases.get(a) == aliases.get(b) and aliases.get(b) is not None

    accepted = [expected] + list(question.get("accepted_answers") or [])
    ni = _norm(independent)
    return bool(ni) and any(ni == _norm(x) for x in accepted if _norm(x))


def _qid(question):
    return str(question.get("id") or "?")


def _short(value, limit=260):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _reject(question, code, detail=""):
    suffix = f" · {_short(detail)}" if detail else ""
    print(f"  Quality gate détail [{_qid(question)}] : REJET {code}{suffix}", flush=True)
    return False


def adversarial_review(question, evidence, ollama_url, model, session):
    """Return True only if an independent adversarial pass confirms the final item."""
    qtype = str(question.get("type") or "")
    provider = str(evidence.get("provider") or "")

    # Text questions need at least two independent non-social domains.
    # Visual questions are handled by the dedicated Wikimedia+vision path.
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
        "difficulty": question.get("difficulty"),
        "question": question.get("question"),
        "options": question.get("options") or [],
        "unit": question.get("unit") or "",
        "clues": question.get("clues") or [],
    }

    prompt = """Tu es le CONTRÔLEUR ADVERSARIAL final d'un quiz français pour adultes.
La réponse validée par le rédacteur t'est volontairement cachée. Tu ne dois PAS réparer la question : tu dois essayer de la faire échouer.

Utilise uniquement le dossier factuel fourni et lis la question au sens littéral.
approved=true seulement si la question est précise, naturelle, non anachronique, stable, et possède une seule réponse défendable.

RÈGLES STRICTES :
- QCM/intrus : examine CHAQUE option séparément. Mets dans defensible_options toutes les options défendables selon le libellé exact. Il doit y en avoir exactement une.
- Intrus : le libellé doit demander réellement quel élément ne partage pas une propriété commune claire. Sinon approved=false.
- Numérique/estimation : une seule valeur exacte et stable doit découler du dossier.
- Libre/buzzer/progressive : une réponse courte unique doit être démontrée.
- Rejette les formulations trop larges dans le temps, les catégories vagues, les anachronismes et toute question dont une autre interprétation raisonnable change la réponse.
- Ne te fie pas au nombre de sources : vérifie ce que le dossier affirme réellement.
- independent_answer = ta réponse indépendante, sans voir celle du rédacteur.

Retourne uniquement un JSON conforme au schéma.
DOSSIER FACTUEL :
""" + str(evidence.get("text") or "") + "\nQUESTION FINALE SANS RÉPONSE :\n" + json.dumps(blind, ensure_ascii=False)

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["approved", "independent_answer", "defensible_options", "reason"],
        "properties": {
            "approved": {"type": "boolean"},
            "independent_answer": {"type": "string"},
            "defensible_options": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
    }

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": schema,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 500},
        "keep_alive": 0,
    }

    try:
        response = session.post(f"{ollama_url}/api/chat", json=payload, timeout=900)
        response.raise_for_status()
        reply = response.json()
        content = reply.get("message", {}).get("content", "")
        raw = json.loads(content)
    except Exception as exc:
        return _reject(question, "erreur_controleur", f"{type(exc).__name__}: {exc}")

    reason = _short(raw.get("reason"))
    independent = _short(raw.get("independent_answer"))
    defensible = [str(x).strip() for x in raw.get("defensible_options") or [] if str(x).strip()]

    if raw.get("approved") is not True:
        return _reject(
            question,
            "controleur_refuse",
            f"raison={reason or 'non précisée'} · réponse_indépendante={independent or 'vide'} · options_défendables={defensible}",
        )

    if qtype in {"mcq", "intruder"}:
        if len(defensible) != 1:
            return _reject(
                question,
                "nombre_options_defendables",
                f"attendu=1 · obtenu={len(defensible)} · {defensible} · raison={reason}",
            )
        expected = str(question.get("answer") or "").strip()
        if _norm(defensible[0]) != _norm(expected):
            return _reject(
                question,
                "reponse_independante_differe",
                f"rédacteur={expected!r} · contrôleur={defensible[0]!r} · raison={reason}",
            )
        print(
            f"  Quality gate détail [{_qid(question)}] : OK · option unique={defensible[0]!r} · domaines={len(usable_hosts)}",
            flush=True,
        )
        return True

    if not _answers_match(qtype, raw.get("independent_answer"), question):
        return _reject(
            question,
            "reponse_independante_differe",
            f"rédacteur={question.get('answer')!r} · contrôleur={independent!r} · raison={reason}",
        )

    print(
        f"  Quality gate détail [{_qid(question)}] : OK · réponse={independent!r} · domaines={len(usable_hosts)}",
        flush=True,
    )
    return True
