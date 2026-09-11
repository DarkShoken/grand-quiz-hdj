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
    const row = document.getElementById('tvContextBar');
    if (!row) return;

    if (!['question', 'reveal'].includes(latestState?.phase)) {
      if (row.childElementCount) row.replaceChildren();
      row.dataset.signature = '';
      return;
    }

    const data = context();
    if (!data) return;

    const phaseLabel = latestState.phase === 'reveal'
      ? `Réponse ${latestState.questionNumber || '—'}/${latestState.totalQuestions || '—'}`
      : `Question ${latestState.questionNumber || '—'}/${latestState.totalQuestions || '—'}`;
    const signature = `${latestState.phase}|${latestState.questionNumber}|${latestState.totalQuestions}|${data.category}|${data.difficulty}`;
    if (row.dataset.signature === signature) return;

    row.dataset.signature = signature;
    row.replaceChildren(
      badge('question-context-leading', phaseLabel),
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

    const signature = `${latestState.phase}|${data.category}|${data.difficulty}`;
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
    /* TV: les métadonnées vivent dans l'en-tête, jamais dans la carte question. */
    #stage .question-meta{display:none!important}
    .tv-top{grid-template-columns:auto minmax(0,1fr) auto!important;gap:12px!important}
    .tv-context-bar{min-width:0;display:flex;justify-content:center;align-items:center;gap:7px;flex-wrap:nowrap;overflow:hidden}
    .tv-context-bar .badge{flex:0 1 auto;min-width:0;padding:5px 10px!important;font-size:clamp(.72rem,1.45vh,.9rem)!important;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tv-context-bar .question-context-leading{flex:0 0 auto;background:rgba(255,255,255,.08)!important;color:#fff!important}
    .tv-context-bar .question-context-category{max-width:min(52vw,620px)}
    .tv-context-bar .question-context-difficulty{flex:0 0 auto}
    .tv-room-accessible{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}

    .question-context-category{background:rgba(76,201,240,.17)!important;color:#bfefff!important;border:1px solid rgba(76,201,240,.34)!important}
    .question-context-difficulty{background:rgba(255,209,102,.16)!important;color:#ffe7a3!important;border:1px solid rgba(255,209,102,.32)!important}
    .question-context-mobile,.question-context-host-reveal{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin:0 0 10px}
    .question-context-mobile .badge{font-size:.8rem;padding:6px 9px}
    .question-context-host-reveal{justify-content:flex-start;margin-bottom:10px}

    @media(max-width:820px){
      .tv-top{grid-template-columns:auto minmax(0,1fr)!important}
      .answer-count{display:none!important}
      .tv-context-bar{justify-content:flex-end;gap:5px}
      .tv-context-bar .badge{padding:4px 7px!important;font-size:.68rem!important}
      .tv-context-bar .question-context-leading{display:none!important}
      .tv-context-bar .question-context-category{max-width:50vw}
    }
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
