(() => {
  const currentFetch = window.fetch.bind(window);
  const PRIMARY_PATH = /\/api\/generate-questions(?:\?|$)/;
  const RETRY_DELAYS = [0, 1200, 3000];
  const FALLBACK_DELAYS = [0, 1800];

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function fallbackUrl(input) {
    const url = requestUrl(input);
    return url.replace('/api/generate-questions', '/api/generate-questions-lite');
  }

  function setStatus(text) {
    const node = document.getElementById('generationStatus');
    if (node) {
      node.textContent = text;
      node.style.color = '#ffd166';
    }
  }

  function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async function responseData(response) {
    try { return await response.clone().json(); }
    catch { return {}; }
  }

  function isTemporaryFailure(response, data) {
    if ([429, 500, 502, 503, 504].includes(response.status)) return true;
    const message = String(data?.error || data?.error?.message || '').toLowerCase();
    return /high demand|temporar|overload|unavailable|try again|resource exhausted|rate limit|satur/.test(message);
  }

  function jsonResponse(data, source, status = source.status) {
    const headers = new Headers(source.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), {
      status,
      statusText: source.statusText,
      headers,
    });
  }

  async function filterFallback(response, init) {
    const data = await responseData(response);
    if (!response.ok || !Array.isArray(data.questions)) return response;

    const semantic = window.GrandQuizSemanticDedupe;
    if (!semantic?.dedupe || !semantic?.loadHistory) return response;

    let body = {};
    try { body = JSON.parse(init?.body || '{}'); } catch {}
    const wanted = Math.max(1, Math.min(30, Number(body.count) || data.questions.length || 1));
    const explicit = [
      ...(Array.isArray(body.excludeEntries) ? body.excludeEntries : []),
      ...(Array.isArray(body.exclude) ? body.exclude : []),
    ];
    const blockers = [...semantic.loadHistory(), ...explicit];
    const questions = semantic.dedupe(data.questions, blockers, wanted);

    return jsonResponse({
      ...data,
      questions,
      fallbackModel: true,
      semanticDeduplication: {
        ...(data.semanticDeduplication || {}),
        requested: wanted,
        retained: questions.length,
      },
    }, response, 200);
  }

  window.fetch = async function resilientGeminiFetch(input, init = {}) {
    const url = requestUrl(input);
    if (!PRIMARY_PATH.test(url)) return currentFetch(input, init);

    let lastResponse = null;

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
      const delay = RETRY_DELAYS[attempt];
      if (delay) {
        setStatus(`Gemini est très sollicité · nouvelle tentative ${attempt + 1}/${RETRY_DELAYS.length}…`);
        await wait(delay);
      }

      try {
        const response = await currentFetch(input, init);
        lastResponse = response;
        const data = await responseData(response);
        if (response.ok || !isTemporaryFailure(response, data)) return response;
      } catch (error) {
        if (attempt === RETRY_DELAYS.length - 1) console.warn('Gemini principal indisponible', error);
      }
    }

    const liteUrl = fallbackUrl(input);
    setStatus('Modèle principal saturé · essai automatique du modèle de secours…');

    for (let attempt = 0; attempt < FALLBACK_DELAYS.length; attempt += 1) {
      const delay = FALLBACK_DELAYS[attempt];
      if (delay) await wait(delay);

      try {
        const response = await currentFetch(liteUrl, init);
        lastResponse = response;
        const data = await responseData(response);
        if (response.ok) return filterFallback(response, init);
        if (!isTemporaryFailure(response, data)) return response;
      } catch (error) {
        if (attempt === FALLBACK_DELAYS.length - 1) console.warn('Gemini de secours indisponible', error);
      }
    }

    return new Response(JSON.stringify({
      error: 'Gemini est momentanément saturé malgré plusieurs tentatives. Réessaie dans quelques instants.',
      code: 'gemini_temporarily_unavailable',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
})();
