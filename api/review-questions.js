const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalize(value) {
  return cleanText(value, 300)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractOutputText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function normalizeReviewedQuestion(raw, allowedCategories) {
  if (!raw || raw.approved !== true) return null;

  const type = ['mcq', 'truefalse', 'numeric', 'buzzer', 'free'].includes(raw.type)
    ? raw.type
    : null;
  const category = cleanText(raw.category, 60);
  const difficulty = ['Facile', 'Moyen', 'Difficile'].includes(raw.difficulty)
    ? raw.difficulty
    : null;
  const question = cleanText(raw.question, 150);
  const explanation = cleanText(raw.explanation, 240);
  const topicKey = cleanText(raw.topicKey, 120);

  if (!type || !difficulty || !allowedCategories.includes(category)) return null;
  if (question.length < 12 || question.length > 130 || !/[?？.]$/.test(question)) return null;
  if (explanation.length < 12 || !topicKey) return null;

  const base = {
    id: cleanText(raw.id, 120) || `reviewed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    difficulty,
    type,
    question,
    explanation,
    topicKey,
    reviewed: true,
  };

  if (type === 'mcq') {
    const options = Array.isArray(raw.options)
      ? raw.options.map((item) => cleanText(item, 65)).filter(Boolean).slice(0, 4)
      : [];
    if (options.length !== 4 || new Set(options.map(normalize)).size !== 4) return null;
    const answerText = cleanText(raw.answer, 65);
    const answer = options.findIndex((option) => normalize(option) === normalize(answerText));
    if (answer < 0) return null;
    return { ...base, options, answer };
  }

  if (type === 'truefalse') {
    const answer = normalize(raw.answer);
    if (!['true', 'false', 'vrai', 'faux'].includes(answer)) return null;
    return { ...base, answer: answer === 'true' || answer === 'vrai' };
  }

  if (type === 'numeric') {
    const answer = Number(String(raw.answer).replace(',', '.'));
    if (!Number.isFinite(answer)) return null;
    return { ...base, answer, unit: cleanText(raw.unit, 40) };
  }

  const answerText = cleanText(raw.answer, 100);
  if (!answerText) return null;
  return { ...base, answerText };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({ error: 'La variable GEMINI_API_KEY n’est pas configurée.' });
    return;
  }

  const body = req.body || {};
  const questions = Array.isArray(body.questions) ? body.questions.slice(0, 40) : [];
  const categories = Array.isArray(body.categories)
    ? body.categories.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 30)
    : [];
  const history = Array.isArray(body.history)
    ? body.history.slice(-180).map((entry) => ({
        question: cleanText(entry?.question || entry, 150),
        category: cleanText(entry?.category, 60),
        answer: cleanText(entry?.answer, 100),
        topicKey: cleanText(entry?.topicKey, 120),
      }))
    : [];

  if (!questions.length || !categories.length) {
    res.status(400).json({ error: 'Questions ou catégories manquantes.' });
    return;
  }

  const schema = {
    type: 'object',
    required: ['reviews'],
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'id', 'approved', 'rejectionReason', 'category', 'difficulty', 'type',
            'question', 'options', 'answer', 'unit', 'explanation', 'topicKey',
          ],
          properties: {
            id: { type: 'string' },
            approved: { type: 'boolean' },
            rejectionReason: { type: 'string' },
            category: { type: 'string' },
            difficulty: { type: 'string', enum: ['Facile', 'Moyen', 'Difficile'] },
            type: { type: 'string', enum: ['mcq', 'truefalse', 'numeric', 'buzzer', 'free'] },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            unit: { type: 'string' },
            explanation: { type: 'string' },
            topicKey: { type: 'string' },
          },
        },
      },
    },
  };

  const prompt = [
    'Tu es le rédacteur en chef et contrôleur qualité d’un jeu télévisé français destiné à des adultes en hôpital de jour.',
    'Relis chaque question indépendamment. Tu dois être sévère : en cas de doute, rejette-la au lieu de l’approuver.',
    `Catégories autorisées : ${categories.join(', ')}.`,
    '',
    'CONTRÔLE FACTUEL :',
    '- Vérifie que l’intitulé, la bonne réponse et l’explication sont exacts, stables et cohérents entre eux.',
    '- Rejette les faits incertains, datés, dépendant de l’actualité, les records susceptibles de changer sans date de référence, et les formulations approximatives.',
    '- Pour la catégorie Records du monde, n’approuve qu’un record historique daté ou une question dont la date de référence est explicitement indiquée.',
    '- Ne transforme jamais une information douteuse en certitude.',
    '',
    'PERTINENCE DES CHOIX :',
    '- Un QCM doit comporter exactement quatre propositions homogènes et une seule réponse incontestablement correcte.',
    '- Chacun des trois distracteurs doit être clairement faux dans le cadre précis de la question.',
    '- Rejette toute question où deux réponses peuvent raisonnablement se défendre, même si l’une paraît plus connue.',
    '- Rejette les questions subjectives : symbole, emblème, plus représentatif, meilleur, principal sans critère explicite, etc.',
    '',
    'DIFFICULTÉ POUR UN PUBLIC ADULTE DE CULTURE GÉNÉRALE :',
    '- Facile : connaissance quotidienne ou scolaire très répandue, réponse attendue de plus de 70 % du public.',
    '- Moyen : connaissance générale nécessitant un vrai rappel, réponse attendue de 30 à 70 % du public.',
    '- Difficile : connaissance précise ou spécialisée, réponse attendue de moins de 30 % du public, sans être une anecdote absurde.',
    '- Corrige obligatoirement l’étiquette de difficulté si elle ne correspond pas à cette grille.',
    '',
    'REDONDANCE :',
    '- Compare toutes les questions entre elles et avec l’historique fourni.',
    '- Deux formulations qui testent le même fait, la même relation sujet-réponse ou les mêmes choix sont des doublons.',
    '- En cas de doublon dans la série, conserve uniquement la formulation la plus précise et rejette les autres.',
    '',
    'RÉÉCRITURE :',
    '- Tu peux corriger légèrement une question, une explication, une difficulté ou des distracteurs si le fond est sûr.',
    '- N’approuve pas une question dont le fond nécessiterait une invention ou une supposition.',
    '- topicKey doit résumer le fait testé sous une forme stable et courte, par exemple « paris|fleuve|seine ».',
    '- Pour mcq, answer doit être exactement le texte de la bonne option. Pour truefalse, answer vaut true ou false. Pour numeric, answer contient seulement la valeur exacte. Pour buzzer/free, answer contient la réponse textuelle attendue.',
    '',
    `HISTORIQUE À NE PAS RÉPÉTER : ${JSON.stringify(history)}`,
    '',
    `QUESTIONS À CONTRÔLER : ${JSON.stringify(questions)}`,
  ].join('\n');

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.08,
          topP: 0.65,
          maxOutputTokens: 22000,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status === 429 ? 429 : 502).json({
        error: data?.error?.message || 'La seconde vérification Gemini a échoué.',
      });
      return;
    }

    const output = extractOutputText(data);
    if (!output) {
      res.status(502).json({ error: 'Le contrôleur qualité n’a renvoyé aucun résultat.' });
      return;
    }

    const parsed = JSON.parse(output);
    const approved = (parsed?.reviews || [])
      .map((review) => normalizeReviewedQuestion(review, categories))
      .filter(Boolean);

    res.status(200).json({
      questions: approved,
      reviewedCount: questions.length,
      approvedCount: approved.length,
      model: DEFAULT_MODEL,
      qualityControl: 'two-pass-editorial-review-v1',
    });
  } catch (error) {
    console.error('Question review failed', error);
    res.status(500).json({ error: 'Impossible de terminer la seconde vérification des questions.' });
  }
};
