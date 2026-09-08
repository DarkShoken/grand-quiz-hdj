#!/usr/bin/env python3
import re
import unicodedata

META_SOURCE_PATTERNS = (
    "selon la source", "selon le document", "d apres le document", "d apres la source",
    "dans le document", "dans l article", "selon l article", "selon ce texte",
    "dans ce texte", "d apres le texte",
)
TECHNICAL_PATTERNS = (
    "famille taxonomique", "groupe taxonomique", "ordre taxonomique", "nom scientifique",
    "nom latin", "classification taxonomique", "code iso", "numero de brevet",
    "reference normative",
)

def norm(value):
    text = str(value or "").replace("’", "'")
    text = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()

def answer_text(answer):
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

def prefilter(candidate):
    errors = []
    qtype = str(candidate.get("type") or "")
    question = str(candidate.get("question") or "").strip()
    options = [str(x).strip() for x in candidate.get("options") or [] if str(x).strip()]
    answer = answer_text(candidate.get("answer"))
    clues = [str(x).strip() for x in candidate.get("clues") or [] if str(x).strip()]
    nq, na = norm(question), norm(answer)

    if not question: errors.append("question_vide")
    if len(question) > 150: errors.append("question_trop_longue")
    if len(question) < 8: errors.append("question_trop_courte")

    if any(marker in nq for marker in META_SOURCE_PATTERNS):
        errors.append("meta_source_wording")
    if any(norm(marker) in nq for marker in TECHNICAL_PATTERNS):
        errors.append("jargon_trop_technique")
    if na and len(na) >= 4 and na in nq:
        errors.append("reponse_dans_question")

    if qtype in {"mcq", "intruder"}:
        if len(options) != 4: errors.append("options_pas_4")
        normalized = [norm(x) for x in options]
        if len(set(normalized)) != len(normalized): errors.append("options_dupliquees")
        if na and na not in normalized: errors.append("reponse_absente_options")
    if qtype == "truefalse" and options:
        errors.append("truefalse_options_non_vides")
    if qtype == "progressive":
        if not 4 <= len(clues) <= 5: errors.append("indices_nombre_invalide")
        if na and any(na in norm(c) for c in clues): errors.append("reponse_dans_indices")
    if qtype not in {"mcq","intruder","truefalse","numeric","estimation","free","buzzer","progressive","image_mystery","location"}:
        errors.append("type_inconnu")
    return errors
