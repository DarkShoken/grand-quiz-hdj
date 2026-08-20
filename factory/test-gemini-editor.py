#!/usr/bin/env python3
import json
import os
import time
import requests

api_key = os.getenv("GEMINI_API_KEY", "").strip()
model = os.getenv("GEMINI_RESEARCH_MODEL", "gemini-3.5-flash-lite").strip()

if not api_key:
    raise SystemExit("GEMINI_API_KEY absente dans l'environnement")

prompt = """Tu es rédacteur de quiz français pour adultes.
À partir du mini dossier factuel ci-dessous, retourne UNE seule proposition finale de niveau Moyen.
La question doit être naturelle, factuelle, non triviale, avec une réponse courte unique.
Retour JSON uniquement.

DOSSIER:
Claude Monet est un peintre impressionniste français. Il a consacré une grande série de tableaux aux nymphéas de son jardin de Giverny.

CANDIDATE:
Quel peintre est célèbre pour sa série de Nymphéas peinte à Giverny ?
"""

schema = {
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

payload = {
    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    "generationConfig": {
        "temperature": 0,
        "maxOutputTokens": 500,
        "responseMimeType": "application/json",
        "responseSchema": schema,
    },
}

url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
start = time.perf_counter()
response = requests.post(
    url,
    headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
    json=payload,
    timeout=120,
)
elapsed = time.perf_counter() - start

print(f"HTTP: {response.status_code}")
print(f"MODELE: {model}")
print(f"TEMPS: {elapsed:.2f} s")

if response.status_code >= 400:
    try:
        print(json.dumps(response.json(), ensure_ascii=False, indent=2)[:4000])
    except Exception:
        print((response.text or "")[:4000])
    raise SystemExit(1)

data = response.json()
try:
    text = data["candidates"][0]["content"]["parts"][0]["text"]
except Exception:
    print(json.dumps(data, ensure_ascii=False, indent=2)[:4000])
    raise SystemExit("Réponse Gemini sans texte exploitable")

print("REPONSE:")
print(text)
try:
    parsed = json.loads(text)
    print("JSON: OK")
    print("approved:", parsed.get("approved"))
    print("pct:", parsed.get("expected_success_pct"))
    print("quality:", parsed.get("quality_score"))
except Exception as exc:
    print("JSON: ERREUR", exc)
    raise SystemExit(1)
