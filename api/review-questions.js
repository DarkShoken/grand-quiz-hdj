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

function calibratedDifficulty(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  if (value >= 70) return 'Facile';
  if (value >= 35) return 'Moyen';
  return 'Difficile';
}

function normalizeReviewedQuestion(raw, allowedCategories, targetDifficulty) {
  if (!raw || raw.approved !== true) return null;

  const type = ['mcq', 'truefalse', 'numeric', 'buzzer', 'free'].includes(raw.type)
    ? raw.type
    : null;
  const category = cleanText(raw.category, 60);
  const rate = Math.round(Number(raw.estimatedSuccessRate));
  const difficulty = calibratedDifficulty(rate);
  const question = cleanText(raw.question, 150);
  const explanation = cleanText(raw.explanation, 240);
  const topicKey = cleanText(raw.topicKey, 120);

  if (!type || !difficulty || !allowedCategories.includes(category)) return null;
  if (rate < 8) return null; // trop obscur pour rester ludique, même en Difficile
  if (targetDifficulty && targetDifficulty !== 'Mixte' && difficulty !== targetDifficulty) return null;
  if (question.length < 12 || question.length > 130 || !/[?？.]$/.test(question)) return null;
  if (explanation.length < 12 || !topicKey) return null;

  const base = {
    id: cleanText(raw.id, 120) || `reviewed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    difficulty,
    estimatedSuccessRate: rate,
    type,
    question,
    explanation,
    topicKey,
    reviewed: true,
    independentlySolved: true,
    difficultyCalibrated: true,
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
  const targetDifficulty = ['Facile', 'Moyen', 'Difficile', 'Mixte'].includes(body.targetDifficulty)
    ? body.targetDifficulty
    : 'Mixte';
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

  // Le contrôleur ne reçoit NI la réponse, NI l'explication, NI l'étiquette de difficulté
  // du premier modèle. Il résout et calibre donc chaque question indépendamment.
  const blindQuestions = questions.map((question) => ({
    id: cleanText(question?.id, 120),
    category: cleanText(question?.category, 60),
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
            'id', 'approved', 'rejectionReason', 'category', 'type',
            'question', 'options', 'answer', 'unit', 'explanation', 'topicKey',
            'estimatedSuccessRate',
          ],
          properties: {
            id: { type: 'string' },
            approved: { type: 'boolean' },
            rejectionReason: { type: 'string' },
            category: { type: 'string' },
            type: { type: 'string', enum: ['mcq', 'truefalse', 'numeric', 'buzzer', 'free'] },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            unit: { type: 'string' },
            explanation: { type: 'string' },
            topicKey: { type: 'string' },
            estimatedSuccessRate: { type: 'integer' },
          },
        },
      },
    },
  };

  const prompt = [
    'Tu es le vérificateur final indépendant d’un jeu télévisé français destiné à des adultes.',
    'IMPORTANT : la réponse, l’explication et la difficulté proposées par le premier auteur t’ont volontairement été cachées. Tu dois résoudre et calibrer chaque question toi-même.',
    'Tu dois être conservateur : si tu n’es pas certain du fait ou si plusieurs réponses sont défendables, rejette la question.',
    `Catégories autorisées : ${categories.join(', ')}.`,
    targetDifficulty === 'Mixte'
      ? 'La série demandée est de difficulté Mixte : calibre chaque question indépendamment sans chercher à conserver l’étiquette du premier auteur.'
      : `La partie demande le niveau ${targetDifficulty}. Une question dont le taux de réussite estimé ne correspond pas réellement à ce niveau doit être rejetée.`,
    '',
    'MÉTHODE OBLIGATOIRE POUR CHAQUE QUESTION :',
    '1. Résous la question toi-même à partir de l’intitulé et des choix éventuels.',
    '2. Vérifie que les autres choix sont faux dans le cadre exact de la question.',
    '3. Si l’intitulé est imprécis, daté, dépend d’une convention non précisée ou d’un fait dont tu n’es pas sûr, approved=false.',
    '4. Si elle est sûre, renvoie la réponse que TU as déterminée et une explication courte qui mentionne explicitement cette réponse.',
    '5. Estime ensuite estimatedSuccessRate entre 0 et 100 : pourcentage de Français adultes de culture générale ordinaire qui répondraient correctement dans les conditions réelles du jeu, en voyant les choix pour un QCM.',
    '',
    'CALIBRAGE DE DIFFICULTÉ — très important :',
    '- Le serveur classe automatiquement : 70–100 % = Facile ; 35–69 % = Moyen ; 0–34 % = Difficile.',
    '- Une question évidente grâce aux choix reste Facile même si le sujet semble savant.',
    '- Une question ne devient jamais Difficile parce qu’elle est mal formulée, piégeuse ou basée sur un détail arbitraire.',
    '- Difficile doit correspondre à une connaissance précise mais intéressante et reconnaissable ; une anecdote microscopique estimée sous 8 % doit être rejetée.',
    '- Évalue la notoriété réelle du fait demandé, pas simplement la notoriété du thème.',
    '',
    'CONTRÔLE FACTUEL :',
    '- Privilégie les faits stables, largement documentés et sans exception raisonnable.',
    '- Rejette légendes populaires, approximations, généralisations, superlatifs sans critère, statistiques mouvantes et informations dépendant de l’actualité.',
    '- Records du monde : uniquement records humains clairement définis, avec date de référence lorsqu’ils peuvent évoluer.',
    '- Expressions françaises des régions : expression réellement attestée dans la région indiquée ; rejette les attributions régionales discutables.',
    '- Architecture : styles, bâtiments, architectes et vocabulaire architectural sur des faits établis.',
    '- BTP & travaux : outils, matériaux, métiers, étapes de chantier et principes techniques stables ; évite normes ou réglementations susceptibles d’évoluer.',
    '- Jeux olympiques : histoire, disciplines, symboles et exploits historiques ; date tout record ou donnée susceptible d’évoluer.',
    '- Célébrités : œuvres, rôles, carrières et faits biographiques publics et stables ; jamais rumeurs, vie privée, fortune, relation actuelle ou âge actuel.',
    '',
    'QCM : exactement quatre choix homogènes, une seule réponse incontestable ; answer doit être exactement le texte de la bonne option.',
    'VRAI/FAUX : l’énoncé doit être entièrement vrai ou entièrement faux sans exception raisonnable ; answer vaut true ou false.',
    'NUMÉRIQUE : accepte seulement une valeur exacte et stable ; answer contient uniquement la valeur numérique correcte.',
    'BUZZER / LIBRE : réponse attendue courte et unique ; rejette les questions acceptant plusieurs entités réellement différentes.',
    '',
    'REDONDANCE : compare les questions entre elles et avec l’historique. Deux questions testant le même fait sont des doublons : n’en garde qu’une.',
    'topicKey résume le fait testé sous une forme stable, par exemple « paris|fleuve|seine ».',
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
      .map((review) => normalizeReviewedQuestion(review, categories, targetDifficulty))
      .filter(Boolean);

    res.status(200).json({
      questions: approved,
      reviewedCount: questions.length,
      approvedCount: approved.length,
      model: DEFAULT_MODEL,
      qualityControl: 'blind-answer-and-difficulty-review-v3',
      targetDifficulty,
    });
  } catch (error) {
    console.error('Independent question review failed', error);
    res.status(500).json({ error: 'Impossible de terminer la vérification indépendante des questions.' });
  }
};
