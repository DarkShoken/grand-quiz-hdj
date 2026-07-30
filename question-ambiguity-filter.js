(() => {
  const nativeFetch = window.fetch.bind(window);

  const subjectiveQuestionPatterns = [
    /\bembl[eè]matique\b/i,
    /\brepr[eé]sente\s+le\s+mieux\b/i,
    /\ble\s+plus\s+(?:connu|c[eé]l[eè]bre|typique|repr[eé]sentatif|important)\b/i,
    /\bprincipal(?:e)?\s+(?:symbole|embl[eè]me|ic[oô]ne)\b/i,
    /\b(?:symbole|embl[eè]me|ic[oô]ne)\s+(?:fort|traditionnel|culturel|de\s+la|du|des)\b/i,
    /\bquel(?:le)?\s+.+\s+est\s+(?:typique|traditionnel(?:le)?|associ[eé](?:e)?)\b/i,
    /\bconsid[eé]r[eé](?:e)?\s+comme\b/i,
  ];

  const nonUniqueExplanationPatterns = [
    /\bl['’]un(?:e)?\s+des\b/i,
    /\bparmi\s+les\b/i,
    /\bnotamment\b/i,
    /\bpeut\s+(?:aussi|[eê]tre)\b/i,
    /\b[eé]galement\b/i,
    /\bsouvent\s+(?:associ[eé]|consid[eé]r[eé])\b/i,
    /\bplusieurs\b/i,
  ];

  function isObjectiveSymbolQuestion(text) {
    return /\bsymbole\s+(?:chimique|math[eé]matique|mon[eé]taire|musical|phon[eé]tique)\b/i.test(text);
  }

  function isAmbiguous(question) {
    const prompt = String(question?.question || '');
    const explanation = String(question?.explanation || '');
    if (!prompt || !explanation) return true;
    if (!isObjectiveSymbolQuestion(prompt) && subjectiveQuestionPatterns.some((pattern) => pattern.test(prompt))) return true;
    if (nonUniqueExplanationPatterns.some((pattern) => pattern.test(explanation))) return true;
    return false;
  }

  function isGenerationRequest(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    return method === 'POST' && /\/api\/generate-questions(?:\?|$)/.test(url);
  }

  window.fetch = async function strictQuizFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!isGenerationRequest(input, init) || !response.ok) return response;

    try {
      const data = await response.clone().json();
      if (!Array.isArray(data?.questions)) return response;
      const filtered = data.questions.filter((question) => !isAmbiguous(question));
      if (filtered.length === data.questions.length) return response;

      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Cache-Control', 'no-store');
      return new Response(JSON.stringify({
        ...data,
        questions: filtered,
        rejectedAmbiguousQuestions: data.questions.length - filtered.length,
        qualityControl: `${data.qualityControl || 'editorial'}+ambiguity-filter`,
      }), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };
})();