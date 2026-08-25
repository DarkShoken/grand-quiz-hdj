(() => {
  const G = window.GrandQuiz;
  if (!G || G.__deadlineGuardInstalled) return;
  G.__deadlineGuardInstalled = true;

  const originalCreateTransport = G.createTransport.bind(G);
  let hostSnapshot = null;
  let lastActionKey = '';

  function expired(value) {
    const deadline = Number(value);
    return Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline;
  }

  function reconcile() {
    const state = hostSnapshot;
    if (!state) return;

    if (
      state.phase === 'question' &&
      state.question?.type !== 'buzzer' &&
      expired(state.deadline)
    ) {
      const key = `question:${state.question?.id || state.questionNumber}:${state.deadline}`;
      if (lastActionKey === key) return;
      const button = document.getElementById('revealBtn');
      if (!button || button.disabled) return;
      lastActionKey = key;
      button.click();
      return;
    }

    if (state.phase === 'reveal' && expired(state.revealDeadline)) {
      const key = `reveal:${state.question?.id || state.questionNumber}:${state.revealDeadline}`;
      if (lastActionKey === key) return;
      const button = document.getElementById('nextBtn');
      if (!button || button.disabled) return;
      lastActionKey = key;
      button.click();
      return;
    }

    lastActionKey = '';
  }

  G.createTransport = function createTransportWithDeadlineGuard(options = {}) {
    if (options.role !== 'host') return originalCreateTransport(options);

    const originalOnMessage = options.onMessage;
    const wrappedOptions = {
      ...options,
      onMessage(message) {
        // Important : si le navigateur a retardé les timers en arrière-plan,
        // tout message entrant devient une occasion de recaler immédiatement
        // la partie sur les deadlines absolues envoyées aux clients.
        reconcile();
        originalOnMessage?.(message);
        reconcile();
      },
    };

    const transport = originalCreateTransport(wrappedOptions);
    if (!transport?.send) return transport;

    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload) => {
      if (type === 'state' && payload) {
        hostSnapshot = payload;
        reconcile();
      }
      return originalSend(type, payload);
    };

    return transport;
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcile();
  });
  window.addEventListener('focus', reconcile);
})();