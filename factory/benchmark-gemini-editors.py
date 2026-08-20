#!/usr/bin/env python3
import json
import os
import time
import requests

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if not API_KEY:
    raise SystemExit("GEMINI_API_KEY absente dans l'environnement")

MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
]

PROMPT = """Tu es rédacteur final de quiz français pour adultes.
À partir du dossier factuel ci-dessous, évalue UNE seule candidate demandée au niveau Moyen.

Règles impératives :
- niveau Moyen = 35 à 69 % de réussite estimée ;
- expected_success_pct est un entier 0-100, jamais 0.75 ;
- quality_score est un entier 0-100, jamais une note sur 10 ;
- si la question est trop facile et ne peut pas être rendue réellement moyenne sans inventer, approved=false ;
- réponse JSON uniquement, très compacte.

DOSSIER :
Claude Monet est un peintre impressionniste français. Il a consacré une grande série de tableaux aux nymphéas de son jardin de Giverny.

CANDIDATE :
Quel peintre est célèbre pour sa série de Nymphéas peinte à Giverny ?
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "boolean"},
        "question": {"type": "string"},
        "answer": {"type": "string"},
        "expected_success_pct": {"type": "integer"},
        "quality_score": {"type": "integer"},
        "reason": {"type": "string"},
    },
    "required": [
        "approved", "question", "answer",
        "expected_success_pct", "quality_score", "reason"
    ],
}


def run(model):
    payload = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT}]}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 350,
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    start = time.perf_counter()
    response = requests.post(
        url,
        headers={"x-goog-api-key": API_KEY, "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    elapsed = time.perf_counter() - start

    print()
    print("=" * 72)
    print("MODELE:", model)
    print("HTTP:", response.status_code)
    print(f"TEMPS: {elapsed:.2f} s")

    if response.status_code >= 400:
        try:
            print(json.dumps(response.json(), ensure_ascii=False, indent=2)[:3000])
        except Exception:
            print((response.text or "")[:3000])
        return

    data = response.json()
    usage = data.get("usageMetadata") or {}
    if usage:
        print(
            "TOKENS:",
            f"prompt={usage.get('promptTokenCount')}",
            f"sortie={usage.get('candidatesTokenCount')}",
            f"pensée={usage.get('thoughtsTokenCount')}",
            f"total={usage.get('totalTokenCount')}",
        )

    try:
        candidate = data["candidates"][0]
        print("FINISH:", candidate.get("finishReason"))
        text = candidate["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        print("JSON: OK")
        print("approved:", parsed.get("approved"))
        print("pct:", parsed.get("expected_success_pct"))
        print("quality:", parsed.get("quality_score"))
        print("question:", parsed.get("question"))
        print("reason:", parsed.get("reason"))
    except Exception as exc:
        print("PARSE: ERREUR", type(exc).__name__, exc)
        print(json.dumps(data, ensure_ascii=False, indent=2)[:3000])


for model in MODELS:
    run(model)
