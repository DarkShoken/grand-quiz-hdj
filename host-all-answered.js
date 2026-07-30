(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const REVEAL_DELAY_MS = 5000;
  let latestState = null;
  let countdownTimer = null;
  let countdownTick = null;
  let countdownQuestionId = null;
  let revealAt = 0;

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
    return activePlayers.every((playerId) => answered.has(playerId));
  }

  function removeNotice() {
    document.getElementById('allAnsweredRevealBadge')?.remove();
  }

  function paintNotice() {
    if (!countdownTimer || !revealAt || latestState?.phase !== 'question') {
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

  function clearCountdown() {
    clearTimeout(countdownTimer);
    clearInterval(countdownTick);
    countdownTimer = null;
    countdownTick = null;
    countdownQuestionId = null;
    revealAt = 0;
    removeNotice();
  }

  function startCountdown(state) {
    const questionId = state?.question?.id;
    if (!questionId) return;
    if (countdownTimer && countdownQuestionId === questionId) return;

    clearCountdown();
    countdownQuestionId = questionId;
    revealAt = Date.now() + REVEAL_DELAY_MS;

    countdownTick = setInterval(paintNotice, 200);
    requestAnimationFrame(paintNotice);

    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      clearInterval(countdownTick);
      countdownTick = null;
      removeNotice();

      if (
        latestState?.phase === 'question' &&
        latestState?.question?.id === questionId &&
        everyoneAnswered(latestState)
      ) {
        document.getElementById('revealBtn')?.click();
      }
    }, REVEAL_DELAY_MS);
  }

  function evaluate(state) {
    latestState = state;
    if (everyoneAnswered(state)) startCountdown(state);
    else clearCountdown();
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithAutoReveal(options = {}) {
    const transport = originalCreateTransport(options);

    if (options.role === 'host') {
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

  window.addEventListener('pagehide', clearCountdown);
})();
