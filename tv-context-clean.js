(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport || G.__tvContextCleanInstalled) return;
  G.__tvContextCleanInstalled = true;

  let latest = null;
  let queued = false;

  function renderContext() {
    queued = false;
    const row = document.getElementById('tvContextBar');
    if (!row) return;

    if (!latest || !['question', 'reveal'].includes(latest.phase) || !latest.question) {
      if (row.childElementCount) row.replaceChildren();
      return;
    }

    const category = String(latest.question.category || '').trim();
    const difficulty = String(latest.question.difficulty || '').trim();
    const signature = `${latest.phase}|${latest.question.id}|${category}|${difficulty}`;
    if (row.dataset.signature === signature) return;
    row.dataset.signature = signature;

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'badge tv-context-category';
    categoryBadge.textContent = `📚 ${category || 'Catégorie'}`;

    const difficultyBadge = document.createElement('span');
    difficultyBadge.className = 'badge tv-context-difficulty';
    difficultyBadge.textContent = `🎯 ${difficulty || 'Difficulté'}`;

    row.replaceChildren(categoryBadge, difficultyBadge);
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(renderContext);
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithCleanTvContext(options = {}) {
    if (options.role !== 'screen') return originalCreateTransport(options);
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message?.type === 'state') {
          latest = message.payload || null;
          originalOnMessage?.(message);
          queueRender();
          return;
        }
        originalOnMessage?.(message);
      },
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', queueRender, { once: true });
  } else {
    queueRender();
  }
})();
