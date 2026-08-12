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

function explanationConfirmsAnswer(explanation, answer) {
  const exp = normalize(explanation);
  const ans = normalize(answer);
  if (!exp || !ans) return false;
  if (/^\d+(?:\.\d+)?$/.test(ans)) return exp.includes(ans);
  if (ans.length <= 3) return true;
  return exp.includes(ans);
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
    independentlySolved: true,
  };

  if (type === 'mcq') {
    const options = Array.isArray(raw.options)
      ? raw.options.map((item) => cleanText(item, 65)).filter(Boolean).slice(0, 4)
      : [];
    if (options.length !== 4 || new Set(options.map(normalize)).size !== 4) return null;
    const answerText = cleanText(raw.answer, 65);
    const answer = options.findIndex((option) => normalize(option) === normalize(answerText));
    if (answer < 0 || !explanationConfirmsAnswer(explanation, answerText)) return null;
    return { ...base, options, answer };
  }

  if (type === 'truefalse') {
    const answer = normalize(raw.answer);
    if (!['true', 'false', 'vrai', 'faux'].includes(answer)) return null;
    return { ...base, answer: answer === 'true' || answer === 'vrai' };
  }

  if (type === 'numeric') {
    const answer = Number(String(raw.answer).replace(',', '.'));
    if (!Number.isFinite(answer) || !explanationConfirmsAnswer(explanation, String(answer))) return null;
    return { ...base, answer, unit: cleanText(raw.unit, 40) };
  }

  const answerText = cleanText(raw.answer, 100);
  if (!answerText || !explanationConfirmsAnswer(explanation, answerText)) return null;
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

  // Important : le contrôleur ne reçoit volontairement NI la réponse proposée,
  // NI l'explication du premier modèle. Il doit résoudre chaque question lui-même.
  const blindQuestions = questions.map((question) => ({
    id: cleanText(question?.id, 120),
    category: cleanText(question?.category, 60),
    difficulty: cleanText(question?.difficulty, 20),
    type: cleanText(question?.type, 20),
    question: cleanText(question?.question, 150),
    options: Array.isArray(question?.options)
      ? question.options.map((item) => cleanText(item, 65)).filter(Boolean).slice(0, 4)
      : [],
    unit: cleanText(question?.unit, 40),
  }));

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
    'Tu es le vérificateur final indépendant d’un jeu télévisé français destiné à des adultes.',
    'IMPORTANT : les réponses et explications proposées par le premier auteur t’ont volontairement été cachées. Tu dois résoudre chaque question toi-même, sans supposer que l’auteur avait raison.',
    'Tu dois être conservateur : si tu n’es pas certain du fait ou si plusieurs réponses sont défendables, rejette la question.',
    `Catégories autorisées : ${categories.join(', ')}.`,
    '',
    'MÉTHODE OBLIGATOIRE POUR CHAQUE QUESTION :',
    '1. Lis seulement l’intitulé et les choix éventuels.',
    '2. Détermine toi-même la réponse à partir d’une connaissance stable et incontestable.',
    '3. Vérifie mentalement que les autres choix sont faux dans le cadre exact de la question.',
    '4. Si l’intitulé est imprécis, daté, dépend d’une convention non précisée ou exige une information obscure dont tu n’es pas sûr, rejette la question.',
    '5. Si elle est sûre, renvoie la bonne réponse que TU as déterminée et rédige une explication courte qui mentionne explicitement cette réponse.',
    '',
    'CONTRÔLE FACTUEL :',
    '- Privilégie les faits stables, largement documentés et sans exception raisonnable.',
    '- Rejette les légendes populaires, approximations, généralisations, superlatifs sans critère, statistiques mouvantes et informations dépendant de l’actualité.',
    '- Pour Records du monde : uniquement des records humains clairement définis, avec date de référence lorsqu’ils peuvent évoluer.',
    '- Pour Expressions françaises des régions : l’expression doit être réellement attestée dans la région indiquée ; rejette les usages trop diffus, discutables ou attribués à une région unique sans certitude.',
    '- Pour les questions historiques, scientifiques ou géographiques : refuse toute formulation qui confond date, lieu, personne, unité, classification ou causalité.',
    '',
    'QCM :',
    '- Exactement quatre choix homogènes et une seule réponse incontestablement correcte.',
    '- answer doit être exactement le texte de la bonne option.',
    '- Si deux options peuvent être vraies selon une interprétation raisonnable, approved=false.',
    '',
    'VRAI/FAUX :',
    '- L’énoncé doit être entièrement vrai ou entièrement faux sans exception raisonnable.',
    '- answer vaut true ou false.',
    '',
    'NUMÉRIQUE :',
    '- Accepte seulement une valeur exacte et stable.',
    '- answer contient uniquement la valeur numérique correcte.',
    '',
    'BUZZER / LIBRE :',
    '- La réponse attendue doit être courte et unique.',
    '- Évite les questions où plusieurs formulations ou entités différentes pourraient être considérées comme correctes.',
    '',
    'DIFFICULTÉ :',
    '- Facile : connaissance très répandue, >70 % de réussite attendue.',
    '- Moyen : vraie culture générale, environ 30–70 %.',
    '- Difficile : connaissance précise, <30 %, mais pas anecdote obscure ou arbitraire.',
    '- Corrige l’étiquette si nécessaire.',
    '',
    'REDONDANCE :',
    '- Compare les questions entre elles et avec l’historique.',
    '- Deux questions testant le même fait ou la même relation sujet-réponse sont des doublons : n’en garde qu’une.',
    '- topicKey résume le fait testé sous une forme stable, par exemple « paris|fleuve|seine ».',
    '',
    `HISTORIQUE À NE PAS RÉPÉTER : ${JSON.stringify(history)}`,
    '',
    `QUESTIONS À RÉSOUDRE ET VÉRIFIER : ${JSON.stringify(blindQuestions)}`,
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
          temperature: 0.02,
          topP: 0.45,
          maxOutputTokens: 22000,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status === 429 ? 429 : 502).json({
        error: data?.error?.message || 'La vérification indépendante Gemini a échoué.',
      });
      return;
    }

    const output = extractOutputText(data);
    if (!output) {
      res.status(502).json({ error: 'Le contrôleur indépendant n’a renvoyé aucun résultat.' });
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
      qualityControl: 'blind-independent-answer-review-v2',
    });
  } catch (error) {
    console.error('Independent question review failed', error);
    res.status(500).json({ error: 'Impossible de terminer la vérification indépendante des questions.' });
  }
};
