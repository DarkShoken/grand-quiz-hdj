(() => {
  const G = window.GrandQuiz;
  if (!G) return;

  const room = G.cleanRoom(G.qs('room', 'QUIZ'));
  const valueNode = document.getElementById('metricTimer');
  const labelNode = document.getElementById('metricTimerLabel');
  const metricNode = valueNode?.closest('.metric');

  if (!valueNode || !labelNode) return;

  let state = null;
  let lastRequestAt = 0;

  function requestState() {
    const now = Date.now();
    if (now - lastRequestAt < 1500) return;
    lastRequestAt = now;
    transport.send('state_request', { from: 'host-countdown' });
  }

  function applyState(nextState) {
    state = nextState || null;
    render();
  }

  function setDisplay(label, value, urgent = false) {
    labelNode.textContent = label;
    valueNode.textContent = value;
    metricNode?.classList.toggle('timer-urgent', urgent);
  }

  function render() {
    if (!state) {
      setDisplay('Temps', '—');
      return;
    }

    if (state.phase === 'question') {
      if (state.question?.type === 'buzzer' || !state.deadline) {
        setDisplay('Temps question', '∞');
        return;
      }

      const leftMs = Math.max(0, Number(state.deadline) - Date.now());
      const seconds = Math.ceil(leftMs / 1000);
      setDisplay('Temps question', String(seconds), seconds <= 5);
      return;
    }

    if (state.phase === 'reveal') {
      if (!state.revealDeadline) {
        setDisplay('Question suivante', '—');
        return;
      }

      const leftMs = Math.max(0, Number(state.revealDeadline) - Date.now());
      const seconds = Math.ceil(leftMs / 1000);
      setDisplay('Question suivante', String(seconds), seconds <= 5);
      return;
    }

    if (state.phase === 'leaderboard') {
      setDisplay('Temps', 'Pause');
      return;
    }

    if (state.phase === 'finished') {
      setDisplay('Temps', 'Fin');
      return;
    }

    setDisplay('Temps', '—');
  }

  const transport = G.createTransport({
    room,
    role: 'host-countdown',
    onMessage: (message) => {
      if (message.type === 'state') applyState(message.payload);
    },
    onStatus: ({ ready }) => {
      if (ready) requestState();
    },
  });

  setInterval(render, 100);
  setInterval(requestState, 2500);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestState();
  });
})();