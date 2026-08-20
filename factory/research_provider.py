#!/usr/bin/env python3
import html
import json
import os
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_RESEARCH_MODEL = os.getenv("GEMINI_RESEARCH_MODEL", "gemini-3.5-flash-lite").strip()
GEMINI_GOOGLE_SEARCH_ENABLED = os.getenv("GEMINI_GOOGLE_SEARCH_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip()
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://127.0.0.1:8888").strip().rstrip("/")
MIN_SOURCE_DOMAINS = max(1, int(os.getenv("MIN_SOURCE_DOMAINS", "2")))
SOURCE_FETCH_LIMIT = max(0, min(6, int(os.getenv("SOURCE_FETCH_LIMIT", "3"))))
SEARCH_RESULT_LIMIT = max(4, min(12, int(os.getenv("SEARCH_RESULT_LIMIT", "8"))))
PAGE_TEXT_LIMIT = max(1800, min(6000, int(os.getenv("PAGE_TEXT_LIMIT", "3500"))))

SOCIAL_HOSTS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "youtube.com", "www.youtube.com", "youtu.be",
    "tiktok.com", "www.tiktok.com",
    "instagram.com", "www.instagram.com",
    "pinterest.com", "www.pinterest.com",
}


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


class _ReadableHTML(HTMLParser):
    BLOCKS = {"p", "li", "h1", "h2", "h3", "h4", "blockquote", "dd", "dt", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip += 1
        elif not self.skip and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self.skip:
            self.skip -= 1
        elif not self.skip and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            text = re.sub(r"\s+", " ", data or "").strip()
            if text:
                self.parts.append(text + " ")


def _extract_page_text(session, url):
    host = _host(url)
    if not host or host in SOCIAL_HOSTS:
        return ""
    try:
        response = session.get(
            url,
            timeout=12,
            allow_redirects=True,
            headers={"Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"},
        )
        if response.status_code >= 400:
            return ""
        ctype = (response.headers.get("content-type") or "").lower()
        if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
            return ""
        raw = response.text[:200000]
        parser = _ReadableHTML()
        parser.feed(raw)
        text = html.unescape("".join(parser.parts))
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text[:PAGE_TEXT_LIMIT]
    except Exception:
        return ""


def _candidate_query(candidate):
    question = str(candidate.get("question") or "").strip()
    options = [str(x).strip() for x in candidate.get("options") or [] if str(x).strip()]
    parts = [question]
    if options:
        parts.append("Options : " + " ; ".join(options))
    parts.append("sources fiables")
    return " ".join(parts)


def _enrich_docs_with_pages(docs, session):
    enriched = []
    fetched = 0
    seen_hosts = set()
    ordered = sorted(
        docs,
        key=lambda d: (_host(d.get("url")) in seen_hosts, not bool(d.get("content"))),
    )
    for doc in ordered:
        item = dict(doc)
        host = _host(item.get("url"))
        if fetched < SOURCE_FETCH_LIMIT and host and host not in SOCIAL_HOSTS:
            page = _extract_page_text(session, item.get("url"))
            if page:
                item["page_text"] = page
                fetched += 1
                seen_hosts.add(host)
        enriched.append(item)
    return enriched


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
                "categories": "general",
            },
            timeout=45,
        )
        if response.status_code >= 400:
            detail = (response.text or "")[:300]
            raise ResearchUnavailable(f"SearXNG HTTP {response.status_code}: {detail}")

        try:
            data = response.json()
        except Exception as exc:
            raise ResearchUnavailable(f"SearXNG JSON invalide: {exc}") from exc

        docs = []
        for result in (data.get("results") or [])[:SEARCH_RESULT_LIMIT]:
            if not isinstance(result, dict):
                continue
            url = str(result.get("url") or "").strip()
            title = str(result.get("title") or "").strip()
            content = str(result.get("content") or "").strip()
            host = _host(url)
            if not url or not host or host in SOCIAL_HOSTS:
                continue
            docs.append({
                "title": title[:180],
                "url": url,
                "content": content[:1200],
                "engine": str(result.get("engine") or ""),
            })
            sources.append({
                "source": "SearXNG local",
                "title": title,
                "url": url,
            })

        docs = _enrich_docs_with_pages(docs, session)
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
        "provider": "searxng-local+raw-pages",
    }


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
                "max_results": SEARCH_RESULT_LIMIT,
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
            host = _host(url)
            if not url or not host or host in SOCIAL_HOSTS:
                continue
            docs.append({
                "title": title[:180],
                "url": url,
                "content": content[:1200],
            })
            sources.append({
                "source": "Tavily Basic Search",
                "title": title,
                "url": url,
            })

        docs = _enrich_docs_with_pages(docs, session)
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
        "provider": "tavily-basic+raw-pages",
    }


def _blind_prompt(blind):
    return """Tu es documentaliste et fact-checker pour un quiz français destiné à des adultes.
Les réponses proposées par l'auteur te sont volontairement cachées.

Tu DOIS utiliser la recherche Web avant de répondre.
Pour chaque question :
- résous-la indépendamment à partir de sources Web ;
- vérifie le sens littéral exact de la question ;
- pour un QCM ou un intrus, vérifie séparément chaque option ;
- signale toute ambiguïté réelle, anachronisme, information mouvante ou contradiction ;
- privilégie les sources officielles, institutionnelles, universitaires ou encyclopédiques reconnues.

Rédige un dossier factuel compact par ID avec les URLs utilisées.
QUESTIONS SANS RÉPONSE :
""" + json.dumps(blind, ensure_ascii=False)


def _gemini_research(blind, session):
    if not GEMINI_GOOGLE_SEARCH_ENABLED:
        raise ResearchUnavailable("grounding Gemini désactivé en mode gratuit")
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
                if not isinstance(annotation, dict) or annotation.get("type") != "url_citation":
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


def _validate_domains(evidence):
    hosts = {_host(s.get("url")) for s in evidence.get("sources") or []}
    hosts.discard("")
    hosts -= SOCIAL_HOSTS
    if len(hosts) < MIN_SOURCE_DOMAINS:
        raise ResearchUnavailable(
            f"seulement {len(hosts)} domaine(s) distinct(s), minimum={MIN_SOURCE_DOMAINS}"
        )
    return hosts


def research_web(blind, session):
    errors = []
    providers = [
        ("SearXNG", _searxng_research),
        ("Tavily", _tavily_research),
    ]
    if GEMINI_GOOGLE_SEARCH_ENABLED:
        providers.append(("Gemini", _gemini_research))

    for label, provider in providers:
        try:
            evidence = provider(blind, session)
            hosts = _validate_domains(evidence)
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
