(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  let paused = false;
  let latestState = null;
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'quizClientPauseOverlay';
    overlay.className = 'quiz-client-pause-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="quiz-client-pause-card"><div class="quiz-client-pause-icon">⏸</div><strong>Partie en pause</strong><span>Le soignant relancera le jeu dans un instant.</span></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateOverlay() {
    const node = ensureOverlay();
    node.hidden = !paused;
    node.setAttribute('aria-hidden', paused ? 'false' : 'true');
    document.body.classList.toggle('quiz-client-paused', paused);
  }

  const style = document.createElement('style');
  style.textContent = `
    .quiz-client-pause-overlay{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:22px;background:rgba(5,7,20,.84);backdrop-filter:blur(9px)}
    .quiz-client-pause-overlay[hidden]{display:none!important}
    .quiz-client-pause-card{width:min(560px,94vw);padding:30px 24px;border-radius:26px;text-align:center;background:#12162d;border:1px solid rgba(255,255,255,.17);box-shadow:0 30px 90px rgba(0,0,0,.58)}
    .quiz-client-pause-icon{font-size:clamp(3rem,10vw,6rem);line-height:1;margin-bottom:12px}
    .quiz-client-pause-card strong{display:block;font-size:clamp(1.8rem,6vw,3.4rem);line-height:1.05}
    .quiz-client-pause-card span{display:block;margin-top:12px;color:var(--muted);font-size:clamp(1rem,3vw,1.3rem)}
  `;
  document.head.appendChild(style);

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithPauseClient(options = {}) {
    const originalOnMessage = options.onMessage;
    const wrappedOptions = {
      ...options,
      onMessage(message) {
        if (message?.type === 'state') {
          latestState = message.payload || null;
          paused = Boolean(latestState?.paused);
        }
        originalOnMessage?.(message);
        if (message?.type === 'state') requestAnimationFrame(updateOverlay);
      },
    };

    const transport = originalCreateTransport(wrappedOptions);
    if (options.role === 'player') {
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (paused && ['answer', 'buzz'].includes(type)) return Promise.resolve(false);
        return originalSend(type, payload);
      };
    }
    return transport;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureOverlay, { once: true });
  else ensureOverlay();

  window.GrandQuizPauseClient = {
    get paused() { return paused; },
    get state() { return latestState; },
  };
})();