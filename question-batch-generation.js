(() => {
  const previousFetch = window.fetch.bind(window);
  const generationPath = /\/api\/generate-questions(?:\?|$)/;
  const BATCH_SIZE = 6;
  const MAX_ROUNDS = 8;

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
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
    let failedRounds = 0;
    const plannedRounds = Math.min(MAX_ROUNDS, Math.ceil(wanted / BATCH_SIZE) + 3);

    for (let round = 0; round < plannedRounds && accepted.length < wanted; round += 1) {
      const missing = wanted - accepted.length;
      const batchCount = Math.min(BATCH_SIZE, Math.max(4, missing));
      const exclude = [
        ...originalExcluded,
        ...accepted.map((question) => question.question),
      ].filter(Boolean).slice(-120);

      setStatus(`Création par petits lots · ${accepted.length}/${wanted} questions validées…`);

      try {
        const response = await previousFetch(input, {
          ...init,
          body: JSON.stringify({
            ...originalBody,
            count: batchCount,
            exclude,
            batchMode: true,
          }),
        });
        lastResponse = response;
        const data = await readData(response);
        lastData = data;
        const candidates = Array.isArray(data.questions) ? data.questions : [];
        const fresh = dedupeQuestions(candidates, accepted);

        for (const question of fresh) {
          if (accepted.length >= wanted) break;
          accepted.push(question);
        }

        if (!fresh.length) {
          failedRounds += 1;
          await wait(700 + round * 250);
        } else {
          failedRounds = 0;
        }
      } catch (error) {
        console.warn('Lot de questions indisponible', error);
        failedRounds += 1;
        await wait(900 + round * 300);
      }

      if (failedRounds >= 3 && accepted.length) break;
    }

    if (!accepted.length) {
      return lastResponse || makeResponse({
        error: 'Aucun lot de questions n’a pu être généré pour le moment.',
        code: 'all_batches_failed',
      }, null, 503);
    }

    setStatus(
      accepted.length >= wanted
        ? `${wanted} questions contrôlées sont prêtes.`
        : `${accepted.length}/${wanted} questions IA validées · complément local en préparation…`,
    );

    return makeResponse({
      ...lastData,
      questions: accepted.slice(0, wanted),
      requestedCount: wanted,
      partial: accepted.length < wanted,
      batchGeneration: {
        enabled: true,
        retained: Math.min(wanted, accepted.length),
        requested: wanted,
      },
    }, lastResponse, 200);
  };
})();
