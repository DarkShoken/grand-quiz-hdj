(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport || G.__playContextCleanInstalled) return;
  G.__playContextCleanInstalled = true;

  let latest = null;
  let queued = false;
  let lastQuestionKey = '';

  function ensureContext() {
    queued = false;
    if (!latest || latest.phase !== 'question' || !latest.question) {
      lastQuestionKey = '';
      return;
    }

    const meta = document.querySelector('#app .mobile-meta');
    if (!meta) return;

    const category = String(latest.question.category || '').trim();
    const difficulty = String(latest.question.difficulty || '').trim();
    const questionId = String(latest.question.id || '');
    const key = `${questionId}|${category}|${difficulty}`;

    let categoryNode = meta.querySelector('.play-category');
    let difficultyNode = meta.querySelector('.play-difficulty');
    let statusNode = meta.querySelector('.answer-status');

    // Si player-v6 vient de créer le DOM d'une nouvelle question, on convertit
    // la ligne de métadonnées une seule fois. Aucun replaceChildren ensuite.
    if (!categoryNode || !difficultyNode) {
      const oldStatusText = statusNode?.textContent || '';
      const questionBadge = [...meta.children].find((node) =>
        !node.classList.contains('answer-status') && /Question\s+\d+/i.test(node.textContent || '')
      );
      questionBadge?.remove();

      categoryNode = document.createElement('span');
      categoryNode.className = 'badge play-category';

      difficultyNode = document.createElement('span');
      difficultyNode.className = 'badge play-difficulty';

      if (!statusNode) {
        statusNode = document.createElement('span');
        statusNode.className = 'badge answer-status';
        statusNode.textContent = oldStatusText;
      }

      meta.insertBefore(categoryNode, statusNode || null);
      meta.insertBefore(difficultyNode, statusNode || null);
    }

    // Ne touche au DOM que lorsque la question/catégorie/difficulté change.
    if (key !== lastQuestionKey) {
      const categoryText = `📚 ${category || 'Catégorie'}`;
      const difficultyText = `🎯 ${difficulty || 'Difficulté'}`;
      if (categoryNode.textContent !== categoryText) categoryNode.textContent = categoryText;
      if (difficultyNode.textContent !== difficultyText) difficultyNode.textContent = difficultyText;
      lastQuestionKey = key;
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensureContext);
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