const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function cleanText(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeKey(value) {
  return cleanText(value, 300)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractOutputText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function normalizeQuestion(raw, index) {
  const type = ["mcq", "truefalse", "numeric", "buzzer"].includes(raw?.type) ? raw.type : "mcq";
  const base = {
    id: `gemini-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    category: cleanText(raw?.category, 60) || "Culture générale",
    difficulty: ["Facile", "Moyen", "Difficile"].includes(raw?.difficulty) ? raw.difficulty : "Moyen",
    type,
    question: cleanText(raw?.question, 280),
    explanation: cleanText(raw?.explanation, 500),
  };

  if (!base.question || !base.explanation) return null;

  if (type === "mcq") {
    const options = Array.isArray(raw?.options)
      ? raw.options.map((item) => cleanText(item, 120)).filter(Boolean)
      : [];
    const uniqueOptions = [...new Map(options.map((item) => [normalizeKey(item), item])).values()].slice(0, 4);
    if (uniqueOptions.length !== 4) return null;
    const wanted = normalizeKey(raw?.answer);
    const answer = uniqueOptions.findIndex((item) => normalizeKey(item) === wanted);
    if (answer < 0) return null;
    return { ...base, options: uniqueOptions, answer };
  }

  if (type === "truefalse") {
    const answerText = normalizeKey(raw?.answer);
    if (!["true", "false", "vrai", "faux"].includes(answerText)) return null;
    return { ...base, answer: answerText === "true" || answerText === "vrai" };
  }

  if (type === "numeric") {
    const answer = Number(String(raw?.answer).replace(",", "."));
    if (!Number.isFinite(answer)) return null;
    return { ...base, answer, unit: cleanText(raw?.unit, 40) };
  }

  const answerText = cleanText(raw?.answer, 180);
  if (!answerText) return null;
  return { ...base, answerText };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error: "La variable GEMINI_API_KEY n'est pas configurée dans Vercel.",
      code: "missing_api_key",
    });
    return;
  }

  const body = req.body || {};
  const count = clamp(body.count, 5, 30);
  const allowedDifficulties = ["Facile", "Moyen", "Difficile", "Mixte"];
  const difficulty = allowedDifficulties.includes(body.difficulty) ? body.difficulty : "Mixte";
  const categories = Array.isArray(body.categories)
    ? body.categories.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 15)
    : [];
  const exclude = Array.isArray(body.exclude)
    ? body.exclude.map((item) => cleanText(item, 220)).filter(Boolean).slice(-80)
    : [];

  if (!categories.length) {
    res.status(400).json({ error: "Aucune catégorie sélectionnée." });
    return;
  }

  const schema = {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          required: ["category", "difficulty", "type", "question", "options", "answer", "unit", "explanation"],
          properties: {
            category: { type: "string" },
            difficulty: { type: "string", enum: ["Facile", "Moyen", "Difficile"] },
            type: { type: "string", enum: ["mcq", "truefalse", "numeric", "buzzer"] },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            unit: { type: "string" },
            explanation: { type: "string" },
          },
        },
      },
    },
  };

  const prompt = [
    `Crée exactement ${count} questions de quiz en français pour un jeu télévisé convivial entre adultes.`,
    `Catégories autorisées : ${categories.join(", ")}.`,
    difficulty === "Mixte"
      ? "Répartis les difficultés de façon équilibrée entre Facile, Moyen et Difficile."
      : `Toutes les questions doivent être de difficulté ${difficulty}.`,
    "Varie fortement les sujets, les formulations et les types de questions. Évite les doublons, les questions pièges, les formulations ambiguës, les sujets sensibles et les faits susceptibles de changer rapidement.",
    "Utilise uniquement des faits stables et largement vérifiables. Chaque explication doit justifier clairement la bonne réponse en une ou deux phrases.",
    "Répartition conseillée : environ 65 % de QCM, 15 % de vrai/faux, 10 % de numérique et 10 % de buzzer.",
    "Pour mcq : fournis exactement 4 options distinctes et place dans answer le texte exact de la bonne option.",
    "Pour truefalse : options doit être vide et answer doit être 'true' ou 'false'.",
    "Pour numeric : options doit être vide, answer doit contenir uniquement le nombre, et unit l'unité éventuelle.",
    "Pour buzzer : options doit être vide et answer doit contenir la réponse courte attendue.",
    exclude.length ? `Ne reprends aucune de ces questions déjà utilisées :\n- ${exclude.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 15000,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Gemini error", data);
      const message = data?.error?.message || "La génération Gemini a échoué.";
      res.status(response.status === 429 ? 429 : 502).json({ error: message });
      return;
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      const blockReason = data?.promptFeedback?.blockReason;
      res.status(502).json({
        error: blockReason
          ? `Gemini a bloqué la demande (${blockReason}).`
          : "Gemini n'a renvoyé aucune question exploitable.",
      });
      return;
    }

    const parsed = JSON.parse(outputText);
    const questions = (parsed?.questions || [])
      .map(normalizeQuestion)
      .filter(Boolean)
      .slice(0, count);

    if (questions.length < Math.min(5, count)) {
      res.status(502).json({ error: "Trop peu de questions valides ont été générées par Gemini." });
      return;
    }

    res.status(200).json({ questions, model: DEFAULT_MODEL, provider: "gemini" });
  } catch (error) {
    console.error("Gemini question generation failed", error);
    res.status(500).json({ error: "Impossible de générer les questions avec Gemini pour le moment." });
  }
};