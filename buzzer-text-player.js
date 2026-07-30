(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  let latestState = null;
  let playerTransport = null;
  let identity = null;
  let currentQuestionId = null;
  let draftValue = '';
  let localStatus = '';
  let renderQueued = false;

  function isWrittenBuzzer() {
    return ['buzzer', 'free', 'text'].includes(latestState?.question?.type);
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderControls();
    });
  }

  function ownAnswer() {
    if (!identity?.playerId) return '';
    const values = latestState?.playerAnswers || {};
    return Object.prototype.hasOwnProperty.call(values, identity.playerId)
      ? String(values[identity.playerId] ?? '')
      : '';
  }

  function renderControls() {
    if (!isWrittenBuzzer() || latestState?.phase !== 'question') return;
    const app = document.getElementById('app');
    if (!app) return;

    const questionId = latestState.question?.id || null;
    if (questionId !== currentQuestionId) {
      currentQuestionId = questionId;
      draftValue = ownAnswer();
      localStatus = '';
    }

    const existingPanel = app.querySelector('.written-buzzer-panel');
    const originalButton = app.querySelector('#buzzBtn');
    if (!existingPanel && !originalButton) return;

    let panel = existingPanel;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'written-buzzer-panel';
      panel.innerHTML = `
        <label for="writtenBuzzerInput">Ta réponse</label>
        <input id="writtenBuzzerInput" type="text" maxlength="120" autocomplete="off" autocapitalize="sentences" placeholder="Écris ta réponse…">
        <button id="writtenBuzzerSend" class="btn green" type="button">Envoyer ma réponse</button>
        <div id="writtenBuzzerStatus" class="written-buzzer-status" aria-live="polite"></div>`;

      const oldFeedback = originalButton?.nextElementSibling?.classList.contains('feedback')
        ? originalButton.nextElementSibling
        : null;
      originalButton?.replaceWith(panel);
      oldFeedback?.remove();

      const input = panel.querySelector('#writtenBuzzerInput');
      const sendButton = panel.querySelector('#writtenBuzzerSend');
      input?.addEventListener('input', () => { draftValue = input.value; });
      input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendAnswer();
        }
      });
      sendButton?.addEventListener('click', sendAnswer);
    }

    const input = panel.querySelector('#writtenBuzzerInput');
    const sendButton = panel.querySelector('#writtenBuzzerSend');
    const status = panel.querySelector('#writtenBuzzerStatus');
    if (!input || !sendButton || !status) return;

    const stored = ownAnswer();
    if (stored && document.activeElement !== input) draftValue = stored;
    if (input.value !== draftValue && document.activeElement !== input) input.value = draftValue;

    const activePlayerId = latestState?.buzzedPlayerId || null;
    const isMine = Boolean(activePlayerId && identity?.playerId && activePlayerId === identity.playerId);
    const lockedByOther = Boolean(activePlayerId && !isMine);
    const nextButtonText = isMine || stored ? 'Modifier ma réponse' : 'Envoyer ma réponse';

    if (input.disabled !== lockedByOther) input.disabled = lockedByOther;
    if (sendButton.disabled !== lockedByOther) sendButton.disabled = lockedByOther;
    if (sendButton.textContent !== nextButtonText) sendButton.textContent = nextButtonText;

    let nextStatus = 'Le premier envoi prend la main.';
    if (localStatus) nextStatus = localStatus;
    else if (isMine) nextStatus = '✅ Ta réponse est transmise au soignant.';
    else if (lockedByOther) nextStatus = `⏳ ${latestState?.buzzedPlayer || 'Un participant'} a pris la main.`;
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
  }

  async function sendAnswer() {
    if (!playerTransport || !identity?.playerId || !isWrittenBuzzer()) return;
    const input = document.getElementById('writtenBuzzerInput');
    const value = String(input?.value || draftValue).replace(/\s+/g, ' ').trim();
    if (!value) {
      localStatus = 'Écris une réponse avant de l’envoyer.';
      scheduleRender();
      input?.focus();
      return;
    }

    const activePlayerId = latestState?.buzzedPlayerId || null;
    if (activePlayerId && activePlayerId !== identity.playerId) return;

    draftValue = value;
    localStatus = '⏳ Envoi de la réponse…';
    scheduleRender();

    const result = await playerTransport.send('answer', {
      ...identity,
      questionId: latestState.question.id,
      value,
      revision: Date.now(),
    });

    if (result === false) {
      localStatus = '⚠️ Réponse non enregistrée.';
      scheduleRender();
    }
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithWrittenBuzzer(options = {}) {
    const originalOnMessage = options.onMessage;
    const transport = originalCreateTransport({
      ...options,
      onMessage(message) {
        if (options.role === 'player' && message?.type === 'state') {
          const previousQuestionId = latestState?.question?.id || null;
          latestState = message.payload;
          const nextQuestionId = latestState?.question?.id || null;
          if (previousQuestionId !== nextQuestionId) {
            currentQuestionId = nextQuestionId;
            draftValue = '';
            localStatus = '';
          }
          const stored = ownAnswer();
          if (stored) draftValue = stored;
          if (!latestState?.buzzedPlayerId && !stored) localStatus = '';
          scheduleRender();
        }

        if (options.role === 'player' && message?.type === 'answer_ack') {
          const payload = message.payload || {};
          if (identity?.playerId && payload.playerId === identity.playerId) {
            if (payload.accepted) localStatus = '✅ Ta réponse est transmise au soignant.';
            else if (payload.reason === 'locked') localStatus = '⏳ Un autre participant a pris la main.';
            else if (payload.reason === 'closed') localStatus = '⏱ La question est terminée.';
            else localStatus = '⚠️ Réponse non enregistrée.';
            scheduleRender();
          }
        }

        originalOnMessage?.(message);
      },
    });

    if (options.role === 'player') {
      playerTransport = transport;
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (['join', 'heartbeat', 'leave'].includes(type) && payload?.playerId) {
          identity = {
            playerId: payload.playerId,
            name: payload.name,
            team: payload.team,
          };
        }
        return originalSend(type, payload);
      };
    }

    return transport;
  };

  const observer = new MutationObserver(scheduleRender);
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
