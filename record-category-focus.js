(() => {
  const previousFetch = window.fetch.bind(window);
  const DISPLAY_CATEGORY = 'Records du monde';
  const AI_CATEGORY = 'Records du monde — exploits humains homologués type Guinness, avec date de référence';
  const generationPath = /\/api\/(?:generate|review)-questions(?:-lite)?(?:\?|$)/;

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function isRelevantRequest(input, init) {
    return String(init?.method || 'GET').toUpperCase() === 'POST' && generationPath.test(requestUrl(input));
  }

  function mapCategory(value, toAi) {
    if (toAi && value === DISPLAY_CATEGORY) return AI_CATEGORY;
    if (!toAi && value === AI_CATEGORY) return DISPLAY_CATEGORY;
    return value;
  }

  function rewriteBody(init) {
    if (typeof init?.body !== 'string') return init;
    try {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.categories)) {
        body.categories = body.categories.map((category) => mapCategory(category, true));
      }
      if (Array.isArray(body.questions)) {
        body.questions = body.questions.map((question) => ({
          ...question,
          category: mapCategory(question?.category, true),
        }));
      }
      return { ...init, body: JSON.stringify(body) };
    } catch {
      return init;
    }
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function isHumanRecord(question) {
    if (mapCategory(question?.category, false) !== DISPLAY_CATEGORY) return true;
    const text = normalize(`${question?.question || ''} ${question?.explanation || ''}`);
    const hasDate = /\b(?:18|19|20)\d{2}\b/.test(text);
    const humanTheme = /\b(personne|humain|homme|femme|athlete|coureur|nageur|alpiniste|pilote|recordman|recordwoman|taille|grand|petit|age|longevite|force|fort|rapide|vitesse|poids|lourd|endurance|apnee|marathon|saut|soulev|port|traction|course|exploit)\b/.test(text);
    const excludedTheme = /\b(animal|chien|chat|cheval|baleine|arbre|plante|montagne|fleuve|ocean|temperature|meteo|batiment|monument|entreprise)\b/.test(text);
    return hasDate && humanTheme && !excludedTheme;
  }

  async function rewriteResponse(response) {
    if (!response.ok) return response;
    try {
      const data = await response.clone().json();
      if (!Array.isArray(data?.questions)) return response;
      const mapped = data.questions
        .map((question) => ({ ...question, category: mapCategory(question?.category, false) }))
        .filter(isHumanRecord);
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({
        ...data,
        questions: mapped,
        rejectedNonHumanRecords: data.questions.length - mapped.length,
      }), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }

  window.fetch = async function focusedRecordFetch(input, init = {}) {
    if (!isRelevantRequest(input, init)) return previousFetch(input, init);
    const response = await previousFetch(input, rewriteBody(init));
    return rewriteResponse(response);
  };
})();
