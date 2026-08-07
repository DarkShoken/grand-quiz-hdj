(() => {
  const originalFetch = window.fetch.bind(window);
  const library = () => Array.isArray(window.GRAND_QUIZ_MEDIA_LIBRARY) ? window.GRAND_QUIZ_MEDIA_LIBRARY : [];

  function bodyFrom(init) {
    try { return JSON.parse(init?.body || '{}'); } catch { return {}; }
  }

  function shuffled(values) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function shuffleQuestion(question) {
    if (question?.type !== 'mcq' || !Array.isArray(question.options) || question.options.length < 2) return { ...question };
    const entries = question.options.map((text, index) => ({ text, correct: index === Number(question.answer) }));
    const mixed = shuffled(entries);
    return {
      ...question,
      options: mixed.map((entry) => entry.text),
      answer: mixed.findIndex((entry) => entry.correct),
    };
  }

  function ensureSetting() {
    if (document.getElementById('specialFormatSelect')) return;
    const speed = document.getElementById('speedSelect')?.closest('.field');
    if (!speed) return;
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = '<label for="specialFormatSelect">Formats spéciaux</label><select id="specialFormatSelect"><option value="auto" selected>Automatique · ~25 %</option><option value="many">Beaucoup · ~40 %</option><option value="off">Désactivés</option></select>';
    speed.after(field);
  }

  function desiredSpecials(count) {
    const mode = document.getElementById('specialFormatSelect')?.value || 'auto';
    if (mode === 'off') return 0;
    return Math.max(1, Math.round(count * (mode === 'many' ? 0.4 : 0.25)));
  }

  function isGenerationRequest(input) {
    const url = typeof input === 'string' ? input : input?.url || '';
    return /\/api\/generate-questions(?:\?|$)/.test(url);
  }

  function jsonResponse(data, response) {
    const headers = new Headers(response.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function multimediaMixFetch(input, init = {}) {
    const response = await originalFetch(input, init);
    if (!isGenerationRequest(input) || !response.ok) return response;

    try {
      const data = await response.clone().json();
      if (!Array.isArray(data.questions)) return response;
      const request = bodyFrom(init);
      const categories = new Set(Array.isArray(request.categories) ? request.categories : []);
      const wanted = Math.max(1, Number(request.count) || data.questions.length);
      const specialCount = Math.min(desiredSpecials(wanted), wanted - 1);
      if (!specialCount) return response;

      const semantic = window.GrandQuizSemanticDedupe;
      const history = semantic?.loadHistory?.() || [];
      const available = shuffled(library().filter((q) => categories.has(q.category)))
        .filter((q) => !history.some((h) => semantic?.isSemanticDuplicate?.(q, h)))
        .filter((q, index, arr) => arr.findIndex((x) => x.id === q.id) === index);

      const chosen = [];
      for (const rawCandidate of available) {
        if (chosen.length >= specialCount) break;
        const candidate = shuffleQuestion(rawCandidate);
        if (semantic?.dedupe) {
          const accepted = semantic.dedupe([candidate], [...data.questions, ...chosen], 1);
          if (!accepted.length) continue;
        }
        chosen.push(candidate);
      }
      if (!chosen.length) return response;

      const standard = [...data.questions];
      const result = [];
      const interval = Math.max(2, Math.floor(wanted / chosen.length));
      let specialIndex = 0;
      let standardIndex = 0;
      for (let i = 0; i < wanted; i += 1) {
        const placeSpecial = specialIndex < chosen.length && (i === Math.min(wanted - 1, 2 + specialIndex * interval));
        if (placeSpecial) result.push(chosen[specialIndex++]);
        else if (standardIndex < standard.length) result.push(standard[standardIndex++]);
      }
      while (result.length < wanted && standardIndex < standard.length) result.push(standard[standardIndex++]);
      while (result.length < wanted && specialIndex < chosen.length) result.push(chosen[specialIndex++]);

      return jsonResponse({ ...data, questions: result.slice(0, wanted), multimediaFormats: chosen.length }, response);
    } catch {
      return response;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureSetting, { once: true });
  else ensureSetting();
})();
