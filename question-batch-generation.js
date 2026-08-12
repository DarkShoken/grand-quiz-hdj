(() => {
  const previousFetch = window.fetch.bind(window);
  const generationPath = /\/api\/generate-questions(?:\?|$)/;
  const BATCH_SIZE = 10;
  const MAX_CONCURRENCY = 2;

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function setStatus(text) {
    const node = document.getElementById('generationStatus');
    if (node) {
      node.textContent = text;
      node.style.color = '#ffd166';
    }
  }

  async function readData(response) {
    try { return await response.clone().json(); }
    catch { return {}; }
  }

  function makeResponse(data, source, status = 200) {
    const headers = new Headers(source?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(data), {
      status,
      statusText: status === 200 ? 'OK' : (source?.statusText || ''),
      headers,
    });
  }

  function dedupeQuestions(candidates, accepted) {
    const semantic = window.GrandQuizSemanticDedupe;
    if (semantic?.dedupe) return semantic.dedupe(candidates, accepted);

    const seen = new Set(accepted.map((question) => String(question?.question || '').toLowerCase().trim()));
    return (candidates || []).filter((question) => {
      const key = String(question?.question || '').toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function runPool(tasks, worker, concurrency = MAX_CONCURRENCY) {
    const results = new Array(tasks.length);
    let cursor = 0;

    async function consume() {
      while (true) {
        const index = cursor++;
        if (index >= tasks.length) return;
        try { results[index] = await worker(tasks[index], index); }
        catch (error) { results[index] = { error }; }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, consume));
    return results;
  }

  window.fetch = async function batchedQuestionFetch(input, init = {}) {
    const url = requestUrl(input);
    if (!generationPath.test(url) || typeof init.body !== 'string') return previousFetch(input, init);

    let originalBody;
    try { originalBody = JSON.parse(init.body); }
    catch { return previousFetch(input, init); }

    const wanted = Math.max(1, Math.min(30, Number(originalBody.count) || 1));
    if (wanted <= 10) return previousFetch(input, init);

    const accepted = [];
    const originalExcluded = Array.isArray(originalBody.exclude) ? originalBody.exclude : [];
    let lastResponse = null;
    let lastData = {};

    const batches = [];
    for (let remaining = wanted; remaining > 0; remaining -= BATCH_SIZE) {
      batches.push(Math.min(BATCH_SIZE, remaining));
    }

    setStatus(`Création accélérée · ${batches.length} lots, jusqu’à ${MAX_CONCURRENCY} en parallèle…`);

    const initialResults = await runPool(batches, async (batchCount, index) => {
      const response = await previousFetch(input, {
        ...init,
        body: JSON.stringify({
          ...originalBody,
          count: batchCount,
          exclude: originalExcluded.slice(-100),
          batchMode: true,
          batchIndex: index,
        }),
      });
      const data = await readData(response);
      return { response, data };
    });

    for (const result of initialResults) {
      if (!result || result.error) continue;
      lastResponse = result.response;
      lastData = result.data || lastData;
      const candidates = Array.isArray(result.data?.questions) ? result.data.questions : [];
      const fresh = dedupeQuestions(candidates, accepted);
      for (const question of fresh) {
        if (accepted.length >= wanted) break;
        accepted.push(question);
      }
      setStatus(`Création accélérée · ${accepted.length}/${wanted} questions validées…`);
    }

    if (accepted.length < wanted) {
      const missing = wanted - accepted.length;
      setStatus(`Complément rapide · ${accepted.length}/${wanted} questions validées…`);
      try {
        const response = await previousFetch(input, {
          ...init,
          body: JSON.stringify({
            ...originalBody,
            count: Math.min(BATCH_SIZE, Math.max(4, missing)),
            exclude: [
              ...originalExcluded,
              ...accepted.map((question) => question.question),
            ].filter(Boolean).slice(-100),
            batchMode: true,
            topUp: true,
          }),
        });
        lastResponse = response;
        const data = await readData(response);
        lastData = data || lastData;
        const fresh = dedupeQuestions(Array.isArray(data.questions) ? data.questions : [], accepted);
        for (const question of fresh) {
          if (accepted.length >= wanted) break;
          accepted.push(question);
        }
      } catch (error) {
        console.warn('Complément IA indisponible', error);
      }
    }

    if (!accepted.length) {
      return lastResponse || makeResponse({
        error: 'Aucune question IA n’a pu être générée pour le moment.',
        code: 'all_fast_batches_failed',
      }, null, 503);
    }

    setStatus(
      accepted.length >= wanted
        ? `${wanted} questions contrôlées sont prêtes.`
        : `${accepted.length}/${wanted} questions IA validées · complément local immédiat…`,
    );

    return makeResponse({
      ...lastData,
      questions: accepted.slice(0, wanted),
      requestedCount: wanted,
      partial: accepted.length < wanted,
      batchGeneration: {
        enabled: true,
        mode: 'parallel-fast',
        retained: Math.min(wanted, accepted.length),
        requested: wanted,
        batches: batches.length,
        concurrency: MAX_CONCURRENCY,
      },
    }, lastResponse, 200);
  };
})();
