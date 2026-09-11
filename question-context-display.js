(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function' || G.__questionContextDisplayInstalled) return;
  G.__questionContextDisplayInstalled = true;

  let latestState = null;
  let scheduled = false;

  function clean(value) {
    return String(value || '').trim();
  }

  function context() {
    const question = latestState?.question;
    if (!question) return null;
    return {
      category: clean(question.category),
      difficulty: clean(question.difficulty),
    };
  }

  function badge(className, text) {
    const node = document.createElement('span');
    node.className = `badge ${className}`;
    node.textContent = text;
    return node;
  }

  function patchTv() {
    if (!['question', 'reveal'].includes(latestState?.phase)) return;
    const data = context();
    const meta = document.querySelector('#stage .question-meta');
    if (!data || !meta) return;

    const leadingText = latestState.phase === 'reveal'
      ? 'Réponse'
      : `Question ${latestState.questionNumber || '—'}/${latestState.totalQuestions || '—'}`;

    meta.replaceChildren(
      badge('question-context-leading', leadingText),
      badge('question-context-category', `📚 ${data.category || 'Catégorie non renseignée'}`),
      badge('question-context-difficulty', `🎯 ${data.difficulty || 'Difficulté non renseignée'}`),
    );
  }

  function patchPlayer() {
    if (!['question', 'reveal'].includes(latestState?.phase)) return;
    const data = context();
    const app = document.getElementById('app');
    if (!data || !app) return;

    let row = app.querySelector('.question-context-mobile');
    if (!row) {
      row = document.createElement('div');
      row.className = 'question-context-mobile';
      app.prepend(row);
    }

    const signature = `${data.category}|${data.difficulty}`;
    if (row.dataset.signature === signature) return;
    row.dataset.signature = signature;
    row.replaceChildren(
      badge('question-context-category', `📚 ${data.category || 'Catégorie non renseignée'}`),
      badge('question-context-difficulty', `🎯 ${data.difficulty || 'Difficulté non renseignée'}`),
    );
  }

  function patchHostReveal() {
    if (latestState?.phase !== 'reveal') return;
    const data = context();
    const stage = document.getElementById('hostStage');
    if (!data || !stage) return;

    let row = stage.querySelector('.question-context-host-reveal');
    if (!row) {
      row = document.createElement('div');
      row.className = 'question-context-host-reveal';
      stage.prepend(row);
    }

    const signature = `${data.category}|${data.difficulty}`;
    if (row.dataset.signature === signature) return;
    row.dataset.signature = signature;
    row.replaceChildren(
      badge('question-context-category', `📚 ${data.category || 'Catégorie non renseignée'}`),
      badge('question-context-difficulty', `🎯 ${data.difficulty || 'Difficulté non renseignée'}`),
    );
  }

  function patch() {
    scheduled = false;
    patchTv();
    patchPlayer();
    patchHostReveal();
  }

  function schedulePatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(patch));
  }

  const style = document.createElement('style');
  style.textContent = `
    #stage .question-meta{display:flex!important;justify-content:center!important;gap:9px!important;flex-wrap:wrap!important;min-height:36px!important;visibility:visible!important;opacity:1!important}
    #stage .question-meta .badge{font-size:clamp(.9rem,1.8vh,1.12rem)!important;padding:7px 13px!important}
    .question-context-category{background:rgba(76,201,240,.17)!important;color:#bfefff!important;border:1px solid rgba(76,201,240,.34)!important}
    .question-context-difficulty{background:rgba(255,209,102,.16)!important;color:#ffe7a3!important;border:1px solid rgba(255,209,102,.32)!important}
    .question-context-mobile,.question-context-host-reveal{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin:0 0 10px}
    .question-context-mobile .badge{font-size:.8rem;padding:6px 9px}
    .question-context-host-reveal{justify-content:flex-start;margin-bottom:10px}
  `;
  document.head.appendChild(style);

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithQuestionContext(options = {}) {
    const originalOnMessage = options.onMessage;
    const wrappedOptions = {
      ...options,
      onMessage(message) {
        if (message?.type === 'state' && message.payload && typeof message.payload === 'object') {
          latestState = message.payload;
        }
        originalOnMessage?.(message);
        if (message?.type === 'state') schedulePatch();
      },
    };

    const transport = originalCreateTransport(wrappedOptions);
    if (options.role !== 'host' || !transport?.send) return transport;

    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state' && payload && typeof payload === 'object') {
        latestState = payload;
        schedulePatch();
      }
      return originalSend(type, payload);
    };
    return transport;
  };

  const startObserver = () => {
    new MutationObserver(schedulePatch).observe(document.body, { childList: true, subtree: true });
    schedulePatch();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();
})();
