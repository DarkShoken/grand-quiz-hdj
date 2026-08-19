#!/usr/bin/env python3
import requests
from research_provider import research_web

blind = [{
    "id": "test-gemini-web",
    "category": "Astronomie",
    "type": "free",
    "difficulty": "Moyen",
    "question": "En quelle année le premier être humain a-t-il marché sur la Lune ?",
    "options": [],
    "unit": "",
    "clues": [],
}]

session = requests.Session()
session.headers.update({"User-Agent": "GrandQuizHDJ-ResearchTest/4.0"})

evidence = research_web(blind, session)
print()
print("PROVIDER:", evidence.get("provider"))
print("SOURCES:", len(evidence.get("sources") or []))
for source in evidence.get("sources") or []:
    print("-", source.get("url"))
print()
print("DOSSIER:")
print((evidence.get("text") or "")[:3000])
