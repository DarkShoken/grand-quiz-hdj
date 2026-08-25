(() => {
  const G = window.GrandQuiz;
  if (!G) return;

  const room = G.cleanRoom(G.qs('room', 'QUIZ'));
  let state = null;
  let lastRequestAt = 0;

  const style = document.createElement('style');
  style.textContent = `
    #playerLiveTimer {
      position: fixed;
      top: 118px;
      right: 24px;
      z-index: 12000;
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 5px solid #4cc9f0;
      background: rgba(9, 12, 29, .96);
      box-shadow: 0 10px 28px rgba(0,0,0,.42);
      color: #fff;
      font-size: 29px;
      font-weight: 1000;
      line-height: 1;
      box-sizing: border-box;
      pointer-events: none;
      font-family: inherit;
    }
    #playerLiveTimer.hidden { display: none !important; }
    #playerLiveTimer.reveal {
      border-color: #ffd166;
      background: rgba(9, 12, 29, .96);
    }
    #playerLiveTimer.urgent {
      border-color: #ff4d6d;
      background: rgba(9, 12, 29, .96);
    }

    @media (max-width: 700px) {
      #playerLiveTimer {
        top: max(7px, env(safe-area-inset-top));
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        width: 38px;
        height: 38px;
        border-width: 3px;
        font-size: 17px;
        box-shadow: 0 5px 16px rgba(0,0,0,.35);
      }

      /* Sur l'écran Réponse, le titre est centré en haut :
         on déplace donc le chrono dans le coin supérieur droit. */
      #playerLiveTimer.reveal {
        top: max(8px, env(safe-area-inset-top));
        left: auto;
        right: 10px;
        transform: none;
      }
    }
  `;
  document.head.appendChild(style);

  const node = document.createElement('div');
  node.id = 'playerLiveTimer';
  node.className = 'hidden';
  node.textContent = '—';
  document.body.appendChild(node);

  function requestState() {
    const now = Date.now();
    if (now - lastRequestAt < 1200) return;
    lastRequestAt = now;
    transport.send('state_request', { from: 'player-countdown' });
  }

  function render() {
    let deadline = null;
    let reveal = false;

    if (state?.phase === 'question' && state?.question?.type !== 'buzzer' && state?.deadline) {
      deadline = Number(state.deadline);
    } else if (state?.phase === 'reveal' && state?.revealDeadline) {
      deadline = Number(state.revealDeadline);
      reveal = true;
    }

    if (!deadline || !Number.isFinite(deadline)) {
      node.classList.add('hidden');
      node.classList.remove('reveal', 'urgent');
      return;
    }

    const seconds = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
    node.textContent = String(seconds);
    node.classList.toggle('reveal', reveal);
    node.classList.toggle('urgent', seconds <= 5);
    node.classList.remove('hidden');
  }

  const transport = G.createTransport({
    room,
    role: 'player-countdown',
    onMessage: (message) => {
      if (message.type !== 'state') return;
      state = message.payload || null;
      render();
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