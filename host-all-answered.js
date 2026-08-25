(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const REVEAL_DELAY_MS = 3000;
  let latestState = null;
  let countdownQuestionId = null;
  let revealAt = 0;
  let actionDoneForQuestion = null;

  function onlinePlayerIds(state) {
    return (state?.players || [])
      .filter((player) => player?.id && player.online !== false)
      .map((player) => player.id);
  }

  function everyoneAnswered(state) {
    if (state?.phase !== 'question') return false;
    if (!state?.question?.id || state.question.type === 'buzzer') return false;

    const activePlayers = onlinePlayerIds(state);
    if (!activePlayers.length) return false;

    const answered = new Set(state.answeredPlayerIds || []);
    const answerCount = Number(state.answerCount) || answered.size;

    // answerCount sert de garde-fou si un ancien client ne renvoie pas
    // correctement answeredPlayerIds, tout en vérifiant les IDs quand ils existent.
    return answerCount >= activePlayers.length ||
      activePlayers.every((playerId) => answered.has(playerId));
  }

  function removeNotice() {
    document.getElementById('allAnsweredRevealBadge')?.remove();
  }

  function paintNotice() {
    if (!revealAt || latestState?.phase !== 'question') {
      removeNotice();
      return;
    }

    const meta = document.querySelector('#hostStage .question-meta-host');
    if (!meta) return;

    let badge = document.getElementById('allAnsweredRevealBadge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'allAnsweredRevealBadge';
      badge.className = 'badge ok';
      meta.appendChild(badge);
    }

    const seconds = Math.max(0, Math.ceil((revealAt - Date.now()) / 1000));
    badge.textContent = `✅ Tous ont répondu · réponse dans ${seconds} s`;
  }

  function resetCountdown() {
    countdownQuestionId = null;
    revealAt = 0;
    removeNotice();
  }

  function armCountdown(state) {
    const questionId = state?.question?.id;
    if (!questionId) return;

    if (countdownQuestionId !== questionId) {
      countdownQuestionId = questionId;
      revealAt = Date.now() + REVEAL_DELAY_MS;
      actionDoneForQuestion = null;
    }
  }

  function reconcile() {
    const state = latestState;

    if (!everyoneAnswered(state)) {
      resetCountdown();
      return;
    }

    armCountdown(state);
    paintNotice();

    if (!revealAt || Date.now() < revealAt) return;

    const questionId = state?.question?.id;
    if (!questionId || actionDoneForQuestion === questionId) return;

    const button = document.getElementById('revealBtn');
    if (!button || button.disabled) {
      // Le host peut être en plein rerender : on réessaiera au prochain tick.
      return;
    }

    actionDoneForQuestion = questionId;
    button.click();
  }

  function evaluate(state) {
    latestState = state || null;
    reconcile();
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithAutoReveal(options = {}) {
    const transport = originalCreateTransport(options);

    if (options.role === 'host' && transport?.send) {
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (type === 'state' && payload && typeof payload === 'object') {
          evaluate(payload);
        }
        return originalSend(type, payload);
      };
    }

    return transport;
  };

  // Une boucle courte rend l'action robuste aux rerenders et au throttling
  // occasionnel des timers par le navigateur.
  setInterval(reconcile, 250);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcile();
  });
  window.addEventListener('focus', reconcile);
  window.addEventListener('pagehide', removeNotice);
})();