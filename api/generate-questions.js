const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function cleanText(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeKey(value) {
  return cleanText(value, 220)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shuffleEntries(entries) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function extractOutputText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

const UNCERTAIN_WORDING = [
  /\benviron\b/i,
  /\bapproximativement\b/i,
  /\bà peu près\b/i,
  /\ben moyenne\b/i,
  /\bgénéralement\b/i,
  /\bsouvent\b/i,
  /\bhabituellement\b/i,
  /\btypiquement\b/i,
  /\bprobablement\b/i,
  /\bpossiblement\b/i,
  /\bpeut varier\b/i,
  /\bcela dépend\b/i,
  /\bça dépend\b/i,
];

const FORBIDDEN_OPTIONS = new Set([
  "toutes ces reponses",
  "toutes les reponses",
  "aucune de ces reponses",
  "aucune reponse",
  "plusieurs reponses",
  "cela depend",
  "ca depend",
  "impossible a savoir",
]);

function containsUncertainty(text) {
  return UNCERTAIN_WORDING.some((pattern) => pattern.test(String(text || "")));
}

function optionsContainEachOther(options) {
  const normalized = options.map(normalizeKey);
  for (let a = 0; a < normalized.length; a += 1) {
    for (let b = 0; b < normalized.length; b += 1) {
      if (a === b) continue;
      if (normalized[a].length >= 6 && normalized[b].includes(normalized[a])) return true;
    }
  }
  return false;
}

function optionLengthsAreBalanced(options, correctIndex) {
  const lengths = options.map((option) => option.length);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  const correctLength = lengths[correctIndex];
  if (longest - shortest > 42) return false;
  if (correctLength > Math.max(18, shortest * 2.3)) return false;
  return true;
}

function normalizeQuestion(raw, index, allowedCategories) {
  const type = ["mcq", "truefalse", "numeric", "buzzer"].includes(raw?.type) ? raw.type : "mcq";
  const category = cleanText(raw?.category, 60);
  const base = {
    id: `gemini-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    category: allowedCategories.includes(category) ? category : allowedCategories[0],
    difficulty: ["Facile", "Moyen", "Difficile"].includes(raw?.difficulty) ? raw.difficulty : "Moyen",
    type,
    question: cleanText(raw?.question, 150),
    explanation: cleanText(raw?.explanation, 220),
  };

  if (!base.question || !base.explanation) return null;
  if (raw?.singleCorrectAnswer !== true) return null;
  if (raw?.factStatus !== "verified" || raw?.ambiguityStatus !== "unambiguous") return null;
  if (base.question.length < 12 || base.question.length > 130 || !/[?？]$/.test(base.question)) return null;
  if (base.explanation.length < 12 || base.explanation.length > 220) return null;
  if (containsUncertainty(base.question) || containsUncertainty(base.explanation)) return null;

  if (type === "mcq") {
    const options = Array.isArray(raw?.options)
      ? raw.options.map((item) => cleanText(item, 65)).filter(Boolean)
      : [];
    const uniqueOptions = [...new Map(options.map((item) => [normalizeKey(item), item])).values()].slice(0, 4);
    if (uniqueOptions.length !== 4) return null;
    if (uniqueOptions.some((option) => FORBIDDEN_OPTIONS.has(normalizeKey(option)))) return null;
    if (optionsContainEachOther(uniqueOptions)) return null;

    const wanted = normalizeKey(raw?.answer);
    const originalAnswer = uniqueOptions.findIndex((item) => normalizeKey(item) === wanted);
    if (originalAnswer < 0 || !optionLengthsAreBalanced(uniqueOptions, originalAnswer)) return null;

    const shuffled = shuffleEntries(uniqueOptions.map((text, optionIndex) => ({
      text,
      correct: optionIndex === originalAnswer,
    })));

    return {
      ...base,
      options: shuffled.map((entry) => entry.text),
      answer: shuffled.findIndex((entry) => entry.correct),
    };
  }

  if (type === "truefalse") {
    const answerText = normalizeKey(raw?.answer);
    if (!["true", "false", "vrai", "faux"].includes(answerText)) return null;
    return { ...base, answer: answerText === "true" || answerText === "vrai" };
  }

  if (type === "numeric") {
    const answer = Number(String(raw?.answer).replace(",", "."));
    if (!Number.isFinite(answer) || !Number.isInteger(answer)) return null;
    return { ...base, answer, unit: cleanText(raw?.unit, 35) };
  }

  const answerText = cleanText(raw?.answer, 90);
  if (!answerText || containsUncertainty(answerText)) return null;
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
  const count = clamp(body.count, 1, 30);
  const candidateCount = Math.min(40, count + Math.max(6, Math.ceil(count * 0.3)));
  const allowedDifficulties = ["Facile", "Moyen", "Difficile", "Mixte"];
  const difficulty = allowedDifficulties.includes(body.difficulty) ? body.difficulty : "Mixte";
  const categories = Array.isArray(body.categories)
    ? body.categories.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 15)
    : [];
  const exclude = Array.isArray(body.exclude)
    ? body.exclude.map((item) => cleanText(item, 180)).filter(Boolean).slice(-120)
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
          required: [
            "category", "difficulty", "type", "question", "options", "answer", "unit", "explanation",
            "singleCorrectAnswer", "factStatus", "ambiguityStatus",
          ],
          properties: {
            category: { type: "string" },
            difficulty: { type: "string", enum: ["Facile", "Moyen", "Difficile"] },
            type: { type: "string", enum: ["mcq", "truefalse", "numeric", "buzzer"] },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            unit: { type: "string" },
            explanation: { type: "string" },
            singleCorrectAnswer: { type: "boolean" },
            factStatus: { type: "string", enum: ["verified"] },
            ambiguityStatus: { type: "string", enum: ["unambiguous"] },
          },
        },
      },
    },
  };

  const prompt = [
    `Tu es auteur puis rédacteur en chef d'un grand jeu télévisé français de culture générale. Prépare ${candidateCount} questions finales publiables afin que le serveur en retienne ${count}.`,
    `Catégories autorisées, à reprendre avec leur libellé exact : ${categories.join(", ")}.`,
    difficulty === "Mixte"
      ? "Répartis réellement les difficultés entre Facile, Moyen et Difficile. La difficulté vient de la connaissance demandée, jamais d'une formulation floue."
      : `Toutes les questions doivent être de difficulté ${difficulty}.`,
    "Avant de rendre le JSON, imagine davantage de questions que nécessaire, contrôle-les une par une, élimine les faibles et ne conserve que celles dignes d'un jeu télévisé. Ne montre pas ce travail préparatoire.",
    "Chaque question doit avoir une seule réponse exacte, incontestable et vérifiable. Si deux réponses peuvent se défendre selon l'interprétation, l'époque, le pays, la définition choisie ou une exception, réécris ou abandonne la question.",
    "N'utilise jamais une croyance populaire, une légende virale, une anecdote douteuse ou un fait dont tu n'es pas certain. Au moindre doute factuel, choisis un autre sujet.",
    "Interdictions : approximations, valeurs moyennes, faits dépendant de l'actualité, records évolutifs, opinions, superlatifs sans critère précis, taxonomies controversées et formulations comme « généralement », « souvent », « environ » ou « cela dépend ».",
    "Pour les QCM, les trois distracteurs doivent être plausibles afin de faire réfléchir, mais clairement faux dans le cadre exact de la question. Les quatre réponses doivent appartenir au même type logique, avoir une forme grammaticale homogène et des longueurs proches.",
    "Évite tout indice involontaire : la bonne réponse ne doit pas être systématiquement plus longue, plus précise, plus connue, mieux raccordée à la phrase ou d'un registre différent.",
    "N'utilise jamais « toutes les réponses », « aucune réponse », une proposition partiellement vraie, ni deux choix qui se recouvrent.",
    "CONTRAINTE TV : une phrase naturelle, claire, idéalement 110 caractères et toujours 130 maximum. Chaque choix doit rester bref, idéalement moins de 40 caractères et toujours 65 maximum. L'explication est une phrase courte qui confirme précisément le fait.",
    "Style : vivant, élégant et accessible, comme une question réellement relue pour un plateau de télévision. Pas de préambule scolaire, pas de piège lexical et pas d'information inutile.",
    "Répartition conseillée : 70 % QCM, 10 % vrai/faux, 10 % numérique et 10 % buzzer. Les questions numériques portent uniquement sur des entiers exacts : années, nombres officiels stables ou calculs simples.",
    "Pour mcq : exactement 4 options distinctes et answer contient le texte strictement identique à la bonne option.",
    "Pour truefalse : options vide et answer vaut true ou false. L'énoncé est totalement vrai ou totalement faux, sans exception raisonnable.",
    "Pour numeric : options vide, answer contient seulement l'entier exact et unit l'unité éventuelle.",
    "Pour buzzer : options vide et answer contient une réponse orale courte et unique.",
    "Pour chaque question, singleCorrectAnswer vaut true, factStatus vaut verified et ambiguityStatus vaut unambiguous uniquement si ces critères sont réellement satisfaits.",
    "Exemple à rejeter : toute question basée sur un mythe animalier, une convention non précisée ou plusieurs réponses partiellement correctes.",
    exclude.length ? `Questions interdites car déjà utilisées :\n- ${exclude.join("\n- ")}` : "",
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
          temperature: 0.42,
          topP: 0.82,
          maxOutputTokens: 20000,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Gemini error", data);
      res.status(response.status === 429 ? 429 : 502).json({
        error: data?.error?.message || "La génération Gemini a échoué.",
      });
      return;
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      const reason = data?.promptFeedback?.blockReason;
      res.status(502).json({
        error: reason
          ? `Gemini a bloqué la demande (${reason}).`
          : "Gemini n'a renvoyé aucune question exploitable.",
      });
      return;
    }

    const parsed = JSON.parse(outputText);
    const seen = new Set();
    const questions = (parsed?.questions || [])
      .map((question, index) => normalizeQuestion(question, index, categories))
      .filter((question) => {
        if (!question) return false;
        const key = normalizeKey(question.question);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, count);

    if (questions.length < count) {
      res.status(502).json({
        error: `Contrôle qualité insuffisant : ${questions.length}/${count} questions seulement ont été validées. Relance la génération.`,
      });
      return;
    }

    res.status(200).json({
      questions,
      model: DEFAULT_MODEL,
      provider: "gemini",
      qualityControl: "editorial-strict",
    });
  } catch (error) {
    console.error("Gemini question generation failed", error);
    res.status(500).json({
      error: "Impossible de générer des questions contrôlées avec Gemini pour le moment.",
    });
  }
};