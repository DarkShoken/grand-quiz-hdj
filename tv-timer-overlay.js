(() => {
  const G = window.GrandQuiz;
  if (!G) return;

  const room = G.cleanRoom(G.qs('room', 'QUIZ'));
  let state = null;

  const style = document.createElement('style');
  style.textContent = `
    #tvStandaloneTimer {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 10000;
      min-width: 150px;
      padding: 12px 16px;
      border-radius: 20px;
      background: rgba(8, 10, 28, .96);
      border: 2px solid rgba(255,255,255,.22);
      box-shadow: 0 12px 40px rgba(0,0,0,.48);
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: none;
      color: #fff;
      font-family: inherit;
    }
    #tvStandaloneTimer.hidden { display: none !important; }
    #tvStandaloneTimerValue {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      flex: 0 0 68px;
      font-size: 30px;
      line-height: 1;
      font-weight: 1000;
      color: #fff;
      background: rgba(76, 201, 240, .17);
      border: 5px solid #4cc9f0;
      box-sizing: border-box;
    }
    #tvStandaloneTimer.reveal #tvStandaloneTimerValue {
      border-color: #ffd166;
      background: rgba(255, 209, 102, .16);
    }
    #tvStandaloneTimerText {
      display: flex;
      flex-direction: column;
      gap: 2px;
      white-space: nowrap;
    }
    #tvStandaloneTimerText strong {
      font-size: 18px;
      font-weight: 950;
    }
    #tvStandaloneTimerText span {
      font-size: 13px;
      color: #b9c2e1;
      font-weight: 750;
    }
    @media (max-width: 820px) {
      #tvStandaloneTimer {
        right: 10px;
        bottom: 10px;
        min-width: 0;
        padding: 8px 10px;
      }
      #tvStandaloneTimerValue {
        width: 54px;
        height: 54px;
        flex-basis: 54px;
        font-size: 24px;
      }
      #tvStandaloneTimerText strong { font-size: 15px; }
      #tvStandaloneTimerText span { display: none; }
    }
  `;
  document.head.appendChild(style);

  const node = document.createElement('div');
  node.id = 'tvStandaloneTimer';
  node.className = 'hidden';
  node.innerHTML = `
    <div id="tvStandaloneTimerValue">—</div>
    <div id="tvStandaloneTimerText">
      <strong id="tvStandaloneTimerLabel">Temps restant</strong>
      <span id="tvStandaloneTimerHint">Répondez maintenant</span>
    </div>
  `;
  document.body.appendChild(node);

  const valueNode = document.getElementById('tvStandaloneTimerValue');
  const labelNode = document.getElementById('tvStandaloneTimerLabel');
  const hintNode = document.getElementById('tvStandaloneTimerHint');

  function update() {
    if (!state) {
      node.classList.add('hidden');
      return;
    }

    let deadline = null;
    let reveal = false;

    if (state.phase === 'question' && state.question?.type !== 'buzzer' && state.deadline) {
      deadline = Number(state.deadline);
      labelNode.textContent = 'Temps restant';
      hintNode.textContent = 'Répondez maintenant';
    } else if (state.phase === 'reveal' && state.revealDeadline) {
      deadline = Number(state.revealDeadline);
      reveal = true;
      labelNode.textContent = 'Question suivante';
      hintNode.textContent = 'Temps pour commenter';
    }

    if (!deadline || !Number.isFinite(deadline)) {
      node.classList.add('hidden');
      return;
    }

    const ms = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(ms / 1000);
    valueNode.textContent = String(seconds);
    node.classList.toggle('reveal', reveal);
    node.classList.remove('hidden');
  }

  function requestState() {
    transport.send('state_request', { from: 'screen-timer' });
  }

  const transport = G.createTransport({
    room,
    role: 'screen-timer',
    onMessage: (message) => {
      if (message.type !== 'state') return;
      state = message.payload || null;
      update();
    },
    onStatus: ({ ready }) => {
      if (ready) requestState();
    },
  });

  setInterval(update, 100);
  setInterval(requestState, 3000);
})();