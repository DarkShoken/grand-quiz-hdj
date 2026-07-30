(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  let suppressOneLeaderboardState = false;

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithEmergencySkip(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role === 'host') {
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (type === 'state' && suppressOneLeaderboardState && payload?.phase === 'leaderboard') {
          suppressOneLeaderboardState = false;
          return Promise.resolve(true);
        }
        return originalSend(type, payload);
      };
    }
    return transport;
  };

  function addEmergencyButton() {
    const stage = document.getElementById('hostStage');
    if (!stage) return;
    const rankButton = stage.querySelector('#rankBtn');
    const nextButton = stage.querySelector('#nextBtn');
    if (!rankButton || nextButton || stage.querySelector('#emergencyNextBtn')) return;

    const actions = rankButton.closest('.actions');
    if (!actions) return;

    const button = document.createElement('button');
    button.id = 'emergencyNextBtn';
    button.className = 'btn danger';
    button.type = 'button';
    button.textContent = '⏭ Passer à la question suivante';
    button.addEventListener('click', () => {
      suppressOneLeaderboardState = true;
      rankButton.click();
      const generatedNextButton = document.getElementById('nextBtn');
      if (generatedNextButton) generatedNextButton.click();
      else suppressOneLeaderboardState = false;
    });
    actions.appendChild(button);
  }

  const observer = new MutationObserver(addEmergencyButton);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    addEmergencyButton();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
