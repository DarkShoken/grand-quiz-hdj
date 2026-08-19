#!/usr/bin/env python3
import json
import os
from urllib.parse import urlparse

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_RESEARCH_MODEL = os.getenv("GEMINI_RESEARCH_MODEL", "gemini-2.5-flash-lite").strip()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip()
SEARXNG_URL = os.getenv("SEARXNG_URL", "").strip().rstrip("/")
MIN_SOURCE_DOMAINS = max(1, int(os.getenv("MIN_SOURCE_DOMAINS", "2")))


class ResearchUnavailable(RuntimeError):
    pass


def _host(url):
    try:
        return (urlparse(str(url or "")).hostname or "").lower()
    except Exception:
        return ""


def _dedupe_sources(sources, limit=24):
    out = []
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            continue
        url = str(source.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            continue
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "source": str(source.get("source") or "Web")[:80],
            "title": str(source.get("title") or "")[:180],
            "url": url,
        })
        if len(out) >= limit:
            break
    return out


def _blind_prompt(blind):
    return """Tu es documentaliste et fact-checker pour un quiz français destiné à des adultes.
Les réponses proposées par l'auteur te sont volontairement cachées.

Tu DOIS utiliser la recherche Web avant de répondre.
Pour chaque question :
- résous-la indépendamment à partir de sources Web ;
- vérifie le sens littéral exact de la question ;
- pour un QCM ou un intrus, vérifie séparément chaque option ;
- signale toute ambiguïté réelle, anachronisme, information mouvante ou contradiction ;
- distingue clairement les faits établis des points incertains ;
- privilégie les sources officielles, institutionnelles, universitaires, encyclopédiques reconnues, musées, fédérations et documentation technique ;
- évite de t'appuyer sur réseaux sociaux, agrégateurs faibles ou contenus SEO lorsqu'une source plus solide existe.

Rédige un DOSSIER FACTUEL compact par ID. Donne la réponse indépendante et les faits qui la démontrent.
N'invente aucune source et ne te contente pas de ta mémoire.

QUESTIONS SANS RÉPONSE :
""" + json.dumps(blind, ensure_ascii=False)


def _gemini_research(blind, session):
    if not GEMINI_API_KEY:
        raise ResearchUnavailable("clé Gemini absente")

    payload = {
        "model": GEMINI_RESEARCH_MODEL,
        "store": False,
        "input": _blind_prompt(blind),
        "tools": [{"type": "google_search"}],
        "generation_config": {"temperature": 0},
    }
    response = session.post(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        headers={
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=180,
    )
    if response.status_code >= 400:
        try:
            detail = json.dumps(response.json(), ensure_ascii=False)[:900]
        except Exception:
            detail = (response.text or "")[:900]
        raise ResearchUnavailable(f"Gemini HTTP {response.status_code}: {detail}")

    data = response.json()
    texts = []
    sources = []
    search_used = False

    for step in data.get("steps") or []:
        if not isinstance(step, dict):
            continue
        step_type = step.get("type")
        if step_type == "google_search_call":
            search_used = True
        if step_type != "model_output":
            continue

        content = step.get("content") or []
        if isinstance(content, dict):
            content = [content]
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            text = str(block.get("text") or "").strip()
            if text:
                texts.append(text)
            for annotation in block.get("annotations") or []:
                if not isinstance(annotation, dict):
                    continue
                if annotation.get("type") != "url_citation":
                    continue
                sources.append({
                    "source": "Gemini Google Search",
                    "title": annotation.get("title") or _host(annotation.get("url")),
                    "url": annotation.get("url"),
                })

    sources = _dedupe_sources(sources)
    if not search_used:
        raise ResearchUnavailable("Gemini n'a exécuté aucune recherche Google")
    if not texts:
        raise ResearchUnavailable("Gemini n'a renvoyé aucun dossier factuel")
    if not sources:
        raise ResearchUnavailable("Gemini Google Search n'a renvoyé aucune URL exploitable")

    return {
        "text": "\n\n".join(texts),
        "sources": sources,
        "provider": f"{GEMINI_RESEARCH_MODEL}+google-search",
    }


def _candidate_query(candidate):
    question = str(candidate.get("question") or "").strip()
    options = [str(x).strip() for x in candidate.get("options") or [] if str(x).strip()]
    parts = [question]
    if options:
        parts.append("Options : " + " ; ".join(options))
    parts.append("Vérification factuelle sources fiables")
    return " ".join(parts)


def _tavily_research(blind, session):
    if not TAVILY_API_KEY:
        raise ResearchUnavailable("clé Tavily absente")

    dossiers = []
    sources = []
    for candidate in blind:
        response = session.post(
            "https://api.tavily.com/search",
            headers={
                "Authorization": f"Bearer {TAVILY_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "query": _candidate_query(candidate),
                "search_depth": "basic",
                "topic": "general",
                "max_results": 8,
                "include_answer": False,
                "include_raw_content": False,
                "include_images": False,
                "country": "france",
                "safe_search": True,
            },
            timeout=60,
        )
        if response.status_code >= 400:
            try:
                detail = json.dumps(response.json(), ensure_ascii=False)[:700]
            except Exception:
                detail = (response.text or "")[:700]
            raise ResearchUnavailable(f"Tavily HTTP {response.status_code}: {detail}")

        data = response.json()
        docs = []
        for result in data.get("results") or []:
            if not isinstance(result, dict):
                continue
            url = str(result.get("url") or "").strip()
            title = str(result.get("title") or "").strip()
            content = str(result.get("content") or "").strip()
            if not url or not content:
                continue
            docs.append({
                "title": title[:180],
                "url": url,
                "content": content[:1800],
            })
            sources.append({
                "source": "Tavily Basic Search",
                "title": title,
                "url": url,
            })
        dossiers.append({
            "id": candidate.get("id"),
            "question": candidate.get("question"),
            "documents": docs,
        })

    sources = _dedupe_sources(sources)
    if not sources:
        raise ResearchUnavailable("Tavily n'a renvoyé aucune source exploitable")

    return {
        "text": json.dumps(dossiers, ensure_ascii=False),
        "sources": sources,
        "provider": "tavily-basic",
    }


def _searxng_research(blind, session):
    if not SEARXNG_URL:
        raise ResearchUnavailable("SEARXNG_URL absent")

    dossiers = []
    sources = []
    for candidate in blind:
        response = session.get(
            f"{SEARXNG_URL}/search",
            params={
                "q": _candidate_query(candidate),
                "format": "json",
                "language": "fr-FR",
                "safesearch": 1,
            },
            timeout=45,
        )
        if response.status_code >= 400:
            raise ResearchUnavailable(f"SearXNG HTTP {response.status_code}")

        data = response.json()
        docs = []
        for result in (data.get("results") or [])[:10]:
            if not isinstance(result, dict):
                continue
            url = str(result.get("url") or "").strip()
            title = str(result.get("title") or "").strip()
            content = str(result.get("content") or "").strip()
            if not url:
                continue
            docs.append({
                "title": title[:180],
                "url": url,
                "content": content[:1600],
            })
            sources.append({
                "source": "SearXNG local",
                "title": title,
                "url": url,
            })
        dossiers.append({
            "id": candidate.get("id"),
            "question": candidate.get("question"),
            "documents": docs,
        })

    sources = _dedupe_sources(sources)
    if not sources:
        raise ResearchUnavailable("SearXNG n'a renvoyé aucune source exploitable")

    return {
        "text": json.dumps(dossiers, ensure_ascii=False),
        "sources": sources,
        "provider": "searxng-local",
    }


def research_web(blind, session):
    errors = []

    for label, provider in (
        ("Gemini", _gemini_research),
        ("Tavily", _tavily_research),
        ("SearXNG", _searxng_research),
    ):
        try:
            evidence = provider(blind, session)
            hosts = {_host(s.get("url")) for s in evidence.get("sources") or []}
            hosts.discard("")
            if len(hosts) < MIN_SOURCE_DOMAINS:
                raise ResearchUnavailable(
                    f"seulement {len(hosts)} domaine(s) distinct(s), minimum={MIN_SOURCE_DOMAINS}"
                )
            print(
                f"  Recherche Web : {evidence['provider']} · "
                f"{len(evidence.get('sources') or [])} sources · {len(hosts)} domaines",
                flush=True,
            )
            return evidence
        except ResearchUnavailable as exc:
            errors.append(f"{label}: {exc}")
            print(f"  Recherche Web {label} indisponible : {exc}", flush=True)
        except Exception as exc:
            errors.append(f"{label}: {type(exc).__name__}: {exc}")
            print(
                f"  Recherche Web {label} en erreur : {type(exc).__name__}: {exc}",
                flush=True,
            )

    raise ResearchUnavailable(" | ".join(errors))
