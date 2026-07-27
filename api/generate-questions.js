const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

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
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function normalizeQuestion(raw, index) {
  const type = ["mcq", "truefalse", "numeric", "buzzer"].includes(raw?.type) ? raw.type : "mcq";
  const base = {
    id: `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
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

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({
      error: "La variable OPENAI_API_KEY n'est pas configurée dans Vercel.",
      code: "missing_api_key",
    });
    return;
  }

  const body = req.body || {};
  const count = clamp(body.count, 5, 25);
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
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 25,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "difficulty", "type", "question", "options", "answer", "unit", "explanation"],
          properties: {
            category: { type: "string" },
            difficulty: { type: "string", enum: ["Facile", "Moyen", "Difficile"] },
            type: { type: "string", enum: ["mcq", "truefalse", "numeric", "buzzer"] },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, maxItems: 4 },
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
    "Varie les formulations, les sujets et les types de questions. Évite les doublons, les questions pièges, les formulations ambiguës, les sujets sensibles et les faits susceptibles de changer rapidement.",
    "Utilise surtout des faits stables, connus et vérifiables. Chaque explication doit justifier clairement la bonne réponse en une ou deux phrases.",
    "Pour mcq : fournis exactement 4 options distinctes et place dans answer le texte exact de la bonne option.",
    "Pour truefalse : options doit être vide et answer doit être 'true' ou 'false'.",
    "Pour numeric : options doit être vide, answer doit contenir uniquement le nombre, et unit l'unité éventuelle.",
    "Pour buzzer : options doit être vide et answer doit contenir la réponse courte attendue.",
    exclude.length ? `Ne reprends aucune de ces questions déjà utilisées :\n- ${exclude.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        instructions: "Tu es un concepteur de questions de quiz rigoureux. Respecte strictement le schéma JSON et n'invente pas de faits incertains.",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "grand_quiz_questions",
            strict: true,
            schema,
          },
        },
        max_output_tokens: 8000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI error", data);
      res.status(502).json({ error: data?.error?.message || "La génération IA a échoué." });
      return;
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      res.status(502).json({ error: "L'IA n'a renvoyé aucune question exploitable." });
      return;
    }

    const parsed = JSON.parse(outputText);
    const questions = (parsed?.questions || [])
      .map(normalizeQuestion)
      .filter(Boolean)
      .slice(0, count);

    if (questions.length < Math.min(5, count)) {
      res.status(502).json({ error: "Trop peu de questions valides ont été générées." });
      return;
    }

    res.status(200).json({ questions, model: DEFAULT_MODEL });
  } catch (error) {
    console.error("Question generation failed", error);
    res.status(500).json({ error: "Impossible de générer les questions pour le moment." });
  }
};
