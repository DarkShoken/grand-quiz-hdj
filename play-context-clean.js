(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport || G.__playContextCleanInstalled) return;
  G.__playContextCleanInstalled = true;

  let latest = null;
  let queued = false;

  function patch() {
    queued = false;
    if (!latest || latest.phase !== 'question' || !latest.question) return;
    const meta = document.querySelector('#app .mobile-meta');
    if (!meta) return;

    const category = String(latest.question.category || '').trim();
    const difficulty = String(latest.question.difficulty || '').trim();
    const existingStatus = meta.querySelector('.answer-status');
    const statusText = existingStatus?.textContent || '';

    const categoryNode = document.createElement('span');
    categoryNode.className = 'badge play-category';
    categoryNode.textContent = `📚 ${category || 'Catégorie'}`;

    const difficultyNode = document.createElement('span');
    difficultyNode.className = 'badge play-difficulty';
    difficultyNode.textContent = `🎯 ${difficulty || 'Difficulté'}`;

    const statusNode = document.createElement('span');
    statusNode.className = 'badge answer-status';
    statusNode.textContent = /Question\s+\d+/i.test(statusText) || statusText === category ? '' : statusText;

    meta.replaceChildren(categoryNode, difficultyNode, statusNode);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => requestAnimationFrame(patch));
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithCleanPlayerContext(options = {}) {
    if (options.role !== 'player') return originalCreateTransport(options);
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message?.type === 'state') latest = message.payload || null;
        originalOnMessage?.(message);
        if (message?.type === 'state') schedule();
      },
    });
  };
})();