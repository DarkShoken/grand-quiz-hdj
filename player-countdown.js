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
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 172px;
      padding: 12px 16px;
      border-radius: 20px;
      background: rgba(10, 13, 34, .96);
      border: 2px solid rgba(76, 201, 240, .55);
      box-shadow: 0 14px 42px rgba(0,0,0,.45);
      color: #fff;
      pointer-events: none;
      font-family: inherit;
    }
    #playerLiveTimer.hidden { display: none !important; }
    #playerLiveTimer.reveal { border-color: rgba(255, 209, 102, .7); }
    #playerLiveTimerValue {
      width: 64px;
      height: 64px;
      flex: 0 0 64px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 5px solid #4cc9f0;
      background: rgba(76, 201, 240, .16);
      font-size: 29px;
      font-weight: 1000;
      line-height: 1;
      box-sizing: border-box;
    }
    #playerLiveTimer.reveal #playerLiveTimerValue {
      border-color: #ffd166;
      background: rgba(255, 209, 102, .14);
    }
    #playerLiveTimerText { display: grid; gap: 3px; }
    #playerLiveTimerLabel { font-size: 16px; font-weight: 950; white-space: nowrap; }
    #playerLiveTimerHint { font-size: 12px; color: #b9c2e1; font-weight: 750; white-space: nowrap; }
    #playerLiveTimer.urgent #playerLiveTimerValue {
      border-color: #ff4d6d;
      background: rgba(255, 77, 109, .16);
    }

    @media (max-width: 700px) {
      #playerLiveTimer {
        top: max(7px, env(safe-area-inset-top));
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        min-width: 0;
        padding: 0;
        gap: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
      }
      #playerLiveTimerValue {
        width: 38px;
        height: 38px;
        flex-basis: 38px;
        border-width: 3px;
        font-size: 17px;
        background: rgba(9, 12, 29, .96);
        box-shadow: 0 5px 16px rgba(0,0,0,.35);
      }
      #playerLiveTimerText { display: none; }
    }
  `;
  document.head.appendChild(style);

  const node = document.createElement('div');
  node.id = 'playerLiveTimer';
  node.className = 'hidden';
  node.innerHTML = `
    <div id="playerLiveTimerValue">—</div>
    <div id="playerLiveTimerText">
      <strong id="playerLiveTimerLabel">Temps restant</strong>
      <span id="playerLiveTimerHint">Réponds maintenant</span>
    </div>
  `;
  document.body.appendChild(node);

  const valueNode = document.getElementById('playerLiveTimerValue');
  const labelNode = document.getElementById('playerLiveTimerLabel');
  const hintNode = document.getElementById('playerLiveTimerHint');

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
      labelNode.textContent = 'Temps restant';
      hintNode.textContent = 'Réponds maintenant';
    } else if (state?.phase === 'reveal' && state?.revealDeadline) {
      deadline = Number(state.revealDeadline);
      reveal = true;
      labelNode.textContent = 'Question suivante';
      hintNode.textContent = 'Temps pour commenter';
    }

    if (!deadline || !Number.isFinite(deadline)) {
      node.classList.add('hidden');
      node.classList.remove('reveal', 'urgent');
      return;
    }

    const seconds = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
    valueNode.textContent = String(seconds);
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