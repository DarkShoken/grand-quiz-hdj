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
    text = str(value or "")
    # Préserver les frontières de mots avant la translittération ASCII :
    # « n’appartient » doit devenir « n appartient », pas « nappartient ».
    text = text.replace("’", " ").replace("'", " ")
    text = text.replace("œ", "oe").replace("Œ", "OE")
    text = unicodedata.normalize("NFD", text)
    text = text.encode("ascii", "ignore").decode().lower()
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


def _short(value, limit=300):
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
La réponse validée par le rédacteur t'est volontairement cachée. Tu ne dois PAS réparer la question : tu dois la résoudre indépendamment et chercher de vraies ambiguïtés.

Utilise uniquement le dossier factuel fourni et lis LA QUESTION AU SENS LITTÉRAL.
approved=true seulement si la question est précise, naturelle, non anachronique, stable, et possède une seule réponse correcte démontrée par le dossier.

IMPORTANT — NE CONFONDS PAS PLAUSIBILITÉ ET AMBIGUÏTÉ :
- Un distracteur peut être plausible, ressembler à une erreur fréquente, être une autre date réelle ou appartenir au même domaine : cela est NORMAL dans un quiz et ne rend PAS la question ambiguë.
- Une option est « satisfaisante » seulement si elle répond réellement et littéralement à la question posée.
- N'invente jamais une autre interprétation non demandée (par exemple date de production si la question demande date de diffusion).
- Rejette pour ambiguïté uniquement si AU MOINS DEUX réponses satisfont réellement le libellé exact, ou si le libellé ne permet pas de savoir ce qui est demandé.

RÈGLES STRICTES :
- QCM : examine CHAQUE option. Mets dans satisfying_options uniquement les options qui répondent effectivement à la question. Il doit y en avoir exactement une.
- Intrus : satisfying_options contient uniquement l'élément qui NE partage PAS la propriété commune demandée. Il doit y en avoir exactement un.
- Vrai/faux : independent_answer doit être EXACTEMENT la chaîne "true" ou "false". Ne mets jamais une phrase, une justification ni le fait reformulé dans independent_answer ; place l'explication dans reason.
- Numérique/estimation : donne la valeur qui répond exactement au libellé. Une date ou statistique mouvante doit avoir une période de référence claire ; sinon approved=false.
- Libre/buzzer/progressive : une réponse courte unique doit être démontrée.
- Rejette les formulations réellement trop larges dans le temps, les catégories vagues, les anachronismes et les contradictions du dossier.
- Ne te fie pas au nombre de sources : vérifie ce que le dossier affirme réellement.
- independent_answer = ta réponse indépendante à la question exacte.
- reason doit expliquer brièvement pourquoi la question est acceptée ou rejetée. Il doit être cohérent avec satisfying_options.

Pour QCM/intrus :
- si satisfying_options contient exactement une option correcte et que le reste est faux pour LE LIBELLÉ POSÉ, approved peut être true ;
- ne mets jamais les quatre options dans satisfying_options simplement parce qu'elles sont toutes « plausibles » ou « défendables » dans l'absolu.

Retourne uniquement un JSON conforme au schéma.
DOSSIER FACTUEL :
""" + str(evidence.get("text") or "") + "\nQUESTION FINALE SANS RÉPONSE :\n" + json.dumps(blind, ensure_ascii=False)

    independent_schema = (
        {"type": "string", "enum": ["true", "false"]}
        if qtype == "truefalse"
        else {"type": "string"}
    )
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["approved", "independent_answer", "satisfying_options", "reason"],
        "properties": {
            "approved": {"type": "boolean"},
            "independent_answer": independent_schema,
            "satisfying_options": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
    }

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": schema,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 550},
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
    satisfying = [str(x).strip() for x in raw.get("satisfying_options") or [] if str(x).strip()]

    # Une sortie structurée auto-contradictoire est rejetée : on ne devine pas à la place du contrôleur.
    if qtype in {"mcq", "intruder"} and raw.get("approved") is True and len(satisfying) != 1:
        return _reject(
            question,
            "sortie_controleur_incoherente",
            f"approved=true mais options_satisfaisantes={len(satisfying)} · {satisfying} · raison={reason}",
        )

    if raw.get("approved") is not True:
        return _reject(
            question,
            "controleur_refuse",
            f"raison={reason or 'non précisée'} · réponse_indépendante={independent or 'vide'} · options_satisfaisantes={satisfying}",
        )

    if qtype in {"mcq", "intruder"}:
        expected = str(question.get("answer") or "").strip()
        if _norm(satisfying[0]) != _norm(expected):
            return _reject(
                question,
                "reponse_independante_differe",
                f"rédacteur={expected!r} · contrôleur={satisfying[0]!r} · raison={reason}",
            )
        print(
            f"  Quality gate détail [{_qid(question)}] : OK · option satisfaisante={satisfying[0]!r} · domaines={len(usable_hosts)}",
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
